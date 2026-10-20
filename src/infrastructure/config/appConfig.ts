import firebaseConfig from '../../../firebase-applet-config.json';

export type BackendMode = 'firebase' | 'mock';

export interface AppConfig {
  backendMode: BackendMode;
  firebase: {
    projectId: string;
    appId: string;
    apiKey: string;
    authDomain: string;
    firestoreDatabaseId: string;
    storageBucket: string;
    messagingSenderId?: string;
  };
  isProduction: boolean;
  validationError?: string;
}

function validateConfiguration(): { config: AppConfig; error?: string } {
  const backendMode: BackendMode = 'firebase';

  const projectId = firebaseConfig.projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID || '';
  const authDomain = firebaseConfig.authDomain || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '';
  const firestoreDatabaseId = firebaseConfig.firestoreDatabaseId || import.meta.env.VITE_FIREBASE_DATABASE_ID || '';
  const storageBucket = firebaseConfig.storageBucket || import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '';
  const appId = firebaseConfig.appId || import.meta.env.VITE_FIREBASE_APP_ID || '';
  const apiKey = firebaseConfig.apiKey || import.meta.env.VITE_FIREBASE_API_KEY || '';

  let error: string | undefined;

  const missing: string[] = [];
  if (!projectId) missing.push('projectId');
  if (!authDomain) missing.push('authDomain');
  if (!firestoreDatabaseId) missing.push('firestoreDatabaseId');
  if (!storageBucket) missing.push('storageBucket');
  if (!appId) missing.push('appId');
  if (!apiKey) missing.push('apiKey');

  if (missing.length > 0) {
    error = `Firebase configuration error: Missing required fields: ${missing.join(', ')}. Please check firebase-applet-config.json.`;
    console.error(error);
  }

  return {
    config: {
      backendMode,
      firebase: {
        projectId,
        appId,
        apiKey,
        authDomain,
        firestoreDatabaseId,
        storageBucket,
        messagingSenderId: firebaseConfig.messagingSenderId,
      },
      isProduction: Boolean((import.meta as any)?.env?.PROD),
      validationError: error,
    },
    error,
  };
}

const { config, error } = validateConfiguration();

export const appConfig = config;
export const configValidationError = error;

export function isFirebaseMode(): boolean {
  return true;
}
