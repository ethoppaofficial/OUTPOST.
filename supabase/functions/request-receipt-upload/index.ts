// Supabase Edge Function: request-receipt-upload
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
    const { reservationId, fileName, contentType, fileSize } = body;

    if (!reservationId || !fileName || !contentType || !fileSize) {
      return new Response(JSON.stringify({ error: 'reservationId, fileName, contentType, and fileSize are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      return new Response(JSON.stringify({ error: 'Invalid file format. Only JPEG, PNG, WebP, and PDF allowed.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (fileSize > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: 'File exceeds 10MB maximum limit' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Lookup reservation to verify ownership
    const { data: reservation, error: resError } = await client
      .from('reservations')
      .select('id, student_id, landlord_id, status, hold_expires_at')
      .eq('id', reservationId)
      .single();

    if (resError || !reservation) {
      return new Response(JSON.stringify({ error: 'Reservation not found or access denied' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (reservation.student_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden: you do not own this reservation' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (reservation.status === 'cancelled' || reservation.status === 'expired') {
      return new Response(JSON.stringify({ error: `Cannot upload receipt for a ${reservation.status} reservation` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const receiptId = crypto.randomUUID();
    const storagePath = `${reservation.landlord_id}/${user.id}/${reservationId}/${receiptId}/${cleanFileName}`;

    // Generate signed upload URL with admin/service client
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: uploadData, error: uploadError } = await adminClient.storage
      .from('payment-receipts')
      .createSignedUploadUrl(storagePath);

    if (uploadError) {
      return new Response(JSON.stringify({ error: 'Failed to create upload session', details: uploadError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        receiptId,
        storagePath,
        uploadUrl: uploadData.signedUrl,
        token: uploadData.token,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
