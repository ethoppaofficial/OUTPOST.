# OUTPOST Known Issues & Technical Limitations

> **Documented gaps, environment constraints, and technical roadmap items identified during system audit and verification.**

---

## 1. Sandbox Environment & Deployment Constraints

### Issue 1.1: Supabase CLI and Docker Daemon Unavailable in Evaluation Container
- **Affected Module**: Local infrastructure tooling and live database deployment.
- **Why it matters**: The local development container lacks a running Docker daemon and the `supabase` CLI binary (`which supabase docker` exits with code 1). Consequently, live execution of `supabase db push` or `supabase functions deploy` cannot run autonomously within this specific sandbox container.
- **Status**: **CONFIRMED** (Environmental constraint).
- **Workaround & Verification Applied**: All SQL DDL, CHECK constraints, stored procedures, and triggers were verified via real runtime execution in Node.js using `pg-mem` in `test/database-runtime.test.mjs`. All 8 Edge Function handlers were verified via HTTP request simulations in `test/edge-functions-execution.test.mjs`.
- **Recommended Next Step**: Operators must execute deployment commands (`supabase link`, `supabase db push`, `supabase functions deploy --all`) from an external workstation or CI/CD runner equipped with Docker and Supabase CLI `v1.180+`.

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

### Issue 3.1: Vector Map Rendering Deferred in Favor of Text-Based Corridor Discovery
- **Affected Module**: `src/pages/public/StudentHousingMapPage.tsx`, `src/infrastructure/config/mapConfig.ts`.
- **Why it matters**: To prevent reliance on external commercial map APIs (e.g. Mapbox / Google Maps billing keys) during initial MVP rollout, student accommodation discovery is centered on structured textual corridor search (Dambare vs Rimin Gata around BUK New Site). The map component renders a lightweight demonstration view with geofence boundaries.
- **Status**: **CONFIRMED** (Approved MVP scope decision).
- **Recommended Next Step**: In Phase 2, integrate a self-hosted MapLibre GL vector tile server or configure an official production Mapbox token to render full interactive lodge markers.

---

## 4. Cache Synchronization & Multi-Tab Concurrency

### Issue 4.1: In-Memory Cache Depends on Realtime Channels for Multi-Tab Sync
- **Affected Module**: `src/infrastructure/supabase/supabaseRepository.ts`.
- **Why it matters**: `SupabaseRepository` maintains an in-memory synchronized entity cache to provide instantaneous local UI rendering without waiting for network roundtrips. While mutations are persisted to Supabase, concurrent modifications occurring in another browser tab or device rely on Supabase Realtime broadcast events. If the user is on an intermittent mobile network and loses WebSocket connectivity, local cache updates from other devices may be delayed until the next page refresh.
- **Status**: **CONFIRMED** (Trade-off for synchronous UI responsiveness).
- **Recommended Next Step**: Implement an automated cache re-validation polling interval (e.g. every 60 seconds) as a fallback when WebSocket connection state drops.

---

## 5. Security & Secret Boundaries

### Issue 5.1: Legacy Firebase Configurations Preserved for Backward Reference
- **Affected Module**: `src/infrastructure/firebase/firebaseConfig.ts`, `firebase-applet-config.json`, `firebase-blueprint.json`.
- **Why it matters**: The codebase has cut over to Supabase as its exclusive production backend. However, legacy Firebase configuration files remain in the repository for historical traceability. While client storage services have been redirected to `supabaseStorageService`, these unused Firebase configuration files could cause confusion for new developers.
- **Status**: **CONFIRMED** (Non-blocking legacy artifacts).
- **Recommended Next Step**: Archive or remove legacy Firebase JSON configuration files once production Supabase deployment and customer acceptance testing are finalized.
