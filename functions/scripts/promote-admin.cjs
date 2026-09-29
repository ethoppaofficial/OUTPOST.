#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { initializeApp, applicationDefault, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const confirmed = process.argv.includes('--confirm');
  if (!email || !email.includes('@') || !confirmed) {
    console.error('Usage: npm run admin:promote -- <existing-verified-admin-email> --confirm');
    process.exitCode = 2;
    return;
  }

  const configPath = path.resolve(__dirname, '../../firebase-applet-config.json');
  let projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  let databaseId = process.env.FIRESTORE_DATABASE_ID;
  if (!projectId && fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      projectId = config.projectId;
      databaseId = databaseId || config.firestoreDatabaseId;
    } catch { /* use ADC project and the default database */ }
  }
  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) });
  const auth = getAuth(app);
  const db = getFirestore(app, databaseId || '(default)');
  const user = await auth.getUserByEmail(email);
  if (user.email?.toLowerCase() !== email) throw new Error('Firebase Auth returned a different email. No changes were made.');
  if (!user.emailVerified) throw new Error('Verify this Firebase Auth email before promoting it. No changes were made.');
  if (user.disabled) throw new Error('This Firebase Auth account is disabled. Reactivate it before promotion.');

  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true });
  await db.doc(`users/${user.uid}`).set({
    id: user.uid,
    email,
    role: 'admin',
    accountStatus: 'active',
    adminProvisionedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await auth.revokeRefreshTokens(user.uid);
  console.log(`Administrator role granted to ${email} (UID ${user.uid}).`);
  console.log('The administrator must sign in again so Firebase issues a token containing the admin claim.');
}

main().catch((error) => {
  console.error(`Admin promotion failed: ${error.message || error}`);
  process.exitCode = 1;
});
