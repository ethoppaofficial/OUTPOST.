-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261020000003_storage_buckets_and_policies.sql
-- Description: Supabase Storage Buckets & Strict Tenant-Isolated Storage RLS
-- ============================================================================

-- 1. Create Private and Scoped Storage Buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('student-docs', 'student-docs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('landlord-docs', 'landlord-docs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('payment-receipts', 'payment-receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('chat-attachments', 'chat-attachments', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']),
  ('property-images', 'property-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('profile-pictures', 'profile-pictures', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- 2. Storage RLS Policies on storage.objects
-- ============================================================================

-- 2.1 Student Documents Bucket: student-docs/{studentId}/{documentId}/{fileName}
CREATE POLICY "Student read own documents or admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'student-docs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

CREATE POLICY "Student upload own verification document"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'student-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.is_student()
  );

CREATE POLICY "Student delete own pending document"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'student-docs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

-- 2.2 Landlord Documents Bucket: landlord-docs/{landlordId}/{documentId}/{fileName}
CREATE POLICY "Landlord read own documents or admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'landlord-docs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

CREATE POLICY "Landlord upload own verification submission"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'landlord-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.is_landlord()
  );

CREATE POLICY "Landlord delete own pending document"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'landlord-docs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

-- 2.3 Payment Receipts: payment-receipts/{landlordId}/{studentId}/{reservationId}/{receiptId}/{fileName}
CREATE POLICY "Read payment receipt restricted to reservation parties or admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text -- Landlord
      OR (storage.foldername(name))[2] = auth.uid()::text -- Student
      OR public.is_admin()
    )
  );

CREATE POLICY "Student upload receipt to server-issued path"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_student()
  );

CREATE POLICY "Payment receipts deletion forbidden to clients"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND public.is_admin()
  );

-- 2.4 Chat Attachments: chat-attachments/{conversationId}/{senderId}/{messageId}/{fileName}
CREATE POLICY "Participants read chat attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      public.is_conversation_participant((storage.foldername(name))[1]::uuid)
      OR public.is_admin()
    )
  );

CREATE POLICY "Sender upload chat attachment to conversation"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_conversation_participant((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "Chat attachment deletion restricted to admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND public.is_admin()
  );

-- 2.5 Property Images: property-images/{landlordId}/{propertyId}/{fileName}
CREATE POLICY "Property images public read"
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'property-images');

CREATE POLICY "Landlords upload images to own property folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.is_landlord()
  );

CREATE POLICY "Landlords delete images from own property folder"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

-- 2.6 Profile Pictures: profile-pictures/{uid}/{fileName}
CREATE POLICY "Profile pictures public read"
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'profile-pictures');

CREATE POLICY "Users upload own profile picture"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-pictures'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users update own profile picture"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-pictures'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete own profile picture"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-pictures'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
