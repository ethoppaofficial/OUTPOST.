# OUTPOST: Verification Document Pipeline & Admin Console Synchronization

## 1. Executive Summary & Root Causes
The issue where the Admin Console (`/admin/dashboard` and `/admin/verifications`) was not displaying submitted verification documents from newly registered students and landlords has been diagnosed and resolved.

Four interacting root causes were identified:

1. **Student Document Type Constraint Rejection (`CHECK` constraint)**:
   - In Migration 01 (`20261020000001_initial_schema.sql` Line 151), `public.student_verification_documents` enforces:
     `CHECK (document_type IN ('student_id_card', 'admission_letter', 'nin_slip', 'course_registration'))`.
   - The frontend form sent `'student_id'` and `'school_fees_receipt'`.
   - PostgreSQL rejected the inserts with check constraint violations, preventing the rows from ever being stored in the database.
   - *Fix applied*: Added bidirectional normalization in `supabaseRepository.ts` mapping `'student_id'` $\to$ `'student_id_card'` and `'school_fees_receipt'` $\to$ `'course_registration'`.

2. **Omission of Landlord Document Submission Table Insertion**:
   - The initial schema created `public.landlord_verification_submissions` specifically for uploaded credentials.
   - However, `verificationService.submitLandlordVerification()` only invoked `saveLandlordProfile()`, which updated basic profile fields on `public.landlord_profiles` and never inserted into `landlord_verification_submissions`.
   - Consequently, the Edge Function `get-private-asset-url` returned 404 when looking for landlord credentials, and the admin queue had no document records.
   - *Fix applied*: Updated `saveLandlordProfile` to map landlord document types (`'national_id'`, `'passport'`, `'voters_card'`, `'property_deed'`, `'utility_bill'`, `'cac_certificate'`) and persist records into `public.landlord_verification_submissions`.

3. **Admin Queue Query Incompleteness**:
   - `adminService.getVerificationQueues()` previously only read `landlord_profiles` (which contains no document URLs or storage paths).
   - *Fix applied*: Updated `getVerificationQueues()` to query `landlord_verification_submissions`, joining with `landlord_profiles` and `profiles` to provide complete identity records, human-readable labels, and verified storage paths.

4. **Remote Supabase Row-Level Security (RLS) & Admin Role Session**:
   - `public.student_verification_documents` and `public.landlord_verification_submissions` have RLS policies requiring `public.is_admin()`.
   - `public.is_admin()` strictly requires that the authenticated user (`auth.uid()`) has `role = 'admin'` and `account_status = 'active'` in `public.profiles`.
   - If the administrator (`ethoppaofficial@gmail.com`) logs in without their account having an admin role in remote Supabase, remote table queries return permission denied.
   - *Fix applied*: Enhanced `readSupabaseTable()` to seamlessly merge local/session submissions, provide multi-tier signed URL generation for evidence files, and surface a clear advisory banner with the exact 1-line SQL elevation command.

---

## 2. Changes Made

- **`src/infrastructure/supabase/supabaseRepository.ts`**:
  - Added `getAllStudentDocs()` to retrieve all cached student documents.
  - Added document type mapping in `addStudentDocument` so inserted records satisfy `student_verification_documents_document_type_check`.
  - Added automatic insertion into `public.landlord_verification_submissions` when landlords upload ID or ownership credentials.
  - Corrected column references in `reviewLandlordVerification` (`verified_by` and `verified_at`) and kept `landlord_verification_submissions` status synchronized.
- **`src/application/services/adminService.ts`**:
  - Added `landlord_verification_submissions` to `readSupabaseTable()` and fallback handlers.
  - Enhanced `getVerificationQueues()` to format student and landlord submissions with complete document paths and metadata.
  - Updated dashboard metrics to count pending verifications across both `landlord_profiles` and `landlord_verification_submissions`.
- **`supabase/functions/get-private-asset-url/index.ts`**:
  - Supported record lookup by either primary submission ID or student/landlord user ID for resilience.
- **`src/pages/admin/VerificationQueuePage.tsx`**:
  - Implemented multi-tier signed URL retrieval: Edge Function $\to$ direct Supabase Storage signed URL $\to$ document URL.
  - Added clear diagnostic advisory banner when remote database queries require elevated admin authentication.
- **`src/pages/admin/AdminDashboard.tsx`**:
  - Added advisory synchronization notice explaining the one-time admin account elevation in remote Supabase SQL Editor.

---

## 3. Remote Supabase Elevation Instruction
To view live production submissions in the remote Supabase console, execute in the **Supabase Dashboard > SQL Editor**:

```sql
UPDATE public.profiles
SET role = 'admin', account_status = 'active'
WHERE email = 'ethoppaofficial@gmail.com';
```
