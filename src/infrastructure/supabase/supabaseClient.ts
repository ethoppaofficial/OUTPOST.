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

export interface InitialAuthCallbackState {
  pathname: string;
  search: string;
  hash: string;
  flowType: string;
  tokenHash: string;
  code: string;
  confirmedParam: string;
  hasAccessToken: boolean;
  error: string;
  errorCode: string;
  errorDescription: string;
  hasAuthError: boolean;
  consumed: boolean;
}

const captureInitialAuthCallback = (): InitialAuthCallbackState | null => {
  if (typeof window === 'undefined') return null;
  const pathname = window.location.pathname || '/';
  const search = window.location.search || '';
  const hash = window.location.hash || '';
  const searchParams = new URLSearchParams(search.replace(/^\?/, ''));
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
  const flowType = (hashParams.get('type') || searchParams.get('type') || '').toLowerCase();
  const tokenHash = hashParams.get('token_hash') || searchParams.get('token_hash') || '';
  const code = searchParams.get('code') || '';
  const confirmedParam = searchParams.get('confirmed') || '';
  const hasAccessToken = Boolean(
    hashParams.get('access_token') || searchParams.get('access_token')
  );
  const error = hashParams.get('error') || searchParams.get('error') || '';
  const errorCode = hashParams.get('error_code') || searchParams.get('error_code') || '';
  const errorDescription =
    hashParams.get('error_description') || searchParams.get('error_description') || '';
  const hasAuthError = Boolean(
    error ||
      errorCode ||
      errorDescription ||
      hash.includes('otp_expired') ||
      search.includes('otp_expired')
  );

  if (
    !flowType &&
    !tokenHash &&
    !code &&
    !confirmedParam &&
    !hasAccessToken &&
    !hasAuthError
  ) {
    return null;
  }

  return {
    pathname,
    search,
    hash,
    flowType,
    tokenHash,
    code,
    confirmedParam,
    hasAccessToken,
    error,
    errorCode,
    errorDescription,
    hasAuthError,
    consumed: false,
  };
};

export const initialAuthCallback = captureInitialAuthCallback();

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
      const ctx = (error as any)?.context;
      const status = ctx?.status;
      let detailMessage = '';

      if (ctx && typeof ctx.clone === 'function') {
        try {
          const textBody = await ctx.clone().text();
          if (textBody) {
            try {
              const parsed = JSON.parse(textBody);
              if (typeof parsed?.error === 'string' && parsed.error.trim()) {
                detailMessage = parsed.error.trim();
              } else if (typeof parsed?.message === 'string' && parsed.message.trim()) {
                detailMessage = parsed.message.trim();
              }
            } catch {
              detailMessage = textBody.trim().slice(0, 300);
            }
          }
        } catch {
          // Ignore non-readable response body
        }
      }

      const baseMessage = detailMessage || error.message || `Edge Function ${functionName} failed`;
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
