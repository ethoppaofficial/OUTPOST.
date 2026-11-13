-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261113000009_corrective_schema_sync_and_media_integrity.sql
-- Description:
--   Idempotent corrective migration reconciling skipped/out-of-order
--   remote runs of Migrations 06, 07, and 08 while hardening media integrity
--   and atomic reservation cancellation.
--
--   Specifically:
--   1. Re-asserts landlord_profiles.tax_id column required by landlord KYC
--      views and registration flows.
--   2. Re-asserts Migration 06 (handle_new_user trigger & profile insert RLS).
--   3. Re-asserts Migration 07 (hardened is_admin(), admin notification/roommate
--      SELECT/INSERT policies, landlord draft property insert policy, safe
--      landlord_profiles pending transition trigger/policy & submission RPC,
--      all 5 atomic admin governance RPCs, and email confirmation sync).
--   4. Preserves and re-asserts Migration 08's normalized property_images table
--      (RLS + FORCE RLS + 4 policies + non-ephemeral CHECK) and the expanded
--      19-metric admin_get_dashboard_metrics() RPC (never downgrading to 07's
--      14-metric version).
--   5. Re-asserts all 6 Storage buckets (student-docs, landlord-docs,
--      payment-receipts, chat-attachments, property-images, profile-pictures)
--      and idempotently ensures storage.objects policies exist.
--   6. Installs BEFORE INSERT OR UPDATE triggers on public.properties and
--      public.profiles via reject_ephemeral_media_urls() to block data: and
--      blob: URLs at the database boundary without failing on legacy rows.
--   7. Adds cancel_reservation_atomic(UUID, TEXT) SECURITY DEFINER RPC for
--      safe student/admin cancellation with atomic room/property space release.
-- ============================================================================

-- 1. Ensure schema columns referenced by frontend & admin services exist
ALTER TABLE public.landlord_profiles
  ADD COLUMN IF NOT EXISTS tax_id TEXT;

-- ============================================================================
-- 2. Re-assert Migration 06: Authoritative Role Registration & Profile Policy
-- ============================================================================

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
    INSERT INTO public.student_profiles (
      user_id,
      institution,
      campus,
      created_at,
      updated_at
    )
    VALUES (
      NEW.id,
      'Bayero University Kano',
      'New Campus',
      timezone('utc'::text, now()),
      timezone('utc'::text, now())
    )
    ON CONFLICT (user_id) DO NOTHING;
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

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND role IN ('student', 'landlord')
    AND account_status IN ('email_unverified', 'active', 'profile_pending')
    AND is_verified = false
  );

-- Backfill any pre-Migration-06 auth.users missing public.profiles or role sub-profiles
DO $$
DECLARE
  u RECORD;
  v_role public.user_role;
  v_status public.account_status;
  v_full_name TEXT;
BEGIN
  FOR u IN
    SELECT au.id, au.email, au.email_confirmed_at, au.raw_user_meta_data
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.id = au.id
    WHERE p.id IS NULL
      AND au.email IS NOT NULL
  LOOP
    v_role := CASE
      WHEN LOWER(COALESCE(u.raw_user_meta_data->>'role', '')) = 'landlord' THEN 'landlord'::public.user_role
      ELSE 'student'::public.user_role
    END;
    v_status := CASE
      WHEN v_role = 'landlord' THEN 'profile_pending'::public.account_status
      WHEN u.email_confirmed_at IS NOT NULL THEN 'active'::public.account_status
      ELSE 'email_unverified'::public.account_status
    END;
    v_full_name := COALESCE(
      NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
      split_part(u.email, '@', 1),
      'OUTPOST User'
    );

    INSERT INTO public.profiles (
      id, email, full_name, role, account_status, is_verified, created_at, updated_at
    )
    VALUES (
      u.id, u.email, v_full_name, v_role, v_status, false, timezone('utc'::text, now()), timezone('utc'::text, now())
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  INSERT INTO public.student_profiles (user_id, institution, campus, created_at, updated_at)
  SELECT p.id, 'Bayero University Kano', 'New Campus', timezone('utc'::text, now()), timezone('utc'::text, now())
  FROM public.profiles p
  LEFT JOIN public.student_profiles sp ON sp.user_id = p.id
  WHERE p.role = 'student' AND sp.user_id IS NULL
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.landlord_profiles (user_id, verification_status, created_at, updated_at)
  SELECT p.id, 'not_started'::public.verification_status, timezone('utc'::text, now()), timezone('utc'::text, now())
  FROM public.profiles p
  LEFT JOIN public.landlord_profiles lp ON lp.user_id = p.id
  WHERE p.role = 'landlord' AND lp.user_id IS NULL
  ON CONFLICT (user_id) DO NOTHING;
END $$;

-- ============================================================================
-- 3. Re-assert Migration 07 RLS Hardening & Atomic Governance RPCs
--    (Preserves Migration 08's 19-metric admin_get_dashboard_metrics below)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND account_status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

DO $$ BEGIN
  CREATE POLICY "Admins read all notifications"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (public.is_admin());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins insert notifications"
    ON public.notifications FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins read all roommate requests"
    ON public.roommate_requests FOR SELECT
    TO authenticated
    USING (public.is_admin());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "Landlords insert draft properties" ON public.properties;
CREATE POLICY "Landlords insert draft properties"
  ON public.properties FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = landlord_id
    AND public.is_landlord()
    AND approval_status IN ('draft', 'pending')
    AND is_published = false
  );

CREATE OR REPLACE FUNCTION public.protect_landlord_profile_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Unauthorized: Landlord user_id is immutable.';
    END IF;
    IF NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
      RAISE EXCEPTION 'Unauthorized: Landlord verification reviewer fields are immutable.';
    END IF;
    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
      IF NOT (
        OLD.verification_status IN ('not_started', 'rejected')
        AND NEW.verification_status = 'pending'
        AND EXISTS (
          SELECT 1 FROM public.landlord_verification_submissions s
          WHERE s.landlord_id = NEW.user_id AND s.status = 'pending'
        )
      ) THEN
        RAISE EXCEPTION 'Unauthorized: Landlord verification status cannot be self-modified.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Landlords can update own editable fields" ON public.landlord_profiles;
CREATE POLICY "Landlords can update own editable fields"
  ON public.landlord_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      verification_status = (SELECT lp.verification_status FROM public.landlord_profiles lp WHERE lp.user_id = auth.uid())
      OR (
        verification_status = 'pending'
        AND EXISTS (
          SELECT 1 FROM public.landlord_verification_submissions s
          WHERE s.landlord_id = auth.uid() AND s.status = 'pending'
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.submit_landlord_verification_submission(
  p_company_name TEXT,
  p_business_address TEXT,
  p_document_type TEXT,
  p_storage_path TEXT,
  p_file_name TEXT,
  p_file_size BIGINT,
  p_content_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_sub_id UUID := gen_random_uuid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_landlord() THEN
    RAISE EXCEPTION 'Forbidden: active landlord account required.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.landlord_verification_submissions (
    id, landlord_id, document_type, storage_path, file_name, file_size, content_type, status
  ) VALUES (
    v_sub_id, v_uid, p_document_type, p_storage_path, p_file_name, p_file_size, p_content_type, 'pending'
  );

  INSERT INTO public.landlord_profiles (user_id, company_name, business_address, verification_status)
  VALUES (v_uid, p_company_name, p_business_address, 'pending')
  ON CONFLICT (user_id) DO UPDATE
  SET
    company_name = COALESCE(NULLIF(TRIM(EXCLUDED.company_name), ''), public.landlord_profiles.company_name),
    business_address = COALESCE(NULLIF(TRIM(EXCLUDED.business_address), ''), public.landlord_profiles.business_address),
    verification_status = 'pending',
    rejection_reason = NULL,
    updated_at = timezone('utc'::text, now());

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (v_uid, 'SUBMIT_LANDLORD_VERIFICATION', 'landlord_verification_submissions', v_sub_id::text, jsonb_build_object('document_type', p_document_type, 'file_name', p_file_name));

  RETURN jsonb_build_object('success', true, 'submissionId', v_sub_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_landlord_verification_submission(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_landlord_verification_submission(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_landlord_verification_submission(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO authenticated;

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
    verified_at = v_now,
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
    jsonb_build_object('decision', p_decision, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', true, 'landlordId', v_landlord_id, 'status', p_decision);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_property(
  p_property_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_prop RECORD;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_status public.property_approval_status;
  v_published BOOLEAN;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found.';
  END IF;

  IF p_decision IN ('approve', 'reactivate') THEN
    v_status := 'approved';
    v_published := true;
  ELSIF p_decision = 'reject' THEN
    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
      RAISE EXCEPTION 'A rejection reason is required.';
    END IF;
    v_status := 'rejected';
    v_published := false;
  ELSIF p_decision = 'suspend' THEN
    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
      RAISE EXCEPTION 'A suspension reason is required.';
    END IF;
    v_status := 'archived';
    v_published := false;
  ELSE
    RAISE EXCEPTION 'Unsupported property review decision: %', p_decision;
  END IF;

  UPDATE public.properties
  SET
    approval_status = v_status,
    is_published = v_published,
    approved_at = CASE WHEN v_status = 'approved' THEN v_now ELSE approved_at END,
    approved_by = CASE WHEN v_status = 'approved' THEN v_admin_id ELSE approved_by END,
    rejection_reason = CASE WHEN v_status IN ('rejected', 'archived') THEN trim(p_reason) ELSE NULL END,
    updated_at = v_now
  WHERE id = p_property_id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_prop.landlord_id,
    'Property Review Update: ' || v_prop.title,
    'Listing status updated to ' || v_status::text || COALESCE(': ' || NULLIF(trim(p_reason), ''), '.'),
    'property',
    '/landlord/properties'
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_admin_id,
    'ADMIN_REVIEW_PROPERTY',
    'properties',
    p_property_id::text,
    jsonb_build_object('decision', p_decision, 'status', v_status, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', true, 'propertyId', p_property_id, 'status', v_status, 'isPublished', v_published);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_property_location(
  p_property_id UUID,
  p_decision verification_status,
  p_public_latitude NUMERIC DEFAULT NULL,
  p_public_longitude NUMERIC DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_loc RECORD;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid location review decision: must be approved or rejected.';
  END IF;

  IF p_decision = 'rejected' AND (p_reason IS NULL OR length(trim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;

  SELECT * INTO v_loc FROM public.property_locations WHERE property_id = p_property_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No location submission found for this property.';
  END IF;

  UPDATE public.property_locations
  SET
    verification_status = p_decision,
    public_latitude = CASE WHEN p_decision = 'approved' THEN COALESCE(p_public_latitude, latitude) ELSE NULL END,
    public_longitude = CASE WHEN p_decision = 'approved' THEN COALESCE(p_public_longitude, longitude) ELSE NULL END,
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    rejection_reason = CASE WHEN p_decision = 'rejected' THEN trim(p_reason) ELSE NULL END,
    updated_at = v_now
  WHERE property_id = p_property_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_admin_id,
    CASE WHEN p_decision = 'approved' THEN 'ADMIN_VERIFY_LOCATION' ELSE 'ADMIN_REJECT_LOCATION' END,
    'property_locations',
    p_property_id::text,
    jsonb_build_object('decision', p_decision, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', true, 'propertyId', p_property_id, 'status', p_decision);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_target_id UUID,
  p_status account_status,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_target RECORD;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.' USING ERRCODE = '42501';
  END IF;

  IF p_target_id = v_admin_id THEN
    RAISE EXCEPTION 'Administrators cannot alter their own suspension status.';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found.';
  END IF;

  IF v_target.role = 'admin' THEN
    RAISE EXCEPTION 'Administrator accounts cannot be suspended from the directory.';
  END IF;

  IF p_status = 'suspended' AND (p_reason IS NULL OR length(trim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'A suspension reason is required.';
  END IF;

  UPDATE public.profiles
  SET account_status = p_status, updated_at = v_now
  WHERE id = p_target_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_admin_id,
    CASE WHEN p_status = 'suspended' THEN 'ADMIN_SUSPEND_USER' ELSE 'ADMIN_ACTIVATE_USER' END,
    'profiles',
    p_target_id::text,
    jsonb_build_object('status', p_status, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', true, 'userId', p_target_id, 'accountStatus', p_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_review_student_verification(UUID, verification_status, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_review_landlord_verification(UUID, verification_status, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_review_property(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_review_property_location(UUID, verification_status, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_status(UUID, account_status, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_review_student_verification(UUID, verification_status, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_landlord_verification(UUID, verification_status, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_property(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_property_location(UUID, verification_status, NUMERIC, NUMERIC, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(UUID, account_status, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_auth_user_email_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.profiles
    SET
      account_status = 'active'::public.account_status,
      updated_at = timezone('utc'::text, now())
    WHERE id = NEW.id
      AND account_status = 'email_unverified';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_email_confirmed();

REVOKE EXECUTE ON FUNCTION public.handle_auth_user_email_confirmed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_auth_user_email_confirmed() TO supabase_auth_admin, service_role;

-- ============================================================================
-- 4. Preserve & Re-assert Migration 08: property_images & 19-Metric RPC
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  landlord_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_bucket TEXT NOT NULL DEFAULT 'property-images',
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL CHECK (
    length(trim(public_url)) > 0
    AND public_url !~* '^(data:|blob:)'
  ),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  file_size BIGINT NOT NULL DEFAULT 1 CHECK (file_size > 0),
  is_cover BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_property_images_property_path UNIQUE (property_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_property_images_property_id
  ON public.property_images(property_id);

CREATE INDEX IF NOT EXISTS idx_property_images_landlord_id
  ON public.property_images(landlord_id);

ALTER TABLE public.property_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_images FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Property images metadata visible with property access" ON public.property_images;
CREATE POLICY "Property images metadata visible with property access"
  ON public.property_images FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_images.property_id
        AND (
          (p.approval_status = 'approved' AND p.is_published = true)
          OR p.landlord_id = auth.uid()
          OR public.is_admin()
        )
    )
  );

DROP POLICY IF EXISTS "Landlords insert images for own properties" ON public.property_images;
CREATE POLICY "Landlords insert images for own properties"
  ON public.property_images FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = landlord_id
    AND public.is_landlord()
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_images.property_id
        AND p.landlord_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Landlords update images for own properties" ON public.property_images;
CREATE POLICY "Landlords update images for own properties"
  ON public.property_images FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = landlord_id AND public.is_landlord())
    OR public.is_admin()
  )
  WITH CHECK (
    (
      auth.uid() = landlord_id
      AND public.is_landlord()
      AND EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.id = property_images.property_id
          AND p.landlord_id = auth.uid()
      )
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Landlords or admins delete property images metadata" ON public.property_images;
CREATE POLICY "Landlords or admins delete property images metadata"
  ON public.property_images FOR DELETE
  TO authenticated
  USING (
    (auth.uid() = landlord_id AND public.is_landlord())
    OR public.is_admin()
  );

CREATE OR REPLACE FUNCTION public.admin_get_dashboard_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
STABLE
AS $$
DECLARE
  v_total_users BIGINT;
  v_total_students BIGINT;
  v_total_landlords BIGINT;
  v_total_administrators BIGINT;
  v_total_non_admin_users BIGINT;
  v_total_student_docs BIGINT;
  v_total_landlord_subs BIGINT;
  v_total_payment_receipts BIGINT;
  v_pending_student_verifications BIGINT;
  v_pending_landlord_verifications BIGINT;
  v_approved_landlord_verifications BIGINT;
  v_rejected_landlord_verifications BIGINT;
  v_total_properties BIGINT;
  v_approved_properties BIGINT;
  v_pending_property_verifications BIGINT;
  v_active_properties BIGINT;
  v_active_reservations BIGINT;
  v_pending_receipt_verifications BIGINT;
  v_expired_reservations BIGINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(DISTINCT id) INTO v_total_users FROM public.profiles;
  SELECT COUNT(DISTINCT id) INTO v_total_students FROM public.profiles WHERE role = 'student';
  SELECT COUNT(DISTINCT id) INTO v_total_landlords FROM public.profiles WHERE role = 'landlord';
  SELECT COUNT(DISTINCT id) INTO v_total_administrators FROM public.profiles WHERE role = 'admin';
  SELECT COUNT(DISTINCT id) INTO v_total_non_admin_users FROM public.profiles WHERE role IN ('student', 'landlord');

  SELECT COUNT(*) INTO v_total_student_docs FROM public.student_verification_documents;
  SELECT COUNT(*) INTO v_total_landlord_subs FROM public.landlord_verification_submissions;
  SELECT COUNT(*) INTO v_total_payment_receipts FROM public.payment_receipts;

  SELECT COUNT(*) INTO v_pending_student_verifications
  FROM public.student_verification_documents
  WHERE status = 'pending';

  SELECT COUNT(DISTINCT landlord_id) INTO v_pending_landlord_verifications
  FROM (
    SELECT landlord_id FROM public.landlord_verification_submissions WHERE status = 'pending'
    UNION
    SELECT user_id AS landlord_id FROM public.landlord_profiles WHERE verification_status = 'pending'
  ) pending_landlords;

  SELECT COUNT(DISTINCT user_id) INTO v_approved_landlord_verifications
  FROM public.landlord_profiles
  WHERE verification_status = 'approved';

  SELECT COUNT(DISTINCT user_id) INTO v_rejected_landlord_verifications
  FROM public.landlord_profiles
  WHERE verification_status = 'rejected';

  SELECT COUNT(*) INTO v_total_properties FROM public.properties;
  SELECT COUNT(*) INTO v_approved_properties FROM public.properties WHERE approval_status = 'approved';
  SELECT COUNT(*) INTO v_pending_property_verifications FROM public.properties WHERE approval_status = 'pending';
  SELECT COUNT(*) INTO v_active_properties FROM public.properties WHERE approval_status = 'approved' AND is_published = true;

  SELECT COUNT(*) INTO v_active_reservations
  FROM public.reservations
  WHERE status IN ('pending_payment', 'payment_submitted', 'confirmed')
    AND hold_expires_at > timezone('utc'::text, now());

  SELECT COUNT(*) INTO v_pending_receipt_verifications
  FROM public.payment_receipts
  WHERE status = 'pending_review';

  SELECT COUNT(*) INTO v_expired_reservations
  FROM public.reservations
  WHERE status = 'expired'
     OR (status IN ('pending_payment', 'payment_submitted') AND hold_expires_at <= timezone('utc'::text, now()));

  RETURN jsonb_build_object(
    'totalUsers', COALESCE(v_total_users, 0),
    'totalStudents', COALESCE(v_total_students, 0),
    'totalLandlords', COALESCE(v_total_landlords, 0),
    'totalAdministrators', COALESCE(v_total_administrators, 0),
    'totalNonAdminUsers', COALESCE(v_total_non_admin_users, 0),
    'totalUploadedStudentDocuments', COALESCE(v_total_student_docs, 0),
    'totalLandlordVerificationSubmissions', COALESCE(v_total_landlord_subs, 0),
    'totalPaymentReceipts', COALESCE(v_total_payment_receipts, 0),
    'pendingStudentVerifications', COALESCE(v_pending_student_verifications, 0),
    'pendingLandlordVerifications', COALESCE(v_pending_landlord_verifications, 0),
    'approvedLandlordVerifications', COALESCE(v_approved_landlord_verifications, 0),
    'rejectedLandlordVerifications', COALESCE(v_rejected_landlord_verifications, 0),
    'totalProperties', COALESCE(v_total_properties, 0),
    'approvedProperties', COALESCE(v_approved_properties, 0),
    'pendingPropertyVerifications', COALESCE(v_pending_property_verifications, 0),
    'activeProperties', COALESCE(v_active_properties, 0),
    'activeReservations', COALESCE(v_active_reservations, 0),
    'pendingReceiptVerifications', COALESCE(v_pending_receipt_verifications, 0),
    'expiredReservations', COALESCE(v_expired_reservations, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_dashboard_metrics() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_dashboard_metrics() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_metrics() TO authenticated, service_role;

-- ============================================================================
-- 5. Re-assert Storage Buckets & Idempotent Storage Policies
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('student-docs', 'student-docs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('landlord-docs', 'landlord-docs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('payment-receipts', 'payment-receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('chat-attachments', 'chat-attachments', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']),
  ('property-images', 'property-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('profile-pictures', 'profile-pictures', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$ BEGIN
  CREATE POLICY "Student read own documents or admin"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'student-docs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Student upload own verification document"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'student-docs' AND (storage.foldername(name))[1] = auth.uid()::text AND public.is_student());
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Student delete own pending document"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'student-docs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Landlord read own documents or admin"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'landlord-docs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Landlord upload own verification submission"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'landlord-docs' AND (storage.foldername(name))[1] = auth.uid()::text AND public.is_landlord());
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Landlord delete own pending document"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'landlord-docs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Read payment receipt restricted to reservation parties or admin"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'payment-receipts' AND ((storage.foldername(name))[1] = auth.uid()::text OR (storage.foldername(name))[2] = auth.uid()::text OR public.is_admin()));
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Student upload receipt to server-issued path"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'payment-receipts' AND (storage.foldername(name))[2] = auth.uid()::text AND public.is_student());
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Payment receipts deletion forbidden to clients"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'payment-receipts' AND public.is_admin());
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Participants read chat attachments"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'chat-attachments' AND (public.is_conversation_participant((storage.foldername(name))[1]::uuid) OR public.is_admin()));
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Sender upload chat attachment to conversation"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'chat-attachments' AND (storage.foldername(name))[2] = auth.uid()::text AND public.is_conversation_participant((storage.foldername(name))[1]::uuid));
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Chat attachment deletion restricted to admin"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'chat-attachments' AND public.is_admin());
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Property images public read"
    ON storage.objects FOR SELECT TO authenticated, anon
    USING (bucket_id = 'property-images');
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Landlords upload images to own property folder"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'property-images' AND (storage.foldername(name))[1] = auth.uid()::text AND public.is_landlord());
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Landlords delete images from own property folder"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'property-images' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Profile pictures public read"
    ON storage.objects FOR SELECT TO authenticated, anon
    USING (bucket_id = 'profile-pictures');
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users upload own profile picture"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users update own profile picture"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users delete own profile picture"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object OR insufficient_privilege THEN NULL;
END $$;

-- ============================================================================
-- 6. Reject Ephemeral (data: / blob:) URLs on Properties & Profiles Triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reject_ephemeral_media_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_img TEXT;
BEGIN
  IF TG_TABLE_NAME = 'properties' THEN
    IF NEW.featured_image_url IS NOT NULL AND NEW.featured_image_url ~* '^(data:|blob:)' THEN
      RAISE EXCEPTION 'Invalid featured_image_url: ephemeral data: or blob: URLs cannot be persisted.'
        USING ERRCODE = '22023';
    END IF;

    IF NEW.images IS NOT NULL THEN
      FOREACH v_img IN ARRAY NEW.images LOOP
        IF v_img IS NOT NULL AND v_img ~* '^(data:|blob:)' THEN
          RAISE EXCEPTION 'Invalid property image URL: ephemeral data: or blob: URLs cannot be persisted.'
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url ~* '^(data:|blob:)' THEN
      RAISE EXCEPTION 'Invalid avatar_url: ephemeral data: or blob: URLs cannot be persisted.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_properties_reject_ephemeral_urls ON public.properties;
CREATE TRIGGER tr_properties_reject_ephemeral_urls
  BEFORE INSERT OR UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_ephemeral_media_urls();

DROP TRIGGER IF EXISTS tr_profiles_reject_ephemeral_urls ON public.profiles;
CREATE TRIGGER tr_profiles_reject_ephemeral_urls
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_ephemeral_media_urls();

-- ============================================================================
-- 7. Atomic Reservation Cancellation RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_reservation_atomic(
  p_reservation_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_res RECORD;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_reason TEXT := COALESCE(NULLIF(TRIM(p_reason), ''), 'Cancelled by student');
BEGIN
  IF v_uid IS NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Authentication required to cancel reservation.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  IF v_res.student_id != v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: only the reservation student or an administrator may cancel this hold.'
      USING ERRCODE = '42501';
  END IF;

  IF v_res.status NOT IN ('pending_payment', 'payment_submitted') THEN
    RAISE EXCEPTION 'Cannot cancel reservation in status: %', v_res.status;
  END IF;

  UPDATE public.reservations
  SET
    status = 'cancelled',
    cancellation_reason = v_reason,
    updated_at = v_now
  WHERE id = p_reservation_id;

  UPDATE public.invoices
  SET
    status = 'cancelled',
    updated_at = v_now
  WHERE reservation_id = p_reservation_id
    AND status != 'paid';

  UPDATE public.units
  SET
    available_spaces = LEAST(capacity, available_spaces + 1),
    is_active = true,
    updated_at = v_now
  WHERE id = v_res.unit_id;

  UPDATE public.properties
  SET
    available_spaces = LEAST(total_spaces, available_spaces + 1),
    updated_at = v_now
  WHERE id = v_res.property_id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_res.landlord_id,
    'Reservation Hold Cancelled',
    'A student released their reservation hold. Room capacity has been restored.',
    'reservation',
    '/landlord/receipts'
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    COALESCE(v_uid, v_res.student_id),
    'CANCEL_RESERVATION',
    'reservation',
    p_reservation_id::text,
    jsonb_build_object('reason', v_reason, 'previous_status', v_res.status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'reservationId', p_reservation_id,
    'status', 'cancelled'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_reservation_atomic(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_atomic(UUID, TEXT) TO authenticated, service_role;
