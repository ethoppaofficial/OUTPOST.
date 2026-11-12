# OUTPOST Administrator Setup and Deployment Guide

## Authoritative Backend Statement

> **OUTPOST uses Supabase as its only active backend: Supabase Auth for authentication, Supabase PostgreSQL for persistence, PostgreSQL Row Level Security for authorization, Supabase Storage for files, Supabase Realtime for live communication, and Supabase Edge Functions and database procedures for privileged workflows. Firebase is legacy/archive material only and is not used by the active application.**

## Authoritative Database Migrations Statement

> **The authoritative database contract is the ordered set of timestamped SQL migrations in supabase/migrations/. Apply 20261020000001_initial_schema.sql, then 20261020000002_row_level_security.sql, then 20261020000003_storage_buckets_and_policies.sql, then 20261020000004_functions_triggers_and_automation.sql. Archived Firebase rules and functions are not the active backend contract.**

## Legacy Firebase Archive Note

> **The repository retains selected Firebase configuration, Firestore rules, Storage rules, and Cloud Function files for historical migration traceability and rollback analysis. These files are not part of the active OUTPOST runtime and must not be deployed or imported by the active frontend. Supabase is the only supported backend. The archive may be removed after production acceptance testing, backup verification, and explicit maintainer approval.**

---

## Remote Deployment Status Table

| Component | Provider | Status | Verification Method | Remaining Action |
| :--- | :--- | :--- | :--- | :--- |
| **Authentication** | Supabase Auth | CONFIGURED | Remote REST probe `/auth/v1/settings` returns HTTP 200 with signup & email enabled | Ready for administrative sign-in |
| **PostgreSQL Schema** | Supabase PostgreSQL | PREPARED ONLY | Authoritative ordered migrations (`01` through `07`) in `supabase/migrations/` | Apply via `supabase db push` with project access token |
| **Row Level Security** | Supabase PostgreSQL RLS | PREPARED ONLY | Protected across all tables (`20261020000002` + `20261112000007`), enforced by `public.is_admin()` | Automatically applied during migration push |
| **Storage Buckets & Policies** | Supabase Storage | PREPARED ONLY | 6 buckets and bucket RLS policies defined in `20261020000003_storage_buckets_and_policies.sql` | Automatically created during migration push |
| **Realtime** | Supabase Realtime | PREPARED ONLY | Publications enabled for messages & notifications; admin console subscribes to verification/property tables | Active upon database push |
| **Edge Functions** | Supabase Edge Functions (Deno) | PREPARED ONLY | Functions including `get-private-asset-url` implemented and tested in `supabase/functions/` | Deploy via `supabase functions deploy --all` |
| **Reservation Expiration Scheduler** | PostgreSQL / pg_cron | PREPARED ONLY | Hourly procedure `expire_pending_reservations` defined in migration 4 | Enabled with `pg_cron` in Supabase project dashboard |

---

## Administrator Authorization & Zero-Fallback Contract

OUTPOST enforces fail-closed zero-client-trust administration:
1. `/admin/login` is a dedicated administrator authentication portal. It does NOT permit self-registration or demo quick-fill credentials.
2. Every administrator action and dashboard query verifies `public.profiles` where:
   - `profiles.id = auth.uid()`
   - `role = 'admin'`
   - `account_status = 'active'`
3. **Zero Local/Demo Fallback**: `adminService` NEVER falls back to seed profiles, browser `localStorage`, or in-memory mock records when Supabase returns empty sets or errors.
   - Live empty database tables legitimately display `0` counts and empty queues (`"No pending items"`).
   - Missing authentication, insufficient roles, RLS rejections (`42501`), or network errors surface an explicit `"Data Unavailable"` banner with the typed error code (`UNAUTHENTICATED`, `FORBIDDEN_ROLE`, `ADMIN_SUSPENDED_OR_INACTIVE`, `SCHEMA_OR_RLS_ERROR`, `NETWORK_ERROR`) and a Retry button.

---

## Live Dashboard & Reports Metrics Contract (`ADMIN_METRICS_METADATA`)

Both `/admin/dashboard` and `/admin/reports` consume the identical `AdminMetrics` contract served by `public.admin_get_dashboard_metrics()` (or database `head: true, count: 'exact'` queries if Migration 07 has not yet been pushed):

| Metric Key | Source Table | Definition / Filter |
| :--- | :--- | :--- |
| `totalUsers` | `public.profiles` | All registered user profiles across all roles |
| `totalStudents` | `public.profiles` | `role = 'student'` |
| `totalLandlords` | `public.profiles` | `role = 'landlord'` |
| `totalAdministrators` | `public.profiles` | `role = 'admin'` |
| `totalUploadedStudentDocuments` | `public.student_verification_documents` | All student verification metadata rows |
| `totalLandlordVerificationSubmissions` | `public.landlord_verification_submissions` | All landlord verification submission rows |
| `totalPaymentReceipts` | `public.payment_receipts` | All payment receipt metadata rows |
| `pendingStudentVerifications` | `public.student_verification_documents` | `status = 'pending'` |
| `pendingLandlordVerifications` | `landlord_verification_submissions` / `landlord_profiles` | Distinct landlords with pending submission or `verification_status = 'pending'` |
| `pendingPropertyVerifications` | `public.properties` | `approval_status = 'pending'` |
| `activeProperties` | `public.properties` | `approval_status = 'approved' AND is_published = true` |
| `activeReservations` | `public.reservations` | `status IN ('pending_payment', 'payment_submitted', 'confirmed') AND hold_expires_at > now()` |
| `pendingReceiptVerifications` | `public.payment_receipts` | `status = 'pending_review'` |
| `expiredReservations` | `public.reservations` | `status = 'expired'` OR unpaid hold past `hold_expires_at` |

### Definition of "Uploaded Files"
- Identity and payment counts strictly track **authorized PostgreSQL metadata rows** (`student_verification_documents`, `landlord_verification_submissions`, `payment_receipts`), never raw Storage bucket listings from the browser.
- Public property photos (`property-images`) and private chat files (`chat-attachments`) are excluded from identity/payment file counts.
- Orphaned Storage objects without a linked authorized database record are never counted or surfaced.

---

### One-Time Administrator Bootstrap (Supabase SQL)

To promote an initial verified user to administrator, execute the following SQL in the Supabase SQL Editor (replacing `<ADMIN_EMAIL>` with your designated operator account):

```sql
-- 1. Verify user exists in auth.users
SELECT id, email, email_confirmed_at, created_at FROM auth.users WHERE email = '<ADMIN_EMAIL>';

-- 2. Set administrator role and active status in profiles table
UPDATE public.profiles
SET role = 'admin',
    account_status = 'active',
    is_verified = true
WHERE id = (SELECT id FROM auth.users WHERE email = '<ADMIN_EMAIL>');

-- 3. Record bootstrap in immutable audit log
INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
VALUES (
  (SELECT id FROM auth.users WHERE email = '<ADMIN_EMAIL>'),
  'ADMIN_BOOTSTRAP',
  'profiles',
  (SELECT id FROM auth.users WHERE email = '<ADMIN_EMAIL>')::text,
  '{"method": "manual_bootstrap_sql", "reason": "initial_admin_setup"}'::jsonb
);
```

---

## Deployment Commands for Supabase

From developer workstation with the Supabase CLI installed:

```bash
# 1. Link project
supabase link --project-ref bljscjzpycbzkubyyfrq

# 2. Push database schema, RLS, storage, automation, and Migration 07 live admin RPCs
supabase db push

# 3. Deploy all Edge Functions (including hardened get-private-asset-url)
supabase functions deploy --all

# 4. Verify Edge Function secrets
supabase secrets set \
  MAPTILER_API_KEY="" \
  ALLOWED_ORIGINS="https://ais-dev-fimwv26mpozkczddnrurtm-564723309739.europe-west2.run.app"
```

---

## Troubleshooting Live vs. Unavailable Admin Data

| Symptom | Root Cause | Resolution |
| :--- | :--- | :--- |
| Banner displays `[UNAUTHENTICATED]` | Browser session missing or JWT expired | Sign in again via `/admin/login`. |
| Banner displays `[FORBIDDEN_ROLE]` | User lacks `role = 'admin'` in `public.profiles` | Run the Bootstrap SQL above for the account. |
| Banner displays `[ADMIN_SUSPENDED_OR_INACTIVE]` | `profiles.account_status` is not `'active'` | Update `account_status = 'active'` in `public.profiles`. |
| Banner displays `[SCHEMA_OR_RLS_ERROR]` (code `42501` / `42883`) | Latest migrations (`20261112000007`) not pushed to live Supabase | Run `supabase db push` on ref `bljscjzpycbzkubyyfrq`. |
| Clicking "Preview File" fails in Verification Queue | `get-private-asset-url` Edge Function undeployed or Storage object missing | Run `supabase functions deploy get-private-asset-url` and confirm the `storage_path` exists in the private bucket. |
| Dashboard shows `0` with `Live` badge | Connected live PostgreSQL database genuinely has zero records | Register a student/landlord, submit verification files, and click **Refresh**. |

---

## Post-Deployment Verification Checklist

1. Navigate to `/admin/login`. Verify non-admin student/landlord credentials are rejected and no demo credentials are prefilled.
2. Sign in as the active administrator and verify `/admin/dashboard` shows the green **Live** indicator (`ADMIN_METRICS_METADATA` counts match SQL `SELECT COUNT(*)` queries).
3. Register or verify a student (`student_verification_documents`) and landlord (`landlord_verification_submissions`) upload; verify the file appears in `/admin/verification` and generates an expiring 15-minute signed download link via `get-private-asset-url` with a corresponding `ADMIN_VIEW_PRIVATE_EVIDENCE` row in `/admin/audit-logs`.
4. Test `/admin/users` (account suspension with reason), `/admin/properties` (property approval and location verification), `/admin/disputes` (reservation & receipt inspection), and `/admin/settings` (`platform_settings` upsert).

