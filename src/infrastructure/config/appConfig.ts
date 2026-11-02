/**
 * @file appConfig.ts
 * @module infrastructure/config/appConfig
 * @description Centralized runtime environment configuration and backend mode resolver for OUTPOST.
 *
 * Security Rationale & Operating Discipline:
 * - Authoritative Backend: Supabase is the exclusive active backend (Supabase Auth, PostgreSQL, RLS, Storage, Realtime, Edge Functions).
 * - Production Strictness: In production (`isProduction: true`), missing or malformed `VITE_SUPABASE_URL`
 *   or `VITE_SUPABASE_ANON_KEY` immediately surfaces a blocking `ConfigErrorScreen`.
 * - No Fake Defaults in Production: Fake localhost URLs or mock keys are strictly prohibited outside automated test environments.
 * - Secret Isolation: Service-role keys (`SUPABASE_SERVICE_ROLE_KEY`) must NEVER be exposed, bundled, or referenced in client code.
 * - Legacy Deprecation: Firebase is archived and never initialized in the active runtime.
 */

export type BackendMode = 'supabase' | 'mock';

export interface AppConfig {
  backendMode: BackendMode;
  supabase: {
    url: string;
    anonKey: string;
  };
  isProduction: boolean;
  isTest: boolean;
  validationError?: string;
}

function validateConfiguration(): { config: AppConfig; error?: string } {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env)
    ? (import.meta as any).env
    : (typeof process !== 'undefined' ? process.env : {}) || {};

  const isProduction = Boolean(env.PROD || env.NODE_ENV === 'production');
  const isTest = Boolean(env.NODE_ENV === 'test' || env.VITEST || typeof (globalThis as any).describe === 'function');
  const backendMode: BackendMode = 'supabase';

  // Check for prohibited service-role key in client environment
  if (env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[SECURITY CRITICAL] Service-role key detected in client environment variables! This key must remain strictly server-side.');
  }

  // Canonical public variables with backward-compatible fallbacks
  const rawUrl = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
  const rawAnonKey = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

  let error: string | undefined;

  // In production, Supabase configuration is strictly mandatory
  if (isProduction) {
    if (!rawUrl || !rawAnonKey) {
      error = 'Production configuration error: Both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required to run in production.';
    } else if (rawUrl.includes('127.0.0.1') || rawUrl.includes('localhost')) {
      error = 'Production configuration error: Localhost or loopback Supabase URL cannot be used in a live production environment.';
    }
  }

  // In test environments, supply controlled mock defaults if unset
  const finalUrl = rawUrl || (isTest ? 'http://127.0.0.1:54321' : '');
  const finalAnonKey = rawAnonKey || (isTest ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.anon_local_test_key' : '');

  // If in development and missing credentials, set warning error for UI banner
  if (!isProduction && !isTest && (!finalUrl || !finalAnonKey)) {
    error = 'Development notice: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not configured. Please define them in your .env.local file.';
  }

  return {
    config: {
      backendMode,
      supabase: {
        url: finalUrl,
        anonKey: finalAnonKey,
      },
      isProduction,
      isTest,
      validationError: error,
    },
    error,
  };
}

const { config, error } = validateConfiguration();

export const appConfig = config;
export const configValidationError = error;

/**
 * Indicates whether Supabase is the active backend (always true in OUTPOST).
 */
export function isSupabaseMode(): boolean {
  return true;
}

/**
 * Indicates whether Firebase is the active backend (always false; Firebase is archived).
 */
export function isFirebaseMode(): boolean {
  return false;
}

/**
 * Indicates whether Supabase credentials are valid and present.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(appConfig.supabase.url && appConfig.supabase.anonKey);
}
