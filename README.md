# OUTPOST - Student Housing & Accommodation Management Platform

OUTPOST connects Nigerian tertiary students with verified landlords and vetted hostel accommodations.

## Features
- **Student Discovery**: Search and filter by campus (UNILAG, UI, OAU, Covenant), price in ₦ NGN, accommodation type, gender policy, distance from campus gate, and amenities.
- **Roommate Matching**: Explainable compatibility scoring based on budget, move-in window, sleep/study habits, cleanliness, and quiet hours.
- **Registration Number Lookup**: Privacy-conscious student search returning only safe verified credentials.
- **Accommodation Groups**: Form student cohorts to co-reserve multi-room hostels and share group chat threads.
- **Reservation & Payment Workflow**: 7-day hold locking, invoice generation, bank transfer receipt upload, landlord confirmation.
- **Real-Time Text Chat**: Direct student-to-landlord, student-to-student, and group cohort chat.
- **Role Portals**: Distinct dashboards and flows for Student, Landlord, and Administrator.
- **Light & Dark Mode**: Persistent theme selection with accessible contrast.

---

## Development Seed Accounts
You can switch instantly between these personas using the top-bar persona switcher or log in manually:

| Role | Email | Password | Details |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@outpost.ng` | `Admin123!` | Platform verification, audit logs, expiration runner |
| **Verified Landlord** | `emeka.landlord@outpost.ng` | `Landlord123!` | Chief Emeka Okafor (Okafor Properties), Approved |
| **Pending Landlord** | `folake.properties@outpost.ng` | `Landlord123!` | Mrs. Folake Adeleke (Adeleke Scholastic Living) |
| **Verified Student** | `tunde.student@unilag.edu.ng` | `Student123!` | Babatunde Fashanu (UNILAG/2023/4821) |
| **Verified Student 2** | `chioma.adebayo@ui.edu.ng` | `Student123!` | Chioma Adebayo (UI/2022/1904) |
| **Pending Student** | `ibrahim.musa@oau.edu.ng` | `Student123!` | Ibrahim Musa (OAU/2024/7712) |
| **Unverified Student**| `zainab.kalu@covenant.edu.ng` | `Student123!` | Zainab Kalu (CU/2023/3309) |

---

## Architecture & Migration
- Designed with provider-neutral service boundaries (`src/application/services/`).
- Local storage persistence and pubsub event bus for instant development.
- Ready for deployment to Firebase or Supabase. See `docs/backend-migration.md`, `firestore.rules`, and `storage.rules`.
