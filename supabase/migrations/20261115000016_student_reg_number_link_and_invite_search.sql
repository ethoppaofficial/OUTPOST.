-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261115000016_student_reg_number_link_and_invite_search.sql
-- Description:
--   1. Backfills missing student_profiles.registration_number from auth user metadata
--      and hardens handle_new_user() to link registration numbers even when rows exist.
--   2. Adds link_student_registration_number() RPC for authenticated students.
--   3. Adds search_students_for_invite() RPC searching all non-suspended students
--      by normalized registration number or full name (non-PII fields only).
--   4. Fixes group_invitations re-invite RLS and adds invite_student_to_group_atomic()
--      and respond_to_group_invitation_atomic() RPCs with notification sync.
-- ============================================================================

-- 1. Idempotent backfill of NULL student_profiles.registration_number from auth.users metadata
DO $$
DECLARE
  rec RECORD;
  v_norm TEXT;
BEGIN
  FOR rec IN
    SELECT
      sp.user_id,
      u.raw_user_meta_data->>'registration_number' AS raw_reg
    FROM public.student_profiles sp
    JOIN auth.users u ON u.id = sp.user_id
    WHERE (sp.registration_number IS NULL OR btrim(sp.registration_number) = '')
      AND COALESCE(u.raw_user_meta_data->>'registration_number', '') <> ''
  LOOP
    v_norm := NULLIF(UPPER(regexp_replace(btrim(rec.raw_reg), '\s+', '', 'g')), '');
    IF v_norm IS NOT NULL
       AND length(v_norm) BETWEEN 4 AND 40
       AND v_norm ~ '^[A-Z0-9][A-Z0-9/.\-_]*[A-Z0-9]$'
       AND v_norm ~ '[A-Z]'
       AND v_norm ~ '[0-9]'
       AND NOT EXISTS (
         SELECT 1
         FROM public.student_profiles other
         WHERE other.user_id <> rec.user_id
           AND other.registration_number IS NOT NULL
           AND UPPER(btrim(other.registration_number)) = v_norm
       )
    THEN
      UPDATE public.student_profiles
      SET
        registration_number = v_norm,
        updated_at = timezone('utc'::text, now())
      WHERE user_id = rec.user_id
        AND (registration_number IS NULL OR btrim(registration_number) = '');
    END IF;
  END LOOP;
END;
$$;

-- 2. Update handle_new_user() so pre-existing NULL-reg student_profiles rows also link registration_number
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
  v_existing_sp_reg TEXT;
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

    SELECT sp.registration_number INTO v_existing_sp_reg
    FROM public.student_profiles sp
    WHERE sp.user_id = NEW.id;

    IF NOT FOUND THEN
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
    ELSIF (v_existing_sp_reg IS NULL OR btrim(v_existing_sp_reg) = '')
      AND v_reg_number IS NOT NULL
      AND length(v_reg_number) BETWEEN 4 AND 40
    THEN
      BEGIN
        UPDATE public.student_profiles
        SET
          registration_number = v_reg_number,
          institution = COALESCE(NULLIF(btrim(institution), ''), v_university),
          campus = COALESCE(NULLIF(btrim(campus), ''), v_campus),
          study_level = COALESCE(NULLIF(btrim(study_level), ''), v_study_level),
          updated_at = timezone('utc'::text, now())
        WHERE user_id = NEW.id
          AND (registration_number IS NULL OR btrim(registration_number) = '');
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

-- 3. Authenticated student RPC to link or update an unverified registration number
CREATE OR REPLACE FUNCTION public.link_student_registration_number(p_reg_number TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_norm TEXT;
  v_role public.user_role;
  v_status public.account_status;
  v_sp RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to update your student registration number.'
      USING ERRCODE = '42501';
  END IF;

  SELECT role, account_status INTO v_role, v_status
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND OR v_role <> 'student' THEN
    RAISE EXCEPTION 'Only student accounts can link a university registration number.'
      USING ERRCODE = '42501';
  END IF;

  IF v_status = 'suspended' THEN
    RAISE EXCEPTION 'Your account is suspended and cannot be updated.'
      USING ERRCODE = '42501';
  END IF;

  v_norm := NULLIF(UPPER(regexp_replace(btrim(COALESCE(p_reg_number, '')), '\s+', '', 'g')), '');
  IF v_norm IS NULL OR length(v_norm) < 4 OR length(v_norm) > 40 THEN
    RAISE EXCEPTION 'Registration number must be between 4 and 40 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_norm !~ '^[A-Z0-9][A-Z0-9/.\-_]*[A-Z0-9]$' OR v_norm !~ '[A-Z]' OR v_norm !~ '[0-9]' THEN
    RAISE EXCEPTION 'Enter a valid registration number containing letters and numbers (e.g. CST/20/SWE/000011).'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sp
  FROM public.student_profiles
  WHERE user_id = v_uid;

  IF FOUND AND COALESCE(v_sp.is_profile_verified, false) = true AND v_sp.registration_number IS DISTINCT FROM v_norm THEN
    RAISE EXCEPTION 'Verified student registration numbers cannot be modified directly.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.student_profiles other
    WHERE other.user_id <> v_uid
      AND other.registration_number IS NOT NULL
      AND UPPER(regexp_replace(btrim(other.registration_number), '\s+', '', 'g')) = v_norm
  ) THEN
    RAISE EXCEPTION 'This student registration number is already registered on OUTPOST.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.student_profiles (
    user_id,
    registration_number,
    institution,
    campus,
    updated_at
  )
  VALUES (
    v_uid,
    v_norm,
    'Bayero University Kano',
    'New Campus',
    timezone('utc'::text, now())
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    registration_number = EXCLUDED.registration_number,
    updated_at = timezone('utc'::text, now());

  RETURN jsonb_build_object(
    'success', true,
    'userId', v_uid,
    'registrationNumber', v_norm
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_student_registration_number(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_student_registration_number(TEXT) TO authenticated, service_role;

-- 4. Authenticated student invite search across ALL students by reg number or name (zero PII)
CREATE OR REPLACE FUNCTION public.search_students_for_invite(
  p_query TEXT,
  p_group_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_raw TEXT;
  v_compact TEXT;
  v_limit INTEGER;
  v_results JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to search students.'
      USING ERRCODE = '42501';
  END IF;

  v_raw := btrim(COALESCE(p_query, ''));
  v_compact := UPPER(regexp_replace(v_raw, '\s+', '', 'g'));
  IF length(v_raw) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));

  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'_rank', item->>'fullName'), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT jsonb_build_object(
      'userId', p.id,
      'fullName', COALESCE(NULLIF(btrim(p.full_name), ''), 'OUTPOST Student'),
      'avatarUrl', p.avatar_url,
      'university', COALESCE(NULLIF(btrim(sp.institution), ''), 'Bayero University Kano'),
      'campus', COALESCE(NULLIF(btrim(sp.campus), ''), 'New Campus'),
      'studyLevel', COALESCE(NULLIF(btrim(sp.study_level), ''), 'Undergraduate'),
      'registrationNumber', NULLIF(btrim(sp.registration_number), ''),
      'isProfileVerified', (
        COALESCE(sp.is_profile_verified, false) = true
        AND COALESCE(p.is_verified, false) = true
      ),
      'isAlreadyMember', (
        p_group_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = p_group_id AND gm.user_id = p.id
        )
      ),
      'hasPendingInvite', (
        p_group_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.group_invitations gi
          WHERE gi.group_id = p_group_id AND gi.student_id = p.id AND gi.status = 'pending'
        )
      ),
      '_rank', CASE
        WHEN UPPER(regexp_replace(btrim(COALESCE(sp.registration_number, '')), '\s+', '', 'g')) = v_compact THEN '0'
        WHEN UPPER(regexp_replace(btrim(COALESCE(sp.registration_number, '')), '\s+', '', 'g')) LIKE v_compact || '%' THEN '1'
        WHEN UPPER(regexp_replace(btrim(COALESCE(sp.registration_number, '')), '\s+', '', 'g')) LIKE '%' || v_compact || '%' THEN '2'
        ELSE '3'
      END
    ) AS item
    FROM public.profiles p
    LEFT JOIN public.student_profiles sp ON sp.user_id = p.id
    WHERE p.role = 'student'
      AND p.account_status <> 'suspended'
      AND (
        UPPER(regexp_replace(btrim(COALESCE(sp.registration_number, '')), '\s+', '', 'g')) LIKE '%' || v_compact || '%'
        OR LOWER(COALESCE(p.full_name, '')) LIKE '%' || LOWER(v_raw) || '%'
      )
    ORDER BY
      CASE
        WHEN UPPER(regexp_replace(btrim(COALESCE(sp.registration_number, '')), '\s+', '', 'g')) = v_compact THEN 0
        WHEN UPPER(regexp_replace(btrim(COALESCE(sp.registration_number, '')), '\s+', '', 'g')) LIKE v_compact || '%' THEN 1
        WHEN UPPER(regexp_replace(btrim(COALESCE(sp.registration_number, '')), '\s+', '', 'g')) LIKE '%' || v_compact || '%' THEN 2
        ELSE 3
      END,
      p.full_name ASC
    LIMIT v_limit
  ) ranked;

  RETURN COALESCE(v_results, '[]'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_students_for_invite(TEXT, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_students_for_invite(TEXT, UUID, INTEGER) TO authenticated, service_role;

-- 5. Allow group admins to reset rejected/cancelled invitations back to pending on re-invite
DROP POLICY IF EXISTS "Recipient responds to invitation" ON public.group_invitations;
CREATE POLICY "Recipient responds to invitation"
  ON public.group_invitations FOR UPDATE
  TO authenticated
  USING (student_id = auth.uid() OR public.is_group_admin(group_id))
  WITH CHECK (
    (student_id = auth.uid() AND status IN ('accepted', 'rejected'))
    OR (public.is_group_admin(group_id) AND status IN ('cancelled', 'pending'))
  );

-- 6. Atomic group invitation creation (by user ID or registration number) + notification
CREATE OR REPLACE FUNCTION public.invite_student_to_group_atomic(
  p_group_id UUID,
  p_target_user_id UUID DEFAULT NULL,
  p_reg_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_group RECORD;
  v_target_id UUID;
  v_target_profile RECORD;
  v_sender_name TEXT;
  v_norm_reg TEXT;
  v_member_count INTEGER;
  v_existing_inv RECORD;
  v_inv_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to invite peers.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_group
  FROM public.accommodation_groups
  WHERE id = p_group_id;

  IF NOT FOUND OR v_group.is_active = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'Accommodation cohort not found or no longer active.');
  END IF;

  IF v_group.leader_id <> v_uid AND NOT public.is_group_admin(p_group_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only cohort administrators can send invitations.');
  END IF;

  IF p_target_user_id IS NOT NULL THEN
    v_target_id := p_target_user_id;
  ELSE
    v_norm_reg := NULLIF(UPPER(regexp_replace(btrim(COALESCE(p_reg_number, '')), '\s+', '', 'g')), '');
    IF v_norm_reg IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Select a student or enter their registration number.');
    END IF;

    SELECT sp.user_id INTO v_target_id
    FROM public.student_profiles sp
    JOIN public.profiles p ON p.id = sp.user_id
    WHERE sp.registration_number IS NOT NULL
      AND UPPER(regexp_replace(btrim(sp.registration_number), '\s+', '', 'g')) = v_norm_reg
      AND p.role = 'student'
      AND p.account_status <> 'suspended'
    LIMIT 1;
  END IF;

  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No student found with that registration number.');
  END IF;

  SELECT p.id, p.full_name, p.role, p.account_status, sp.registration_number
  INTO v_target_profile
  FROM public.profiles p
  LEFT JOIN public.student_profiles sp ON sp.user_id = p.id
  WHERE p.id = v_target_id;

  IF NOT FOUND OR v_target_profile.role <> 'student' OR v_target_profile.account_status = 'suspended' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This student account is unavailable for cohort invitations.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = v_target_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student is already a member of this cohort.');
  END IF;

  SELECT COUNT(*) INTO v_member_count
  FROM public.group_members
  WHERE group_id = p_group_id;

  IF v_member_count >= COALESCE(v_group.max_members, 4) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cohort has already reached its maximum member capacity.');
  END IF;

  SELECT * INTO v_existing_inv
  FROM public.group_invitations
  WHERE group_id = p_group_id AND student_id = v_target_id;

  IF FOUND AND v_existing_inv.status = 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'An invitation is already pending for this student.');
  END IF;

  INSERT INTO public.group_invitations (
    group_id,
    invited_by,
    student_id,
    status,
    created_at,
    updated_at
  )
  VALUES (
    p_group_id,
    v_uid,
    v_target_id,
    'pending',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
  )
  ON CONFLICT (group_id, student_id) DO UPDATE
  SET
    invited_by = EXCLUDED.invited_by,
    status = 'pending',
    updated_at = timezone('utc'::text, now())
  RETURNING id INTO v_inv_id;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'A cohort administrator')
  INTO v_sender_name
  FROM public.profiles
  WHERE id = v_uid;

  INSERT INTO public.notifications (user_id, title, message, type, link, metadata)
  VALUES (
    v_target_id,
    'Cohort Invitation Received',
    format('%s invited you to join the accommodation cohort "%s".', COALESCE(v_sender_name, 'Cohort Admin'), v_group.name),
    'group_invitation',
    '/student/groups',
    jsonb_build_object('groupId', p_group_id, 'invitationId', v_inv_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'invitation', jsonb_build_object(
      'id', v_inv_id,
      'groupId', p_group_id,
      'groupName', v_group.name,
      'senderId', v_uid,
      'senderName', COALESCE(v_sender_name, 'Cohort Admin'),
      'receiverId', v_target_id,
      'receiverName', v_target_profile.full_name,
      'receiverRegNumber', v_target_profile.registration_number,
      'status', 'pending'
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invite_student_to_group_atomic(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_student_to_group_atomic(UUID, UUID, TEXT) TO authenticated, service_role;

-- 7. Atomic group invitation acceptance / rejection (with cohort chat participant sync)
CREATE OR REPLACE FUNCTION public.respond_to_group_invitation_atomic(
  p_invite_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_inv RECORD;
  v_group RECORD;
  v_member_count INTEGER;
  v_conv_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to respond to invitations.'
      USING ERRCODE = '42501';
  END IF;

  IF p_action NOT IN ('accept', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invitation action.');
  END IF;

  SELECT * INTO v_inv
  FROM public.group_invitations
  WHERE id = p_invite_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invitation not found.');
  END IF;

  IF v_inv.student_id <> v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the invited student can respond to this invitation.');
  END IF;

  IF v_inv.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invitation has already been processed.');
  END IF;

  IF p_action = 'reject' THEN
    UPDATE public.group_invitations
    SET status = 'rejected', updated_at = timezone('utc'::text, now())
    WHERE id = p_invite_id;

    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  SELECT * INTO v_group
  FROM public.accommodation_groups
  WHERE id = v_inv.group_id;

  IF NOT FOUND OR v_group.is_active = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'This accommodation cohort is no longer active.');
  END IF;

  SELECT COUNT(*) INTO v_member_count
  FROM public.group_members
  WHERE group_id = v_inv.group_id;

  IF v_member_count >= COALESCE(v_group.max_members, 4)
     AND NOT EXISTS (
       SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = v_inv.group_id AND gm.user_id = v_uid
     )
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'This cohort has already reached its maximum capacity.');
  END IF;

  UPDATE public.group_invitations
  SET status = 'accepted', updated_at = timezone('utc'::text, now())
  WHERE id = p_invite_id;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_inv.group_id, v_uid, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE group_id = v_inv.group_id
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, v_uid)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'accepted', 'groupId', v_inv.group_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.respond_to_group_invitation_atomic(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_group_invitation_atomic(UUID, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
