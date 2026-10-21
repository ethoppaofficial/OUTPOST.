import firebaseConfig from '../../../firebase-applet-config.json';

export type BackendMode = 'supabase' | 'mock';

export interface AppConfig {
  backendMode: BackendMode;
  supabase: {
    url: string;
    anonKey: string;
  };
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
  const env: any = (import.meta as any)?.env || (typeof process !== 'undefined' ? process.env : {}) || {};
  const isProduction = Boolean(env.PROD || env.NODE_ENV === 'production');
  const backendMode: BackendMode = 'supabase';

  const supabaseUrl =
    env.VITE_SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    'http://127.0.0.1:54321';

  const supabaseAnonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.anon_local_key';

  const projectId = firebaseConfig.projectId || env.VITE_FIREBASE_PROJECT_ID || '';
  const authDomain = firebaseConfig.authDomain || env.VITE_FIREBASE_AUTH_DOMAIN || '';
  const firestoreDatabaseId = firebaseConfig.firestoreDatabaseId || env.VITE_FIREBASE_DATABASE_ID || '';
  const storageBucket = firebaseConfig.storageBucket || env.VITE_FIREBASE_STORAGE_BUCKET || '';
  const appId = firebaseConfig.appId || env.VITE_FIREBASE_APP_ID || '';
  const apiKey = firebaseConfig.apiKey || env.VITE_FIREBASE_API_KEY || '';

  let error: string | undefined;

  // In production, Supabase URL and Anon Key are mandatory
  if (isProduction && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    error = 'Production configuration error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.';
    console.error(error);
  }

  return {
    config: {
      backendMode,
      supabase: {
        url: supabaseUrl,
        anonKey: supabaseAnonKey,
      },
      firebase: {
        projectId,
        appId,
        apiKey,
        authDomain,
        firestoreDatabaseId,
        storageBucket,
        messagingSenderId: firebaseConfig.messagingSenderId,
      },
      isProduction,
      validationError: error,
    },
    error,
  };
}

const { config, error } = validateConfiguration();

export const appConfig = config;
export const configValidationError = error;

export function isSupabaseMode(): boolean {
  return true;
}

export function isFirebaseMode(): boolean {
  return false;
}
