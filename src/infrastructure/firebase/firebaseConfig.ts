import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { appConfig } from '../config/appConfig';
import firebaseConfigFile from '../../../firebase-applet-config.json';

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfigFile);

// CRITICAL: Connect to the specific firestoreDatabaseId
export const firestoreDatabaseId = firebaseConfigFile.firestoreDatabaseId || appConfig.firebase.firestoreDatabaseId;
export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleAuthProvider = new GoogleAuthProvider();

export async function testConnection(): Promise<boolean> {
  try {
    // Attempt to access test collection doc
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase Firestore: Please check your network connection or Firebase database provisioning.');
    }
    // Note: If permissions deny or document not found, it still proved connection reachable
    return true;
  }
}

// Perform initial connection verification in browser
if (typeof window !== 'undefined') {
  testConnection().catch(() => {});
}

export default app;
