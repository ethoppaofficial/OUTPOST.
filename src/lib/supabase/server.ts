import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { appConfig } from '../../infrastructure/config/appConfig';

/**
 * Server-side Supabase client helper (from @supabase/supabase-client-nextjs block).
 * Provided for SSR / API route compatibility when cookie context is available.
 */
export function createServerSupabaseClient(cookieStore?: {
  getAll?: () => Array<{ name: string; value: string }>;
  setAll?: (cookies: Array<{ name: string; value: string; options: CookieOptions }>) => void;
}) {
  const supabaseUrl =
    appConfig.supabase.url ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    '';
  const supabaseKey =
    appConfig.supabase.publishableKey ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    '';

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore?.getAll ? cookieStore.getAll() : [];
      },
      setAll(cookiesToSet) {
        try {
          cookieStore?.setAll?.(cookiesToSet);
        } catch {
          // Ignore cookie mutation errors in read-only contexts
        }
      },
    },
  });
}
