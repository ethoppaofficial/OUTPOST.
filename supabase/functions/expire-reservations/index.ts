/**
 * @file supabase/functions/expire-reservations/index.ts
 * @description Supabase Edge Function: expire-reservations
 * 
 * Scheduled sweep or administrative manual trigger to reclaim abandoned bedspaces:
 * 1. Authorization: Only executable by Supabase service_role key (e.g. pg_cron or GitHub Action) OR an active administrator.
 * 2. Invokes database stored procedure `expire_pending_reservations()`.
 * 3. Identifies all reservations in `pending_payment` status where `expires_at < NOW()`.
 * 4. Atomically transitions their status to `expired`, marks invoices as `cancelled`, increments room `available_spaces`,
 *    and writes an audit log entry for each reclaimed space.
 * 5. Returns `{ success: true, expiredCount: n }`.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Verify caller has service role or bearer admin token
    const authHeader = req.headers.get('Authorization');
    const isServiceKey = Boolean(supabaseServiceKey) && authHeader === `Bearer ${supabaseServiceKey}`;

    if (!isServiceKey) {
      // Check if bearer user is admin
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
      const client = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader || '' } },
      });
      const { data: { user } } = await client.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const adminClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: profile } = await adminClient
        .from('profiles')
        .select('role, account_status')
        .eq('id', user.id)
        .single();

      if (profile?.role !== 'admin' || profile?.account_status !== 'active') {
        return new Response(JSON.stringify({ error: 'Forbidden: active administrator credentials required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: expiredCount, error: rpcError } = await adminClient.rpc('expire_pending_reservations');

    if (rpcError) {
      return new Response(JSON.stringify({ error: 'Failed to execute expiration procedure' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        expiredCount: expiredCount || 0,
        executedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[expire-reservations error]:', err?.message || err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
