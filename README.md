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
