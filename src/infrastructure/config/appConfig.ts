import firebaseConfig from '../../../firebase-applet-config.json';

export type BackendMode = 'firebase' | 'supabase' | 'mock';

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
  supabase: {
    url: string;
    publishableKey: string;
  };
  isProduction: boolean;
  validationError?: string;
}

function validateConfiguration(): { config: AppConfig; error?: string } {
  const supabaseUrl = (
    (import.meta.env.VITE_SUPABASE_URL as string) ||
    (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string) ||
    ''
  ).trim();

  const supabasePublishableKey = (
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ||
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
    (import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string) ||
    ''
  ).trim();

  const rawMode = (
    (import.meta.env.VITE_BACKEND_MODE as string) ||
    (import.meta.env.VITE_USE_BACKEND as string) ||
    ''
  )
    .trim()
    .toLowerCase();

  // Default to 'supabase' when Supabase URL & publishable key are configured unless explicitly set to 'firebase' or 'mock'
  const backendMode: BackendMode =
    rawMode === 'firebase'
      ? 'firebase'
      : rawMode === 'mock'
      ? 'mock'
      : rawMode === 'supabase' || (supabaseUrl && supabasePublishableKey)
      ? 'supabase'
      : 'firebase';

  const projectId = firebaseConfig.projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID || '';
  const authDomain = firebaseConfig.authDomain || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '';
  const firestoreDatabaseId =
    firebaseConfig.firestoreDatabaseId || import.meta.env.VITE_FIREBASE_DATABASE_ID || '';
  const storageBucket =
    firebaseConfig.storageBucket || import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '';
  const appId = firebaseConfig.appId || import.meta.env.VITE_FIREBASE_APP_ID || '';
  const apiKey = firebaseConfig.apiKey || import.meta.env.VITE_FIREBASE_API_KEY || '';

  let error: string | undefined;

  if (backendMode === 'firebase') {
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
  } else if (backendMode === 'supabase') {
    const missing: string[] = [];
    if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL / VITE_SUPABASE_URL');
    if (!supabasePublishableKey) {
      missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PUBLISHABLE_KEY');
    }
    if (missing.length > 0) {
      error = `Supabase configuration error: Missing required environment variables: ${missing.join(', ')}.`;
      console.error(error);
    }
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
      supabase: {
        url: supabaseUrl,
        publishableKey: supabasePublishableKey,
      },
      isProduction: import.meta.env.PROD || false,
      validationError: error,
    },
    error,
  };
}

const { config, error } = validateConfiguration();

export const appConfig = config;
export const configValidationError = error;

export function isFirebaseMode(): boolean {
  return appConfig.backendMode === 'firebase';
}

export function isSupabaseMode(): boolean {
  return appConfig.backendMode === 'supabase';
}

export function isMockMode(): boolean {
  return appConfig.backendMode === 'mock';
}
