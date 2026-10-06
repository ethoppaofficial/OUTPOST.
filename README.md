# OUTPOST — Student Accommodation Platform

OUTPOST supports student accommodation discovery and shared accommodation coordination around Bayero University Kano's New Site, including Danbare and Rimin Gata.

## Personas

- **Student** — discovers accommodation, coordinates with roommates, and manages reservations.
- **Landlord** — manages listings, availability, verification, and reservation receipts.
- **Administrator** — reviews users, verification submissions, listings, and platform settings through a separate protected workspace.

## Run locally

```bash
npm install
npm run dev
```

The configured backend is Firebase Authentication, Cloud Firestore (the named database in `firebase-applet-config.json`), Cloud Storage, and Cloud Functions. Use the matching Firebase project for the web app and backend deployment. Frontend Firebase configuration is client configuration; never place service-account credentials or administrator passwords in this repository or a Vite environment variable.

## Administrator onboarding

There are **no default administrator credentials, demo admin account, admin self-registration, or persona-switcher bypass**. Create or confirm the administrator in Firebase Authentication, then set the trusted `admin: true` custom claim using the one-time promotion script. See [ADMIN_SETUP.md](ADMIN_SETUP.md) for setup, deployment, and smoke-test steps.

## Build and deploy

```bash
npm run lint
npm run build
npm --prefix functions install
npm --prefix functions run build
```

Deploy the Firebase rules and functions to the configured project, then deploy the Vite `dist` output through the connected Vercel project. The deployment must use the same Firebase project and named Firestore database as the client configuration.

## Location Architecture & Nearby Search Security

- **Map-free MVP**: Interactive maps and geocoding services are removed/deferred as future work. Accommodation search is text-based and corridor-focused (Dambare and Rimin Gata around BUK New Site).
- **Opt-in One-time Browser Location**: The browser Geolocation API is requested only upon an explicit student gesture ("Use my location") or landlord action. It is never triggered on page load, sign-in, route navigation, or background refresh.
- **Privacy Protection**: Browser coordinates are sensitive and used strictly for the single request. They are never persisted in Firestore, localStorage, sessionStorage, logs, analytics, or student profiles. Browser geolocation requires HTTPS or localhost.
- **Landlord Property-Point Capture**: Landlord device-captured GPS coordinates are optional, private, and stored separately from public listing data. They supplement—and never bypass—written addresses, landmarks, directions, and administrative review. Exact latitude/longitude is never written to public listing documents or returned to students.
- **Trusted Server-Side Ranking**: Nearby search ranking is performed by a trusted Firebase Cloud Function (`searchNearbyProperties`) reading private points with the Admin SDK. The function returns only minimal public fields: property ID, distance rounded to 0.1 km, and coarse 8-point compass direction (N, NE, E, SE, S, SW, W, NW).
- **Backend Status & Future Migration**: Firebase (Auth, Firestore, Storage, Cloud Functions) is the active operational backend. The Supabase/PostgreSQL migration remains separate future work. Local builds and unit tests verify software correctness but do not prove live production deployment or activation.
