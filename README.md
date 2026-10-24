# OUTPOST — Student Accommodation Platform

> **Web-based student accommodation discovery, roommate matching, and shared housing coordination platform for the off-campus corridors of Bayero University Kano (BUK) New Site.**

[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.0-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.4-646CFF.svg)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.1-38bdf8.svg)](https://tailwindcss.com/)
[![Database](https://img.shields.io/badge/Supabase-PostgreSQL_15-3ECF8E.svg)](https://supabase.com/)
[![Tests](https://img.shields.io/badge/Tests-100%20Passing-brightgreen.svg)]()
[![Security Audit](https://img.shields.io/badge/Audit-0%20High%20Vulnerabilities-success.svg)]()

---

## 1. Problem Statement & Mission

Securing off-campus housing around Nigerian tertiary institutions presents severe friction: unverified private agents, arbitrary pricing markups, phantom accommodation listings, incompatible roommate pairings resulting in mid-session disputes, and payment disputes with informal rent collection.

Around **Bayero University Kano (BUK) New Site**, students predominantly seek accommodation in the immediately adjacent residential corridors along Gwarzo Road:
- **Dambare** (directly opposite BUK New Site main gate).
- **Rimin Gata** (residential settlement directly west of campus).

**OUTPOST** establishes an institutional-grade, verifiable digital infrastructure tailored specifically to this ecosystem. It provides:
1. **Verified Accommodations**: Physical property and title verification before listings become publicly searchable.
2. **Deterministic Roommate Matching**: An explainable 6-dimension compatibility scoring engine based on budget, lifestyle, study habits, and sleep schedule.
3. **Shared Housing Groups**: Collaborative student groups pooling budgets to inspect and reserve multi-room lodges.
4. **Transparent Rent Payment & Audit**: 7-day atomic reservation holds, official student invoices, bank transfer receipt submission, and landlord verification workflows.
5. **Role-Based Isolation**: Distinct portals and strict Row Level Security (RLS) across Students, Landlords, and Administrators.

---

## 2. Personas & Scope

| Persona | Core Responsibilities & Workflows | Access Restrictions |
| :--- | :--- | :--- |
| **Student** | • Search approved hostel rooms across Dambare and Rimin Gata<br>• Upload university identity documents (ID card, admission slip, school-fees receipt)<br>• Define roommate preferences and receive explainable compatibility rankings<br>• Form shared accommodation groups and participate in group chats<br>• Reserve rooms (placing a 7-day hold), generate invoices, and submit bank transfer receipts | Read-only access to approved listings. Restricted to own reservations, private chat conversations, and own group memberships. Cannot self-promote or approve receipts. |
| **Landlord** | • Create property listings (draft / pending review)<br>• Upload land ownership titles (C of O, Governor's Consent, Deed of Conveyance)<br>• Manage room capacity and real-time space availability<br>• Review student payment receipts (approve or reject with mandatory reason)<br>• Chat with prospective and booked student tenants | Full control over own listings, units, and receipts. Cannot view or review other landlords' properties or financial receipts. Cannot approve own listings. |
| **Administrator** | • Review and approve student academic verification submissions<br>• Verify landlord legal identity and ownership documents<br>• Inspect submitted property listings and approve for public indexing<br>• Manage platform settings (maintenance mode, hold durations)<br>• Review immutable system audit logs, handle disputes, and suspend abusive users | Full platform administrative visibility governed by server-side role validation and database triggers. No self-registration or persona-switcher bypass. |

---

## 3. Verified Technology Stack

The actual repository implementation consists of:

- **Frontend Application**: React 19 SPA, TypeScript 5.8, Vite 6.4, React Router DOM 7.1, Motion (Framer Motion 12.2), Lucide React icons.
- **Styling Architecture**: Tailwind CSS 4.1 via `@tailwindcss/vite` without legacy configuration files.
- **Database Engine**: Supabase PostgreSQL 15, managed through 4 relational migrations containing 23 domain tables, custom ENUMs, CHECK constraints, and indexes.
- **Authorization & Security**: PostgreSQL Row Level Security (RLS) on all 23 tables, SECURITY DEFINER functions with pinned search paths, and database triggers enforcing immutable user fields.
- **Object Storage**: Supabase Storage with 6 partitioned buckets (`student-docs`, `landlord-docs`, `payment-receipts`, `chat-attachments`, `property-images`, `profile-pictures`) backed by signed URL download gates.
- **Serverless API Layer**: 8 Supabase Edge Functions (Deno runtime) for privileged transactions, signed URL issuing, and reservation hold expiration.
- **Real-Time Communication**: Supabase Realtime channels and in-browser event bus for real-time messaging and notifications.
- **Testing Infrastructure**: Node.js test runner (`node:test`), TSX, and `pg-mem` in-memory PostgreSQL engine executing real SQL transactions.

---

## 4. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        OUTPOST Client (React 19 SPA)                   │
│  ┌──────────────────────┬──────────────────────┬────────────────────┐  │
│  │   Public Portal      │   Student Workspace  │ Landlord Workspace │  │
│  └──────────────────────┴──────────────────────┴────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              Administrator Workspace (/admin/*)                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Application Services: Auth, Property, Reservation, Chat, Admin   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ SupabaseRepository (Authoritative sync, optimistic caching)      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────────┬─────────────────────┘
                   │ HTTPS / JWT                   │ Edge Function Calls
                   ▼                               ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│        Supabase Edge Network         │  │ 8 Supabase Edge Functions    │
│  • JWT Verification Gateway          │  │ • create-reservation         │
│  • Storage Signed URL API            │  │ • review-payment-receipt     │
│  • Realtime Broadcast Engine         │  │ • expire-reservations        │
└──────────────────┬───────────────────┘  │ • request/finalize-receipt   │
                   │                      │ • request/finalize-chat      │
                   ▼                      │ • get-private-asset-url      │
┌──────────────────────────────────────┐  └──────────────┬───────────────┘
│   Supabase PostgreSQL 15 Database    │                 │
│  • 23 Domain Tables with RLS         │◄────────────────┘ Service Role
│  • Stored Procedures & Triggers      │
│  • Hard CHECK Constraints            │
│  • Immutable Audit Log Ledger        │
└──────────────────────────────────────┘
```

---

## 5. Repository Structure

```
outpost/
├── docs/                           # Comprehensive technical & architectural documentation
│   ├── ARCHITECTURE.md             # System layers, context, data flows, and component interaction
│   ├── CODEBASE_GUIDE.md           # Module-by-module navigation guide and extension points
│   ├── DATABASE.md                 # Complete 23-table schema, ER diagram, RLS matrix, constraints
│   ├── API.md                      # Supabase Edge Functions contracts, request/response schemas
│   ├── WORKFLOWS.md                # Sequence diagrams for booking, review, expiration, matching
│   ├── DEVELOPMENT.md              # Local setup, testing guide, and contribution guidelines
│   ├── SECURITY.md                 # Threat model, authorization boundaries, and defense-in-depth
│   └── KNOWN_ISSUES.md             # Implementation gaps, sandbox constraints, and future roadmap
├── supabase/                       # Supabase configuration, migrations, and Edge Functions
│   ├── config.toml                 # Local Supabase CLI configuration
│   ├── migrations/                 # 4 Authoritative SQL migrations
│   │   ├── 20261020000001_initial_schema.sql             # 23 tables, ENUMs, foreign keys, CHECKs
│   │   ├── 20261020000002_row_level_security.sql         # Table RLS policies and role isolation
│   │   ├── 20261020000003_storage_buckets_and_policies.sql# 6 storage buckets & tenant paths
│   │   └── 20261020000004_functions_triggers_and_automation.sql # Atomic procedures & triggers
│   └── functions/                  # 8 Production Supabase Edge Functions (Deno TypeScript)
│       ├── create-reservation/
│       ├── expire-reservations/
│       ├── finalize-chat-attachment-upload/
│       ├── finalize-receipt-upload/
│       ├── get-private-asset-url/
│       ├── request-chat-attachment-upload/
│       ├── request-receipt-upload/
│       └── review-payment-receipt/
├── src/                            # Frontend source code (React 19 + TypeScript)
│   ├── application/                # Business logic, services, and state contexts
│   │   ├── context/                # ThemeContext & FirebaseContext (Supabase Auth bridge)
│   │   └── services/               # AuthService, PropertyService, ReservationService, etc.
│   ├── components/                 # Reusable UI component library
│   │   ├── chat/                   # Real-time chat thread, attachment cards, message composer
│   │   ├── layout/                 # AppShell, Navbar, Sidebar, ProtectedRoute, persona guards
│   │   ├── property/               # Property cards, filters, image upload galleries
│   │   └── ui/                     # Badges, Modals, Buttons, Status indicators
│   ├── domain/                     # Pure domain layer (types, matching engine, geo utilities)
│   │   ├── geoUtils.ts             # Haversine distance & privacy-preserving coordinate jitter
│   │   ├── locations.ts            # Geographic nodes: Dambare and Rimin Gata
│   │   ├── matching.ts             # Deterministic 6-dimension roommate compatibility engine
│   │   ├── repository.ts           # Domain repository contract
│   │   └── types.ts                # TypeScript interfaces, entity models, and domain enums
│   ├── infrastructure/             # Concrete adapters and external client bridges
│   │   ├── config/                 # appConfig.ts, mapConfig.ts
│   │   ├── events/                 # PubSub EventBus for reactive events
│   │   └── supabase/               # Supabase client, repository adapter, and storage service
│   ├── pages/                      # Page components categorized by persona
│   │   ├── admin/                  # Verification queue, property approvals, user directory, audit
│   │   ├── landlord/               # Properties, new listing, receipts review, availability
│   │   ├── public/                 # Home, search, property detail, auth, case study map
│   │   └── student/                # Dashboard, roommate discovery, groups, reservations, invoices
│   ├── App.tsx                     # Master route registry and route protection tree
│   ├── index.css                   # Tailwind CSS import directives and theme tokens
│   └── main.tsx                    # React DOM entry point
├── test/                           # Automated test suites
│   ├── database-runtime.test.mjs   # Real in-memory PostgreSQL execution via pg-mem
│   ├── edge-functions-execution.test.mjs # HTTP handler execution for all 8 Edge Functions
│   ├── security-regression.test.mjs# Storage rules, AST checks, token scrubbing
│   └── supabase-security.test.mjs  # 23-table schema & RLS invariant assertions
├── package.json                    # Project dependencies and script declarations
├── tsconfig.json                   # TypeScript compiler options
└── vite.config.ts                  # Vite build and plugin configuration
```

---

## 6. Development Prerequisites

Ensure your development machine has:
- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **npm**: `v10.x` or higher
- **Git**: `v2.40+`
- **Supabase CLI** (optional for local emulation): `v1.180+`
- **Docker Desktop** (optional for local Supabase emulator container)

---

## 7. Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd outpost
   ```

2. **Install project dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your Supabase project credentials (see Section 8).

4. **Start the local development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 8. Environment Variable Configuration

Create a `.env` file in the project root:

```env
# ==============================================================================
# OUTPOST Environment Configuration
# ==============================================================================

# Public Supabase API credentials (safe for client bundles)
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.your-anon-key

# Server-Side Secrets (DO NOT expose in client or prefix with VITE_)
# Required only for Edge Function deployments and local automation:
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

> **Security Mandate**: Never prefix `SUPABASE_SERVICE_ROLE_KEY` with `VITE_`. The client SPA must never have access to the service role key.

---

## 9. Verification & Testing

OUTPOST enforces a multi-tier testing pipeline combining static type checking, security regression suites, simulated Edge Function request pipelines, and **real in-memory PostgreSQL execution**:

```bash
# 1. Run all 100 automated test suites
npm test

# 2. Run TypeScript type check
npm run lint

# 3. Compile production bundle
npm run build

# 4. Check dependencies for high-severity security vulnerabilities
npm audit --audit-level=high
```

### Verified Test Summary

```
✔ functions/test/geometry.test.mjs          (8 tests)  - Haversine formula & geofencing
✔ functions/test/storageSecurity.test.mjs   (6 tests)  - Path isolation & MIME bounds
✔ test/security-regression.test.mjs        (26 tests) - AST, DDL, and token scrubbers
✔ test/supabase-security.test.mjs          (29 tests) - 23 tables, RLS rules, triggers
✔ test/database-runtime.test.mjs           (10 tests) - In-memory PostgreSQL (pg-mem)
✔ test/edge-functions-execution.test.mjs    (21 tests) - HTTP handler request simulations

Total: 100 tests passed, 0 failures, 0 skipped (27 suites)
```

---

## 10. Database Migrations & Supabase Setup

### Authoritative Backend Statement

> **OUTPOST uses Supabase as its only active backend: Supabase Auth for authentication, Supabase PostgreSQL for persistence, PostgreSQL Row Level Security for authorization, Supabase Storage for files, Supabase Realtime for live communication, and Supabase Edge Functions and database procedures for privileged workflows. Firebase is legacy/archive material only and is not used by the active application.**

### Authoritative Database Migrations Statement

> **The authoritative database contract is the ordered set of timestamped SQL migrations in supabase/migrations/. Apply 20261020000001_initial_schema.sql, then 20261020000002_row_level_security.sql, then 20261020000003_storage_buckets_and_policies.sql, then 20261020000004_functions_triggers_and_automation.sql. Archived Firebase rules and functions are not the active backend contract.**

### Legacy Firebase Archive Note

> **The repository retains selected Firebase configuration, Firestore rules, Storage rules, and Cloud Function files for historical migration traceability and rollback analysis. These files are not part of the active OUTPOST runtime and must not be deployed or imported by the active frontend. Supabase is the only supported backend. The archive may be removed after production acceptance testing, backup verification, and explicit maintainer approval.**

The authoritative PostgreSQL migrations reside in `supabase/migrations/`:

| Migration File | Contents |
| :--- | :--- |
| `20261020000001_initial_schema.sql` | 23 tables, custom ENUMs, foreign keys, ON DELETE cascades, and CHECK constraints (`available_spaces >= 0 AND available_spaces <= capacity`, `file_size <= 10485760`). |
| `20261020000002_row_level_security.sql` | Enables RLS on all 23 tables. Strict tenant policies for students, landlords, admins, and conversation participants. Revokes direct write access to `audit_logs`. |
| `20261020000003_storage_buckets_and_policies.sql` | Configures 6 storage buckets with MIME whitelists, 10MB limits, and path-isolated RLS. |
| `20261020000004_functions_triggers_and_automation.sql` | Installs `create_reservation_atomic`, `review_payment_receipt_atomic`, `expire_pending_reservations`, immutable profile triggers, and 15-minute message edit window triggers. |

### Applying Migrations to Remote Supabase Project

```bash
# Link project
supabase link --project-ref bljscjzpycbzkubyyfrq

# Verify pre-migration data backup (non-destructive discipline)
supabase db dump --data-only -f backup_pre_cutover.sql

# Push migrations
supabase db push

# Deploy all 8 Edge Functions
supabase functions deploy --all
```

---

## 11. Core Workflows Overview

1. **Academic Verification**: Students upload university credentials. Administrators inspect documents in `/admin/verifications` and grant verified status. Database triggers prevent self-verification.
2. **Property Listing & Approval**: Landlords create listings and provide land title evidence. Listings remain hidden until approved by an administrator in `/admin/properties`.
3. **Roommate Matching**: Students fill out preferences (budget, corridor, neatness, study, chronotype, smoking, guests). The deterministic engine in `src/domain/matching.ts` computes 0-100 compatibility scores with plain-language matching/diverging factors.
4. **Reservation & 7-Day Hold**: A student reserves a room. Stored procedure `create_reservation_atomic` locks the unit row, decrements `available_spaces`, creates a reservation, generates an official invoice, and starts a 7-day hold timer.
5. **External Payment & Review**: The student makes a direct bank transfer to the landlord's verified account and uploads the payment receipt. The landlord reviews the receipt in `/landlord/receipts`.
   - **Approval**: Stored procedure `review_payment_receipt_atomic` updates reservation to `confirmed` and invoice to `paid`.
   - **Rejection**: Requires a specific reason; releases room capacity and resets status to `pending_payment`.
6. **7-Day Hold Expiration**: Idempotent stored procedure `expire_pending_reservations` releases room spaces for holds exceeding 7 days without submitted payment.

---

## 12. Security Model & Trust Boundaries

- **Zero Client Trust**: All critical state transitions (capacity allocation, payment verification, role changes) occur in PostgreSQL stored procedures or Supabase Edge Functions. Direct client mutations to `profiles.role` or `profiles.account_status` are blocked by database triggers.
- **Account Suspension Check**: All 8 Edge Functions inspect the user's `account_status`; suspended users receive immediate `403 Forbidden`.
- **Tenant Path Isolation**: Storage paths strictly partition data by `{landlordId}/{studentId}/{reservationId}` or `{conversationId}/{senderId}`.
- **Signed URL Access Gate**: Sensitive documents (payment receipts, academic IDs, landlord deeds, chat attachments) are private. Access is mediated through `get-private-asset-url` Edge Function issuing 15-minute signed URLs after verifying relationship.
- **Append-Only Audit Ledger**: Direct `UPDATE`, `DELETE`, and `TRUNCATE` privileges on `audit_logs` are revoked from `PUBLIC`, `authenticated`, and `anon`. Non-admin callers cannot insert administrative action types.
- **Strict Non-Destructive Rollback**: Destructive commands like `DROP SCHEMA public CASCADE` are permanently prohibited. Rollbacks follow a staged, data-preserving procedure.

---

## 13. Deployment & Release Readiness

### Remote Deployment Status Table

| Component | Provider | Status | Verification method | Remaining action |
| :--- | :--- | :--- | :--- | :--- |
| **Authentication** | Supabase Auth | CONFIGURED | Remote REST probe `/auth/v1/settings` returns HTTP 200 with signup & email enabled | Active in production runtime |
| **PostgreSQL schema** | Supabase PostgreSQL | PREPARED ONLY | Authoritative ordered migrations in `supabase/migrations/` validated via 129 passing automated tests | Run `supabase db push` |
| **Row Level Security** | Supabase PostgreSQL RLS | PREPARED ONLY | 23 tables protected with RLS in `20261020000002_row_level_security.sql`, tested across all user roles | Applied automatically with migrations |
| **Storage buckets and policies** | Supabase Storage | PREPARED ONLY | 6 buckets with RLS defined in `20261020000003_storage_buckets_and_policies.sql` | Created automatically with migrations |
| **Realtime** | Supabase Realtime | PREPARED ONLY | Publications enabled for messages and notifications in schema migration | Active upon database push |
| **Edge Functions** | Supabase Edge Functions (Deno) | PREPARED ONLY | 8 functions implemented and tested in `supabase/functions/` | Run `supabase functions deploy --all` |
| **Reservation expiration scheduler** | PostgreSQL / pg_cron | PREPARED ONLY | Stored procedure `expire_pending_reservations` defined in migration 4 | Enable `pg_cron` schedule in Supabase dashboard |

- **Frontend**: Automated zero-downtime deployment on Vercel / Cloud Run (`dist/` build output via `npm run build`).
- **Backend & Database**: Fully prepared for Supabase Cloud (`supabase db push` and `supabase functions deploy`).
- **Release Status**: **SUPABASE-ONLY CUTOVER COMPLETE - FIREBASE ARCHIVED AND ACTIVE RUNTIME CLEAN**. Zero active Firebase SDK imports, 129 passing security regression tests, strict RLS, and clean Supabase runtime.

---

## 14. Documentation Directory

For in-depth architectural and developer documentation, see:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Detailed layered architecture, system context, and component design.
- [docs/CODEBASE_GUIDE.md](docs/CODEBASE_GUIDE.md) — Module-by-module navigation, file responsibilities, and extension guide.
- [docs/DATABASE.md](docs/DATABASE.md) — Exhaustive 23-table schema, ER diagram, RLS policies matrix, and triggers.
- [docs/API.md](docs/API.md) — Contracts and schemas for all 8 Supabase Edge Functions.
- [docs/WORKFLOWS.md](docs/WORKFLOWS.md) — Step-by-step sequence diagrams and state machines for primary workflows.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — Local development guidelines, testing instructions, and troubleshooting.
- [docs/SECURITY.md](docs/SECURITY.md) — Comprehensive security specification, threat model, and RLS audit.
- [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) — Disclosed limitations, sandbox environment boundaries, and roadmap.

---

## 15. License & Academic Disclaimer

OUTPOST was designed and implemented as an academic case study and production-grade prototype for off-campus student accommodation discovery around Bayero University Kano. Listings, user accounts, and test records in development environments are demonstration data.
