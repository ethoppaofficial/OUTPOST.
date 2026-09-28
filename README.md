# OUTPOST — Off-Campus Student Housing & Roommate Platform (BUK Case Study)

OUTPOST is an off-campus student accommodation discovery, landlord verification, and rule-based roommate compatibility platform focused on **Dambare** and **Rimin Gata**, Kano State, Nigeria, near **Bayero University Kano (BUK) New Campus**.

> **Disclaimer:** OUTPOST is an independent academic case-study platform for off-campus student housing around Bayero University Kano. It is not an official BUK service and does not manage on-campus university hostels. All sample/seed records are fictional demonstration data.

---

## 1. Product Scope & Core Roles

- **Case-Study Geography:** Exclusively serves off-campus student settlements in **Dambare** (opposite BUK New Campus gate along Gwarzo Road) and **Rimin Gata** (west of BUK New Campus off Gwarzo Road), Kano State, Nigeria.
- **Core Roles:**
  1. **Student:** Register/sign in, verify email, submit student verification documents (Student ID, Admission Letter, or School Fees Receipt), browse/filter approved off-campus listings in Dambare and Rimin Gata, configure lifestyle/budget preferences, view explainable rule-based roommate compatibility matches, send/manage roommate requests, join/manage accommodation groups, use direct/group chat, and request 7-day reservation holds with manual bank-transfer receipt upload.
  2. **Landlord:** Register/sign in, submit identity and property ownership verification documents, create/edit/deactivate their own property listings with verified address and map pin selection, inspect 7-day reservation holds for their properties, and approve/reject uploaded payment receipts with reasons.
  3. **Administrator:** Privileged role assigned only via trusted server-side custom claims or admin-controlled Firestore records (never selectable during public registration). Reviews student/landlord verification queues, approves/rejects property listings and location coordinates with audit reasons, oversees disputes, and inspects system audit logs.

---

## 2. Architecture & Modular Repository Layer

```text
src/
├── domain/                  # Core TypeScript interfaces, BUK location constants, GeoJSON utilities, rule-based matching
├── application/             # Domain services (authService, propertyService, reservationService, roommateService, etc.)
├── infrastructure/
│   ├── config/              # Environment configuration, Firebase config validation, MapLibre/MapTiler setup
│   ├── firebase/            # Firebase Auth, Firestore, Storage, and App Check initialization
│   ├── repositories/        # IDataRepository contract with FirebaseRepository & LocalStorageRepository
│   └── mock/                # Fictional BUK (Dambare & Rimin Gata) case-study seed data
├── components/              # Layout shell, ProtectedRoute guards, MapLibre interactive components, UI primitives
└── pages/
    ├── public/              # HomePage, PropertiesPage, PropertyDetailPage, LoginPage, RegisterPage, ForgotPasswordPage
    ├── student/             # StudentDashboard, StudentVerificationPage, RoommatesPage, ReservationsPage, ChatPage, etc.
    ├── landlord/            # LandlordDashboard, LandlordPropertiesPage, NewPropertyPage, LandlordReceiptsPage, etc.
    └── admin/               # AdminDashboard, VerificationQueuePage, PropertyApprovalsPage, UsersPage, AuditLogsPage, etc.
```

---

## 3. Environment Variables

Copy `.env.example` to `.env` and configure your credentials (never commit `.env` or secret keys):

```bash
# Backend Selection ('firebase' for production/live Firebase, 'mock' for local offline testing)
VITE_USE_BACKEND=firebase
VITE_ENABLE_DEMO_MODE=false

# Firebase Web SDK Configuration
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Optional Firebase App Check (reCAPTCHA Enterprise or v3 site key)
VITE_FIREBASE_APP_CHECK_KEY=

# MapTiler API Key for MapLibre GL JS (restrict by domain & quota in MapTiler Cloud)
VITE_MAPTILER_API_KEY=your_maptiler_public_key
```

---

## 4. Security & Data Integrity

- **No Fake Signed-In State:** Fresh visitors always start signed out on the public entry pages (`/`, `/properties`, `/login`, `/register`, `/forgot-password`). Demo persona switchers and quick-fill credentials are removed.
- **Role & Route Protection:** Public registration only permits `student` or `landlord` roles. `ProtectedRoute` enforces authentication and role authorization, redirecting unauthenticated users to `/login` (preserving their intended destination) and unauthorized roles to `/unauthorized`.
- **Firestore & Storage Rules:** Deny-by-default rules (`firestore.rules` and `storage.rules`) enforce ownership, role checks, active account checks, private verification document paths (`student-docs/`, `landlord-docs/`, `receipts/`), and separate property approval (`verificationStatus == 'approved'`) from location verification (`locationVerificationStatus == 'verified'`).
- **7-Day Hold Expiry & Transactions:** Cloud Functions (`functions/src/index.ts`) provide transactional reservation creation, receipt review, and scheduled idempotent expiration of unpaid 7-day reservation holds.

---

## 5. Development, Verification & Deployment

```bash
# Install dependencies
npm install

# Run development server (port 3000)
npm run dev

# Type-check and build production bundle
npm run lint
npm run build

# Deploy Firebase Security Rules, Indexes, Functions, and Hosting
firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting
```
