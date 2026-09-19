# OUTPOST: Firebase to Supabase Migration Specification & Runbook

This document defines the architectural mapping and zero-loss cutover runbook for transitioning the OUTPOST Student Accommodation Platform from its Firebase (Firestore / Auth / Storage / Cloud Functions) implementation to Supabase (PostgreSQL / Supabase Auth / Supabase Storage / Edge Functions / Supabase Realtime).

---

## 1. Domain Capability Mapping Table

| Domain Capability | Firebase Implementation (Source) | Supabase Destination (Target) | Notes & Invariants |
| :--- | :--- | :--- | :--- |
| **Authentication** | Firebase Auth (Email/Password, Custom Claims) | Supabase Auth (`auth.users`) | Preserve normalized emails, UUID mapping table |
| **User & Student Profiles** | `/users/{id}`, `/studentProfiles/{id}` | `public.users`, `public.student_profiles` | Foreign key to `auth.users(id)` ON DELETE CASCADE |
| **Landlord & Admin Profiles**| `/landlordProfiles/{id}`, `/adminProfiles/{id}`| `public.landlord_profiles`, `public.admin_profiles` | Foreign key to `auth.users(id)` |
| **Properties & Units** | `/properties/{id}` with subcollections/embedded | `public.properties`, `public.units` | 1-to-many normalized relation with foreign key |
| **Verification Documents** | `/studentVerificationDocuments/{id}` | `public.student_verification_documents` | Private RLS: student owner & admins only |
| **Landlord Verifications** | `/landlordVerifications/{id}` | `public.landlord_verifications` | Private RLS: landlord owner & admins only |
| **Roommate Preferences** | `/roommatePreferences/{id}` | `public.roommate_preferences` | One-to-one with student profile |
| **Roommate Requests** | `/roommateRequests/{id}` | `public.roommate_requests` | Unique constraint on `(sender_id, receiver_id, status)` |
| **Accommodation Groups** | `/accommodationGroups/{id}` | `public.accommodation_groups`, `public.group_members` | Normalized junction table with membership check |
| **Reservations & Holds** | `/reservations/{id}` | `public.reservations` | Check constraint: hold 7-day expiration logic |
| **Invoices & Receipts** | `/invoices/{id}`, `/paymentReceipts/{id}` | `public.invoices`, `public.payment_receipts` | Foreign keys to reservation; financial invariants |
| **In-App Notifications** | `/notifications/{id}` | `public.notifications` | RLS: `auth.uid() = user_id` |
| **Real-Time Text Chat** | `/conversations/{id}`, `/messages/{id}` | `public.conversations`, `public.conversation_participants`, `public.messages` | Supabase Realtime postgres_changes & broadcast |
| **Sensitive & Media Storage**| Firebase Storage (Private buckets) | Supabase Storage (`student-docs`, `receipts`, `properties` buckets) | Private buckets with signed URLs or Storage RLS |
| **Server-side Logic** | Cloud Functions (Triggers & Callables) | Supabase Edge Functions / Database Triggers | Atomic transaction guarantees |
| **Scheduled 7-day Expiration**| Scheduled Cloud Function (cron) | `pg_cron` extension scheduled job | Runs hourly to release unverified reservation holds |

---

## 2. PostgreSQL Target Schema (`schema.sql`)

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Role and Status Enums
CREATE TYPE user_role AS ENUM ('student', 'landlord', 'admin');
CREATE TYPE account_status AS ENUM ('active', 'email_unverified', 'profile_pending', 'profile_verified', 'rejected', 'suspended');
CREATE TYPE verification_status AS ENUM ('not_started', 'pending', 'approved', 'rejected');
CREATE TYPE property_verification_status AS ENUM ('draft', 'pending', 'approved', 'rejected', 'suspended');
CREATE TYPE reservation_status AS ENUM ('pending_payment', 'receipt_submitted', 'confirmed', 'rejected', 'cancelled', 'expired');
CREATE TYPE receipt_status AS ENUM ('not_submitted', 'pending_review', 'approved', 'rejected');

-- Users
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'student',
  account_status account_status NOT NULL DEFAULT 'email_unverified',
  email_verified BOOLEAN NOT NULL DEFAULT false,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- Student Profiles
CREATE TABLE public.student_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  registration_number TEXT NOT NULL UNIQUE,
  university TEXT NOT NULL,
  campus TEXT NOT NULL,
  study_level TEXT NOT NULL,
  programme TEXT NOT NULL,
  gender TEXT NOT NULL,
  preferred_location TEXT NOT NULL,
  bio TEXT,
  is_profile_verified BOOLEAN NOT NULL DEFAULT false
);

-- Student Verification Documents
CREATE TABLE public.student_verification_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('student_id', 'admission_letter', 'school_fees_receipt')),
  document_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  status verification_status NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES public.users(id)
);

-- Landlord Profiles
CREATE TABLE public.landlord_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  contact_address TEXT NOT NULL,
  id_type TEXT NOT NULL,
  id_reference TEXT NOT NULL,
  business_name TEXT,
  document_url TEXT,
  verification_status verification_status NOT NULL DEFAULT 'not_started',
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ
);

-- Properties
CREATE TABLE public.properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  landlord_id UUID NOT NULL REFERENCES public.users(id),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  property_type TEXT NOT NULL,
  accommodation_type TEXT NOT NULL,
  gender_policy TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  neighbourhood TEXT NOT NULL,
  campus TEXT NOT NULL,
  university TEXT NOT NULL,
  distance_km NUMERIC(5, 2) NOT NULL,
  price_per_session NUMERIC(12, 2) NOT NULL CHECK (price_per_session > 0),
  billing_period TEXT NOT NULL,
  deposit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  utilities_included BOOLEAN NOT NULL DEFAULT false,
  amenities TEXT[] NOT NULL DEFAULT '{}',
  house_rules TEXT[] NOT NULL DEFAULT '{}',
  images TEXT[] NOT NULL DEFAULT '{}',
  total_capacity INT NOT NULL CHECK (total_capacity > 0),
  available_spaces INT NOT NULL CHECK (available_spaces >= 0),
  verification_status property_verification_status NOT NULL DEFAULT 'pending',
  admin_feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Units / Rooms
CREATE TABLE public.units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  total_capacity INT NOT NULL CHECK (total_capacity > 0),
  available_spaces INT NOT NULL CHECK (available_spaces >= 0),
  price_per_session NUMERIC(12, 2) NOT NULL
);

-- Reservations
CREATE TABLE public.reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_number TEXT NOT NULL UNIQUE,
  student_id UUID NOT NULL REFERENCES public.users(id),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  unit_id UUID NOT NULL REFERENCES public.units(id),
  landlord_id UUID NOT NULL REFERENCES public.users(id),
  status reservation_status NOT NULL DEFAULT 'pending_payment',
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  hold_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  cancellation_reason TEXT
);

-- Invoices
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number TEXT NOT NULL UNIQUE,
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid',
  bank_details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment Receipts
CREATE TABLE public.payment_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id),
  student_id UUID NOT NULL REFERENCES public.users(id),
  landlord_id UUID NOT NULL REFERENCES public.users(id),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  payment_reference TEXT NOT NULL,
  payer_bank_name TEXT NOT NULL,
  payment_date DATE NOT NULL,
  amount_paid NUMERIC(12, 2) NOT NULL,
  status receipt_status NOT NULL DEFAULT 'pending_review',
  rejection_reason TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.users(id)
);

-- Roommate Preferences
CREATE TABLE public.roommate_preferences (
  student_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  preferred_neighbourhoods TEXT[] NOT NULL DEFAULT '{}',
  min_budget NUMERIC(12, 2) NOT NULL,
  max_budget NUMERIC(12, 2) NOT NULL,
  move_in_period TEXT NOT NULL,
  study_habits TEXT NOT NULL,
  sleep_schedule TEXT NOT NULL,
  cleanliness TEXT NOT NULL,
  smoking TEXT NOT NULL,
  guest_preference TEXT NOT NULL,
  noise_tolerance TEXT NOT NULL,
  room_sharing TEXT NOT NULL,
  gender_preference TEXT NOT NULL
);

-- Accommodation Groups
CREATE TABLE public.accommodation_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  leader_id UUID NOT NULL REFERENCES public.users(id),
  target_property_id UUID REFERENCES public.properties(id),
  max_capacity INT NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.group_members (
  group_id UUID NOT NULL REFERENCES public.accommodation_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

-- Conversations & Messages
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  name TEXT NOT NULL,
  group_id UUID REFERENCES public.accommodation_groups(id) ON DELETE SET NULL,
  last_message_text TEXT,
  last_message_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'delivered',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. Seven-Day Expiration Automation via pg_cron

In Supabase PostgreSQL, the seven-day expiration is implemented natively in SQL and scheduled via `pg_cron`:

```sql
CREATE OR REPLACE FUNCTION public.expire_seven_day_reservations()
RETURNS void AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, property_id, unit_id, student_id, reservation_number
    FROM public.reservations
    WHERE status = 'pending_payment'
      AND hold_expires_at <= NOW()
    FOR UPDATE
  LOOP
    -- 1. Update reservation status
    UPDATE public.reservations
    SET status = 'expired',
        cancellation_reason = 'Automated 7-day payment hold window expired.'
    WHERE id = rec.id;

    -- 2. Release held unit inventory
    UPDATE public.units
    SET available_spaces = available_spaces + 1
    WHERE id = rec.unit_id;

    -- 3. Update parent property aggregate available spaces
    UPDATE public.properties p
    SET available_spaces = (SELECT SUM(available_spaces) FROM public.units WHERE property_id = p.id)
    WHERE p.id = rec.property_id;

    -- 4. Expire unpaid invoice
    UPDATE public.invoices
    SET status = 'expired'
    WHERE reservation_id = rec.id AND status = 'unpaid';

    -- 5. Insert notification
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      rec.student_id,
      'Reservation Hold Expired',
      'Your reservation ' || rec.reservation_number || ' has expired after 7 days without payment verification.',
      'warning',
      '/student/reservations/' || rec.id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule to run hourly
SELECT cron.schedule('expire-reservations-hourly', '0 * * * *', 'SELECT public.expire_seven_day_reservations()');
```

---

## 4. Reconciliation Checks and Rollback Strategy

1. **Reconciliation Queries:**
   - Verify `COUNT(*)` matches between exported Firestore collections and Supabase tables.
   - Verify active inventory: `SUM(units.available_spaces) + COUNT(active_holds) = units.total_capacity`.
   - Verify no orphan foreign keys in `reservations`, `student_verification_documents`, or `payment_receipts`.
2. **Rollback Trigger:**
   - If error rate exceeds 0.5% during staging verification or cutover tests fail, toggle the client repository adapter back to Firebase or local storage immediately without data loss.
