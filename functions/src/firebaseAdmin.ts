import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const app = getApps()[0] || initializeApp();

// This is a public Firebase resource identifier, not a credential. Keep it aligned
// with firebase-applet-config.json; an environment override supports other stages.
export const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID
  || 'ai-studio-outpoststudentho-f2f5cd38-bc33-486e-897b-2f36813511f0';
export const db = getFirestore(app, FIRESTORE_DATABASE_ID);
export const storage = getStorage(app);
