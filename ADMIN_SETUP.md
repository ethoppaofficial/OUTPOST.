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
| **PostgreSQL Schema** | Supabase PostgreSQL | PREPARED ONLY | Authoritative ordered migrations in `supabase/migrations/` validated via in-memory PostgreSQL test suite | Apply via `supabase db push` with project access token |
| **Row Level Security** | Supabase PostgreSQL RLS | PREPARED ONLY | 23 tables protected with RLS in `20261020000002_row_level_security.sql`, tested across tenant roles | Automatically applied during migration push |
| **Storage Buckets & Policies** | Supabase Storage | PREPARED ONLY | 6 buckets and bucket RLS policies defined in `20261020000003_storage_buckets_and_policies.sql` | Automatically created during migration push |
| **Realtime** | Supabase Realtime | PREPARED ONLY | Publications enabled for messages & notifications in schema migration | Active upon database push |
| **Edge Functions** | Supabase Edge Functions (Deno) | PREPARED ONLY | 8 functions implemented, CORS-validated, and tested in `supabase/functions/` | Deploy via `supabase functions deploy --all` |
| **Reservation Expiration Scheduler** | PostgreSQL / pg_cron | PREPARED ONLY | Hourly procedure `expire_pending_reservations` defined in migration 4 | Enabled with `pg_cron` in Supabase project dashboard |

---

## Administrator Bootstrap & Security Guardrails

OUTPOST enforces zero-client-trust administration:
1. `/admin/login` is a dedicated administrator authentication portal. It does NOT permit self-registration.
2. Administrative privileges are rooted in `public.profiles.role = 'admin'` backed by database triggers that strictly prevent client mutations.
3. System audit logs are append-only; direct `UPDATE`, `DELETE`, and `TRUNCATE` privileges on `audit_logs` are revoked from `PUBLIC`, `authenticated`, and `anon`.
4. Stored procedures (`create_reservation_atomic`, `review_payment_receipt_atomic`, `expire_pending_reservations`) execute as `SECURITY DEFINER` with fixed `search_path = public, auth`.

### One-Time Administrator Bootstrap (Supabase SQL)

To promote an initial verified user to administrator, execute the following SQL in the Supabase SQL Editor:

```sql
-- 1. Verify user exists in auth.users
SELECT id, email, created_at FROM auth.users WHERE email = 'mrrex0312@gmail.com';

-- 2. Set administrator role in profiles table
UPDATE public.profiles
SET role = 'admin',
    account_status = 'active'
WHERE id = (SELECT id FROM auth.users WHERE email = 'mrrex0312@gmail.com');

-- 3. Ensure corresponding admin_profile entry exists
INSERT INTO public.admin_profiles (id, full_name, permissions)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'mrrex0312@gmail.com'),
  'System Administrator',
  '{"can_verify_students": true, "can_verify_landlords": true, "can_approve_properties": true, "can_manage_settings": true, "can_suspend_users": true}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET permissions = EXCLUDED.permissions;

-- 4. Record bootstrap in immutable audit log
INSERT INTO public.audit_logs (actor_id, actor_role, action, target_type, target_id, details)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'mrrex0312@gmail.com'),
  'admin',
  'ADMIN_BOOTSTRAP',
  'admin_profile',
  (SELECT id FROM auth.users WHERE email = 'mrrex0312@gmail.com')::text,
  '{"method": "manual_bootstrap_sql", "reason": "initial_admin_setup"}'::jsonb
);
```

---

## Deployment Commands for Supabase

From developer workstation with the Supabase CLI installed:

```bash
# 1. Link project
supabase link --project-ref bljscjzpycbzkubyyfrq

# 2. Push database schema, RLS, storage, and automation migrations
supabase db push

# 3. Deploy all Edge Functions
supabase functions deploy --all

# 4. Verify Edge Function secrets
supabase secrets set \
  MAPTILER_API_KEY="" \
  ALLOWED_ORIGINS="https://ais-dev-fimwv26mpozkczddnrurtm-564723309739.europe-west2.run.app"
```

---

## Production Smoke Tests

1. Navigate to `/admin/login`. Ensure standard student or landlord credentials are not permitted.
2. Sign in with the promoted administrator account and verify `/admin/dashboard` loads live statistics.
3. Access `/admin/users` and ensure user directory displays Supabase user records and allows account suspension with recorded reasons.
4. Access `/admin/properties` and verify property approval and location verification workflows execute independently.
5. Access `/admin/settings` and verify platform settings (maintenance mode) update and record audit entries.
