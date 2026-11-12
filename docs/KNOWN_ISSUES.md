# OUTPOST Known Issues & Technical Limitations

> **Documented gaps, environment constraints, and technical roadmap items identified during system audit and verification.**

## Authoritative Backend Statement

> **OUTPOST uses Supabase as its only active backend: Supabase Auth for authentication, Supabase PostgreSQL for persistence, PostgreSQL Row Level Security for authorization, Supabase Storage for files, Supabase Realtime for live communication, and Supabase Edge Functions and database procedures for privileged workflows. Firebase is legacy/archive material only and is not used by the active application.**

## Authoritative Database Migrations Statement

> **The authoritative database contract is the ordered set of timestamped SQL migrations in supabase/migrations/. Apply 20261020000001_initial_schema.sql, then 20261020000002_row_level_security.sql, then 20261020000003_storage_buckets_and_policies.sql, then 20261020000004_functions_triggers_and_automation.sql. Archived Firebase rules and functions are not the active backend contract.**

## Legacy Firebase Archive Note

> **The repository retains selected Firebase configuration, Firestore rules, Storage rules, and Cloud Function files for historical migration traceability and rollback analysis. These files are not part of the active OUTPOST runtime and must not be deployed or imported by the active frontend. Supabase is the only supported backend. The archive may be removed after production acceptance testing, backup verification, and explicit maintainer approval.**

---

## 1. Sandbox Environment & Deployment Constraints

### Issue 1.1: Supabase CLI and Docker Daemon Unavailable in Evaluation Container
- **Affected Module**: Local infrastructure tooling and live database deployment.
- **Why it matters**: The local development container lacks a running Docker daemon and the `supabase` CLI binary (`which supabase docker` exits with code 1). Consequently, live execution of `supabase db push` or `supabase functions deploy` cannot run autonomously within this specific sandbox container.
- **Status**: **CONFIRMED** (Environmental constraint).
- **Workaround & Verification Applied**: All SQL DDL, CHECK constraints, stored procedures, and triggers were verified via real runtime execution in Node.js using `pg-mem` (`test/database-runtime.test.mjs`), and live admin metrics/auth contracts were verified in `test/admin-live-metrics.test.mjs`. Pending remote push to project ref `bljscjzpycbzkubyyfrq`: `supabase/migrations/20261112000007_admin_live_metrics_and_rls_fixes.sql` and updated `supabase/functions/get-private-asset-url`.
- **Recommended Next Step**: Operators must execute `supabase link --project-ref bljscjzpycbzkubyyfrq`, `supabase db push`, and `supabase functions deploy --all` from an authenticated workstation or CI/CD runner. Until Migration 07 is pushed, `adminService.getAdminMetrics()` falls back strictly to authenticated PostgREST `head: true, count: 'exact'` queries (never local demo data).

---

## 2. Background Task Automation & Scheduling

### Issue 2.1: Automated 7-Day Hold Expiration Requires External Cron Trigger
- **Affected Module**: `supabase/functions/expire-reservations/index.ts`, `expire_pending_reservations()` stored procedure, `reservationService.ts`.
- **Why it matters**: While the database stored procedure `expire_pending_reservations()` and the Edge Function `expire-reservations` are implemented, hardened, and verified, Supabase Edge Functions do not run continuously on their own without an external invocation mechanism. If no cron job or scheduled webhook triggers the function, holds older than 7 days will not automatically transition to `expired` until a manual or scheduled call occurs.
- **Status**: **CONFIRMED** (Architectural characteristic).
- **Recommended Next Step**: Configure Supabase `pg_cron` in the remote project to invoke the procedure every 10 minutes:
  ```sql
  SELECT cron.schedule(
    'expire-pending-reservations-every-10-mins',
    '*/10 * * * *',
    $$SELECT public.expire_pending_reservations();$$
  );
  ```

---

## 3. Frontend & Map Visualizations

### Issue 3.1: Vector Map Rendering Requires MapTiler Key Configuration
- **Affected Module**: `src/pages/public/StudentHousingMapPage.tsx`, `src/infrastructure/config/mapConfig.ts`.
- **Why it matters**: Interactive MapLibre vector tile rendering uses `VITE_MAPTILER_API_KEY`. When unset, discovery gracefully falls back to structured Dambare / Rimin Gata corridor discovery without breaking booking workflows.
- **Status**: **CONFIRMED** (Configuration dependency).
- **Recommended Next Step**: Configure `VITE_MAPTILER_API_KEY` in deployment environment variables for full vector map tiles.

---

## 4. Cache Synchronization & Admin Live Data Architecture

### Issue 4.1: Admin Console Strict Live Queries vs. Non-Admin Repository Cache
- **Affected Module**: `src/application/services/adminService.ts`, `src/application/hooks/useAdminData.ts`, `src/infrastructure/supabase/supabaseRepository.ts`.
- **Why it matters**: Previously, `adminService` fell back to in-memory seed records on empty tables or query errors. That fallback has been completely removed: all admin pages now require live Supabase queries via `useAdminData` (with mount hydration, manual refresh, throttled tab reactivation, and Supabase Realtime table invalidation), and seed profiles in `SupabaseRepository` are strictly restricted to headless Node.js unit-test execution (`!IS_PROD && typeof window === 'undefined'`).
- **Status**: **RESOLVED** in codebase; awaiting live `supabase db push` on remote instance.

---

## 5. Security & Secret Boundaries

### Issue 5.1: Legacy Firebase Configurations Preserved for Backward Reference
- **Affected Module**: `src/infrastructure/firebase/firebaseConfig.ts`, `firebase-applet-config.json`, `firebase-blueprint.json`.
- **Why it matters**: The codebase uses Supabase as its exclusive production backend. Selected legacy Firebase files remain solely for historical traceability and are ignored at runtime.
- **Status**: **CONFIRMED** (Non-blocking legacy artifacts).
- **Recommended Next Step**: Archive or remove legacy Firebase configuration files once production Supabase deployment and acceptance testing are finalized.
