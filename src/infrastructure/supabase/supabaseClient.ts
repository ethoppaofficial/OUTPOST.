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

export function isEdgeFunctionUnavailableError(error: unknown): boolean {
  const raw =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'string'
      ? error
      : JSON.stringify(error || '');
  const lower = raw.toLowerCase();
  return (
    lower.includes('failed to send a request to the edge function') ||
    lower.includes('requested function was not found') ||
    lower.includes('functionsfetcherror') ||
    lower.includes('not_found') ||
    lower.includes('failed to fetch') ||
    lower.includes('status 404')
  );
}

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
      const status = (error as any)?.context?.status;
      const baseMessage = error.message || `Edge Function ${functionName} failed`;
      const enrichedMessage =
        typeof status === 'number' && !baseMessage.includes(String(status))
          ? `${baseMessage} (status ${status})`
          : baseMessage;
      const wrapped = new Error(enrichedMessage);
      wrapped.name = error.name || wrapped.name;
      return { data: null, error: wrapped };
    }
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
