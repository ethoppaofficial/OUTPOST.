-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261115000015_system_audit_fixes.sql
-- Description:
--   System-wide audit remediations for transactional reliability & persistence:
--   1. Adds submit_payment_receipt_atomic() RPC so direct Storage receipt
--      submissions atomically transition reservations to 'payment_submitted'
--      and invoices to 'processing', preventing false 7-day hold expiration.
--   2. Adds update_unit_availability_atomic() RPC so landlords can adjust
--      room capacity & available spaces on approved/published properties
--      without hitting the non-approved properties UPDATE RLS block.
--   3. Adds accommodation_groups.visibility column with validated constraint
--      so discoverable / request_required / invite_only cohort policies persist.
--   4. Adds public.property_reports table with strict RLS so safety reports
--      from listings persist in PostgreSQL for administrative review.
-- ============================================================================

-- ============================================================================
-- 1. Atomic Payment Receipt Submission RPC (for Edge-unavailable fallback)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_payment_receipt_atomic(
  p_receipt_id UUID,
  p_reservation_id UUID,
  p_storage_path TEXT,
  p_file_name TEXT,
  p_content_type TEXT,
  p_file_size BIGINT,
  p_amount_paid NUMERIC,
  p_payment_reference TEXT,
  p_payer_bank_name TEXT,
  p_payment_date TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_res RECORD;
  v_invoice_id UUID;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_expected_prefix TEXT;
  v_clean_ref TEXT := COALESCE(NULLIF(btrim(p_payment_reference), ''), 'DIRECT_TRANSFER');
  v_clean_bank TEXT := COALESCE(NULLIF(btrim(p_payer_bank_name), ''), 'Bank');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit a payment receipt.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND account_status = 'suspended') THEN
    RAISE EXCEPTION 'Suspended accounts cannot submit payment receipts.'
      USING ERRCODE = '42501';
  END IF;

  IF p_file_size IS NULL OR p_file_size <= 0 OR p_file_size > 10485760 THEN
    RAISE EXCEPTION 'Invalid file size (must be between 1 byte and 10 MB).'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_paid IS NULL OR p_amount_paid <= 0 THEN
    RAISE EXCEPTION 'Amount paid must be greater than zero.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_res.student_id != v_uid THEN
    RAISE EXCEPTION 'Forbidden: you do not own this reservation.'
      USING ERRCODE = '42501';
  END IF;

  IF v_res.status NOT IN ('pending_payment', 'payment_submitted') THEN
    RAISE EXCEPTION 'Cannot upload receipt for a % reservation.', v_res.status
      USING ERRCODE = '22023';
  END IF;

  v_expected_prefix := v_res.landlord_id::text || '/' || v_uid::text || '/' || p_reservation_id::text || '/' || p_receipt_id::text || '/';
  IF p_storage_path IS NULL OR LEFT(p_storage_path, length(v_expected_prefix)) != v_expected_prefix THEN
    RAISE EXCEPTION 'Security violation: storage path does not match reservation receipt parameters.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_invoice_id
  FROM public.invoices
  WHERE reservation_id = p_reservation_id
  LIMIT 1;

  INSERT INTO public.payment_receipts (
    id,
    reservation_id,
    invoice_id,
    student_id,
    landlord_id,
    property_id,
    storage_path,
    file_name,
    content_type,
    file_size,
    amount_paid,
    payment_reference,
    payer_bank_name,
    payment_date,
    status
  )
  VALUES (
    p_receipt_id,
    p_reservation_id,
    v_invoice_id,
    v_uid,
    v_res.landlord_id,
    v_res.property_id,
    p_storage_path,
    COALESCE(NULLIF(btrim(p_file_name), ''), 'receipt'),
    COALESCE(NULLIF(btrim(p_content_type), ''), 'application/octet-stream'),
    p_file_size,
    p_amount_paid,
    v_clean_ref,
    v_clean_bank,
    COALESCE(p_payment_date, v_now),
    'pending_review'
  );

  UPDATE public.reservations
  SET
    status = 'payment_submitted',
    payment_receipt_id = p_receipt_id,
    payment_receipt_submitted_at = v_now,
    updated_at = v_now
  WHERE id = p_reservation_id;

  IF v_invoice_id IS NOT NULL THEN
    UPDATE public.invoices
    SET
      status = 'processing',
      updated_at = v_now
    WHERE id = v_invoice_id
      AND status != 'paid';
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_res.landlord_id,
    'Payment Receipt Submitted',
    'Student submitted a bank transfer receipt for verification. Review and confirm.',
    'receipt',
    '/landlord/receipts'
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_uid,
    'SUBMIT_PAYMENT_RECEIPT',
    'payment_receipt',
    p_receipt_id::text,
    jsonb_build_object(
      'reservation_id', p_reservation_id,
      'amount_paid', p_amount_paid,
      'storage_path', p_storage_path
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', p_receipt_id,
    'reservation_id', p_reservation_id,
    'status', 'payment_submitted'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_payment_receipt_atomic(UUID, UUID, TEXT, TEXT, TEXT, BIGINT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_payment_receipt_atomic(UUID, UUID, TEXT, TEXT, TEXT, BIGINT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) TO authenticated, service_role;

-- ============================================================================
-- 2. Atomic Room/Unit Capacity & Availability Update RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_unit_availability_atomic(
  p_property_id UUID,
  p_unit_id UUID,
  p_available_spaces INTEGER,
  p_capacity INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_prop RECORD;
  v_unit RECORD;
  v_next_avail INTEGER;
  v_next_cap INTEGER;
  v_total_cap INTEGER;
  v_total_avail INTEGER;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to update room availability.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop
  FROM public.properties
  WHERE id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_prop.landlord_id != v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: only the property landlord or an administrator can manage room spaces.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_unit
  FROM public.units
  WHERE id = p_unit_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room unit not found for this property.'
      USING ERRCODE = 'P0002';
  END IF;

  v_next_avail := GREATEST(0, COALESCE(p_available_spaces, v_unit.available_spaces));
  v_next_cap := GREATEST(1, COALESCE(p_capacity, GREATEST(v_unit.capacity, v_next_avail)));
  IF v_next_avail > v_next_cap THEN
    v_next_cap := v_next_avail;
  END IF;

  UPDATE public.units
  SET
    capacity = v_next_cap,
    available_spaces = v_next_avail,
    is_active = (v_next_avail > 0),
    updated_at = v_now
  WHERE id = p_unit_id;

  SELECT
    COALESCE(SUM(capacity), 0)::integer,
    COALESCE(SUM(available_spaces), 0)::integer
  INTO v_total_cap, v_total_avail
  FROM public.units
  WHERE property_id = p_property_id;

  UPDATE public.properties
  SET
    total_spaces = GREATEST(1, v_total_cap),
    available_spaces = GREATEST(0, v_total_avail),
    updated_at = v_now
  WHERE id = p_property_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_uid,
    'UPDATE_UNIT_AVAILABILITY',
    'units',
    p_unit_id::text,
    jsonb_build_object(
      'property_id', p_property_id,
      'available_spaces', v_next_avail,
      'capacity', v_next_cap,
      'property_available_spaces', v_total_avail,
      'property_total_spaces', v_total_cap
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'unit_id', p_unit_id,
    'available_spaces', v_next_avail,
    'capacity', v_next_cap,
    'property_available_spaces', v_total_avail,
    'property_total_spaces', v_total_cap
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_unit_availability_atomic(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_unit_availability_atomic(UUID, UUID, INTEGER, INTEGER) TO authenticated, service_role;

-- ============================================================================
-- 3. Accommodation Group Visibility Column
-- ============================================================================

ALTER TABLE public.accommodation_groups
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'discoverable';

ALTER TABLE public.accommodation_groups
  DROP CONSTRAINT IF EXISTS chk_accommodation_groups_visibility;

ALTER TABLE public.accommodation_groups
  ADD CONSTRAINT chk_accommodation_groups_visibility
  CHECK (visibility IN ('discoverable', 'invite_only', 'request_required'));

-- ============================================================================
-- 4. Persisted Property Safety Reports Table & RLS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.property_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 2),
  details TEXT NOT NULL CHECK (length(btrim(details)) >= 5),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_property_reports_property_id ON public.property_reports(property_id);
CREATE INDEX IF NOT EXISTS idx_property_reports_status ON public.property_reports(status);

DROP TRIGGER IF EXISTS tr_property_reports_updated_at ON public.property_reports;
CREATE TRIGGER tr_property_reports_updated_at
  BEFORE UPDATE ON public.property_reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.property_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users create own property reports" ON public.property_reports;
CREATE POLICY "Authenticated users create own property reports"
  ON public.property_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND status = 'open'
  );

DROP POLICY IF EXISTS "Reporters or admins read property reports" ON public.property_reports;
CREATE POLICY "Reporters or admins read property reports"
  ON public.property_reports FOR SELECT
  TO authenticated
  USING (
    reporter_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins update property reports" ON public.property_reports;
CREATE POLICY "Admins update property reports"
  ON public.property_reports FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
