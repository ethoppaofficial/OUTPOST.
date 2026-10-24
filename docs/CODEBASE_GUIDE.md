# OUTPOST Codebase Navigation Guide

> **Practical module-by-module navigation, architectural responsibilities, dependencies, and developer extension guide.**

## Authoritative Backend Statement

> **OUTPOST uses Supabase as its only active backend: Supabase Auth for authentication, Supabase PostgreSQL for persistence, PostgreSQL Row Level Security for authorization, Supabase Storage for files, Supabase Realtime for live communication, and Supabase Edge Functions and database procedures for privileged workflows. Firebase is legacy/archive material only and is not used by the active application.**

## Authoritative Database Migrations Statement

> **The authoritative database contract is the ordered set of timestamped SQL migrations in supabase/migrations/. Apply 20261020000001_initial_schema.sql, then 20261020000002_row_level_security.sql, then 20261020000003_storage_buckets_and_policies.sql, then 20261020000004_functions_triggers_and_automation.sql. Archived Firebase rules and functions are not the active backend contract.**

## Legacy Firebase Archive Note

> **The repository retains selected Firebase configuration, Firestore rules, Storage rules, and Cloud Function files for historical migration traceability and rollback analysis. These files are not part of the active OUTPOST runtime and must not be deployed or imported by the active frontend. Supabase is the only supported backend. The archive may be removed after production acceptance testing, backup verification, and explicit maintainer approval.**

---

## 1. Directory Overview & Organization

The OUTPOST repository follows a clean separation of concerns:

```
src/
├── domain/               # Core business entities, calculation models, and types (Zero external dependencies)
├── application/          # Use cases, application services, and React context providers
├── infrastructure/       # Concrete adapters for Supabase, configuration, and event buses
├── components/           # Reusable UI component hierarchy (layout, ui, property, chat)
└── pages/                # Route views partitioned by persona (public, student, landlord, admin)

supabase/
├── migrations/           # Authoritative SQL schema, RLS policies, and stored procedures
└── functions/            # 8 Supabase Edge Functions (Deno runtime)

test/                     # Automated regression suites, in-memory PostgreSQL tests, and handler mocks
```

---

## 2. Domain Layer (`src/domain/`)

The domain layer encapsulates the core business rules of OUTPOST. It does not import anything from `application/`, `infrastructure/`, `components/`, or external frameworks.

### `src/domain/types.ts`
- **What it does**: Defines all TypeScript interfaces, entity models, and status unions across the platform.
- **Why it exists**: Serves as the single source of truth for domain data structures (e.g. `User`, `Property`, `UnitOrRoom`, `Reservation`, `Invoice`, `PaymentReceipt`, `ChatMessage`, `AuditLog`).
- **Dependencies**: None.
- **Who uses it**: Every application service, repository, component, and page in the project.
- **Debugging / Extending**: Look here when adding new entity fields, status values (e.g. new verification status), or updating entity contracts.

### `src/domain/matching.ts`
- **What it does**: Computes an explainable, deterministic 0–100 compatibility rating between two students' preferences.
- **Why it exists**: Enables students looking for roommates to evaluate mutual suitability across budget, corridor, cleanliness, study habits, sleep schedule, noise tolerance, smoking, and guests.
- **Dependencies**: `src/domain/types.ts` (`RoommatePreference`).
- **Who uses it**: `roommateService.ts`, `RoommatesPage.tsx`, `UserSearchPage.tsx`.
- **Debugging / Extending**: Adjust weights or scoring thresholds in `calculateCompatibility()`. Notice that this is pure, deterministic arithmetic without external ML models.

### `src/domain/geoUtils.ts`
- **What it does**: Performs Haversine distance calculations, geohash encoding, and privacy-preserving coordinate obfuscation (`computePublicCoordinates`).
- **Why it exists**: Protects private landlord property gates from unsolicited student loitering by applying deterministic ~30–50m jitter or street-level rounding to public listings.
- **Dependencies**: `src/domain/types.ts` (`HousingArea`, `LocationPrecision`).
- **Who uses it**: `propertyService.ts`, `StudentHousingMapPage.tsx`, `PropertyDetailPage.tsx`.
- **Debugging / Extending**: Modify `computePublicCoordinates()` when altering coordinate privacy policies or adding new geographical boundaries.

### `src/domain/locations.ts`
- **What it does**: Contains static geographic reference nodes for the BUK New Site off-campus corridors: Dambare and Rimin Gata.
- **Why it exists**: Enforces platform geographic boundaries along Gwarzo Road in Kano.
- **Dependencies**: `src/domain/types.ts` (`HousingLocation`).
- **Who uses it**: `propertyService.ts`, `PropertiesPage.tsx`, `HomePage.tsx`.
- **Debugging / Extending**: Add new student corridors (e.g. Kabuga, Rijiyar Zaki) by appending records to `HOUSING_LOCATIONS`.

### `src/domain/repository.ts`
- **What it does**: Re-exports the authoritative repository contract type `IRepository`.
- **Why it exists**: Decouples application services from concrete repository implementations.
- **Dependencies**: `src/infrastructure/supabase/supabaseRepository.ts`.

---

## 3. Application Services & Context Layer (`src/application/`)

The application layer implements use-case logic and mediates between the UI and data infrastructure.

### Services (`src/application/services/`)

| File | Primary Responsibility | Key Methods | External Calls / Dependencies |
| :--- | :--- | :--- | :--- |
| **`authService.ts`** | User registration, session serialization, profile lookups, role resolution | `login()`, `register()`, `getSession()`, `getCurrentUser()` | `IRepository`, `SupabaseRepository` |
| **`propertyService.ts`** | Accommodation search, corridor filtering, unit capacity aggregation, listing creation | `searchProperties()`, `getPropertyById()`, `saveProperty()`, `getNearbyProperties()` | `IRepository`, `geoUtils.ts`, `locations.ts` |
| **`reservationService.ts`** | 7-day hold creation, invoice generation, bank transfer receipt upload and review | `createReservation()`, `uploadPaymentReceipt()`, `reviewPaymentReceipt()`, `cancelReservation()` | `IRepository`, `invokeEdgeFunction('review-payment-receipt')` |
| **`verificationService.ts`** | Student academic credential and landlord ownership document validation | `uploadStudentDocument()`, `reviewStudentDocument()`, `uploadLandlordDocument()` | `IRepository`, `storageService.ts` |
| **`roommateService.ts`** | Student preferences, compatibility matching, request dispatches, accommodation groups | `getSuggestedMatches()`, `sendRequest()`, `respondToRequest()`, `createGroup()` | `IRepository`, `matching.ts` |
| **`chatService.ts`** | Real-time messaging, conversation threads, attachments, 15-minute edit window | `getMessages()`, `sendMessage()`, `editMessage()`, `sendAttachmentMessage()` | `IRepository`, `eventBus.ts`, `storageService.ts` |
| **`adminService.ts`** | Administrative verification queues, listing approvals, user directory, audit inspection | `getDashboardData()`, `approveProperty()`, `suspendUser()`, `getAuditLogs()` | `supabaseClient.ts`, `IRepository` |
| **`notificationService.ts`** | In-app notification creation, unread counts, status toggling | `getNotifications()`, `markAsRead()`, `createNotification()` | `IRepository`, `eventBus.ts` |

### Context Providers (`src/application/context/`)

- **`FirebaseContext.tsx`**: Central authentication context provider. **Architecture note:** While retaining the legacy name `FirebaseContext` and `useFirebase()` for component import stability, this provider is connected directly to Supabase Auth (`supabase.auth.onAuthStateChange`), profile querying from PostgreSQL, and session maintenance checks.
- **`ThemeContext.tsx`**: Provides dynamic light/dark theme state with persistence to `localStorage` and CSS class toggling on the `document.documentElement` element.

---

## 4. Infrastructure Layer (`src/infrastructure/`)

Implements concrete technology adapters for Supabase, object storage, and event broadcasting.

### `src/infrastructure/supabase/supabaseClient.ts`
- **What it does**: Instantiates the Supabase client (`createClient`) and exports `invokeEdgeFunction()`.
- **Why it exists**: Centralizes configuration, session auto-refresh, and edge function invocations.
- **Environment Handling**: Safely checks `import.meta.env` (Vite) with a fallback to `process.env` (Node test environment).
- **Debugging / Extending**: Inspect this file if Supabase API connection failures or Edge Function invocation errors occur.

### `src/infrastructure/supabase/supabaseRepository.ts`
- **What it does**: Authoritative implementation of `IRepository` interfacing with 23 Supabase PostgreSQL tables.
- **Why it exists**: Provides an in-memory synchronized entity cache for instantaneous UI rendering, while dispatching mutations to Supabase PostgreSQL and Edge Functions.
- **Realtime Integration**: Subscribes to Supabase Realtime channels for table changes on `messages` and `notifications`.
- **Debugging / Extending**: When adding new database columns or tables, update the corresponding mapping methods (`mapProfileRow`, `mapPropertyRow`, etc.) in this file.

### `src/infrastructure/supabase/supabaseStorageService.ts`
- **What it does**: Manages file uploads across 6 partitioned Supabase Storage buckets and delegates private downloads to `get-private-asset-url`.
- **Why it exists**: Enforces file size limits, MIME type validation, file name sanitization, and path isolation.
- **Debugging / Extending**: Check this file for file upload size restrictions or storage bucket path conventions.

### `src/infrastructure/events/eventBus.ts`
- **What it does**: Lightweight in-browser PubSub event bus.
- **Why it exists**: Allows decoupled cross-component notifications (e.g. incoming chat message triggering unread badge update).

### `src/infrastructure/config/appConfig.ts`
- **What it does**: Validates runtime environment variables and sets `backendMode = 'supabase'`.
- **Why it exists**: Prevents silent startup in production when required backend connection parameters are missing.

---

## 5. UI Components & Layout Layer (`src/components/`)

### Layout Components (`src/components/layout/`)
- **`AppShell.tsx`**: Main application frame containing navigation header, sidebar navigation, persona badge, and responsive container.
- **`Navbar.tsx`**: Top header with logo, navigation links, theme toggle, and user profile avatar.
- **`Sidebar.tsx`**: Left navigation drawer displaying persona-specific menu items (Student, Landlord, Admin).
- **`ProtectedRoute.tsx`**: Route guard checking authentication state, email verification, and role permissions. Redirects unauthorized users.

### UI Primitives (`src/components/ui/`)
- **`Badge.tsx`**: Status badges for reservations (`pending_payment`, `confirmed`, `expired`), receipts, and user roles.
- **`Modal.tsx`**: Accessible dialog component for confirmation prompts, receipt upload modals, and rejection forms.
- **`BackendStatusBanner.tsx`**: Non-intrusive status indicator displaying backend connection status.

### Feature Components (`src/components/property/`, `src/components/chat/`)
- **`PropertyCard.tsx`**: Listing presentation card with price, corridor badge, capacity counter, and verified landlord tag.
- **`PropertyFilterBar.tsx`**: Corridor filter (Dambare/Rimin Gata), price range slider, and accommodation type dropdown.
- **`PropertyImageCaptureUpload.tsx`**: Multi-file uploader with live device camera integration, file validation, and photo gallery preview.
- **`ChatThread.tsx` & `ChatComposer.tsx`**: Message stream, file attachment previews, reply bubbles, and 15-minute edit actions.

---

## 6. Page Components (`src/pages/`)

Grouped by user persona to maintain clean functional boundaries:

### Public Pages (`src/pages/public/`)
- **`HomePage.tsx`**: Landing page with hero search, corridor cards (Dambare / Rimin Gata), and feature highlights.
- **`PropertiesPage.tsx`**: Searchable accommodation catalog with interactive filtering and sorting.
- **`PropertyDetailPage.tsx`**: Full listing breakdown, room availability, landlord verification status, and "Hold Space" booking button.
- **`LoginPage.tsx` & `AdminLoginPage.tsx`**: Role-specific login pages with error feedback.
- **`RegisterPage.tsx`**: Account creation for students and landlords with institutional email guidance.
- **`StudentHousingMapPage.tsx`**: Map-based corridor overview of off-campus settlements around BUK New Site.

### Student Workspace (`src/pages/student/`)
- **`StudentDashboard.tsx`**: Overview of active reservations, roommate requests, and verification status.
- **`StudentVerificationPage.tsx`**: File upload form for academic credentials (ID Card, Admission Letter, Fees Receipt).
- **`RoommatesPage.tsx`**: Roommate discovery feed displaying compatibility match percentages and matching factors.
- **`RoommatePreferencesPage.tsx`**: Questionnaire for budget, cleanliness, sleep schedule, study habits, and house rules.
- **`GroupsPage.tsx` & `GroupDetailPage.tsx`**: Shared accommodation group creation, member management, and group booking.
- **`ReservationsPage.tsx` & `ReservationDetailPage.tsx`**: View 7-day hold timer, download invoice, and upload bank transfer receipt.
- **`InvoicePage.tsx`**: Official printable student invoice with landlord bank details and session breakdown.
- **`ChatPage.tsx`**: Real-time peer-to-peer and group messaging interface.

### Landlord Workspace (`src/pages/landlord/`)
- **`LandlordDashboard.tsx`**: Summary metrics of properties, active tenants, and pending receipt reviews.
- **`LandlordPropertiesPage.tsx` & `NewPropertyPage.tsx`**: Listing management and multi-room lodge listing creation.
- **`ManageAvailabilityPage.tsx`**: Real-time room capacity adjustment and unit maintenance toggles.
- **`LandlordReceiptsPage.tsx`**: Queue for inspecting student transfer receipts and issuing approval or rejection decisions.
- **`LandlordVerificationPage.tsx`**: Legal ownership document upload form.

### Administrator Workspace (`src/pages/admin/`)
- **`AdminDashboard.tsx`**: Platform-wide metrics: total students, total landlords, pending approvals, active holds.
- **`VerificationQueuePage.tsx`**: Queue for approving or rejecting student academic IDs and landlord ownership deeds.
- **`PropertyApprovalsPage.tsx`**: Inspection workflow for reviewing new listing drafts before public publication.
- **`UsersPage.tsx`**: User management directory with account suspension controls.
- **`AdminAuditLogsPage.tsx`**: Immutable ledger of administrative and financial transactions.
- **`AdminSettingsPage.tsx`**: Platform-wide settings (maintenance mode toggle, reservation hold duration).

---

## 7. Database Migrations (`supabase/migrations/`)

Four sequential migrations define the relational schema in PostgreSQL:

1. **`20261020000001_initial_schema.sql`**:
   - Creates custom ENUMs (`user_role`, `account_status`, `verification_status`, etc.).
   - Defines 23 tables with foreign key relationships and strict CHECK constraints (`available_spaces >= 0 AND available_spaces <= capacity`).
   - Creates indexes on foreign keys, geohashes, and status fields.
2. **`20261020000002_row_level_security.sql`**:
   - Enables RLS on all 23 tables.
   - Defines granular tenant policies (`student_id = auth.uid()`, `landlord_id = auth.uid()`, `is_admin()`).
   - Revokes direct `UPDATE`, `DELETE`, and `TRUNCATE` grants on `audit_logs`.
3. **`20261020000003_storage_buckets_and_policies.sql`**:
   - Provisions 6 storage buckets (`student-docs`, `landlord-docs`, `payment-receipts`, `chat-attachments`, `property-images`, `profile-pictures`).
   - Configures MIME type restrictions and 10MB limits.
4. **`20261020000004_functions_triggers_and_automation.sql`**:
   - Implements `create_reservation_atomic` (row lock `SELECT ... FOR UPDATE`, capacity decrement, 7-day hold timer).
   - Implements `review_payment_receipt_atomic` (landlord validation, atomic state transition).
   - Implements `expire_pending_reservations` (idempotent capacity release for timed-out holds).
   - Installs triggers preventing non-admin mutation of `profiles.role` and `account_status`.
   - Installs 15-minute message edit window trigger.

---

## 8. Supabase Edge Functions (`supabase/functions/`)

Implemented in TypeScript for the Deno runtime:

| Edge Function | Endpoint | Method | Security Checks | Primary Action |
| :--- | :--- | :--- | :--- | :--- |
| `create-reservation` | `/functions/v1/create-reservation` | POST | Bearer JWT, account not suspended | Invokes `create_reservation_atomic` |
| `review-payment-receipt` | `/functions/v1/review-payment-receipt` | POST | Bearer JWT, landlord ownership or admin | Invokes `review_payment_receipt_atomic` |
| `expire-reservations` | `/functions/v1/expire-reservations` | POST | Exact service-role key or active admin | Invokes `expire_pending_reservations` |
| `request-receipt-upload` | `/functions/v1/request-receipt-upload` | POST | Bearer JWT, student reservation owner | Generates scoped storage path & upload URL |
| `finalize-receipt-upload` | `/functions/v1/finalize-receipt-upload` | POST | Bearer JWT, path integrity check | Creates `payment_receipts` record |
| `request-chat-attachment-upload` | `/functions/v1/request-chat-attachment-upload` | POST | Bearer JWT, conversation participant | Generates scoped upload session |
| `finalize-chat-attachment-upload` | `/functions/v1/finalize-chat-attachment-upload` | POST | Bearer JWT, sender verification | Creates chat message with attachment |
| `get-private-asset-url` | `/functions/v1/get-private-asset-url` | POST | Bearer JWT, authorization check | Issues 15-minute signed download URL |

---

## 9. Testing Infrastructure (`test/`)

- **`test/database-runtime.test.mjs`**: Uses `pg-mem` to simulate a real PostgreSQL engine in memory. Tests CHECK constraints, negative inventory prevention, concurrent booking races, transaction rollback on failure, 7-day expiration, and receipt review state transitions.
- **`test/edge-functions-execution.test.mjs`**: Runs HTTP `Request`/`Response` simulations for all 8 Edge Functions. Asserts 401 unauthenticated, 403 suspended, 400 validation errors, and 200 successes.
- **`test/security-regression.test.mjs`**: Inspects SQL files, storage rules, ASTs, and token scrubbing functions.
- **`test/supabase-security.test.mjs`**: Verifies schema table declarations, RLS rules, triggers, and stored procedures across the 4 migrations.
