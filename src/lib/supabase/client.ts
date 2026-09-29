import { createBrowserClient } from '@supabase/ssr';
import { createClient as createSupabaseJsClient, SupabaseClient } from '@supabase/supabase-js';
import { appConfig } from '../../infrastructure/config/appConfig';

let browserClientInstance: SupabaseClient | null = null;

/**
 * Creates or returns the singleton Supabase browser client.
 * Compatible with the @supabase/supabase-client-nextjs registry block pattern
 * while supporting Vite SPA environment variables (NEXT_PUBLIC_* and VITE_*).
 */
export function createClient(): SupabaseClient {
  if (browserClientInstance) {
    return browserClientInstance;
  }

  const supabaseUrl =
    appConfig.supabase.url ||
    (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string) ||
    (import.meta.env.VITE_SUPABASE_URL as string) ||
    '';

  const supabaseKey =
    appConfig.supabase.publishableKey ||
    (import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string) ||
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ||
    '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Supabase configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.'
    );
  }

  try {
    browserClientInstance = createBrowserClient(supabaseUrl, supabaseKey);
  } catch {
    browserClientInstance = createSupabaseJsClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClientInstance;
}

export function getSupabaseClient(): SupabaseClient | null {
  try {
    if (!appConfig.supabase.url || !appConfig.supabase.publishableKey) {
      return null;
    }
    return createClient();
  } catch {
    return null;
  }
}

export async function testSupabaseConnection(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    const { error } = await client.auth.getSession();
    return !error;
  } catch {
    return false;
  }
}
