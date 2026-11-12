-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261112000008_end_to_end_remediation.sql
-- Description:
--   1. Creates normalized public.property_images metadata table with strict
--      RLS + FORCE ROW LEVEL SECURITY and explicit non-ephemeral URL checks
--      (rejecting data: and blob: URLs at the database boundary).
--   2. Expands public.admin_get_dashboard_metrics() to return all 19 reconciled
--      live platform counters using DISTINCT user/entity counting semantics.
-- ============================================================================

-- 1. Normalized property_images metadata table
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

-- 2. Reconciled 19-metric server-side dashboard aggregation RPC
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
  -- Fail closed: caller must be an active administrator in public.profiles
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.'
      USING ERRCODE = '42501';
  END IF;

  -- Distinct account counts from public.profiles (prevents double-counting across companion tables)
  SELECT COUNT(DISTINCT id) INTO v_total_users FROM public.profiles;
  SELECT COUNT(DISTINCT id) INTO v_total_students FROM public.profiles WHERE role = 'student';
  SELECT COUNT(DISTINCT id) INTO v_total_landlords FROM public.profiles WHERE role = 'landlord';
  SELECT COUNT(DISTINCT id) INTO v_total_administrators FROM public.profiles WHERE role = 'admin';
  SELECT COUNT(DISTINCT id) INTO v_total_non_admin_users FROM public.profiles WHERE role IN ('student', 'landlord');

  -- Uploaded file counts strictly track authoritative metadata records (never unlinked storage blobs)
  SELECT COUNT(*) INTO v_total_student_docs FROM public.student_verification_documents;
  SELECT COUNT(*) INTO v_total_landlord_subs FROM public.landlord_verification_submissions;
  SELECT COUNT(*) INTO v_total_payment_receipts FROM public.payment_receipts;

  SELECT COUNT(*) INTO v_pending_student_verifications
  FROM public.student_verification_documents
  WHERE status = 'pending';

  -- Landlord verification status lifecycle across distinct landlord accounts
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

  -- Property submission and publication totals
  SELECT COUNT(*) INTO v_total_properties FROM public.properties;
  SELECT COUNT(*) INTO v_approved_properties FROM public.properties WHERE approval_status = 'approved';
  SELECT COUNT(*) INTO v_pending_property_verifications FROM public.properties WHERE approval_status = 'pending';
  SELECT COUNT(*) INTO v_active_properties FROM public.properties WHERE approval_status = 'approved' AND is_published = true;

  -- Reservation and payment review queues
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
