# OUTPOST: Architecture & Technical Plan

## System Overview
OUTPOST is a specialized accommodation discovery and student housing management platform designed for the Nigerian tertiary education market (with configurable locale, NGN currency, and expandable campus nodes).

## Layered Architecture
```
src/
├── domain/                  # Provider-neutral core domain
│   ├── types.ts             # Logical entities & status enums
│   ├── matching.ts          # Explainable weighted compatibility scoring algorithm
│   └── validation.ts        # Pure domain validation rules
├── application/             # Use cases and domain service facades
│   └── services/
│       ├── authService.ts
│       ├── propertyService.ts
│       ├── verificationService.ts
│       ├── reservationService.ts
│       ├── roommateService.ts
│       ├── chatService.ts
│       ├── notificationService.ts
│       └── adminService.ts
├── infrastructure/          # Data access, real-time events & adapters
│   ├── repositories/        # LocalStorage repository with live reactive sync
│   ├── events/              # PubSub EventBus for instant chat and notification pushes
│   └── mock/                # Realistic Nigerian campus seed data
├── components/              # Reusable UI component system
│   ├── ui/                  # Badges, modals, inputs, skeletons, galleries
│   ├── layout/              # App shell, responsive header, sidebar, mobile navigation
│   └── chat/                # Real-time message thread and composer
└── pages/                   # Route views (Public, Student, Landlord, Admin)
```

## Security & Verification Workflows
1. **Compulsory Active Email & Identity Documents**:
   - Students must register with valid email and unique institutional registration number.
   - Profile verification requires uploading an allowed document: Student Identity Card, Admission Letter, or School-Fees Receipt.
2. **External Payment Workflow with Landlord Review**:
   - In accordance with MVP financial safety, students reserve a unit (locking a 7-day hold), receive an official invoice with landlord bank transfer details, and upload their bank transfer receipt.
   - The landlord confirms receipt credit, which changes reservation status to `confirmed`.
3. **Automated 7-Day Hold Expiration**:
   - Idempotent expiration engine checks unverified holds and safely releases inventory back into availability.

## Geospatial Architecture & Nearby Accommodation Search
1. **MVP Scope: Map-Free Discovery**:
   - Interactive maps, mapping tiles, and geocoding services are deferred as future enhancements. Student discovery is centered on the BUK New Site off-campus residential settlements: Danbare and Rimin Gata.
2. **Opt-in One-Time Device Location**:
   - Browser location is requested strictly through an explicit user gesture ("Use my location" on student search, or "Capture private property location" on the landlord form).
   - Never requested on page load, navigation, or background intervals.
   - Coordinates are transient for the query lifecycle and never saved to localStorage, Firestore, or user profiles.
   - Requires HTTPS or localhost runtime contexts.
3. **Private Property-Point Storage**:
   - Landlord-captured device points supplement written addresses and directions; they do not bypass administrative verification.
   - Stored in a separate restricted collection (`propertyLocations/{propertyId}`). Public property documents never contain raw exact coordinates.
4. **Trusted Server-Side Ranking**:
   - A trusted Firebase Cloud Function (`searchNearbyProperties`) uses the Firebase Admin SDK to evaluate distance on private points.
   - Outputs strictly minimal data: property ID, distance rounded to 0.1 km, and a coarse 8-point compass sector (N, NE, E, SE, S, SW, W, NW).
   - Distances and directions are explicitly labeled as approximate straight-line estimates, not turn-by-turn navigation.
5. **Backend State**:
   - Firebase (Auth, Firestore, Cloud Functions, Cloud Storage) serves as the active backend. Supabase migration is separate future work.
