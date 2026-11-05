-- ============================================================================
-- OUTPOST Database Migration: 20261020000006_fix_landlord_registration_profile_initialization.sql
-- Purpose: Authoritative role assignment for student and landlord registration,
--          strict prevention of administrator self-assignment, contradictory
--          companion record prevention, and correction of profile RLS policies.
-- ============================================================================

-- 1. Correct handle_new_user trigger function
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
  -- Check if profile already exists for this user ID (e.g. pre-provisioned account or re-signup)
  SELECT role INTO v_existing_role
  FROM public.profiles
  WHERE id = NEW.id;

  IF v_existing_role IS NOT NULL THEN
    -- Authoritative existing role takes precedence.
    -- DO NOT alter existing role, verification status, or account status.
    UPDATE public.profiles
    SET 
      email = NEW.email,
      updated_at = timezone('utc'::text, now())
    WHERE id = NEW.id;

    v_effective_role := v_existing_role;
  ELSE
    -- New profile: extract and validate raw role from user_metadata
    v_raw_role := NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), '');

    IF v_raw_role IS NULL THEN
      -- Missing role: default to 'student'
      v_role := 'student'::public.user_role;
      IF NEW.email_confirmed_at IS NOT NULL THEN
        v_account_status := 'active'::public.account_status;
      ELSE
        v_account_status := 'email_unverified'::public.account_status;
      END IF;
    ELSIF LOWER(v_raw_role) = 'student' THEN
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

    -- Extract full name from user_metadata or fallback to email prefix
    v_full_name := COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1),
      'OUTPOST User'
    );

    -- Insert new authoritative profile record
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

  -- Provision companion profile strictly matching the authoritative effective role
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
  -- If v_effective_role = 'admin', do not create student or landlord companion records.

  RETURN NEW;
END;
$$;

-- 2. Re-assert trigger on auth.users safely
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 3. Configure execution privileges
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, service_role;

-- 4. Correct profiles INSERT RLS policy to permit landlord self-registration and reject admin
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
