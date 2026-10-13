# OUTPOST administrator setup and deployment

This implementation uses the existing Firebase Authentication and OUTPOST's **named Firestore database**. It does not add an admin password, backdoor, hard-coded email allowlist, or client-side privilege switch.

## What changed

- `/admin/login` is a dedicated email/password sign-in screen. It does not offer admin self-registration.
- Admin UI access requires a Firebase Auth custom claim: `admin: true`.
- Firestore, Storage, and callable functions verify that claim. A `users/{uid}.role = "admin"` field by itself is not sufficient.
- Admin account, verification, property, settings, and authenticated sign-in/sign-out events run through Cloud Functions and create immutable audit entries. Suspension also disables the Firebase Auth user and requires a reason.
- Listing approval and private location verification remain separate. A property becomes active/public only after the listing is approved and the location is verified.
- Reservation and receipt screens are read-only. Admins cannot edit payment amounts or approve receipts there.
- The admin settings screen stores validated settings and audits changes. `maintenanceMode` is enforced on Student/Landlord protected routes; `notificationsEnabled` controls notifications emitted by the new admin decisions. Existing reservation/receipt workflows do not yet consume the other settings (hold period, receipt deadline, verification requirement toggles), so those values are **stored only** until their business rules are wired. The Firestore policy continues to cap a reservation hold at seven days.
- `vercel.json` includes the SPA rewrite required for direct navigation to `/admin/...` URLs.

## One-time administrator bootstrap

1. In the Firebase Console for the OUTPOST project, enable **Authentication → Sign-in method → Email/Password**.
2. Create or confirm the administrator account in Firebase Authentication using the intended administrator email. Verify the email. Do not put the password in source code, AI Studio prompts, or this setup script.
3. From a trusted developer machine with this project checked out, install the Functions dependencies and authenticate the Firebase CLI:

   ```bash
   npm --prefix functions install
   firebase login
   firebase use --add
   ```

   Select the same project used by `firebase-applet-config.json`.
4. Authenticate Application Default Credentials with an account authorized to manage Firebase Authentication custom claims and write the OUTPOST Firestore database. Then promote the existing verified account:

   ```bash
   gcloud auth application-default login
   npm --prefix functions run admin:promote -- <existing-verified-admin-email> --confirm
   ```

   The script reads the project ID and named Firestore database ID from `firebase-applet-config.json`. It sets only the custom claim and the matching role/status profile fields; it never creates or reads a password. The signed-in Google identity needs an appropriate privileged IAM role. If `gcloud` is unavailable, run the script in an environment with valid Application Default Credentials and the Firebase Admin SDK.
5. The promoted administrator must sign out and sign back in at `/admin/login`; the script revokes old refresh tokens so a fresh token includes the admin claim.

If the email account does not already exist in Firebase Authentication, create it through the Firebase Console first. The promoter intentionally refuses unverified or disabled accounts.

## Deploy the backend rules and functions

Run from the repository root after selecting the correct Firebase project:

```bash
npm --prefix functions install
firebase deploy --only functions,firestore:rules,storage
```

The `firebase.json` deploy target is the named OUTPOST Firestore database, not `(default)`. The Cloud Functions Admin SDK and the property-location trigger are configured for that same database. Do not deploy the rules to a different database. Cloud Functions deployment may require the Firebase project to have the required billing plan/APIs enabled.

Deploy the Vite frontend through the existing Vercel project from the intended production branch. Verify the Vercel build command is `npm run build`, output directory is `dist`, and its existing public Firebase configuration matches the same project. The deployment is not complete until the Functions and rules deployment has succeeded as well as the frontend build.

## Smoke tests after deployment

1. Open `/admin/login`; an ordinary Student or Landlord must not be accepted as an administrator.
2. Sign in with the promoted account and verify `/admin/dashboard` loads live Firestore collections.
3. Open a Student/Landlord route while signed in as admin; the route should redirect to `/unauthorized` rather than change personas.
4. As a non-admin, enter `/admin/users` directly; Firestore rules and route protection must deny administrative access.
5. Review a test verification submission and confirm the stored status, user notification (when enabled), and new immutable audit record.
6. Sign out and back in as an administrator; confirm `ADMIN_LOGOUT` and `ADMIN_LOGIN` events appear in the audit log.
7. Approve a test listing without approving its location; it must remain inactive. Verify the location separately and confirm only its derived public coordinates become public.
8. Suspend a test non-admin account with a reason; Firebase Auth should disable it and the audit log should contain the reason. Reactivate it and confirm the new audit entry.
9. Turn maintenance mode on; protected Student/Landlord pages should show the maintenance notice while the admin workspace remains available.
10. Test a direct Vercel URL such as `/admin/login` after deployment to confirm the SPA rewrite works.

Do not test account suspension against the only administrator. User administration deliberately refuses to suspend any account carrying the admin claim or stored admin role.
