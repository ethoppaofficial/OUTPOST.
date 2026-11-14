-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261114000013_student_delete_reservation_and_admin_broadcasts.sql
-- Description:
--   1. Adds `delete_student_reservation_atomic(p_reservation_id UUID)` allowing
--      students (or admins) to delete unpaid/cancelled/expired/rejected
--      reservations while atomically restoring unit & property spaces if a
--      hold was active, notifying the landlord, cascading linked unpaid
--      invoices/receipts, and preserving audit logs.
--   2. Adds `public.admin_broadcasts` table (RLS + FORCE RLS) and
--      `admin_send_broadcast(p_target_audience, p_title, p_message, p_target_user_id)`
--      SECURITY DEFINER RPC enabling administrators to broadcast notifications
--      to every user, every landlord, every student, or an individual user.
--   3. Ensures `public.notifications` is published for Supabase Realtime so
--      connected clients receive broadcast notifications immediately.
-- ============================================================================

-- ============================================================================
-- 1. Atomic Student Reservation Deletion RPC
-- ============================================================================

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

  -- If the reservation was still holding inventory, restore capacity atomically
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

  -- Audit log before deleting reservation row
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

  -- Delete reservation (cascades linked unpaid invoices & pending receipts via FK ON DELETE CASCADE)
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
-- 2. Admin Broadcast Messages Table & Notification Delivery RPC
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_audience TEXT NOT NULL CHECK (target_audience IN ('all_users', 'all_landlords', 'all_students', 'individual')),
  target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 140),
  message TEXT NOT NULL CHECK (length(btrim(message)) BETWEEN 2 AND 2000),
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_created_at
  ON public.admin_broadcasts (created_at DESC);

ALTER TABLE public.admin_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_broadcasts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read broadcast history" ON public.admin_broadcasts;
CREATE POLICY "Admins read broadcast history"
  ON public.admin_broadcasts FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins insert broadcast history" ON public.admin_broadcasts;
CREATE POLICY "Admins insert broadcast history"
  ON public.admin_broadcasts FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND sender_id = auth.uid());

CREATE OR REPLACE FUNCTION public.admin_send_broadcast(
  p_target_audience TEXT,
  p_title TEXT,
  p_message TEXT,
  p_target_user_id UUID DEFAULT NULL
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
  v_recipient_count INTEGER := 0;
  v_target_exists BOOLEAN := false;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: active administrator account required.'
      USING ERRCODE = '42501';
  END IF;

  IF v_audience NOT IN ('all_users', 'all_landlords', 'all_students', 'individual') THEN
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

  IF v_audience = 'individual' THEN
    IF p_target_user_id IS NULL THEN
      RAISE EXCEPTION 'A target user must be selected for an individual message.'
        USING ERRCODE = '22023';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = p_target_user_id
    ) INTO v_target_exists;

    IF NOT v_target_exists THEN
      RAISE EXCEPTION 'Target user profile not found.'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'OUTPOST Administration')
  INTO v_sender_name
  FROM public.profiles
  WHERE id = v_admin_id;

  -- Deliver individual notification rows for every matched recipient
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
        v_audience = 'individual'
        AND id = p_target_user_id
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

  INSERT INTO public.admin_broadcasts (
    id,
    sender_id,
    target_audience,
    target_user_id,
    title,
    message,
    recipient_count,
    created_at
  ) VALUES (
    v_broadcast_id,
    v_admin_id,
    v_audience,
    CASE WHEN v_audience = 'individual' THEN p_target_user_id ELSE NULL END,
    v_title,
    v_message,
    v_recipient_count,
    v_now
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_admin_id,
    'ADMIN_SEND_BROADCAST',
    'admin_broadcasts',
    v_broadcast_id::text,
    jsonb_build_object(
      'target_audience', v_audience,
      'target_user_id', p_target_user_id,
      'title', v_title,
      'recipient_count', v_recipient_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'broadcast_id', v_broadcast_id,
    'target_audience', v_audience,
    'target_user_id', p_target_user_id,
    'recipient_count', v_recipient_count,
    'created_at', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_send_broadcast(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_broadcast(TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;

-- ============================================================================
-- 3. Ensure Realtime Push Delivery for public.notifications
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

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
