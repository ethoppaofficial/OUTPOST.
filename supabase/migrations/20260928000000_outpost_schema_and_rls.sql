-- ============================================================================
-- OUTPOST — Off-Campus Student Housing & Roommate Platform (BUK Case Study)
-- Complete Supabase PostgreSQL Schema, Triggers, Transactional RPCs,
-- Storage Buckets, and Row Level Security (RLS) Policies
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. CORE TABLES
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  legacy_firebase_uid text UNIQUE,
  email text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'landlord', 'admin')),
  display_name text,
  phone text,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  email_verified boolean NOT NULL DEFAULT false,
  account_status text NOT NULL DEFAULT 'email_unverified'
    CHECK (account_status IN ('email_unverified', 'profile_pending', 'profile_verified', 'active', 'suspended', 'rejected')),
  suspension_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.public_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  avatar_url text,
  role text NOT NULL CHECK (role IN ('student', 'landlord', 'admin')),
  university text DEFAULT 'Bayero University Kano (BUK)',
  campus text,
  programme text,
  study_level text,
  gender text CHECK (gender IN ('Male', 'Female', 'Other')),
  preferred_location text CHECK (preferred_location IN ('Dambare', 'Rimin Gata')),
  bio text,
  is_profile_verified boolean NOT NULL DEFAULT false,
  is_discoverable boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text NOT NULL,
  registration_number text UNIQUE NOT NULL,
  institution_name text NOT NULL DEFAULT 'Bayero University Kano (BUK)',
  university text NOT NULL DEFAULT 'Bayero University Kano (BUK)',
  campus text NOT NULL DEFAULT 'New Campus (Gwarzo Road)',
  study_level text NOT NULL,
  programme text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('Male', 'Female', 'Other')),
  preferred_location text CHECK (preferred_location IN ('Dambare', 'Rimin Gata')),
  bio text,
  is_profile_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.landlord_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  business_name text,
  phone text NOT NULL,
  contact_address text NOT NULL,
  id_type text NOT NULL,
  id_reference text NOT NULL,
  document_storage_path text,
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('not_started', 'pending', 'approved', 'rejected')),
  rejection_reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_verification_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('student_id', 'admission_letter', 'school_fees_receipt')),
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewer_id uuid REFERENCES public.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.landlord_verification_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewer_id uuid REFERENCES public.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.locations (
  id text PRIMARY KEY,
  name text UNIQUE NOT NULL CHECK (name IN ('Dambare', 'Rimin Gata')),
  city text NOT NULL DEFAULT 'Kano' CHECK (city = 'Kano'),
  state text NOT NULL DEFAULT 'Kano State' CHECK (state = 'Kano State'),
  country text NOT NULL DEFAULT 'Nigeria' CHECK (country = 'Nigeria'),
  is_off_campus boolean NOT NULL DEFAULT true CHECK (is_off_campus = true),
  institution_context text NOT NULL DEFAULT 'Bayero University Kano',
  description text,
  aliases text[] DEFAULT '{}',
  distance_estimate text,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  is_active boolean NOT NULL DEFAULT true
);

INSERT INTO public.locations (id, name, city, state, country, is_off_campus, institution_context, description, aliases, distance_estimate, latitude, longitude, is_active)
VALUES
  ('loc-dambare', 'Dambare', 'Kano', 'Kano State', 'Nigeria', true, 'Bayero University Kano', 'Settlement directly opposite BUK New Campus along Gwarzo Road.', ARRAY['Dambare', 'Opposite BUK New Campus', 'Gwarzo Road Dambare'], '~0.4 - 0.6 km', 11.9842, 8.4187, true),
  ('loc-rimin-gata', 'Rimin Gata', 'Kano', 'Kano State', 'Nigeria', true, 'Bayero University Kano', 'Quiet residential community located just west of BUK New Campus off Gwarzo Road.', ARRAY['Rimin Gata', 'Rimingata', 'Off Gwarzo Road'], '~0.8 - 1.2 km', 11.9785, 8.4093, true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  landlord_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  landlord_name text NOT NULL,
  landlord_verified boolean NOT NULL DEFAULT false,
  location_id text NOT NULL REFERENCES public.locations(id),
  title text NOT NULL,
  description text NOT NULL,
  property_type text NOT NULL,
  accommodation_type text NOT NULL,
  gender_policy text NOT NULL CHECK (gender_policy IN ('Male Only', 'Female Only', 'Mixed (Segregated Blocks)', 'Mixed')),
  university text NOT NULL DEFAULT 'Bayero University Kano (BUK)',
  campus text NOT NULL DEFAULT 'New Campus (Gwarzo Road)',
  city text NOT NULL DEFAULT 'Kano' CHECK (city = 'Kano'),
  state text NOT NULL DEFAULT 'Kano State' CHECK (state = 'Kano State'),
  neighbourhood text NOT NULL CHECK (neighbourhood IN ('Dambare', 'Rimin Gata')),
  address text NOT NULL,
  full_address text,
  street_or_road text,
  nearest_landmark text,
  directions text,
  location_note text,
  distance_km numeric(5,2) NOT NULL DEFAULT 0.5,
  price_per_session integer NOT NULL CHECK (price_per_session > 0),
  currency text NOT NULL DEFAULT 'NGN',
  total_units integer NOT NULL CHECK (total_units >= 0),
  available_units integer NOT NULL CHECK (available_units >= 0),
  amenities text[] NOT NULL DEFAULT '{}',
  house_rules text[] NOT NULL DEFAULT '{}',
  images text[] NOT NULL DEFAULT '{}',
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('draft', 'pending', 'approved', 'rejected', 'archived')),
  location_verification_status text NOT NULL DEFAULT 'pending'
    CHECK (location_verification_status IN ('pending', 'verified', 'rejected')),
  rejection_reason text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.property_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  price_per_session integer NOT NULL CHECK (price_per_session > 0),
  total_capacity integer NOT NULL CHECK (total_capacity > 0),
  available_spaces integer NOT NULL CHECK (available_spaces >= 0 AND available_spaces <= total_capacity),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.property_locations (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  location_id text NOT NULL REFERENCES public.locations(id),
  area text NOT NULL CHECK (area IN ('Dambare', 'Rimin Gata')),
  city text NOT NULL DEFAULT 'Kano',
  state text NOT NULL DEFAULT 'Kano State',
  country text NOT NULL DEFAULT 'Nigeria',
  latitude double precision NOT NULL CHECK (latitude BETWEEN 11.80 AND 12.20),
  longitude double precision NOT NULL CHECK (longitude BETWEEN 8.25 AND 8.65),
  geohash text NOT NULL,
  public_latitude double precision CHECK (public_latitude BETWEEN 11.80 AND 12.20),
  public_longitude double precision CHECK (public_longitude BETWEEN 8.25 AND 8.65),
  public_geohash text,
  public_location_label text,
  formatted_address text,
  precision text NOT NULL CHECK (precision IN ('exact_building', 'nearby_building', 'street', 'neighbourhood')),
  source text NOT NULL CHECK (source IN ('geocoded_address', 'landlord_pin', 'admin_verified', 'seed_demo')),
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  submitted_by uuid NOT NULL REFERENCES public.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  review_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roommate_preferences (
  student_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  min_budget integer NOT NULL CHECK (min_budget >= 0),
  max_budget integer NOT NULL CHECK (max_budget >= min_budget),
  preferred_neighbourhoods text[] NOT NULL DEFAULT '{Dambare,Rimin Gata}',
  move_in_period text NOT NULL,
  study_habits text NOT NULL,
  sleep_schedule text NOT NULL,
  cleanliness text NOT NULL,
  smoking text NOT NULL,
  guest_preference text NOT NULL,
  noise_tolerance text NOT NULL,
  room_sharing text NOT NULL,
  gender_preference text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roommate_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  compatibility_score integer,
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> receiver_id)
);

CREATE TABLE IF NOT EXISTS public.accommodation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  description text,
  owner_id uuid NOT NULL REFERENCES public.users(id),
  leader_id uuid NOT NULL REFERENCES public.users(id),
  target_property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  university text NOT NULL DEFAULT 'Bayero University Kano (BUK)',
  max_capacity integer NOT NULL DEFAULT 4 CHECK (max_capacity BETWEEN 2 AND 12),
  visibility text NOT NULL DEFAULT 'discoverable' CHECK (visibility IN ('discoverable', 'invite_only', 'request_required')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accommodation_group_members (
  group_id uuid NOT NULL REFERENCES public.accommodation_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed', 'left')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.group_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.accommodation_groups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.accommodation_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number text UNIQUE NOT NULL,
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  landlord_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.property_rooms(id) ON DELETE RESTRICT,
  group_id uuid REFERENCES public.accommodation_groups(id) ON DELETE SET NULL,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'receipt_submitted', 'confirmed', 'rejected', 'expired', 'cancelled')),
  hold_expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL,
  reservation_id uuid UNIQUE NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  landlord_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'NGN',
  due_date timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid', 'payment_submitted', 'paid', 'expired', 'cancelled')),
  bank_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  landlord_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  payment_reference text NOT NULL,
  payer_bank_name text NOT NULL,
  payment_date text,
  amount_paid integer NOT NULL CHECK (amount_paid > 0),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid REFERENCES public.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('direct', 'group')),
  title text,
  group_id uuid REFERENCES public.accommodation_groups(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  last_message_id uuid,
  last_message_text text,
  last_message_timestamp timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'student',
  unread_count integer NOT NULL DEFAULT 0,
  is_muted boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  text text NOT NULL CHECK (char_length(btrim(text)) > 0),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  reply_to jsonb,
  mentions jsonb,
  is_edited boolean NOT NULL DEFAULT false,
  edited_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
  is_read boolean NOT NULL DEFAULT false,
  link text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.users(id),
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  reason text NOT NULL,
  details text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed')),
  resolution_note text,
  resolved_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  actor_id uuid REFERENCES public.users(id),
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  target_entity text NOT NULL,
  target_id text NOT NULL,
  details text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. INDEXES & PUBLIC SAFE VIEW
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_properties_public_discovery
  ON public.properties (verification_status, location_verification_status, is_active, neighbourhood, price_per_session);
CREATE INDEX IF NOT EXISTS idx_properties_landlord
  ON public.properties (landlord_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_locations_status_area
  ON public.property_locations (verification_status, area, geohash);
CREATE INDEX IF NOT EXISTS idx_reservations_expiry
  ON public.reservations (status, hold_expires_at) WHERE status = 'pending_payment';
CREATE INDEX IF NOT EXISTS idx_reservations_student
  ON public.reservations (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_landlord
  ON public.reservations (landlord_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
  ON public.messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp
  ON public.audit_logs (timestamp DESC);

-- Public-safe view exposing only approved listings and public perimeter coordinates
CREATE OR REPLACE VIEW public.v_public_properties AS
SELECT
  p.id,
  p.slug,
  p.landlord_id,
  p.landlord_name,
  p.landlord_verified,
  p.location_id,
  p.title,
  p.description,
  p.property_type,
  p.accommodation_type,
  p.gender_policy,
  p.university,
  p.campus,
  p.city,
  p.state,
  p.neighbourhood,
  p.address,
  p.street_or_road,
  p.nearest_landmark,
  p.directions,
  p.distance_km,
  p.price_per_session,
  p.currency,
  p.total_units,
  p.available_units,
  p.amenities,
  p.house_rules,
  p.images,
  p.verification_status,
  p.location_verification_status,
  p.is_active,
  p.created_at,
  p.updated_at,
  pl.public_latitude,
  pl.public_longitude,
  pl.public_geohash,
  pl.public_location_label,
  pl.precision AS location_precision
FROM public.properties p
JOIN public.property_locations pl ON pl.property_id = p.id
WHERE p.verification_status = 'approved'
  AND p.location_verification_status = 'verified'
  AND p.is_active = true
  AND pl.verification_status = 'verified';

-- ----------------------------------------------------------------------------
-- 3. SECURITY HELPER FUNCTIONS & AUTH SIGN-UP TRIGGER
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
      AND account_status <> 'suspended'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_active_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = p_role
      AND is_active = true
      AND account_status <> 'suspended'
  );
$$;

-- Never allow public registration to self-assign 'admin' role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested_role text;
  v_safe_role text;
  v_full_name text;
BEGIN
  v_requested_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
  IF v_requested_role = 'landlord' THEN
    v_safe_role := 'landlord';
  ELSE
    v_safe_role := 'student';
  END IF;

  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'legal_name',
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.users (id, email, role, display_name, phone, email_verified, account_status)
  VALUES (
    NEW.id,
    NEW.email,
    v_safe_role,
    v_full_name,
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    NEW.email_confirmed_at IS NOT NULL,
    CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN 'profile_pending' ELSE 'email_unverified' END
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.public_profiles (user_id, display_name, role, is_discoverable)
  VALUES (NEW.id, v_full_name, v_safe_role, v_safe_role = 'student')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) POLICIES (DENY BY DEFAULT)
-- ----------------------------------------------------------------------------

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roommate_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roommate_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accommodation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accommodation_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Users
CREATE POLICY "users_select_self_or_admin" ON public.users
  FOR SELECT USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "users_update_self_non_privileged" ON public.users
  FOR UPDATE USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (
    public.is_admin() OR (
      auth.uid() = id
      AND role = (SELECT u.role FROM public.users u WHERE u.id = auth.uid())
      AND account_status = (SELECT u.account_status FROM public.users u WHERE u.id = auth.uid())
    )
  );

-- Public Profiles
CREATE POLICY "public_profiles_select_authenticated" ON public.public_profiles
  FOR SELECT USING (auth.role() = 'authenticated' OR public.is_admin());

CREATE POLICY "public_profiles_update_self" ON public.public_profiles
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin());

-- Student Profiles
CREATE POLICY "student_profiles_select_self_or_admin" ON public.student_profiles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "student_profiles_insert_self" ON public.student_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_profile_verified = false);

CREATE POLICY "student_profiles_update_self" ON public.student_profiles
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (
    public.is_admin() OR (
      auth.uid() = user_id
      AND is_profile_verified = (SELECT sp.is_profile_verified FROM public.student_profiles sp WHERE sp.user_id = auth.uid())
    )
  );

-- Landlord Profiles
CREATE POLICY "landlord_profiles_select_self_or_admin" ON public.landlord_profiles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "landlord_profiles_insert_self" ON public.landlord_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id AND verification_status = 'pending');

CREATE POLICY "landlord_profiles_update_self" ON public.landlord_profiles
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (
    public.is_admin() OR (
      auth.uid() = user_id
      AND verification_status = (SELECT lp.verification_status FROM public.landlord_profiles lp WHERE lp.user_id = auth.uid())
    )
  );

-- Verification Documents
CREATE POLICY "student_docs_select_self_or_admin" ON public.student_verification_documents
  FOR SELECT USING (auth.uid() = student_id OR public.is_admin());

CREATE POLICY "student_docs_insert_self" ON public.student_verification_documents
  FOR INSERT WITH CHECK (public.has_active_role('student') AND auth.uid() = student_id AND status = 'pending');

CREATE POLICY "student_docs_update_admin" ON public.student_verification_documents
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "landlord_docs_select_self_or_admin" ON public.landlord_verification_documents
  FOR SELECT USING (auth.uid() = landlord_id OR public.is_admin());

CREATE POLICY "landlord_docs_insert_self" ON public.landlord_verification_documents
  FOR INSERT WITH CHECK (public.has_active_role('landlord') AND auth.uid() = landlord_id AND status = 'pending');

CREATE POLICY "landlord_docs_update_admin" ON public.landlord_verification_documents
  FOR UPDATE USING (public.is_admin());

-- Reference Locations
CREATE POLICY "locations_select_all" ON public.locations
  FOR SELECT USING (is_active = true OR public.is_admin());

-- Properties & Rooms
CREATE POLICY "properties_select_public_or_owner_or_admin" ON public.properties
  FOR SELECT USING (
    (verification_status = 'approved' AND location_verification_status = 'verified' AND is_active = true)
    OR landlord_id = auth.uid()
    OR public.is_admin()
  );

CREATE POLICY "properties_insert_landlord" ON public.properties
  FOR INSERT WITH CHECK (
    public.has_active_role('landlord')
    AND landlord_id = auth.uid()
    AND verification_status IN ('draft', 'pending')
    AND location_verification_status = 'pending'
  );

CREATE POLICY "properties_update_landlord_or_admin" ON public.properties
  FOR UPDATE USING (landlord_id = auth.uid() OR public.is_admin())
  WITH CHECK (
    public.is_admin() OR (
      landlord_id = auth.uid()
      AND verification_status IN ('draft', 'pending', 'rejected')
    )
  );

CREATE POLICY "property_rooms_select" ON public.property_rooms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_id
        AND (
          (p.verification_status = 'approved' AND p.location_verification_status = 'verified' AND p.is_active = true)
          OR p.landlord_id = auth.uid()
          OR public.is_admin()
        )
    )
  );

-- Property Locations (Raw row containing exact lat/lng restricted to owner landlord & admin)
CREATE POLICY "property_locations_select_owner_or_admin" ON public.property_locations
  FOR SELECT USING (submitted_by = auth.uid() OR public.is_admin());

CREATE POLICY "property_locations_insert_landlord" ON public.property_locations
  FOR INSERT WITH CHECK (
    public.has_active_role('landlord')
    AND submitted_by = auth.uid()
    AND verification_status = 'pending'
  );

-- Reservations, Invoices & Receipts
CREATE POLICY "reservations_select_participant_or_admin" ON public.reservations
  FOR SELECT USING (student_id = auth.uid() OR landlord_id = auth.uid() OR public.is_admin());

CREATE POLICY "invoices_select_participant_or_admin" ON public.invoices
  FOR SELECT USING (student_id = auth.uid() OR landlord_id = auth.uid() OR public.is_admin());

CREATE POLICY "receipts_select_participant_or_admin" ON public.payment_receipts
  FOR SELECT USING (student_id = auth.uid() OR landlord_id = auth.uid() OR public.is_admin());

-- Roommate Preferences & Requests
CREATE POLICY "roommate_prefs_select_authenticated" ON public.roommate_preferences
  FOR SELECT USING (auth.role() = 'authenticated' OR public.is_admin());

CREATE POLICY "roommate_prefs_write_self" ON public.roommate_preferences
  FOR ALL USING (student_id = auth.uid() OR public.is_admin())
  WITH CHECK (student_id = auth.uid() OR public.is_admin());

CREATE POLICY "roommate_requests_select_participant" ON public.roommate_requests
  FOR SELECT USING (sender_id = auth.uid() OR receiver_id = auth.uid() OR public.is_admin());

-- Chat Conversations & Messages (with 15-minute edit window)
CREATE POLICY "conversations_select_participant" ON public.conversations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = id AND cp.user_id = auth.uid()
    ) OR public.is_admin()
  );

CREATE POLICY "messages_select_participant" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()
    ) OR public.is_admin()
  );

CREATE POLICY "messages_insert_participant" ON public.messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "messages_update_15_minute_window" ON public.messages
  FOR UPDATE USING (
    sender_id = auth.uid()
    AND now() <= created_at + interval '15 minutes'
  )
  WITH CHECK (
    sender_id = auth.uid()
    AND now() <= created_at + interval '15 minutes'
  );

-- Notifications & Audit Logs
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "audit_logs_select_admin_only" ON public.audit_logs
  FOR SELECT USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. TRANSACTIONAL POSTGRESQL RPCs
-- ----------------------------------------------------------------------------

-- 5.1 Atomic Reservation + Room Hold Decrement + Invoice Generation
CREATE OR REPLACE FUNCTION public.create_reservation_atomic(
  p_property_id uuid,
  p_unit_id uuid,
  p_group_id uuid DEFAULT NULL
)
RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.property_rooms;
  v_prop public.properties;
  v_res public.reservations;
  v_res_number text;
  v_inv_number text;
  v_expires_at timestamptz := now() + interval '7 days';
BEGIN
  IF NOT public.has_active_role('student') THEN
    RAISE EXCEPTION 'Only active student accounts may request a reservation hold.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservations
    WHERE student_id = auth.uid()
      AND property_id = p_property_id
      AND status IN ('pending_payment', 'receipt_submitted', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'You already have an active reservation hold or confirmed booking for this property.';
  END IF;

  SELECT * INTO v_prop
  FROM public.properties
  WHERE id = p_property_id
    AND verification_status = 'approved'
    AND location_verification_status = 'verified'
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property is not approved or active for reservation.';
  END IF;

  SELECT * INTO v_room
  FROM public.property_rooms
  WHERE id = p_unit_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND OR v_room.available_spaces <= 0 THEN
    RAISE EXCEPTION 'Selected room unit currently has no available spaces.';
  END IF;

  UPDATE public.property_rooms
  SET available_spaces = available_spaces - 1, updated_at = now()
  WHERE id = p_unit_id;

  UPDATE public.properties
  SET available_units = GREATEST(0, available_units - 1), updated_at = now()
  WHERE id = p_property_id;

  v_res_number := 'RES-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_inv_number := 'INV-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.reservations (
    reservation_number, student_id, landlord_id, property_id, unit_id, group_id,
    amount, currency, status, hold_expires_at
  ) VALUES (
    v_res_number, auth.uid(), v_prop.landlord_id, p_property_id, p_unit_id, p_group_id,
    v_room.price_per_session, 'NGN', 'pending_payment', v_expires_at
  ) RETURNING * INTO v_res;

  INSERT INTO public.invoices (
    invoice_number, reservation_id, student_id, landlord_id, property_id,
    amount, currency, due_date, status
  ) VALUES (
    v_inv_number, v_res.id, auth.uid(), v_prop.landlord_id, p_property_id,
    v_room.price_per_session, 'NGN', v_expires_at, 'unpaid'
  );

  RETURN v_res;
END;
$$;

-- 5.2 Atomic Landlord/Admin Payment Evidence Review
CREATE OR REPLACE FUNCTION public.review_payment_receipt_atomic(
  p_receipt_id uuid,
  p_decision text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS public.payment_receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec public.payment_receipts;
BEGIN
  SELECT * INTO v_rec FROM public.payment_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment receipt not found.';
  END IF;

  IF v_rec.landlord_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to review this payment receipt.';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.';
  END IF;

  IF p_decision = 'rejected' AND (p_rejection_reason IS NULL OR char_length(btrim(p_rejection_reason)) < 3) THEN
    RAISE EXCEPTION 'A rejection reason is required when rejecting payment evidence.';
  END IF;

  UPDATE public.payment_receipts
  SET status = p_decision,
      rejection_reason = CASE WHEN p_decision = 'rejected' THEN btrim(p_rejection_reason) ELSE NULL END,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_receipt_id
  RETURNING * INTO v_rec;

  IF p_decision = 'approved' THEN
    UPDATE public.reservations
    SET status = 'confirmed', confirmed_at = now(), updated_at = now()
    WHERE id = v_rec.reservation_id;

    UPDATE public.invoices
    SET status = 'paid', updated_at = now()
    WHERE id = v_rec.invoice_id;
  ELSE
    UPDATE public.reservations
    SET status = 'pending_payment', updated_at = now()
    WHERE id = v_rec.reservation_id;

    UPDATE public.invoices
    SET status = 'unpaid', updated_at = now()
    WHERE id = v_rec.invoice_id;
  END IF;

  RETURN v_rec;
END;
$$;

-- 5.3 Idempotent 7-Day Hold Expiry RPC
CREATE OR REPLACE FUNCTION public.expire_stale_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.reservations
    WHERE status = 'pending_payment'
      AND hold_expires_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.reservations
    SET status = 'expired',
        cancellation_reason = '7-day reservation hold expired without verified payment evidence.',
        updated_at = now()
    WHERE id = r.id;

    UPDATE public.invoices
    SET status = 'expired', updated_at = now()
    WHERE reservation_id = r.id AND status = 'unpaid';

    UPDATE public.property_rooms
    SET available_spaces = LEAST(total_capacity, available_spaces + 1), updated_at = now()
    WHERE id = r.unit_id;

    UPDATE public.properties
    SET available_units = LEAST(total_units, available_units + 1), updated_at = now()
    WHERE id = r.property_id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      r.student_id,
      'Reservation Hold Expired',
      'Your 7-day reservation hold (' || r.reservation_number || ') expired and the room space has been released.',
      'warning',
      '/student/reservations/' || r.id
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 5.4 Authorized Student Matric Lookup (Anti-Enumeration)
CREATE OR REPLACE FUNCTION public.lookup_student_by_matric(p_matric text)
RETURNS SETOF public.public_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required for student registration lookup.';
  END IF;

  RETURN QUERY
  SELECT pp.*
  FROM public.student_profiles sp
  JOIN public.public_profiles pp ON pp.user_id = sp.user_id
  WHERE upper(btrim(sp.registration_number)) = upper(btrim(p_matric))
    AND pp.is_discoverable = true
  LIMIT 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. STORAGE BUCKETS & PRIVATE OBJECT RLS POLICIES
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('verification-documents', 'verification-documents', false, 5242880, ARRAY['image/jpeg', 'image/png', 'application/pdf']),
  ('payment-receipts', 'payment-receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf']),
  ('property-images', 'property-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "verification_docs_upload_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'verification-documents'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "verification_docs_read_own_or_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'verification-documents'
    AND ((storage.foldername(name))[2] = auth.uid()::text OR public.is_admin())
  );

CREATE POLICY "payment_receipts_upload_student" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.id::text = (storage.foldername(name))[2]
        AND r.student_id = auth.uid()
    )
  );

CREATE POLICY "payment_receipts_read_participant_or_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND (
      public.is_admin() OR EXISTS (
        SELECT 1 FROM public.reservations r
        WHERE r.id::text = (storage.foldername(name))[2]
          AND (r.student_id = auth.uid() OR r.landlord_id = auth.uid())
      )
    )
  );

CREATE POLICY "property_images_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'property-images');

CREATE POLICY "property_images_landlord_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'property-images'
    AND (public.has_active_role('landlord') OR public.is_admin())
  );

