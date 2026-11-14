-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261114000014_profile_pictures_storage_rls_review.sql
-- Description:
--   Audits and hardens Supabase Storage RLS policies for 'profile-pictures'
--   (OUTPOST's equivalent of 'avatars') and ensures profile avatar persistence:
--   1. Re-asserts 'profile-pictures' bucket with public = true, 2 MB limit,
--      and strict raster image MIME allowlist (JPEG, PNG, WebP).
--   2. Enforces 'public-read' (SELECT TO public) and 'authenticated-write'
--      (INSERT, UPDATE with USING + WITH CHECK, DELETE TO authenticated)
--      scoped strictly to the caller's lower(auth.uid()::text) folder.
--   3. Wraps each storage.objects policy individually so a single privilege
--      error in SQL Editor never aborts sibling policies.
--   4. Re-asserts public.update_own_profile_avatar(TEXT) SECURITY DEFINER RPC.
-- ============================================================================

-- 1. Ensure 'profile-pictures' public bucket exists with 2 MB image constraints
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-pictures',
  'profile-pictures',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage RLS Policies for 'profile-pictures'
--    Public-read: SELECT TO public (covers anon & authenticated visitors)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Profile pictures public read" ON storage.objects;
  CREATE POLICY "Profile pictures public read"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'profile-pictures');
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to alter SELECT policy "Profile pictures public read" on storage.objects from SQL Editor. Configure SELECT for public on bucket profile-pictures under Storage > Policies.';
END $$;

--    Authenticated-write (INSERT): users may upload only into {auth.uid()}/...
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users upload own profile picture" ON storage.objects;
  CREATE POLICY "Users upload own profile picture"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'profile-pictures'
      AND auth.uid() IS NOT NULL
      AND lower((storage.foldername(name))[1]) = lower(auth.uid()::text)
    );
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to alter INSERT policy "Users upload own profile picture" on storage.objects from SQL Editor. Configure INSERT for authenticated on bucket profile-pictures under Storage > Policies.';
END $$;

--    Authenticated-write (UPDATE): users may update only objects in {auth.uid()}/...
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users update own profile picture" ON storage.objects;
  CREATE POLICY "Users update own profile picture"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'profile-pictures'
      AND auth.uid() IS NOT NULL
      AND lower((storage.foldername(name))[1]) = lower(auth.uid()::text)
    )
    WITH CHECK (
      bucket_id = 'profile-pictures'
      AND auth.uid() IS NOT NULL
      AND lower((storage.foldername(name))[1]) = lower(auth.uid()::text)
    );
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to alter UPDATE policy "Users update own profile picture" on storage.objects from SQL Editor. Configure UPDATE for authenticated on bucket profile-pictures under Storage > Policies.';
END $$;

--    Authenticated-write (DELETE): users may delete only objects in {auth.uid()}/...
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users delete own profile picture" ON storage.objects;
  CREATE POLICY "Users delete own profile picture"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'profile-pictures'
      AND auth.uid() IS NOT NULL
      AND lower((storage.foldername(name))[1]) = lower(auth.uid()::text)
    );
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to alter DELETE policy "Users delete own profile picture" on storage.objects from SQL Editor. Configure DELETE for authenticated on bucket profile-pictures under Storage > Policies.';
END $$;

-- 3. Ensure profile columns and atomic avatar RPC remain synced
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

CREATE OR REPLACE FUNCTION public.update_own_profile_avatar(p_avatar_url TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_clean_url TEXT := NULLIF(btrim(COALESCE(p_avatar_url, '')), '');
  v_status public.account_status;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to update profile photo.'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_status INTO v_status
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'suspended' THEN
    RAISE EXCEPTION 'Suspended accounts cannot modify profile details.'
      USING ERRCODE = '42501';
  END IF;

  IF v_clean_url IS NULL OR v_clean_url ~* '^(data:|blob:)' OR v_clean_url !~* '^https?://' THEN
    RAISE EXCEPTION 'A valid permanent Storage avatar URL is required.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET
    avatar_url = v_clean_url,
    updated_at = v_now
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_uid,
    'avatar_url', v_clean_url,
    'updated_at', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_own_profile_avatar(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_own_profile_avatar(TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
