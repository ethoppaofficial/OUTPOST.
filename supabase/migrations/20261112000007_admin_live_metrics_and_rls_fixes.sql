-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261112000007_admin_live_metrics_and_rls_fixes.sql
-- Description:
--   1. Hardens public.is_admin() with explicit safe search_path (pg_temp).
--   2. Adds SECURITY DEFINER RPCs for authoritative server-side admin metrics,
--      verification review transitions, property/location moderation, and
--      user account status governance (all failing closed unless active admin).
--   3. Adds landlord verification submission RPC & safe trigger check so
--      landlords can move from not_started/rejected -> pending when submitting
--      real verification evidence, while never self-approving.
--   4. Allows landlords to insert 'pending' (unpublished) property drafts and
--      grants explicit admin SELECT visibility where needed without weakening RLS.
--   5. Synchronizes profiles.account_status on auth.users email confirmation.
-- ============================================================================

-- 1. Harden public.is_admin() search_path (still requires active role='admin')
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

-- 2. Explicit admin SELECT visibility on supporting tables where needed
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

-- Allow landlords to insert 'draft' or 'pending' properties (always unpublished until admin approves)
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

-- 3. Authoritative server-side metrics RPC (counts metadata rows only, no table dumps)
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
  v_total_student_docs BIGINT;
  v_total_landlord_subs BIGINT;
  v_total_payment_receipts BIGINT;
  v_pending_student_verifications BIGINT;
  v_pending_landlord_verifications BIGINT;
  v_pending_property_verifications BIGINT;
  v_active_properties BIGINT;
  v_active_reservations BIGINT;
  v_pending_receipt_verifications BIGINT;
  v_expired_reservations BIGINT;
BEGIN
  -- Fail closed: caller must be an active administrator in public.profiles
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_total_users FROM public.profiles;
  SELECT COUNT(*) INTO v_total_students FROM public.profiles WHERE role = 'student';
  SELECT COUNT(*) INTO v_total_landlords FROM public.profiles WHERE role = 'landlord';
  SELECT COUNT(*) INTO v_total_administrators FROM public.profiles WHERE role = 'admin';

  -- "Uploaded files" metrics strictly count authoritative metadata records
  SELECT COUNT(*) INTO v_total_student_docs FROM public.student_verification_documents;
  SELECT COUNT(*) INTO v_total_landlord_subs FROM public.landlord_verification_submissions;
  SELECT COUNT(*) INTO v_total_payment_receipts FROM public.payment_receipts;

  SELECT COUNT(*) INTO v_pending_student_verifications
  FROM public.student_verification_documents
  WHERE status = 'pending';

  -- Count pending landlords across submissions and submitted landlord_profiles
  SELECT COUNT(DISTINCT landlord_id) INTO v_pending_landlord_verifications
  FROM (
    SELECT landlord_id FROM public.landlord_verification_submissions WHERE status = 'pending'
    UNION
    SELECT user_id AS landlord_id FROM public.landlord_profiles WHERE verification_status = 'pending'
  ) pending_landlords;

  SELECT COUNT(*) INTO v_pending_property_verifications
  FROM public.properties
  WHERE approval_status = 'pending';

  SELECT COUNT(*) INTO v_active_properties
  FROM public.properties
  WHERE approval_status = 'approved' AND is_published = true;

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
    'totalUploadedStudentDocuments', COALESCE(v_total_student_docs, 0),
    'totalLandlordVerificationSubmissions', COALESCE(v_total_landlord_subs, 0),
    'totalPaymentReceipts', COALESCE(v_total_payment_receipts, 0),
    'pendingStudentVerifications', COALESCE(v_pending_student_verifications, 0),
    'pendingLandlordVerifications', COALESCE(v_pending_landlord_verifications, 0),
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

-- 4. Safe landlord verification trigger + atomic submission RPC
--    Allows transition not_started/rejected -> pending ONLY when backing submission exists,
--    while continuing to strictly forbid landlords from setting 'approved' or 'rejected'.
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

-- RLS update check on landlord_profiles must match trigger for pending transition
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

-- Atomic RPC for landlord verification submission
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

-- 5. Atomic Admin Governance RPCs (fail closed if caller is not an active admin)
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

  -- p_target_id may be either a submission UUID or the landlord user_id
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

-- 6. Synchronize email confirmation from auth.users to public.profiles
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
