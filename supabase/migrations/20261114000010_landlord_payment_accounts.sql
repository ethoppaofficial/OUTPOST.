-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261114000010_landlord_payment_accounts.sql
-- Description:
--   Adds secure landlord direct bank transfer account management and snapshot
--   preservation for student reservation invoices:
--   1. Creates public.landlord_payment_accounts with Nigerian banking
--      constraints, normalization trigger, updated_at trigger, and partial
--      unique index enforcing one active payment account per landlord.
--   2. Enables + forces RLS on landlord_payment_accounts:
--      - Landlords manage (SELECT/INSERT/UPDATE) only their own accounts.
--      - Administrators have read-only (SELECT) oversight and cannot alter
--        landlord bank account details.
--      - Students can only read active account details for landlords linked to
--        their own eligible active reservations (no platform-wide listing).
--   3. Adds nullable payment_account_snapshot JSONB to public.invoices so
--      issued invoices preserve historical beneficiary details across future edits.
--   4. Adds upsert_landlord_payment_account() and
--      get_reservation_payment_details() SECURITY DEFINER RPCs without logging
--      raw account numbers in audit logs or error messages.
--   5. Updates create_reservation_atomic() to snapshot active landlord bank
--      details onto newly created invoices atomically.
-- ============================================================================

-- 1. Create normalized landlord_payment_accounts table
CREATE TABLE IF NOT EXISTS public.landlord_payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_holder_name TEXT NOT NULL CHECK (length(btrim(account_holder_name)) BETWEEN 2 AND 120),
  bank_name TEXT NOT NULL CHECK (length(btrim(bank_name)) BETWEEN 2 AND 100),
  account_number TEXT NOT NULL CHECK (account_number ~ '^[0-9]{10,12}$'),
  account_type TEXT CHECK (account_type IS NULL OR account_type IN ('savings', 'current', 'corporate')),
  payment_instructions TEXT CHECK (payment_instructions IS NULL OR length(btrim(payment_instructions)) <= 500),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enforce one active payment account per landlord
CREATE UNIQUE INDEX IF NOT EXISTS uq_landlord_payment_accounts_one_active
  ON public.landlord_payment_accounts (landlord_id)
  WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_landlord_payment_accounts_landlord_id
  ON public.landlord_payment_accounts (landlord_id, is_active, updated_at DESC);

-- Maintain updated_at automatically
DROP TRIGGER IF EXISTS tr_landlord_payment_accounts_updated_at ON public.landlord_payment_accounts;
CREATE TRIGGER tr_landlord_payment_accounts_updated_at
  BEFORE UPDATE ON public.landlord_payment_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Normalize and validate inputs before insert/update
CREATE OR REPLACE FUNCTION public.normalize_landlord_payment_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_clean_number TEXT;
  v_role public.user_role;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = NEW.landlord_id;

  IF v_role IS DISTINCT FROM 'landlord'::public.user_role THEN
    RAISE EXCEPTION 'Only landlord profiles may hold landlord payment account records.'
      USING ERRCODE = '23514';
  END IF;

  NEW.account_holder_name := regexp_replace(btrim(COALESCE(NEW.account_holder_name, '')), '\s+', ' ', 'g');
  NEW.bank_name := regexp_replace(btrim(COALESCE(NEW.bank_name, '')), '\s+', ' ', 'g');
  v_clean_number := regexp_replace(btrim(COALESCE(NEW.account_number, '')), '[\s\-]', '', 'g');

  IF v_clean_number !~ '^[0-9]{10,12}$' THEN
    RAISE EXCEPTION 'Invalid Nigerian bank account number format. Provide 10 digits (NUBAN) or 10-12 digits if your bank uses an extended format.'
      USING ERRCODE = '22023';
  END IF;
  NEW.account_number := v_clean_number;

  IF NEW.account_type IS NOT NULL THEN
    NEW.account_type := NULLIF(LOWER(btrim(NEW.account_type)), '');
  END IF;

  IF NEW.payment_instructions IS NOT NULL THEN
    NEW.payment_instructions := NULLIF(btrim(NEW.payment_instructions), '');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_landlord_payment_accounts_normalize ON public.landlord_payment_accounts;
CREATE TRIGGER tr_landlord_payment_accounts_normalize
  BEFORE INSERT OR UPDATE ON public.landlord_payment_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_landlord_payment_account();

-- ============================================================================
-- 2. Enable & Force Row-Level Security on landlord_payment_accounts
-- ============================================================================

ALTER TABLE public.landlord_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_payment_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Landlords read own payment accounts" ON public.landlord_payment_accounts;
CREATE POLICY "Landlords read own payment accounts"
  ON public.landlord_payment_accounts FOR SELECT
  TO authenticated
  USING (auth.uid() = landlord_id AND public.is_landlord());

DROP POLICY IF EXISTS "Landlords insert own payment account" ON public.landlord_payment_accounts;
CREATE POLICY "Landlords insert own payment account"
  ON public.landlord_payment_accounts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = landlord_id AND public.is_landlord());

DROP POLICY IF EXISTS "Landlords update own payment account" ON public.landlord_payment_accounts;
CREATE POLICY "Landlords update own payment account"
  ON public.landlord_payment_accounts FOR UPDATE
  TO authenticated
  USING (auth.uid() = landlord_id AND public.is_landlord())
  WITH CHECK (auth.uid() = landlord_id AND public.is_landlord());

-- Administrators have strictly read-only oversight (no INSERT/UPDATE/DELETE policies)
DROP POLICY IF EXISTS "Admins read landlord payment accounts" ON public.landlord_payment_accounts;
CREATE POLICY "Admins read landlord payment accounts"
  ON public.landlord_payment_accounts FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Students can only read active payment account details for landlords associated with
-- their own eligible reservations (cannot browse or list unrelated landlord accounts).
DROP POLICY IF EXISTS "Students read active payment account for eligible reservation" ON public.landlord_payment_accounts;
CREATE POLICY "Students read active payment account for eligible reservation"
  ON public.landlord_payment_accounts FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND public.is_student()
    AND EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.landlord_id = landlord_payment_accounts.landlord_id
        AND r.student_id = auth.uid()
        AND r.status IN ('pending_payment', 'payment_submitted', 'confirmed')
    )
  );

-- ============================================================================
-- 3. Historical Snapshot Column on public.invoices
-- ============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_account_snapshot JSONB;

-- ============================================================================
-- 4. Atomic Landlord Payment Account Upsert RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_landlord_payment_account(
  p_account_holder_name TEXT,
  p_bank_name TEXT,
  p_account_number TEXT,
  p_account_type TEXT DEFAULT NULL,
  p_payment_instructions TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_holder TEXT := regexp_replace(btrim(COALESCE(p_account_holder_name, '')), '\s+', ' ', 'g');
  v_bank TEXT := regexp_replace(btrim(COALESCE(p_bank_name, '')), '\s+', ' ', 'g');
  v_number TEXT := regexp_replace(btrim(COALESCE(p_account_number, '')), '[\s\-]', '', 'g');
  v_type TEXT := NULLIF(LOWER(btrim(COALESCE(p_account_type, ''))), '');
  v_instructions TEXT := NULLIF(btrim(COALESCE(p_payment_instructions, '')), '');
  v_existing RECORD;
  v_saved public.landlord_payment_accounts%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.is_landlord() THEN
    RAISE EXCEPTION 'Forbidden: Only authenticated landlords can manage their own payment account details.'
      USING ERRCODE = '42501';
  END IF;

  IF length(v_holder) < 2 OR length(v_holder) > 120 THEN
    RAISE EXCEPTION 'Account holder name must be between 2 and 120 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF length(v_bank) < 2 OR length(v_bank) > 100 THEN
    RAISE EXCEPTION 'Bank name must be between 2 and 100 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_number !~ '^[0-9]{10,12}$' THEN
    RAISE EXCEPTION 'Account number must contain 10 to 12 digits according to Nigerian banking standards.'
      USING ERRCODE = '22023';
  END IF;

  IF v_type IS NOT NULL AND v_type NOT IN ('savings', 'current', 'corporate') THEN
    RAISE EXCEPTION 'Account type must be savings, current, or corporate.'
      USING ERRCODE = '22023';
  END IF;

  IF v_instructions IS NOT NULL AND length(v_instructions) > 500 THEN
    RAISE EXCEPTION 'Payment instructions cannot exceed 500 characters.'
      USING ERRCODE = '22023';
  END IF;

  -- Lock any currently active account for this landlord
  SELECT * INTO v_existing
  FROM public.landlord_payment_accounts
  WHERE landlord_id = v_uid
    AND is_active = true
  FOR UPDATE
  LIMIT 1;

  IF FOUND AND v_existing.account_number = v_number THEN
    UPDATE public.landlord_payment_accounts
    SET
      account_holder_name = v_holder,
      bank_name = v_bank,
      account_type = v_type,
      payment_instructions = v_instructions,
      updated_at = timezone('utc'::text, now())
    WHERE id = v_existing.id
    RETURNING * INTO v_saved;
  ELSE
    IF FOUND THEN
      UPDATE public.landlord_payment_accounts
      SET is_active = false,
          updated_at = timezone('utc'::text, now())
      WHERE landlord_id = v_uid
        AND is_active = true;
    END IF;

    INSERT INTO public.landlord_payment_accounts (
      landlord_id,
      account_holder_name,
      bank_name,
      account_number,
      account_type,
      payment_instructions,
      is_active
    ) VALUES (
      v_uid,
      v_holder,
      v_bank,
      v_number,
      v_type,
      v_instructions,
      true
    )
    RETURNING * INTO v_saved;
  END IF;

  -- Audit log strictly masks the account number (only last 4 digits recorded)
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_uid,
    'UPSERT_LANDLORD_PAYMENT_ACCOUNT',
    'landlord_payment_accounts',
    v_saved.id::text,
    jsonb_build_object(
      'bank_name', v_saved.bank_name,
      'account_type', v_saved.account_type,
      'masked_account_number', '******' || right(v_saved.account_number, 4),
      'is_active', v_saved.is_active
    )
  );

  RETURN jsonb_build_object(
    'id', v_saved.id,
    'landlordId', v_saved.landlord_id,
    'accountHolderName', v_saved.account_holder_name,
    'bankName', v_saved.bank_name,
    'accountNumber', v_saved.account_number,
    'accountType', v_saved.account_type,
    'paymentInstructions', v_saved.payment_instructions,
    'isActive', v_saved.is_active,
    'createdAt', v_saved.created_at,
    'updatedAt', v_saved.updated_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_landlord_payment_account(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_landlord_payment_account(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 5. Scoped Student/Landlord/Admin Reservation Payment Details RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_reservation_payment_details(
  p_reservation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
STABLE
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_res RECORD;
  v_inv RECORD;
  v_acct RECORD;
  v_snapshot JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, student_id, landlord_id, status, hold_expires_at
  INTO v_res
  FROM public.reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  IF v_uid != v_res.student_id
     AND v_uid != v_res.landlord_id
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: You are not authorized to view payment details for this reservation.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, invoice_number, payment_account_snapshot, created_at
  INTO v_inv
  FROM public.invoices
  WHERE reservation_id = p_reservation_id
  LIMIT 1;

  v_snapshot := v_inv.payment_account_snapshot;

  -- Priority 1: Preserve historical invoice snapshot if captured at issuance
  IF v_snapshot IS NOT NULL
     AND NULLIF(btrim(COALESCE(v_snapshot->>'account_number', '')), '') IS NOT NULL
     AND NULLIF(btrim(COALESCE(v_snapshot->>'bank_name', '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'configured', true,
      'source', 'snapshot',
      'invoiceId', v_inv.id,
      'invoiceNumber', v_inv.invoice_number,
      'accountHolderName', v_snapshot->>'account_holder_name',
      'bankName', v_snapshot->>'bank_name',
      'accountNumber', v_snapshot->>'account_number',
      'accountType', v_snapshot->>'account_type',
      'paymentInstructions', v_snapshot->>'payment_instructions',
      'capturedAt', COALESCE(v_snapshot->>'captured_at', v_inv.created_at::text)
    );
  END IF;

  -- Priority 2: For eligible active reservations where no snapshot was stored yet
  IF v_res.status IN ('pending_payment', 'payment_submitted')
     AND v_res.hold_expires_at > timezone('utc'::text, now()) THEN
    SELECT id, account_holder_name, bank_name, account_number, account_type, payment_instructions, updated_at
    INTO v_acct
    FROM public.landlord_payment_accounts
    WHERE landlord_id = v_res.landlord_id
      AND is_active = true
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'configured', true,
        'source', 'active_account',
        'invoiceId', v_inv.id,
        'invoiceNumber', v_inv.invoice_number,
        'accountHolderName', v_acct.account_holder_name,
        'bankName', v_acct.bank_name,
        'accountNumber', v_acct.account_number,
        'accountType', v_acct.account_type,
        'paymentInstructions', v_acct.payment_instructions,
        'capturedAt', v_acct.updated_at::text
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'configured', false,
    'source', 'none',
    'invoiceId', v_inv.id,
    'invoiceNumber', v_inv.invoice_number
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_reservation_payment_details(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reservation_payment_details(UUID) TO authenticated, service_role;

-- ============================================================================
-- 6. Update create_reservation_atomic to snapshot active landlord bank details
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
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_property RECORD;
  v_unit RECORD;
  v_payment_acct RECORD;
  v_legacy_lp RECORD;
  v_payment_snapshot JSONB := NULL;
  v_reservation_id UUID;
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_hold_expires TIMESTAMPTZ;
  v_existing_res RECORD;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  -- Caller authorization check: caller must match p_student_id, or be admin, or called via service_role (auth.uid() IS NULL)
  IF auth.uid() IS NOT NULL AND auth.uid() != p_student_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: reservation student_id must match authenticated caller.';
  END IF;

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

  -- 3. Snapshot landlord's active payment account details if configured
  SELECT id, account_holder_name, bank_name, account_number, account_type, payment_instructions
  INTO v_payment_acct
  FROM public.landlord_payment_accounts
  WHERE landlord_id = v_property.landlord_id
    AND is_active = true
  LIMIT 1;

  IF FOUND THEN
    v_payment_snapshot := jsonb_build_object(
      'payment_account_id', v_payment_acct.id,
      'account_holder_name', v_payment_acct.account_holder_name,
      'bank_name', v_payment_acct.bank_name,
      'account_number', v_payment_acct.account_number,
      'account_type', v_payment_acct.account_type,
      'payment_instructions', v_payment_acct.payment_instructions,
      'captured_at', v_now
    );
  ELSE
    SELECT bank_name, bank_account_number, bank_account_name
    INTO v_legacy_lp
    FROM public.landlord_profiles
    WHERE user_id = v_property.landlord_id;

    IF FOUND
       AND NULLIF(btrim(COALESCE(v_legacy_lp.bank_name, '')), '') IS NOT NULL
       AND NULLIF(btrim(COALESCE(v_legacy_lp.bank_account_number, '')), '') IS NOT NULL THEN
      v_payment_snapshot := jsonb_build_object(
        'account_holder_name', COALESCE(NULLIF(btrim(v_legacy_lp.bank_account_name), ''), 'Property Landlord'),
        'bank_name', btrim(v_legacy_lp.bank_name),
        'account_number', regexp_replace(btrim(v_legacy_lp.bank_account_number), '[\s\-]', '', 'g'),
        'account_type', NULL,
        'payment_instructions', NULL,
        'captured_at', v_now
      );
    END IF;
  END IF;

  -- 4. Calculate 7-day hold window
  v_hold_expires := v_now + interval '7 days';
  v_reservation_id := gen_random_uuid();
  v_invoice_id := gen_random_uuid();
  v_invoice_number := 'INV-' || to_char(v_now, 'YYYYMMDD') || '-' || substr(v_reservation_id::text, 1, 6);

  -- 5. Decrement available spaces atomically
  UPDATE public.units
  SET available_spaces = available_spaces - 1
  WHERE id = p_unit_id;

  UPDATE public.properties
  SET available_spaces = available_spaces - 1
  WHERE id = p_property_id;

  -- 6. Insert reservation record
  INSERT INTO public.reservations (
    id, student_id, property_id, unit_id, landlord_id,
    status, hold_expires_at, amount, idempotency_key
  ) VALUES (
    v_reservation_id, p_student_id, p_property_id, p_unit_id, v_property.landlord_id,
    'pending_payment', v_hold_expires, v_unit.price_annual, p_idempotency_key
  );

  -- 7. Insert associated invoice with preserved payment_account_snapshot
  INSERT INTO public.invoices (
    id, invoice_number, reservation_id, student_id, landlord_id, property_id,
    amount, breakdown, payment_account_snapshot, status, due_date
  ) VALUES (
    v_invoice_id, v_invoice_number, v_reservation_id, p_student_id, v_property.landlord_id, p_property_id,
    v_unit.price_annual,
    jsonb_build_object(
      'rental_fee', v_unit.price_annual,
      'caution_deposit', v_property.caution_deposit,
      'service_charge', v_property.service_charge
    ),
    v_payment_snapshot,
    'unpaid', v_hold_expires
  );

  -- 8. Audit log & notifications
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES
    (p_student_id, 'Reservation Created', 'Your 7-day payment hold is active. Please submit payment receipt before expiry.', 'reservation', '/student/reservations/' || v_reservation_id),
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

REVOKE EXECUTE ON FUNCTION public.create_reservation_atomic(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_reservation_atomic(UUID, UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_atomic(UUID, UUID, UUID, TEXT) TO authenticated, service_role;
