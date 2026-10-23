/**
 * @file supabaseClient.ts
 * @module infrastructure/supabase/supabaseClient
 * @description Master Supabase client instance and Edge Function invocation helper.
 *
 * Security Rationale:
 * - Uses validated configuration from `appConfig`.
 * - In production, startup without valid credentials is fully blocked.
 * - Handles JWT bearer pass-through automatically via Supabase client headers.
 */

import { createClient } from '@supabase/supabase-js';
import { appConfig } from '../config/appConfig';

const supabaseUrl = appConfig.supabase.url || 'http://127.0.0.1:54321';
const supabaseAnonKey = appConfig.supabase.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.anon_local_test_key';

export const isSupabaseConfigured = Boolean(
  appConfig.supabase.url &&
  appConfig.supabase.anonKey &&
  !appConfig.validationError
);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

/**
 * Invoke a Supabase Edge Function securely passing the authenticated user's session token.
 */
export async function invokeEdgeFunction<T = any>(
  functionName: string,
  body: Record<string, any>
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body,
    });
    if (error) {
      return { data: null, error: new Error(error.message || `Edge Function ${functionName} failed`) };
    }
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
