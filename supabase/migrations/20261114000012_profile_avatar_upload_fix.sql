-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261114000012_profile_avatar_upload_fix.sql
-- Description:
--   Hardens profile picture upload and persistence across Storage and Postgres:
--   1. Guarantees public.profiles.avatar_url and updated_at columns exist.
--   2. Re-asserts the public 'profile-pictures' storage bucket (2 MB, JPEG/PNG/WebP)
--      and idempotent tenant-scoped storage.objects policies.
--   3. Adds atomic SECURITY DEFINER RPC `update_own_profile_avatar(TEXT)`
--      so authenticated non-suspended users can persist their avatar URL cleanly
--      without hitting nested UPDATE RLS subqueries on public.profiles.
-- ============================================================================

-- 1. Ensure expected profile columns exist on legacy deployments
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- 2. Ensure 'profile-pictures' bucket exists with 2 MB public image constraints
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

-- 3. Ensure Storage RLS policies for 'profile-pictures' exist cleanly
DO $$
BEGIN
  DROP POLICY IF EXISTS "Profile pictures public read" ON storage.objects;
  CREATE POLICY "Profile pictures public read"
    ON storage.objects FOR SELECT
    TO authenticated, anon
    USING (bucket_id = 'profile-pictures');

  DROP POLICY IF EXISTS "Users upload own profile picture" ON storage.objects;
  CREATE POLICY "Users upload own profile picture"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'profile-pictures'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

  DROP POLICY IF EXISTS "Users update own profile picture" ON storage.objects;
  CREATE POLICY "Users update own profile picture"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'profile-pictures'
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
      bucket_id = 'profile-pictures'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

  DROP POLICY IF EXISTS "Users delete own profile picture" ON storage.objects;
  CREATE POLICY "Users delete own profile picture"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'profile-pictures'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to alter storage.objects policies from SQL Editor. Configure the 4 profile-pictures policies under Storage > Policies in Supabase Dashboard if uploads are blocked.';
END $$;

-- 4. Atomic SECURITY DEFINER RPC for authenticated user avatar updates
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

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
