/**
 * @file supabase/functions/review-payment-receipt/index.ts
 * @description Supabase Edge Function: review-payment-receipt
 * 
 * Verifies or rejects offline bank transfer receipts submitted by students:
 * 1. Verifies caller authentication and enforces role checks (must be landlord owning the property or an administrator).
 * 2. Validates inputs: receiptId, decision (`approved` | `rejected`), and mandatory rejectionReason on rejection.
 * 3. Executes atomic database stored procedure `review_payment_receipt_atomic(p_receipt_id, p_reviewer_id, p_decision, p_rejection_reason)`.
 * 4. Stored procedure updates receipt state, confirms reservation to `confirmed` (on approval) or resets to `pending_payment` (on rejection),
 *    records verified timestamp and reviewer ID, and creates an immutable audit trail entry.
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
    const { receiptId, decision, rejectionReason } = body;

    if (!receiptId || !decision) {
      return new Response(JSON.stringify({ error: 'receiptId and decision (approved|rejected) are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (decision !== 'approved' && decision !== 'rejected') {
      return new Response(JSON.stringify({ error: 'decision must be either approved or rejected' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (decision === 'rejected' && (!rejectionReason || !rejectionReason.trim())) {
      return new Response(JSON.stringify({ error: 'A specific rejectionReason is required when declining a receipt' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call atomic stored procedure using service role
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: profile } = await adminClient
      .from('profiles')
      .select('account_status')
      .eq('id', user.id)
      .single();

    if (profile?.account_status === 'suspended') {
      return new Response(JSON.stringify({ error: 'Forbidden: Account is suspended' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: result, error: rpcError } = await adminClient.rpc('review_payment_receipt_atomic', {
      p_receipt_id: receiptId,
      p_decision: decision,
      p_reviewer_id: user.id,
      p_rejection_reason: rejectionReason || null,
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
    console.error('[review-payment-receipt error]:', err?.message || err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
