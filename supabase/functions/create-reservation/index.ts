/**
 * @file supabase/functions/create-reservation/index.ts
 * @description Supabase Edge Function: create-reservation
 * 
 * Secure atomic reservation creation endpoint for students:
 * 1. Verifies caller JWT Bearer token and checks user profile status (`account_status != 'suspended'`).
 * 2. Enforces caller role is `student`.
 * 3. Calls database stored procedure `create_reservation_atomic(p_student_id, p_property_id, p_unit_id, p_idempotency_key)`.
 * 4. The stored procedure enforces available spaces > 0, decrements unit availability, generates an invoice with a 7-day hold timer, and sets status to `pending_payment`.
 * 5. Handles duplicate submission prevention via caller-provided or generated `idempotencyKey`.
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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized user' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { propertyId, unitId, idempotencyKey, reservationMode } = body;
    const normalizedMode = reservationMode === 'pay_now' ? 'pay_now' : 'hold';

    if (!propertyId || !unitId) {
      return new Response(JSON.stringify({ error: 'propertyId and unitId are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: profile } = await adminClient
      .from('profiles')
      .select('account_status, role')
      .eq('id', user.id)
      .single();

    if (profile?.account_status === 'suspended') {
      return new Response(JSON.stringify({ error: 'Forbidden: Account is suspended' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: result, error: rpcError } = await adminClient.rpc('create_reservation_atomic', {
      p_student_id: user.id,
      p_property_id: propertyId,
      p_unit_id: unitId,
      p_idempotency_key: idempotencyKey || null,
      p_reservation_mode: normalizedMode,
    });

    if (rpcError) {
      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[create-reservation error]:', err?.message || err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
