# OUTPOST Developer & Contributor Guide

> **Practical guide for local onboarding, development workflows, testing discipline, migration authoring, and troubleshooting.**

## Authoritative Backend Statement

> **OUTPOST uses Supabase as its only active backend: Supabase Auth for authentication, Supabase PostgreSQL for persistence, PostgreSQL Row Level Security for authorization, Supabase Storage for files, Supabase Realtime for live communication, and Supabase Edge Functions and database procedures for privileged workflows. Firebase is legacy/archive material only and is not used by the active application.**

## Authoritative Database Migrations Statement

> **The authoritative database contract is the ordered set of timestamped SQL migrations in supabase/migrations/. Apply 20261020000001_initial_schema.sql, then 20261020000002_row_level_security.sql, then 20261020000003_storage_buckets_and_policies.sql, then 20261020000004_functions_triggers_and_automation.sql. Archived Firebase rules and functions are not the active backend contract.**

## Legacy Firebase Archive Note

> **The repository retains selected Firebase configuration, Firestore rules, Storage rules, and Cloud Function files for historical migration traceability and rollback analysis. These files are not part of the active OUTPOST runtime and must not be deployed or imported by the active frontend. Supabase is the only supported backend. The archive may be removed after production acceptance testing, backup verification, and explicit maintainer approval.**

---

## 1. Prerequisites & Environment Setup

Ensure the following tools are available on your workstation:

- **Node.js**: `v20.x` or `v22.x` (LTS)
- **npm**: `v10.x+`
- **Git**: `v2.40+`
- **Docker Desktop** (optional, for running local Supabase emulator)
- **Supabase CLI** (optional, `brew install supabase/tap/supabase` or `npm install -g supabase`)

### Initial Workspace Setup

```bash
# 1. Clone repository
git clone <repository-url>
cd outpost

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env
```

Edit `.env` to include your Supabase project parameters:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI...
```

---

## 2. Running the Application Locally

```bash
# Start Vite development server
npm run dev
```

The application starts on `http://localhost:3000`. Hot Module Replacement (HMR) or page refresh will update changes instantly.

---

## 3. Running Automated Test Suites

OUTPOST maintains a multi-layered automated test suite ensuring database integrity, security boundaries, and edge function correctness without requiring live cloud infrastructure:

```bash
# Run all 100 tests across 6 test files:
npm test
```

### Breakdown of Test Files

1. **`test/database-runtime.test.mjs`**:
   - Uses `pg-mem` to simulate a real PostgreSQL engine.
   - Tests: Negative unit spaces prohibition, capacity overflow bounds, atomic reservation hold execution, rollback on failure, 7-day expiration inventory restoration, and receipt review race conditions.
2. **`test/edge-functions-execution.test.mjs`**:
   - Simulates real HTTP `Request`/`Response` dispatch against all 8 Edge Functions.
   - Tests: 401 unauthenticated requests, 403 account suspension, 400 validation failures, and 200 successful state updates.
3. **`test/security-regression.test.mjs`**:
   - Evaluates SQL migrations and storage security rules for path isolation and token scrubbing.
4. **`test/supabase-security.test.mjs`**:
   - Asserts the structural integrity of 23 tables, RLS policies, and PostgreSQL triggers.
5. **`functions/test/geometry.test.mjs`**:
   - Verifies the Haversine formula and BUK Kano campus geofencing logic.
6. **`functions/test/storageSecurity.test.mjs`**:
   - Asserts storage path isolation and MIME type whitelist enforcement.

### Static Analysis & Production Build Checks

```bash
# Run TypeScript compilation check (no emit)
npm run lint

# Build production bundle
npm run build

# Run high-severity dependency vulnerability audit
npm audit --audit-level=high
```

---

## 4. Database Migrations Workflow

All database migrations reside in `supabase/migrations/` and follow the timestamp format:

`YYYYMMDDHHMMSS_<descriptive_name>.sql`

### Strict Non-Destructive Migration Rules
- **NEVER** use `DROP SCHEMA public CASCADE`, `DROP TABLE ... CASCADE`, or `TRUNCATE` in migrations or rollback scripts.
- Schema changes must be backward-compatible:
  - Add new columns as nullable or with safe defaults.
  - Deprecate old columns rather than dropping them immediately.
  - Replace triggers or functions safely using `CREATE OR REPLACE FUNCTION`.

### Authoring a New Migration
1. Create a new file in `supabase/migrations/` with the current timestamp:
   ```bash
   touch supabase/migrations/20261023000001_add_feature_x.sql
   ```
2. Write idempotent SQL:
   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns 
       WHERE table_name = 'properties' AND column_name = 'virtual_tour_url'
     ) THEN
       ALTER TABLE public.properties ADD COLUMN virtual_tour_url TEXT;
     END IF;
   END $$;
   ```
3. Update `test/database-runtime.test.mjs` and `test/supabase-security.test.mjs` to assert the new column or constraint.
4. Run `npm test` to verify the migration against `pg-mem`.

---

## 5. Adding New Application Services & Components

### Convention for Adding a Service
1. Place domain types in `src/domain/types.ts`.
2. Add pure calculation logic in `src/domain/` (e.g. `src/domain/myAlgorithm.ts`).
3. Create an application service in `src/application/services/myService.ts`:
   - Delegate data persistence to `repository` (`src/infrastructure/repositories`).
   - Use `invokeEdgeFunction()` for privileged server-side actions.
4. Export the service singleton at the bottom of the file:
   ```typescript
   export const myService = new MyService();
   ```

### Convention for Adding a Persona Page
1. Create the page under the appropriate persona directory:
   - `src/pages/student/` for student features.
   - `src/pages/landlord/` for landlord features.
   - `src/pages/admin/` for admin features.
   - `src/pages/public/` for unauthenticated views.
2. Register the route in `src/App.tsx` wrapped in `ProtectedRoute`:
   ```tsx
   <Route
     path="/student/my-page"
     element={
       <ProtectedRoute requiredRole="student">
         <MyStudentPage />
       </ProtectedRoute>
     }
   />
   ```

---

## 6. Diagnosing Common Development Issues

| Symptom | Probable Cause | Diagnostic & Solution |
| :--- | :--- | :--- |
| **"Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')"** | Code is executing in Node.js test runner where `import.meta.env` is not injected by Vite. | Use the safe fallback pattern established in `src/infrastructure/supabase/supabaseClient.ts` checking `(import.meta as any)?.env \|\| process.env`. |
| **"Unit is currently full or unavailable"** | Unit `available_spaces` has reached 0. | Check unit row in database or wait for the 7-day expiration worker to release unverified holds. |
| **"Forbidden: Account is suspended"** | The active user account has `account_status = 'suspended'`. | Edge Functions strictly reject suspended accounts with 403. Check user record in `/admin/users` or database. |
| **"Message edit window has expired"** | Attempting to edit a chat message older than 15 minutes. | This is an enforced business and database trigger rule. Edits must occur within 15 minutes of message creation. |
| **"File size exceeds 10MB limit"** | Uploaded file exceeds the storage bucket limit. | Verify file size before uploading; compress images or PDFs to under 10 MB (or 5 MB for student verification documents). |
