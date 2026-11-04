-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Seed Data for Local Development and Security Testing
-- ============================================================================

-- Seed Profiles
INSERT INTO public.profiles (id, email, full_name, role, account_status, is_verified)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'student1@outpost.edu.ng', 'Amina Garba', 'student', 'active', true),
  ('22222222-2222-4222-8222-222222222222', 'student2@outpost.edu.ng', 'Ibrahim Musa', 'student', 'active', false),
  ('33333333-3333-4333-8333-333333333333', 'landlord1@outpost.ng', 'Alhaji Sani Bello', 'landlord', 'active', true),
  ('44444444-4444-4444-8444-444444444444', 'landlord2@outpost.ng', 'Hajiya Fatima Umar', 'landlord', 'active', false),
  ('55555555-5555-4555-8555-555555555555', 'admin@outpost.edu.ng', 'Platform Moderator', 'admin', 'active', true),
  ('00000000-0000-4000-8000-000000000001', 'ethoppaofficial@gmail.com', 'System Administrator', 'admin', 'active', true)
ON CONFLICT (id) DO NOTHING;

-- Seed Student Profiles
INSERT INTO public.student_profiles (id, user_id, institution, campus, faculty, department, study_level, registration_number, gender, is_profile_verified)
VALUES
  ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Bayero University Kano', 'New Campus', 'Computer Science & Information Technology', 'Software Engineering', '300L', 'CST/22/SWE/00142', 'female', true),
  ('a2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Bayero University Kano', 'New Campus', 'Engineering', 'Electrical Engineering', '200L', 'ENG/23/ELE/00098', 'male', false)
ON CONFLICT (id) DO NOTHING;

-- Seed Landlord Profiles
INSERT INTO public.landlord_profiles (id, user_id, company_name, business_address, bank_name, bank_account_number, bank_account_name, verification_status)
VALUES
  ('b3333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 'Dambare Royal Homes Ltd', 'Plot 14 Dambare University Road, Kano', 'First Bank of Nigeria', '3012948571', 'Sani Bello Enterprise', 'approved'),
  ('b4444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444', 'Rimin Gata Prestige Lodge', 'Behind BUK Senior Staff Quarters, Rimin Gata', 'Zenith Bank', '2081734910', 'Fatima Umar Properties', 'pending')
ON CONFLICT (id) DO NOTHING;

-- Seed Properties
INSERT INTO public.properties (id, landlord_id, title, description, address, landmark, area, city, property_type, approval_status, is_published, total_spaces, available_spaces, rental_fee_annual, caution_deposit, service_charge)
VALUES
  ('c1111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'Dambare Scholar Enclave', 'Modern self-contained apartments with 24/7 borehole water, solar inverter backup, and gated security perimeter.', 'Near BUK Gate 2, Dambare, Kano', 'Opposite Bayero University New Campus Gate 2', 'Dambare', 'Kano', 'self_contained', 'approved', true, 10, 8, 250000.00, 30000.00, 20000.00),
  ('c2222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', 'Rimin Gata Student Villa', 'Serene shared accommodation with private study desks and prepaid electricity meters.', 'Old Gwarzo Road, Rimin Gata, Kano', 'Near Rimin Gata Primary Healthcare Centre', 'Rimin Gata', 'Kano', 'shared_apartment', 'draft', false, 6, 6, 180000.00, 20000.00, 15000.00)
ON CONFLICT (id) DO NOTHING;

-- Seed Units
INSERT INTO public.units (id, property_id, name, unit_type, capacity, available_spaces, price_annual)
VALUES
  ('d1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', 'Deluxe Studio Block A-1', 'self_contained', 1, 1, 250000.00),
  ('d2222222-2222-4222-8222-222222222222', 'c1111111-1111-4111-8111-111111111111', 'Deluxe Studio Block A-2', 'self_contained', 1, 1, 250000.00)
ON CONFLICT (id) DO NOTHING;

-- Seed Property Location (Verified and Publicly Gated)
INSERT INTO public.property_locations (id, property_id, submitted_by, latitude, longitude, public_latitude, public_longitude, precision, verification_status, formatted_address)
VALUES
  ('e1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 11.9754200, 8.4231500, 11.9754000, 8.4231000, 'exact_building', 'verified', 'BUK Gate 2, Dambare, Kano')
ON CONFLICT (id) DO NOTHING;

-- Seed Roommate Preferences
INSERT INTO public.roommate_preferences (id, student_id, budget_min, budget_max, preferred_area, cleanliness_rating, sleep_habit, study_habit, smoking_preference)
VALUES
  ('f1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 100000.00, 200000.00, '{"Dambare"}', 5, 'early_bird', 'silent', 'no_smoking')
ON CONFLICT (id) DO NOTHING;
