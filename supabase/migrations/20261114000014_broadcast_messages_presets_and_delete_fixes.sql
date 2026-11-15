-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261114000014_broadcast_messages_presets_and_delete_fixes.sql
-- Description:
--   Consolidated idempotent migration resolving:
--   1. Profile Picture Uploads & Preset Avatars:
--      - Ensures `profiles.avatar_url`, `profiles.avatar_preset_id`, `profiles.updated_at`.
--      - Ensures `profile-pictures` storage bucket & owner RLS policies.
--      - Updates `update_own_profile_avatar(p_avatar_url, p_avatar_preset_id)` RPC
--        supporting uploaded Storage URLs, curated preset avatars, or clearing to initials.
--   2. Student Reservation Deletion:
--      - Adds RLS DELETE policy for non-confirmed reservations owned by student/admin.
--      - Ensures `delete_student_reservation_atomic(p_reservation_id)` RPC exists and
--        atomically releases active holds, notifies landlord, and logs audit_logs.
--   3. Persistent Broadcast Messages (`public.broadcast_messages`):
--      - Creates `public.broadcast_messages` table persisting sender_id, target_audience
--        ('all_users', 'all_landlords', 'all_students', 'specific_users', 'individual'),
--        target_user_ids UUID[], target_user_id, title, message, recipient_count, created_at.
--      - Enables RLS + FORCE RLS for active administrators.
--      - Updates `admin_send_broadcast(...)` RPC to deliver notifications and persist
--        every broadcast into `public.broadcast_messages`.
--   4. Ensures `public.notifications` is enabled for Realtime and reloads PostgREST cache.
-- ============================================================================

-- ============================================================================
-- 1. Profile Picture Columns, Storage Policies & Preset-Aware Avatar RPC
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS avatar_preset_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

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
    RAISE NOTICE 'Configure profile-pictures policies in Supabase Storage > Policies if uploads are blocked.';
END $$;

DROP FUNCTION IF EXISTS public.update_own_profile_avatar(TEXT);

CREATE OR REPLACE FUNCTION public.update_own_profile_avatar(
  p_avatar_url TEXT DEFAULT NULL,
  p_avatar_preset_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_clean_url TEXT := NULLIF(btrim(COALESCE(p_avatar_url, '')), '');
  v_clean_preset TEXT := NULLIF(btrim(COALESCE(p_avatar_preset_id, '')), '');
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

  IF v_clean_url IS NOT NULL AND v_clean_url ~* '^(data:|blob:)' THEN
    RAISE EXCEPTION 'Ephemeral data: or blob: URLs cannot be persisted as profile avatars.'
      USING ERRCODE = '22023';
  END IF;

  IF v_clean_url IS NOT NULL
     AND v_clean_url !~* '^https?://'
     AND v_clean_url !~* '^preset:[a-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Invalid avatar URL format.'
      USING ERRCODE = '22023';
  END IF;

  IF v_clean_preset IS NOT NULL AND v_clean_preset !~* '^[a-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Invalid avatar preset identifier.'
      USING ERRCODE = '22023';
  END IF;

  IF v_clean_preset IS NOT NULL AND v_clean_url IS NULL THEN
    v_clean_url := 'preset:' || v_clean_preset;
  ELSIF v_clean_url IS NOT NULL AND v_clean_url ~* '^preset:' AND v_clean_preset IS NULL THEN
    v_clean_preset := substring(v_clean_url FROM 8);
  END IF;

  UPDATE public.profiles
  SET
    avatar_url = v_clean_url,
    avatar_preset_id = CASE WHEN v_clean_url ~* '^https?://' THEN NULL ELSE v_clean_preset END,
    updated_at = v_now
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_uid,
    'avatar_url', v_clean_url,
    'avatar_preset_id', CASE WHEN v_clean_url ~* '^https?://' THEN NULL ELSE v_clean_preset END,
    'updated_at', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_own_profile_avatar(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_own_profile_avatar(TEXT, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 2. Student Reservation Deletion (RLS Policy + Atomic RPC)
-- ============================================================================

DROP POLICY IF EXISTS "Students or admins delete non-confirmed reservations" ON public.reservations;
CREATE POLICY "Students or admins delete non-confirmed reservations"
  ON public.reservations FOR DELETE
  TO authenticated
  USING (
    (student_id = auth.uid() AND status != 'confirmed')
    OR public.is_admin()
  );

CREATE OR REPLACE FUNCTION public.delete_student_reservation_atomic(
  p_reservation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_res RECORD;
  v_prop_title TEXT;
  v_released_space BOOLEAN := false;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF v_uid IS NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Authentication required to delete a reservation.'
      USING ERRCODE = '42501';
  END IF;

  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'Reservation identifier is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  IF v_res.student_id != v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: only the reservation owner or an administrator may delete this reservation.'
      USING ERRCODE = '42501';
  END IF;

  IF v_res.status = 'confirmed' THEN
    RAISE EXCEPTION 'Confirmed reservations with verified payment receipts cannot be deleted directly. Contact support for tenancy changes.'
      USING ERRCODE = '22023';
  END IF;

  SELECT title INTO v_prop_title
  FROM public.properties
  WHERE id = v_res.property_id;

  IF v_res.status IN ('pending_payment', 'payment_submitted') THEN
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

    v_released_space := true;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_res.landlord_id,
      'Reserved Space Released',
      'A student deleted their unpaid reservation for ' || COALESCE(v_prop_title, 'your property') || '. The room space is now available again.',
      'reservation',
      '/landlord/receipts'
    );
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    COALESCE(v_uid, v_res.student_id),
    'DELETE_RESERVATION',
    'reservation',
    p_reservation_id::text,
    jsonb_build_object(
      'property_id', v_res.property_id,
      'unit_id', v_res.unit_id,
      'previous_status', v_res.status,
      'released_space', v_released_space
    )
  );

  DELETE FROM public.reservations
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object(
    'success', true,
    'reservationId', p_reservation_id,
    'releasedSpace', v_released_space,
    'previousStatus', v_res.status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_student_reservation_atomic(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_student_reservation_atomic(UUID) TO authenticated, service_role;

-- ============================================================================
-- 3. Persistent Broadcast Messages Table (`public.broadcast_messages`) & RPC
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.broadcast_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_audience TEXT NOT NULL CHECK (
    target_audience IN ('all_users', 'all_landlords', 'all_students', 'specific_users', 'individual')
  ),
  target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_user_ids UUID[] NOT NULL DEFAULT '{}',
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 140),
  message TEXT NOT NULL CHECK (length(btrim(message)) BETWEEN 2 AND 2000),
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_broadcast_messages_created_at
  ON public.broadcast_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_broadcast_messages_audience
  ON public.broadcast_messages (target_audience, created_at DESC);

ALTER TABLE public.broadcast_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read broadcast messages" ON public.broadcast_messages;
CREATE POLICY "Admins read broadcast messages"
  ON public.broadcast_messages FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins insert broadcast messages" ON public.broadcast_messages;
CREATE POLICY "Admins insert broadcast messages"
  ON public.broadcast_messages FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND sender_id = auth.uid());

-- Migrate any legacy rows if admin_broadcasts was already created earlier
DO $$
BEGIN
  IF to_regclass('public.admin_broadcasts') IS NOT NULL THEN
    INSERT INTO public.broadcast_messages (
      id, sender_id, target_audience, target_user_id, target_user_ids, title, message, recipient_count, created_at
    )
    SELECT
      ab.id,
      ab.sender_id,
      ab.target_audience,
      ab.target_user_id,
      CASE WHEN ab.target_user_id IS NOT NULL THEN ARRAY[ab.target_user_id] ELSE '{}'::uuid[] END,
      ab.title,
      ab.message,
      ab.recipient_count,
      ab.created_at
    FROM public.admin_broadcasts ab
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Allow active administrators to deliver notification rows even when falling back outside RPC
DROP POLICY IF EXISTS "Admins insert notifications" ON public.notifications;
CREATE POLICY "Admins insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP FUNCTION IF EXISTS public.admin_send_broadcast(TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_send_broadcast(TEXT, TEXT, TEXT, UUID, UUID[]);

CREATE OR REPLACE FUNCTION public.admin_send_broadcast(
  p_target_audience TEXT,
  p_title TEXT,
  p_message TEXT,
  p_target_user_id UUID DEFAULT NULL,
  p_target_user_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_sender_name TEXT;
  v_audience TEXT := lower(btrim(COALESCE(p_target_audience, '')));
  v_title TEXT := btrim(COALESCE(p_title, ''));
  v_message TEXT := btrim(COALESCE(p_message, ''));
  v_broadcast_id UUID := gen_random_uuid();
  v_target_ids UUID[] := '{}';
  v_primary_target_id UUID;
  v_recipient_count INTEGER := 0;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.'
      USING ERRCODE = '42501';
  END IF;

  IF v_audience NOT IN ('all_users', 'all_landlords', 'all_students', 'specific_users', 'individual') THEN
    RAISE EXCEPTION 'Invalid broadcast target audience "%".', v_audience
      USING ERRCODE = '22023';
  END IF;

  IF length(v_title) < 2 OR length(v_title) > 140 THEN
    RAISE EXCEPTION 'Broadcast title must be between 2 and 140 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF length(v_message) < 2 OR length(v_message) > 2000 THEN
    RAISE EXCEPTION 'Broadcast message must be between 2 and 2000 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_audience IN ('specific_users', 'individual') THEN
    SELECT COALESCE(array_agg(DISTINCT u_id), '{}')
    INTO v_target_ids
    FROM (
      SELECT unnest(COALESCE(p_target_user_ids, '{}'::uuid[])) AS u_id
      UNION
      SELECT p_target_user_id AS u_id WHERE p_target_user_id IS NOT NULL
    ) merged
    WHERE u_id IS NOT NULL;

    IF array_length(v_target_ids, 1) IS NULL OR array_length(v_target_ids, 1) = 0 THEN
      RAISE EXCEPTION 'At least one target user must be selected.'
        USING ERRCODE = '22023';
    END IF;

    v_primary_target_id := v_target_ids[1];
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'OUTPOST Administration')
  INTO v_sender_name
  FROM public.profiles
  WHERE id = v_admin_id;

  WITH recipients AS (
    SELECT id
    FROM public.profiles
    WHERE
      (
        v_audience = 'all_users'
        AND account_status != 'suspended'
      )
      OR (
        v_audience = 'all_landlords'
        AND role = 'landlord'
        AND account_status != 'suspended'
      )
      OR (
        v_audience = 'all_students'
        AND role = 'student'
        AND account_status != 'suspended'
      )
      OR (
        v_audience IN ('specific_users', 'individual')
        AND id = ANY(v_target_ids)
      )
  ),
  inserted_notifs AS (
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      link,
      is_read,
      metadata,
      created_at
    )
    SELECT
      r.id,
      v_title,
      v_message,
      'broadcast',
      '/notifications',
      false,
      jsonb_build_object(
        'broadcast_id', v_broadcast_id,
        'audience', v_audience,
        'sender_id', v_admin_id,
        'sender_name', COALESCE(v_sender_name, 'OUTPOST Administration')
      ),
      v_now
    FROM recipients r
    RETURNING id
  )
  SELECT count(*)::int INTO v_recipient_count FROM inserted_notifs;

  IF v_audience IN ('specific_users', 'individual') AND v_recipient_count = 0 THEN
    RAISE EXCEPTION 'None of the selected recipient profiles were found.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.broadcast_messages (
    id,
    sender_id,
    target_audience,
    target_user_id,
    target_user_ids,
    title,
    message,
    recipient_count,
    created_at
  ) VALUES (
    v_broadcast_id,
    v_admin_id,
    v_audience,
    v_primary_target_id,
    v_target_ids,
    v_title,
    v_message,
    v_recipient_count,
    v_now
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_admin_id,
    'ADMIN_SEND_BROADCAST',
    'broadcast_messages',
    v_broadcast_id::text,
    jsonb_build_object(
      'target_audience', v_audience,
      'target_user_id', v_primary_target_id,
      'target_user_ids', v_target_ids,
      'title', v_title,
      'message', v_message,
      'recipient_count', v_recipient_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'broadcast_id', v_broadcast_id,
    'target_audience', v_audience,
    'target_user_id', v_primary_target_id,
    'target_user_ids', v_target_ids,
    'recipient_count', v_recipient_count,
    'created_at', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_send_broadcast(TEXT, TEXT, TEXT, UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_broadcast(TEXT, TEXT, TEXT, UUID, UUID[]) TO authenticated, service_role;

-- ============================================================================
-- 4. Enable Realtime on public.notifications & Refresh Schema Cache
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not alter supabase_realtime publication for notifications automatically.';
END $$;

NOTIFY pgrst, 'reload schema';
