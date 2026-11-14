-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261114000011_targeted_profiles_availability_pay_verification.sql
-- Description:
--   1. Student registration number uniqueness, normalization, legacy-safe CHECK
--      constraint, pre-signup availability RPC, and atomic signup trigger persistence.
--   2. Safe public profile RPCs for landlords (anon/auth) & students (auth only)
--      with strict zero-PII boundaries and suspended-account handling.
--   3. Reservation `reservation_mode` ('hold' | 'pay_now'), inline server-time
--      7-day hold expiration inside create_reservation_atomic & browse helper
--      expire_overdue_reservations_safe() (preserving service_role grant on
--      expire_pending_reservations()).
--   4. Authoritative verification approval/rejection sync + admin revocation RPC
--      `admin_revoke_user_verification`.
-- ============================================================================

-- ============================================================================
-- 1. Student Registration Number Normalization, Uniqueness & Legacy-Safe Guards
-- ============================================================================

-- Normalize any pre-existing non-empty registration numbers (never fabricate for NULLs)
UPDATE public.student_profiles
SET registration_number = NULLIF(UPPER(regexp_replace(btrim(registration_number), '\s+', '', 'g')), '')
WHERE registration_number IS NOT NULL;

-- Unique functional index preventing duplicate registration numbers across students
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_profiles_registration_number
  ON public.student_profiles (UPPER(btrim(registration_number)))
  WHERE registration_number IS NOT NULL AND length(btrim(registration_number)) > 0;

-- Enforce non-null & length rules on all NEW/UPDATED rows without breaking legacy NULL rows
ALTER TABLE public.student_profiles
  DROP CONSTRAINT IF EXISTS chk_student_reg_number_required;

ALTER TABLE public.student_profiles
  ADD CONSTRAINT chk_student_reg_number_required
  CHECK (registration_number IS NOT NULL AND length(btrim(registration_number)) BETWEEN 4 AND 40)
  NOT VALID;

-- Helper RPC returning boolean availability only (zero PII exposed)
CREATE OR REPLACE FUNCTION public.is_registration_number_available(p_reg_number TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm TEXT;
BEGIN
  v_norm := NULLIF(UPPER(regexp_replace(btrim(COALESCE(p_reg_number, '')), '\s+', '', 'g')), '');
  IF v_norm IS NULL OR length(v_norm) < 4 OR length(v_norm) > 40 THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.student_profiles
    WHERE registration_number IS NOT NULL
      AND UPPER(btrim(registration_number)) = v_norm
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_registration_number_available(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_registration_number_available(TEXT) TO anon, authenticated, service_role;

-- Protect student_profiles immutable fields and verified registration numbers
CREATE OR REPLACE FUNCTION public.protect_student_profile_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.registration_number IS NOT NULL THEN
    NEW.registration_number := NULLIF(UPPER(regexp_replace(btrim(NEW.registration_number), '\s+', '', 'g')), '');
  END IF;

  IF NOT public.is_admin() THEN
    IF NEW.is_profile_verified IS DISTINCT FROM OLD.is_profile_verified THEN
      RAISE EXCEPTION 'Unauthorized: Student verification status cannot be self-modified.';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Unauthorized: Student user_id is immutable.';
    END IF;
    IF OLD.registration_number IS NOT NULL AND (NEW.registration_number IS NULL OR btrim(NEW.registration_number) = '') THEN
      RAISE EXCEPTION 'Student registration number cannot be cleared once set.'
        USING ERRCODE = '22023';
    END IF;
    IF OLD.is_profile_verified = true AND NEW.registration_number IS DISTINCT FROM OLD.registration_number THEN
      RAISE EXCEPTION 'Verified student registration numbers cannot be modified directly.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_student_profiles_protect_fields ON public.student_profiles;
CREATE TRIGGER tr_student_profiles_protect_fields
  BEFORE UPDATE ON public.student_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_student_profile_immutable_fields();

-- Update handle_new_user() to persist & enforce unique student registration numbers atomically
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_raw_role TEXT;
  v_role public.user_role;
  v_full_name TEXT;
  v_account_status public.account_status;
  v_existing_role public.user_role;
  v_effective_role public.user_role;
  v_reg_number TEXT;
  v_university TEXT;
  v_campus TEXT;
  v_study_level TEXT;
  v_gender TEXT;
BEGIN
  SELECT role INTO v_existing_role
  FROM public.profiles
  WHERE id = NEW.id;

  IF v_existing_role IS NOT NULL THEN
    UPDATE public.profiles
    SET
      email = NEW.email,
      updated_at = timezone('utc'::text, now())
    WHERE id = NEW.id;

    v_effective_role := v_existing_role;
  ELSE
    v_raw_role := NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), '');

    IF v_raw_role IS NULL OR LOWER(v_raw_role) = 'student' THEN
      v_role := 'student'::public.user_role;
      IF NEW.email_confirmed_at IS NOT NULL THEN
        v_account_status := 'active'::public.account_status;
      ELSE
        v_account_status := 'email_unverified'::public.account_status;
      END IF;
    ELSIF LOWER(v_raw_role) = 'landlord' THEN
      v_role := 'landlord'::public.user_role;
      v_account_status := 'profile_pending'::public.account_status;
    ELSIF LOWER(v_raw_role) = 'admin' THEN
      RAISE EXCEPTION 'Access denied: The administrator role cannot be self-assigned during registration.'
        USING ERRCODE = '42501';
    ELSE
      RAISE EXCEPTION 'Invalid registration role "%". Permitted roles for public registration are "student" and "landlord".', v_raw_role
        USING ERRCODE = '22023';
    END IF;

    v_full_name := COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1),
      'OUTPOST User'
    );

    INSERT INTO public.profiles (
      id,
      email,
      full_name,
      role,
      account_status,
      is_verified,
      created_at,
      updated_at
    )
    VALUES (
      NEW.id,
      NEW.email,
      v_full_name,
      v_role,
      v_account_status,
      false,
      timezone('utc'::text, now()),
      timezone('utc'::text, now())
    );

    v_effective_role := v_role;
  END IF;

  IF v_effective_role = 'student' THEN
    v_reg_number := NULLIF(
      UPPER(regexp_replace(btrim(COALESCE(NEW.raw_user_meta_data->>'registration_number', '')), '\s+', '', 'g')),
      ''
    );
    v_university := COALESCE(NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'university', '')), ''), 'Bayero University Kano');
    v_campus := COALESCE(NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'campus', '')), ''), 'New Campus');
    v_study_level := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'study_level', '')), '');
    v_gender := lower(btrim(COALESCE(NEW.raw_user_meta_data->>'gender', 'other')));
    IF v_gender NOT IN ('male', 'female', 'other', 'prefer_not_to_say') THEN
      v_gender := 'other';
    END IF;

    -- Skip strict check only if a student_profiles row already exists for this user_id
    IF NOT EXISTS (SELECT 1 FROM public.student_profiles WHERE user_id = NEW.id) THEN
      IF v_reg_number IS NULL OR length(v_reg_number) < 4 OR length(v_reg_number) > 40 THEN
        RAISE EXCEPTION 'A valid student registration number (e.g. BUK/22/CHS/00812) is required to register as a student.'
          USING ERRCODE = '22023';
      END IF;

      BEGIN
        INSERT INTO public.student_profiles (
          user_id,
          institution,
          campus,
          study_level,
          registration_number,
          gender,
          created_at,
          updated_at
        )
        VALUES (
          NEW.id,
          v_university,
          v_campus,
          v_study_level,
          v_reg_number,
          v_gender,
          timezone('utc'::text, now()),
          timezone('utc'::text, now())
        )
        ON CONFLICT (user_id) DO NOTHING;
      EXCEPTION
        WHEN unique_violation THEN
          RAISE EXCEPTION 'This student registration number is already registered on OUTPOST.'
            USING ERRCODE = '23505';
      END;
    END IF;
  ELSIF v_effective_role = 'landlord' THEN
    INSERT INTO public.landlord_profiles (
      user_id,
      verification_status,
      created_at,
      updated_at
    )
    VALUES (
      NEW.id,
      'not_started'::public.verification_status,
      timezone('utc'::text, now()),
      timezone('utc'::text, now())
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, service_role;

-- ============================================================================
-- 2. Reconcile Authoritative Verification Flags & Safe Public Profile RPCs
-- ============================================================================

-- One-time reconciliation for existing verified accounts (non-suspended only)
UPDATE public.profiles p
SET is_verified = true
FROM public.landlord_profiles lp
WHERE lp.user_id = p.id
  AND lp.verification_status = 'approved'
  AND p.account_status != 'suspended'
  AND p.is_verified = false;

UPDATE public.profiles p
SET is_verified = true
FROM public.student_profiles sp
WHERE sp.user_id = p.id
  AND sp.is_profile_verified = true
  AND p.account_status != 'suspended'
  AND p.is_verified = false;

-- Public Landlord Profile RPC (callable by anon & authenticated; STRICTLY non-PII)
CREATE OR REPLACE FUNCTION public.get_public_landlord_profile(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_listings_count INTEGER := 0;
  v_is_verified BOOLEAN := false;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'unavailable', true, 'reason', 'Invalid landlord identifier.');
  END IF;

  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    p.role,
    p.account_status,
    p.is_verified,
    p.created_at,
    lp.company_name,
    lp.verification_status
  INTO v_row
  FROM public.profiles p
  LEFT JOIN public.landlord_profiles lp ON lp.user_id = p.id
  WHERE p.id = p_user_id
    AND p.role = 'landlord';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', false,
      'unavailable', true,
      'reason', 'Landlord profile not found.'
    );
  END IF;

  IF v_row.account_status = 'suspended' THEN
    RETURN jsonb_build_object(
      'found', true,
      'unavailable', true,
      'reason', 'This landlord account is currently unavailable.',
      'id', v_row.id,
      'role', 'landlord',
      'displayName', 'Account Unavailable',
      'isVerified', false
    );
  END IF;

  SELECT count(*)::int INTO v_listings_count
  FROM public.properties
  WHERE landlord_id = v_row.id
    AND approval_status = 'approved'
    AND is_published = true;

  v_is_verified := (
    v_row.account_status != 'suspended'
    AND v_row.verification_status = 'approved'
    AND COALESCE(v_row.is_verified, false) = true
  );

  RETURN jsonb_build_object(
    'found', true,
    'unavailable', false,
    'id', v_row.id,
    'role', 'landlord',
    'displayName', COALESCE(NULLIF(btrim(v_row.full_name), ''), NULLIF(btrim(v_row.company_name), ''), 'OUTPOST Host'),
    'companyName', NULLIF(btrim(v_row.company_name), ''),
    'avatarUrl', v_row.avatar_url,
    'isVerified', v_is_verified,
    'verificationStatus', CASE WHEN v_is_verified THEN 'approved' ELSE COALESCE(v_row.verification_status::text, 'not_started') END,
    'createdAt', v_row.created_at,
    'approvedListingsCount', v_listings_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_landlord_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_landlord_profile(UUID) TO anon, authenticated, service_role;

-- Batch Public Landlord Summaries for property card hydration (non-PII)
CREATE OR REPLACE FUNCTION public.get_public_landlord_summaries(p_landlord_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_result JSONB := '{}'::jsonb;
  v_rec RECORD;
BEGIN
  IF p_landlord_ids IS NULL OR array_length(p_landlord_ids, 1) IS NULL THEN
    RETURN v_result;
  END IF;

  FOR v_rec IN
    SELECT
      p.id,
      p.full_name,
      p.account_status,
      p.is_verified,
      lp.company_name,
      lp.verification_status
    FROM public.profiles p
    LEFT JOIN public.landlord_profiles lp ON lp.user_id = p.id
    WHERE p.id = ANY(p_landlord_ids)
      AND p.role = 'landlord'
  LOOP
    v_result := v_result || jsonb_build_object(
      v_rec.id::text,
      jsonb_build_object(
        'displayName', CASE
          WHEN v_rec.account_status = 'suspended' THEN 'Account Unavailable'
          ELSE COALESCE(NULLIF(btrim(v_rec.full_name), ''), NULLIF(btrim(v_rec.company_name), ''), 'Property Host')
        END,
        'companyName', CASE
          WHEN v_rec.account_status = 'suspended' THEN NULL
          ELSE NULLIF(btrim(v_rec.company_name), '')
        END,
        'isVerified', (
          v_rec.account_status != 'suspended'
          AND v_rec.verification_status = 'approved'
          AND COALESCE(v_rec.is_verified, false) = true
        ),
        'unavailable', (v_rec.account_status = 'suspended')
      )
    );
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_landlord_summaries(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_landlord_summaries(UUID[]) TO anon, authenticated, service_role;

-- Public Student Profile RPC (STRICTLY authenticated users only; hides private email/phone/docs)
CREATE OR REPLACE FUNCTION public.get_public_student_profile(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_is_verified BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required to view student profiles.'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'unavailable', true, 'reason', 'Invalid student identifier.');
  END IF;

  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    p.role,
    p.account_status,
    p.is_verified,
    p.created_at,
    sp.registration_number,
    sp.institution,
    sp.campus,
    sp.faculty,
    sp.department,
    sp.study_level,
    sp.bio,
    sp.is_profile_verified
  INTO v_row
  FROM public.profiles p
  LEFT JOIN public.student_profiles sp ON sp.user_id = p.id
  WHERE p.id = p_user_id
    AND p.role = 'student';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', false,
      'unavailable', true,
      'reason', 'Student profile not found.'
    );
  END IF;

  IF v_row.account_status = 'suspended' THEN
    RETURN jsonb_build_object(
      'found', true,
      'unavailable', true,
      'reason', 'This student account is currently unavailable.',
      'id', v_row.id,
      'role', 'student',
      'displayName', 'Account Unavailable',
      'isVerified', false
    );
  END IF;

  v_is_verified := (
    v_row.account_status != 'suspended'
    AND COALESCE(v_row.is_profile_verified, false) = true
    AND COALESCE(v_row.is_verified, false) = true
  );

  RETURN jsonb_build_object(
    'found', true,
    'unavailable', false,
    'id', v_row.id,
    'role', 'student',
    'displayName', COALESCE(NULLIF(btrim(v_row.full_name), ''), 'OUTPOST Student'),
    'avatarUrl', v_row.avatar_url,
    'isVerified', v_is_verified,
    'registrationNumber', NULLIF(btrim(v_row.registration_number), ''),
    'university', COALESCE(NULLIF(btrim(v_row.institution), ''), 'Bayero University Kano'),
    'campus', COALESCE(NULLIF(btrim(v_row.campus), ''), 'New Campus'),
    'faculty', NULLIF(btrim(v_row.faculty), ''),
    'department', NULLIF(btrim(v_row.department), ''),
    'studyLevel', NULLIF(btrim(v_row.study_level), ''),
    'bio', NULLIF(btrim(v_row.bio), ''),
    'createdAt', v_row.created_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_student_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_student_profile(UUID) TO authenticated, service_role;

-- Authenticated lookup of student by registration number (non-PII fields only)
CREATE OR REPLACE FUNCTION public.lookup_student_by_registration_number(p_reg_number TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_norm TEXT;
  v_target_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required to search students.'
      USING ERRCODE = '42501';
  END IF;

  v_norm := NULLIF(UPPER(regexp_replace(btrim(COALESCE(p_reg_number, '')), '\s+', '', 'g')), '');
  IF v_norm IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT sp.user_id INTO v_target_id
  FROM public.student_profiles sp
  JOIN public.profiles p ON p.id = sp.user_id
  WHERE sp.registration_number IS NOT NULL
    AND UPPER(btrim(sp.registration_number)) = v_norm
    AND p.role = 'student'
    AND p.account_status != 'suspended'
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN public.get_public_student_profile(v_target_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_student_by_registration_number(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_student_by_registration_number(TEXT) TO authenticated, service_role;

-- ============================================================================
-- 3. Reservation Mode ('hold' | 'pay_now'), Concurrency & 7-Day Auto-Expiry
-- ============================================================================

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS reservation_mode TEXT NOT NULL DEFAULT 'hold';

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS chk_reservations_mode;

ALTER TABLE public.reservations
  ADD CONSTRAINT chk_reservations_mode
  CHECK (reservation_mode IN ('hold', 'pay_now'));

-- Harden service-role scheduled expiration function (fixes inventory cap)
CREATE OR REPLACE FUNCTION public.expire_pending_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_res RECORD;
  v_count INTEGER := 0;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  FOR v_res IN
    SELECT id, student_id, property_id, unit_id
    FROM public.reservations
    WHERE status = 'pending_payment'
      AND hold_expires_at <= v_now
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.reservations
    SET status = 'expired',
        expired_at = v_now,
        cancellation_reason = '7-day unpaid hold period expired.',
        updated_at = v_now
    WHERE id = v_res.id
      AND status = 'pending_payment';

    IF FOUND THEN
      UPDATE public.invoices
      SET status = 'expired',
          updated_at = v_now
      WHERE reservation_id = v_res.id
        AND status IN ('unpaid', 'processing');

      UPDATE public.units
      SET available_spaces = LEAST(capacity, available_spaces + 1),
          updated_at = v_now
      WHERE id = v_res.unit_id;

      UPDATE public.properties
      SET available_spaces = LEAST(total_spaces, available_spaces + 1),
          updated_at = v_now
      WHERE id = v_res.property_id;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        v_res.student_id,
        'Reservation Expired',
        'Your 7-day payment hold has expired and availability has been released.',
        'reservation',
        '/student/reservations/' || v_res.id
      );

      INSERT INTO public.audit_logs (action, entity_type, entity_id, details)
      VALUES (
        'EXPIRE_RESERVATION',
        'reservation',
        v_res.id::text,
        jsonb_build_object('reason', '7-day hold elapsed')
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_reservations() TO service_role;

-- Safe server-time release helper callable during public browse & booking reads
-- Returns integer count only (zero row data exposed)
CREATE OR REPLACE FUNCTION public.expire_overdue_reservations_safe()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RETURN public.expire_pending_reservations();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_overdue_reservations_safe() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_overdue_reservations_safe() TO anon, authenticated, service_role;

-- Drop legacy 4-arg overload to prevent PostgREST RPC overload ambiguity
DROP FUNCTION IF EXISTS public.create_reservation_atomic(UUID, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.create_reservation_atomic(
  p_student_id UUID,
  p_property_id UUID,
  p_unit_id UUID,
  p_idempotency_key TEXT DEFAULT NULL,
  p_reservation_mode TEXT DEFAULT 'hold'
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
  v_expired_res RECORD;
  v_mode TEXT;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() != p_student_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: reservation student_id must match authenticated caller.';
  END IF;

  v_mode := COALESCE(NULLIF(lower(btrim(COALESCE(p_reservation_mode, ''))), ''), 'hold');
  IF v_mode NOT IN ('hold', 'pay_now') THEN
    RAISE EXCEPTION 'Invalid reservation mode "%". Must be "hold" or "pay_now".', v_mode
      USING ERRCODE = '22023';
  END IF;

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_res FROM public.reservations WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'reservation_id', v_existing_res.id,
        'status', v_existing_res.status,
        'reservation_mode', v_existing_res.reservation_mode
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

  -- 2. Lock unit BEFORE checking capacity & lazily release overdue holds on this unit
  SELECT * INTO v_unit
  FROM public.units
  WHERE id = p_unit_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unit not found in property.';
  END IF;

  -- Lazy server-side release of any overdue 7-day unpaid holds on this unit
  FOR v_expired_res IN
    SELECT id, student_id
    FROM public.reservations
    WHERE unit_id = p_unit_id
      AND status = 'pending_payment'
      AND hold_expires_at <= v_now
    FOR UPDATE
  LOOP
    UPDATE public.reservations
    SET status = 'expired',
        expired_at = v_now,
        cancellation_reason = '7-day unpaid hold period expired.',
        updated_at = v_now
    WHERE id = v_expired_res.id;

    UPDATE public.invoices
    SET status = 'expired',
        updated_at = v_now
    WHERE reservation_id = v_expired_res.id
      AND status IN ('unpaid', 'processing');

    UPDATE public.units
    SET available_spaces = LEAST(capacity, available_spaces + 1),
        updated_at = v_now
    WHERE id = p_unit_id;

    UPDATE public.properties
    SET available_spaces = LEAST(total_spaces, available_spaces + 1),
        updated_at = v_now
    WHERE id = p_property_id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_expired_res.student_id,
      'Reservation Expired',
      'Your 7-day payment hold has expired and availability has been released.',
      'reservation',
      '/student/reservations/' || v_expired_res.id
    );

    INSERT INTO public.audit_logs (action, entity_type, entity_id, details)
    VALUES ('EXPIRE_RESERVATION', 'reservation', v_expired_res.id::text, jsonb_build_object('reason', '7-day hold elapsed'));
  END LOOP;

  -- Re-read unit availability after overdue hold cleanup
  SELECT * INTO v_unit
  FROM public.units
  WHERE id = p_unit_id AND property_id = p_property_id;

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

  -- 4. Calculate 7-day hold window (also caps Pay Now pending receipt window)
  v_hold_expires := v_now + interval '7 days';
  v_reservation_id := gen_random_uuid();
  v_invoice_id := gen_random_uuid();
  v_invoice_number := 'INV-' || to_char(v_now, 'YYYYMMDD') || '-' || substr(v_reservation_id::text, 1, 6);

  -- 5. Decrement available spaces atomically
  UPDATE public.units
  SET available_spaces = available_spaces - 1,
      updated_at = v_now
  WHERE id = p_unit_id;

  UPDATE public.properties
  SET available_spaces = GREATEST(0, available_spaces - 1),
      updated_at = v_now
  WHERE id = p_property_id;

  -- 6. Insert reservation record (never auto-marked confirmed; requires bank transfer + landlord verification)
  INSERT INTO public.reservations (
    id, student_id, property_id, unit_id, landlord_id,
    status, reservation_mode, hold_expires_at, amount, idempotency_key
  ) VALUES (
    v_reservation_id, p_student_id, p_property_id, p_unit_id, v_property.landlord_id,
    'pending_payment', v_mode, v_hold_expires, v_unit.price_annual, p_idempotency_key
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
    (
      p_student_id,
      CASE WHEN v_mode = 'pay_now' THEN 'Reservation Locked — Ready for Transfer' ELSE 'Reservation Created' END,
      CASE WHEN v_mode = 'pay_now'
        THEN 'Your room is locked. Transfer directly to the landlord bank account shown and upload your receipt for verification.'
        ELSE 'Your 7-day payment hold is active. Please submit payment receipt before expiry.'
      END,
      'reservation',
      '/student/reservations/' || v_reservation_id
    ),
    (
      v_property.landlord_id,
      CASE WHEN v_mode = 'pay_now' THEN 'New Pay-Now Booking Hold' ELSE 'New Reservation Hold' END,
      'A student locked a unit at ' || v_property.title || ' and is preparing payment transfer.',
      'reservation',
      '/landlord/receipts'
    );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    p_student_id,
    'CREATE_RESERVATION',
    'reservation',
    v_reservation_id::text,
    jsonb_build_object('amount', v_unit.price_annual, 'hold_expires_at', v_hold_expires, 'reservation_mode', v_mode)
  );

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'invoice_id', v_invoice_id,
    'hold_expires_at', v_hold_expires,
    'reservation_mode', v_mode
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_reservation_atomic(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_reservation_atomic(UUID, UUID, UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation_atomic(UUID, UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 4. Authoritative Verification Sync & Admin Revocation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_review_student_verification(
  p_doc_id UUID,
  p_decision verification_status,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_doc RECORD;
  v_has_other_approved BOOLEAN := false;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid verification decision: must be approved or rejected.';
  END IF;

  IF p_decision = 'rejected' AND (p_reason IS NULL OR length(trim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;

  SELECT * INTO v_doc FROM public.student_verification_documents WHERE id = p_doc_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student verification document not found.';
  END IF;

  UPDATE public.student_verification_documents
  SET
    status = p_decision,
    reviewer_id = v_admin_id,
    reviewed_at = v_now,
    rejection_reason = CASE WHEN p_decision = 'rejected' THEN trim(p_reason) ELSE NULL END,
    updated_at = v_now
  WHERE id = p_doc_id;

  IF p_decision = 'approved' THEN
    UPDATE public.student_profiles
    SET is_profile_verified = true, verification_date = v_now, updated_at = v_now
    WHERE user_id = v_doc.student_id;

    UPDATE public.profiles
    SET
      is_verified = true,
      verified_at = v_now,
      verified_by = v_admin_id,
      account_status = CASE WHEN account_status = 'suspended' THEN 'suspended' ELSE 'profile_verified'::public.account_status END,
      updated_at = v_now
    WHERE id = v_doc.student_id;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.student_verification_documents
      WHERE student_id = v_doc.student_id
        AND id != p_doc_id
        AND status = 'approved'
    ) INTO v_has_other_approved;

    IF NOT v_has_other_approved THEN
      UPDATE public.student_profiles
      SET is_profile_verified = false, verification_date = NULL, updated_at = v_now
      WHERE user_id = v_doc.student_id;

      UPDATE public.profiles
      SET
        is_verified = false,
        verified_at = NULL,
        verified_by = NULL,
        account_status = CASE
          WHEN account_status IN ('suspended', 'email_unverified') THEN account_status
          ELSE 'active'::public.account_status
        END,
        updated_at = v_now
      WHERE id = v_doc.student_id;
    END IF;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_doc.student_id,
    CASE WHEN p_decision = 'approved' THEN 'Student Identity Verified' ELSE 'Verification Document Rejected' END,
    CASE WHEN p_decision = 'approved' THEN 'Your academic identity document has been verified by an administrator.' ELSE 'Your verification document was declined: ' || trim(p_reason) END,
    'verification',
    '/student/verification'
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_admin_id,
    CASE WHEN p_decision = 'approved' THEN 'ADMIN_APPROVE_STUDENT_DOC' ELSE 'ADMIN_REJECT_STUDENT_DOC' END,
    'student_verification_documents',
    p_doc_id::text,
    jsonb_build_object('student_id', v_doc.student_id, 'decision', p_decision, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', true, 'id', p_doc_id, 'status', p_decision);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_landlord_verification(
  p_target_id UUID,
  p_decision verification_status,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_landlord_id UUID;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid verification decision: must be approved or rejected.';
  END IF;

  IF p_decision = 'rejected' AND (p_reason IS NULL OR length(trim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;

  SELECT landlord_id INTO v_landlord_id
  FROM public.landlord_verification_submissions
  WHERE id = p_target_id;

  IF v_landlord_id IS NULL THEN
    SELECT user_id INTO v_landlord_id
    FROM public.landlord_profiles
    WHERE user_id = p_target_id OR id = p_target_id;
  END IF;

  IF v_landlord_id IS NULL THEN
    RAISE EXCEPTION 'Landlord verification record not found.';
  END IF;

  UPDATE public.landlord_profiles
  SET
    verification_status = p_decision,
    verified_by = v_admin_id,
    verified_at = CASE WHEN p_decision = 'approved' THEN v_now ELSE NULL END,
    rejection_reason = CASE WHEN p_decision = 'rejected' THEN trim(p_reason) ELSE NULL END,
    updated_at = v_now
  WHERE user_id = v_landlord_id;

  UPDATE public.landlord_verification_submissions
  SET
    status = p_decision,
    reviewer_id = v_admin_id,
    reviewed_at = v_now,
    rejection_reason = CASE WHEN p_decision = 'rejected' THEN trim(p_reason) ELSE NULL END,
    updated_at = v_now
  WHERE landlord_id = v_landlord_id
    AND (id = p_target_id OR status = 'pending');

  IF p_decision = 'approved' THEN
    UPDATE public.profiles
    SET
      is_verified = true,
      verified_at = v_now,
      verified_by = v_admin_id,
      account_status = CASE WHEN account_status = 'suspended' THEN 'suspended' ELSE 'profile_verified'::public.account_status END,
      updated_at = v_now
    WHERE id = v_landlord_id;
  ELSE
    UPDATE public.profiles
    SET
      is_verified = false,
      verified_at = NULL,
      verified_by = NULL,
      account_status = CASE
        WHEN account_status IN ('suspended', 'profile_pending', 'email_unverified') THEN account_status
        ELSE 'active'::public.account_status
      END,
      updated_at = v_now
    WHERE id = v_landlord_id;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_landlord_id,
    CASE WHEN p_decision = 'approved' THEN 'Landlord Account Verified' ELSE 'Landlord Verification Declined' END,
    CASE WHEN p_decision = 'approved' THEN 'Your landlord identity and ownership proof have been approved.' ELSE 'Your verification submission was declined: ' || trim(p_reason) END,
    'verification',
    '/landlord/verification'
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_admin_id,
    CASE WHEN p_decision = 'approved' THEN 'ADMIN_APPROVE_LANDLORD' ELSE 'ADMIN_REJECT_LANDLORD' END,
    'landlord_profiles',
    v_landlord_id::text,
    jsonb_build_object('landlord_id', v_landlord_id, 'decision', p_decision, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', true, 'landlord_id', v_landlord_id, 'status', p_decision);
END;
$$;

-- Admin Verification Revocation RPC
CREATE OR REPLACE FUNCTION public.admin_revoke_user_verification(
  p_target_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_target RECORD;
  v_clean_reason TEXT := trim(COALESCE(p_reason, ''));
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.' USING ERRCODE = '42501';
  END IF;

  IF length(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'A revocation reason of at least 5 characters is required.';
  END IF;

  SELECT id, role, account_status
  INTO v_target
  FROM public.profiles
  WHERE id = p_target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found.';
  END IF;

  IF v_target.role = 'admin' THEN
    RAISE EXCEPTION 'Cannot revoke verification via user workflow for administrator accounts.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET
    is_verified = false,
    verified_at = NULL,
    verified_by = NULL,
    account_status = CASE
      WHEN account_status IN ('suspended', 'email_unverified') THEN account_status
      WHEN role = 'landlord' THEN 'profile_pending'::public.account_status
      ELSE 'active'::public.account_status
    END,
    updated_at = v_now
  WHERE id = p_target_id;

  IF v_target.role = 'student' THEN
    UPDATE public.student_profiles
    SET is_profile_verified = false, verification_date = NULL, updated_at = v_now
    WHERE user_id = p_target_id;

    UPDATE public.student_verification_documents
    SET
      status = 'rejected',
      reviewer_id = v_admin_id,
      reviewed_at = v_now,
      rejection_reason = 'Verification revoked: ' || v_clean_reason,
      updated_at = v_now
    WHERE student_id = p_target_id
      AND status = 'approved';
  ELSIF v_target.role = 'landlord' THEN
    UPDATE public.landlord_profiles
    SET
      verification_status = 'rejected',
      verified_by = v_admin_id,
      verified_at = NULL,
      rejection_reason = 'Verification revoked: ' || v_clean_reason,
      updated_at = v_now
    WHERE user_id = p_target_id;

    UPDATE public.landlord_verification_submissions
    SET
      status = 'rejected',
      reviewer_id = v_admin_id,
      reviewed_at = v_now,
      rejection_reason = 'Verification revoked: ' || v_clean_reason,
      updated_at = v_now
    WHERE landlord_id = p_target_id
      AND status = 'approved';
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    p_target_id,
    'Verification Badge Revoked',
    'Your platform verification badge was revoked by an administrator: ' || v_clean_reason,
    'verification',
    CASE WHEN v_target.role = 'landlord' THEN '/landlord/verification' ELSE '/student/verification' END
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_admin_id,
    'ADMIN_REVOKE_VERIFICATION',
    'profiles',
    p_target_id::text,
    jsonb_build_object('role', v_target.role, 'reason', v_clean_reason)
  );

  RETURN jsonb_build_object('success', true, 'user_id', p_target_id, 'role', v_target.role, 'revoked', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_user_verification(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_verification(UUID, TEXT) TO authenticated, service_role;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
