-- ============================================================================
-- Migration: 20261020000005_pre_deployment_hardening.sql
-- Description: Pre-deployment database hardening for OUTPOST BUK Student Accommodation.
-- Remediations:
--   1. Automatic profile provisioning on auth.users signup (handle_new_user trigger).
--   2. Database-level partial unique index preventing concurrent multi-property holds.
--   3. Automated capacity synchronization trigger between units and parent property.
--   4. FORCE Row Level Security on sensitive tenant tables.
--   5. Resilient pg_cron registration function for hourly 7-day reservation expiration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Automatic Profile Provisioning on User Signup
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_role public.user_role;
  v_full_name TEXT;
BEGIN
  -- Extract user role from user_metadata, default to 'student'
  BEGIN
    v_role := COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'student'::public.user_role);
  EXCEPTION WHEN OTHERS THEN
    v_role := 'student'::public.user_role;
  END;

  -- Extract full name from user_metadata or fallback to email prefix
  v_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    split_part(NEW.email, '@', 1)
  );

  -- Insert profile if not exists
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
    CASE 
      WHEN NEW.email_confirmed_at IS NOT NULL THEN 'active'::public.account_status 
      ELSE 'email_unverified'::public.account_status 
    END,
    false,
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
  )
  ON CONFLICT (id) DO UPDATE
  SET 
    email = EXCLUDED.email,
    updated_at = timezone('utc'::text, now());

  -- If role is student, ensure student_profiles row exists
  IF v_role = 'student' THEN
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
  -- If role is landlord, ensure landlord_profiles row exists
  ELSIF v_role = 'landlord' THEN
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

-- Create trigger on auth.users safely
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Revoke execute from PUBLIC and grant only to service_role and postgres
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Partial Unique Index to Prevent Multi-Property Active Reservations Concurrency
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_reservation_per_student
ON public.reservations (student_id)
WHERE status IN ('pending_payment', 'payment_submitted', 'confirmed');

-- ----------------------------------------------------------------------------
-- 3. Automatic Synchronization of Unit Spaces to Parent Property Spaces
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_property_spaces()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_prop_id UUID;
  v_total INTEGER;
  v_avail INTEGER;
BEGIN
  v_prop_id := COALESCE(NEW.property_id, OLD.property_id);
  
  IF v_prop_id IS NOT NULL THEN
    SELECT 
      COALESCE(SUM(capacity), 0),
      COALESCE(SUM(available_spaces), 0)
    INTO v_total, v_avail
    FROM public.units
    WHERE property_id = v_prop_id;

    -- Only synchronize when units exist for this property
    IF v_total > 0 THEN
      UPDATE public.properties
      SET 
        total_spaces = v_total,
        available_spaces = v_avail,
        updated_at = timezone('utc'::text, now())
      WHERE id = v_prop_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_unit_spaces ON public.units;
CREATE TRIGGER trg_sync_unit_spaces
  AFTER INSERT OR UPDATE OF capacity, available_spaces OR DELETE ON public.units
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_property_spaces();

REVOKE EXECUTE ON FUNCTION public.sync_property_spaces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_property_spaces() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. FORCE Row Level Security on Sensitive Tables
-- ----------------------------------------------------------------------------

ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.student_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_verification_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 5. Safe Scheduled Cron Job Configuration Function
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_hourly_expiration_cron()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('expire-pending-reservations-hourly');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'expire-pending-reservations-hourly',
      '0 * * * *',
      'SELECT public.expire_pending_reservations();'
    );
    RETURN true;
  END IF;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_hourly_expiration_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_hourly_expiration_cron() TO service_role;

-- Execute safely
DO $$
BEGIN
  PERFORM public.ensure_hourly_expiration_cron();
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
