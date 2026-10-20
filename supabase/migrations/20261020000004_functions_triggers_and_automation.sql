-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261020000004_functions_triggers_and_automation.sql
-- Description: Business Invariants, Triggers, Atomic Transactions, and Expiration
-- ============================================================================

-- 1. Automatic updated_at Trigger Function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

-- Apply updated_at triggers to all relevant tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'profiles', 'student_profiles', 'landlord_profiles',
    'student_verification_documents', 'landlord_verification_submissions',
    'properties', 'units', 'property_locations', 'roommate_preferences',
    'roommate_requests', 'accommodation_groups', 'group_join_requests',
    'group_invitations', 'reservations', 'invoices', 'payment_receipts',
    'conversations', 'messages'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS tr_%I_updated_at ON public.%I;
      CREATE TRIGGER tr_%I_updated_at
      BEFORE UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
    ', t, t, t, t);
  END LOOP;
END $$;

-- ============================================================================
-- 2. Message 15-Minute Edit Restriction Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_message_edit_window()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.text IS DISTINCT FROM OLD.text THEN
    IF OLD.created_at < (timezone('utc'::text, now()) - interval '15 minutes') THEN
      RAISE EXCEPTION 'Message editing window has expired. Messages can only be edited within 15 minutes of sending.';
    END IF;
    NEW.is_edited = true;
    NEW.edited_at = timezone('utc'::text, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_messages_edit_window ON public.messages;
CREATE TRIGGER tr_messages_edit_window
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.check_message_edit_window();

-- ============================================================================
-- 3. Group Last-Admin Protection Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_removing_last_group_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin_count integer;
  v_group_id uuid;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'admin') OR (TG_OP = 'UPDATE' AND OLD.role = 'admin' AND NEW.role != 'admin') THEN
    v_group_id := OLD.group_id;
    SELECT count(*) INTO v_admin_count
    FROM public.group_members
    WHERE group_id = v_group_id AND role = 'admin' AND id != OLD.id;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'Action denied: An accommodation group must retain at least one active administrator.';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS tr_group_members_last_admin ON public.group_members;
CREATE TRIGGER tr_group_members_last_admin
BEFORE UPDATE OR DELETE ON public.group_members
FOR EACH ROW EXECUTE FUNCTION public.prevent_removing_last_group_admin();

-- ============================================================================
-- 4. Atomic Stored Procedure: create_reservation_atomic
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_reservation_atomic(
  p_student_id UUID,
  p_property_id UUID,
  p_unit_id UUID,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_property RECORD;
  v_unit RECORD;
  v_reservation_id UUID;
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_hold_expires TIMESTAMPTZ;
  v_existing_res RECORD;
BEGIN
  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_res FROM public.reservations WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'reservation_id', v_existing_res.id,
        'status', v_existing_res.status
      );
    END IF;
  END IF;

  -- 1. Validate property with row lock
  SELECT * INTO v_property
  FROM public.properties
  WHERE id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found.';
  END IF;

  IF v_property.approval_status != 'approved' OR NOT v_property.is_published THEN
    RAISE EXCEPTION 'Property is not published or approved for reservations.';
  END IF;

  -- 2. Validate unit with row lock
  SELECT * INTO v_unit
  FROM public.units
  WHERE id = p_unit_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unit not found in property.';
  END IF;

  IF v_unit.available_spaces <= 0 THEN
    RAISE EXCEPTION 'No available spaces remaining in this unit.';
  END IF;

  -- 3. Calculate 7-day hold window
  v_hold_expires := timezone('utc'::text, now() + interval '7 days');
  v_reservation_id := gen_random_uuid();
  v_invoice_id := gen_random_uuid();
  v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(v_reservation_id::text, 1, 6);

  -- 4. Decrement available spaces atomically
  UPDATE public.units
  SET available_spaces = available_spaces - 1
  WHERE id = p_unit_id;

  UPDATE public.properties
  SET available_spaces = available_spaces - 1
  WHERE id = p_property_id;

  -- 5. Insert reservation record
  INSERT INTO public.reservations (
    id, student_id, property_id, unit_id, landlord_id,
    status, hold_expires_at, amount, idempotency_key
  ) VALUES (
    v_reservation_id, p_student_id, p_property_id, p_unit_id, v_property.landlord_id,
    'pending_payment', v_hold_expires, v_unit.price_annual, p_idempotency_key
  );

  -- 6. Insert associated invoice
  INSERT INTO public.invoices (
    id, invoice_number, reservation_id, student_id, landlord_id, property_id,
    amount, breakdown, status, due_date
  ) VALUES (
    v_invoice_id, v_invoice_number, v_reservation_id, p_student_id, v_property.landlord_id, p_property_id,
    v_unit.price_annual,
    jsonb_build_object(
      'rental_fee', v_unit.price_annual,
      'caution_deposit', v_property.caution_deposit,
      'service_charge', v_property.service_charge
    ),
    'unpaid', v_hold_expires
  );

  -- 7. Audit log & notifications
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES
    (p_student_id, 'Reservation Created', 'Your 7-day payment hold is active. Please submit payment receipt before expiry.', 'reservation', '/reservations/' || v_reservation_id),
    (v_property.landlord_id, 'New Reservation Hold', 'A student placed a 7-day reservation hold on ' || v_property.title, 'reservation', '/landlord/receipts');

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (p_student_id, 'CREATE_RESERVATION', 'reservation', v_reservation_id::text, jsonb_build_object('amount', v_unit.price_annual, 'hold_expires_at', v_hold_expires));

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'invoice_id', v_invoice_id,
    'hold_expires_at', v_hold_expires
  );
END;
$$;

-- ============================================================================
-- 5. Atomic Stored Procedure: review_payment_receipt_atomic
-- ============================================================================

CREATE OR REPLACE FUNCTION public.review_payment_receipt_atomic(
  p_receipt_id UUID,
  p_decision receipt_status,
  p_reviewer_id UUID,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_receipt RECORD;
  v_res RECORD;
BEGIN
  -- 1. Fetch receipt with row lock
  SELECT * INTO v_receipt
  FROM public.payment_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found.';
  END IF;

  -- Authorization check: reviewer must be landlord or admin
  IF v_receipt.landlord_id != p_reviewer_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: only the property landlord or an administrator may review receipts.';
  END IF;

  IF v_receipt.status != 'pending_review' THEN
    RAISE EXCEPTION 'Receipt has already been reviewed with status: %', v_receipt.status;
  END IF;

  -- 2. Fetch reservation with row lock
  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = v_receipt.reservation_id
  FOR UPDATE;

  IF p_decision = 'approved' THEN
    -- Update receipt
    UPDATE public.payment_receipts
    SET status = 'approved',
        reviewed_at = timezone('utc'::text, now()),
        reviewed_by = p_reviewer_id
    WHERE id = p_receipt_id;

    -- Update reservation to confirmed
    UPDATE public.reservations
    SET status = 'confirmed',
        confirmed_at = timezone('utc'::text, now())
    WHERE id = v_receipt.reservation_id;

    -- Update invoice to paid
    IF v_receipt.invoice_id IS NOT NULL THEN
      UPDATE public.invoices
      SET status = 'paid',
          paid_at = timezone('utc'::text, now())
      WHERE id = v_receipt.invoice_id;
    END IF;

    -- Send confirmation notification
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_res.student_id, 'Payment Receipt Confirmed!', 'Your reservation has been confirmed by the landlord.', 'reservation', '/reservations/' || v_res.id);

  ELSIF p_decision = 'rejected' THEN
    IF p_rejection_reason IS NULL OR length(trim(p_rejection_reason)) = 0 THEN
      RAISE EXCEPTION 'A specific rejection reason is required when declining a receipt.';
    END IF;

    -- Update receipt
    UPDATE public.payment_receipts
    SET status = 'rejected',
        reviewed_at = timezone('utc'::text, now()),
        reviewed_by = p_reviewer_id,
        rejection_reason = p_rejection_reason
    WHERE id = p_receipt_id;

    -- Update reservation to rejected
    UPDATE public.reservations
    SET status = 'rejected',
        cancellation_reason = p_rejection_reason
    WHERE id = v_receipt.reservation_id;

    -- Restore unit & property inventory
    UPDATE public.units
    SET available_spaces = available_spaces + 1
    WHERE id = v_res.unit_id;

    UPDATE public.properties
    SET available_spaces = available_spaces + 1
    WHERE id = v_res.property_id;

    -- Send notification
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_res.student_id, 'Payment Receipt Declined', 'Receipt was declined: ' || p_rejection_reason, 'reservation', '/reservations/' || v_res.id);
  END IF;

  -- Audit log
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (p_reviewer_id, 'REVIEW_RECEIPT', 'payment_receipt', p_receipt_id::text, jsonb_build_object('decision', p_decision, 'reason', p_rejection_reason));

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', p_receipt_id,
    'status', p_decision
  );
END;
$$;

-- ============================================================================
-- 6. Scheduled Function: expire_pending_reservations
-- ============================================================================

CREATE OR REPLACE FUNCTION public.expire_pending_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_res RECORD;
  v_count INTEGER := 0;
BEGIN
  -- Select all expired unpaid reservations
  FOR v_res IN
    SELECT id, student_id, property_id, unit_id
    FROM public.reservations
    WHERE status = 'pending_payment'
      AND hold_expires_at <= timezone('utc'::text, now())
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 1. Mark reservation expired
    UPDATE public.reservations
    SET status = 'expired',
        expired_at = timezone('utc'::text, now()),
        cancellation_reason = '7-day unpaid hold period expired.'
    WHERE id = v_res.id;

    -- 2. Update associated invoice
    UPDATE public.invoices
    SET status = 'expired'
    WHERE reservation_id = v_res.id;

    -- 3. Restore inventory
    UPDATE public.units
    SET available_spaces = available_spaces + 1
    WHERE id = v_res.unit_id;

    UPDATE public.properties
    SET available_spaces = available_spaces + 1
    WHERE id = v_res.property_id;

    -- 4. Notify student
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_res.student_id, 'Reservation Expired', 'Your 7-day payment hold has expired and availability has been released.', 'reservation', '/reservations/' || v_res.id);

    -- 5. Audit log
    INSERT INTO public.audit_logs (action, entity_type, entity_id, details)
    VALUES ('EXPIRE_RESERVATION', 'reservation', v_res.id::text, jsonb_build_object('reason', '7-day hold elapsed'));

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Attempt to schedule with pg_cron if extension exists
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS "pg_cron";
  -- Hourly job to expire pending reservations
  PERFORM cron.schedule(
    'expire-unpaid-reservations-hourly',
    '0 * * * *',
    'SELECT public.expire_pending_reservations();'
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron extension not available in this environment; scheduled execution can be performed via Edge Function cron trigger.';
END $$;
