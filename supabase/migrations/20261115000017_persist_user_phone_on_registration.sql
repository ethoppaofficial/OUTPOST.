-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261115000017_persist_user_phone_on_registration.sql
-- Description:
--   1. Idempotently backfills missing/blank public.profiles.phone values from
--      auth.users.raw_user_meta_data->>'phone' captured during registration.
--   2. Updates public.handle_new_user() so new student and landlord signups
--      persist their registered phone number directly into public.profiles.phone
--      (preserving all existing role, verification, and registration number logic).
-- ============================================================================

-- 1. Backfill missing/blank profiles.phone from auth.users metadata
UPDATE public.profiles p
SET
  phone = NULLIF(btrim(u.raw_user_meta_data->>'phone'), ''),
  updated_at = timezone('utc'::text, now())
FROM auth.users u
WHERE u.id = p.id
  AND COALESCE(NULLIF(btrim(p.phone), ''), '') = ''
  AND NULLIF(btrim(COALESCE(u.raw_user_meta_data->>'phone', '')), '') IS NOT NULL;

-- 2. Update handle_new_user() to persist registered phone into public.profiles
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
  v_phone TEXT;
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
  v_phone := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'phone', '')), '');

  SELECT role INTO v_existing_role
  FROM public.profiles
  WHERE id = NEW.id;

  IF v_existing_role IS NOT NULL THEN
    UPDATE public.profiles
    SET
      email = NEW.email,
      phone = COALESCE(NULLIF(btrim(phone), ''), v_phone),
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
      phone,
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
      v_phone,
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

NOTIFY pgrst, 'reload schema';
