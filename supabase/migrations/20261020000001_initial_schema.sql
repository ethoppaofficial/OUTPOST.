-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261020000001_initial_schema.sql
-- Description: Complete Relational Schema, Enums, Constraints, and Indexes
-- ============================================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Custom Enumerated Types
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('student', 'landlord', 'admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE account_status AS ENUM (
    'active',
    'email_unverified',
    'profile_pending',
    'profile_verified',
    'rejected',
    'suspended'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM ('not_started', 'pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE property_approval_status AS ENUM ('draft', 'pending', 'approved', 'rejected', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM (
    'pending_payment',
    'payment_submitted',
    'confirmed',
    'rejected',
    'cancelled',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('unpaid', 'processing', 'paid', 'cancelled', 'expired');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE receipt_status AS ENUM ('pending_review', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE roommate_request_status AS ENUM ('pending', 'accepted', 'rejected', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE group_request_status AS ENUM ('pending', 'accepted', 'rejected', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE group_member_role AS ENUM ('admin', 'member');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE conversation_type AS ENUM ('direct', 'group');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 3. Base Tables
-- ============================================================================

-- 3.1 Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  role user_role NOT NULL DEFAULT 'student',
  account_status account_status NOT NULL DEFAULT 'email_unverified',
  avatar_url TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.2 Student Profiles
CREATE TABLE IF NOT EXISTS public.student_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution TEXT NOT NULL DEFAULT 'Bayero University Kano',
  campus TEXT NOT NULL DEFAULT 'New Campus',
  faculty TEXT,
  department TEXT,
  study_level TEXT,
  registration_number TEXT,
  gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
  bio TEXT,
  is_profile_verified BOOLEAN NOT NULL DEFAULT false,
  verification_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.3 Landlord Profiles
CREATE TABLE IF NOT EXISTS public.landlord_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_name TEXT,
  business_address TEXT,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  verification_status verification_status NOT NULL DEFAULT 'not_started',
  rejection_reason TEXT,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.4 Student Verification Documents
CREATE TABLE IF NOT EXISTS public.student_verification_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('student_id_card', 'admission_letter', 'nin_slip', 'course_registration')),
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760), -- max 10MB
  content_type TEXT NOT NULL,
  status verification_status NOT NULL DEFAULT 'pending',
  reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.5 Landlord Verification Submissions
CREATE TABLE IF NOT EXISTS public.landlord_verification_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('national_id', 'passport', 'voters_card', 'property_deed', 'utility_bill', 'cac_certificate')),
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  content_type TEXT NOT NULL,
  status verification_status NOT NULL DEFAULT 'pending',
  reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.6 Properties
CREATE TABLE IF NOT EXISTS public.properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  address TEXT NOT NULL,
  landmark TEXT,
  area TEXT NOT NULL CHECK (area IN ('Dambare', 'Rimin Gata', 'Kano', 'Other')),
  city TEXT NOT NULL DEFAULT 'Kano',
  state TEXT NOT NULL DEFAULT 'Kano',
  country TEXT NOT NULL DEFAULT 'Nigeria',
  property_type TEXT NOT NULL CHECK (property_type IN ('self_contained', 'single_room', 'flat', 'shared_apartment', 'hostel')),
  approval_status property_approval_status NOT NULL DEFAULT 'draft',
  is_published BOOLEAN NOT NULL DEFAULT false,
  total_spaces INTEGER NOT NULL DEFAULT 1 CHECK (total_spaces >= 1),
  available_spaces INTEGER NOT NULL DEFAULT 1 CHECK (available_spaces >= 0 AND available_spaces <= total_spaces),
  featured_image_url TEXT,
  images TEXT[] NOT NULL DEFAULT '{}',
  amenities TEXT[] NOT NULL DEFAULT '{}',
  rental_fee_annual NUMERIC(12, 2) NOT NULL CHECK (rental_fee_annual > 0),
  caution_deposit NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (caution_deposit >= 0),
  service_charge NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (service_charge >= 0),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.7 Units / Rooms
CREATE TABLE IF NOT EXISTS public.units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL DEFAULT 'room',
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  available_spaces INTEGER NOT NULL DEFAULT 1 CHECK (available_spaces >= 0 AND available_spaces <= capacity),
  price_annual NUMERIC(12, 2) NOT NULL CHECK (price_annual > 0),
  features TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.8 Property Locations (Privacy-Gated)
CREATE TABLE IF NOT EXISTS public.property_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL UNIQUE REFERENCES public.properties(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  latitude NUMERIC(10, 7) NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude NUMERIC(10, 7) NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  public_latitude NUMERIC(10, 7) CHECK (public_latitude >= -90 AND public_latitude <= 90),
  public_longitude NUMERIC(10, 7) CHECK (public_longitude >= -180 AND public_longitude <= 180),
  geohash TEXT,
  public_geohash TEXT,
  precision TEXT NOT NULL DEFAULT 'nearby_building' CHECK (precision IN ('exact_building', 'nearby_building', 'street', 'neighbourhood')),
  formatted_address TEXT,
  directions TEXT,
  verification_status verification_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.9 Roommate Preferences
CREATE TABLE IF NOT EXISTS public.roommate_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  budget_min NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (budget_min >= 0),
  budget_max NUMERIC(12, 2) NOT NULL CHECK (budget_max >= budget_min),
  preferred_area TEXT[] NOT NULL DEFAULT '{"Dambare"}',
  cleanliness_rating INTEGER NOT NULL DEFAULT 3 CHECK (cleanliness_rating BETWEEN 1 AND 5),
  sleep_habit TEXT NOT NULL DEFAULT 'flexible' CHECK (sleep_habit IN ('early_bird', 'night_owl', 'flexible')),
  study_habit TEXT NOT NULL DEFAULT 'moderate' CHECK (study_habit IN ('silent', 'moderate', 'group_friendly')),
  smoking_preference TEXT NOT NULL DEFAULT 'no_smoking' CHECK (smoking_preference IN ('no_smoking', 'outside_only', 'flexible')),
  alcohol_preference TEXT NOT NULL DEFAULT 'no_alcohol' CHECK (alcohol_preference IN ('no_alcohol', 'social', 'flexible')),
  guest_policy TEXT NOT NULL DEFAULT 'occasional' CHECK (guest_policy IN ('no_guests', 'occasional', 'frequent')),
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.10 Roommate Requests
CREATE TABLE IF NOT EXISTS public.roommate_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status roommate_request_status NOT NULL DEFAULT 'pending',
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_active_roommate_request UNIQUE (sender_id, receiver_id),
  CONSTRAINT different_students CHECK (sender_id != receiver_id)
);

-- 3.11 Accommodation Groups
CREATE TABLE IF NOT EXISTS public.accommodation_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  target_area TEXT NOT NULL DEFAULT 'Dambare',
  budget_per_member NUMERIC(12, 2) NOT NULL CHECK (budget_per_member > 0),
  max_members INTEGER NOT NULL DEFAULT 4 CHECK (max_members >= 2 AND max_members <= 12),
  leader_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  target_property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.12 Group Members
CREATE TABLE IF NOT EXISTS public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.accommodation_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role group_member_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_group_user UNIQUE (group_id, user_id)
);

-- 3.13 Group Join Requests
CREATE TABLE IF NOT EXISTS public.group_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.accommodation_groups(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status group_request_status NOT NULL DEFAULT 'pending',
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_active_group_join UNIQUE (group_id, student_id)
);

-- 3.14 Group Invitations
CREATE TABLE IF NOT EXISTS public.group_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.accommodation_groups(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status group_request_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_group_invitation UNIQUE (group_id, student_id)
);

-- 3.15 Reservations
CREATE TABLE IF NOT EXISTS public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  landlord_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status reservation_status NOT NULL DEFAULT 'pending_payment',
  hold_expires_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now() + interval '7 days'),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  cancellation_reason TEXT,
  payment_receipt_id UUID,
  payment_receipt_submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT valid_hold_window CHECK (hold_expires_at > created_at)
);

-- 3.16 Invoices
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  reservation_id UUID NOT NULL UNIQUE REFERENCES public.reservations(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  landlord_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  status invoice_status NOT NULL DEFAULT 'unpaid',
  due_date TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.17 Payment Receipts
CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  landlord_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  amount_paid NUMERIC(12, 2) NOT NULL CHECK (amount_paid > 0),
  payment_reference TEXT NOT NULL,
  payer_bank_name TEXT NOT NULL,
  payment_date TIMESTAMPTZ NOT NULL,
  status receipt_status NOT NULL DEFAULT 'pending_review',
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.18 Conversations
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type conversation_type NOT NULL DEFAULT 'direct',
  title TEXT,
  group_id UUID REFERENCES public.accommodation_groups(id) ON DELETE CASCADE,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.19 Conversation Participants
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_read_at TIMESTAMPTZ,
  CONSTRAINT unique_participant UNIQUE (conversation_id, user_id)
);

-- 3.20 Messages
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  text TEXT NOT NULL,
  attachment JSONB,
  is_edited BOOLEAN NOT NULL DEFAULT false,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.21 Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3.22 Audit Logs (Append-Only)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ============================================================================
-- 4. Indexes for Performance and RLS Lookups
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON public.student_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_landlord_profiles_user_id ON public.landlord_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_properties_landlord ON public.properties(landlord_id);
CREATE INDEX IF NOT EXISTS idx_properties_approval ON public.properties(approval_status, is_published);
CREATE INDEX IF NOT EXISTS idx_properties_area ON public.properties(area);

CREATE INDEX IF NOT EXISTS idx_units_property ON public.units(property_id);
CREATE INDEX IF NOT EXISTS idx_property_locations_prop ON public.property_locations(property_id);
CREATE INDEX IF NOT EXISTS idx_property_locations_status ON public.property_locations(verification_status);

CREATE INDEX IF NOT EXISTS idx_roommate_req_sender ON public.roommate_requests(sender_id);
CREATE INDEX IF NOT EXISTS idx_roommate_req_receiver ON public.roommate_requests(receiver_id);

CREATE INDEX IF NOT EXISTS idx_group_members_group ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON public.group_members(user_id);

CREATE INDEX IF NOT EXISTS idx_reservations_student ON public.reservations(student_id);
CREATE INDEX IF NOT EXISTS idx_reservations_landlord ON public.reservations(landlord_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON public.reservations(status, hold_expires_at);

CREATE INDEX IF NOT EXISTS idx_invoices_student ON public.invoices(student_id);
CREATE INDEX IF NOT EXISTS idx_invoices_reservation ON public.invoices(reservation_id);

CREATE INDEX IF NOT EXISTS idx_receipts_reservation ON public.payment_receipts(reservation_id);
CREATE INDEX IF NOT EXISTS idx_receipts_landlord ON public.payment_receipts(landlord_id);
CREATE INDEX IF NOT EXISTS idx_receipts_student ON public.payment_receipts(student_id);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id, created_at);
