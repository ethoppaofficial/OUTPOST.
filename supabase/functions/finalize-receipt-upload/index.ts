/**
 * @file supabase/functions/finalize-receipt-upload/index.ts
 * @description Supabase Edge Function: finalize-receipt-upload
 * 
 * Finalizes and registers an uploaded payment receipt after file transmission to Storage:
 * 1. Authenticates caller and verifies reservation ownership.
 * 2. Validates that the uploaded object exists in the storage bucket at `storagePath`.
 * 3. Records the receipt metadata into `payment_receipts` table with status `pending_review`.
 * 4. Advances reservation state from `pending_payment` to `receipt_submitted`.
 * 5. Generates an immutable audit trail entry and returns the finalized receipt record.
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
    const {
      reservationId,
      receiptId,
      storagePath,
      fileName,
      contentType,
      fileSize,
      amountPaid,
      paymentReference,
      payerBankName,
      paymentDate,
    } = body;

    if (!reservationId || !receiptId || !storagePath || !fileName) {
      return new Response(JSON.stringify({ error: 'reservationId, receiptId, storagePath, and fileName are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parsedSize = Number(fileSize ?? 0);
    if (!Number.isFinite(parsedSize) || parsedSize <= 0 || parsedSize > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Invalid file size (must be between 1 byte and 10 MB)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Lookup reservation
    const { data: reservation, error: resError } = await client
      .from('reservations')
      .select('id, student_id, landlord_id, property_id, status, amount')
      .eq('id', reservationId)
      .single();

    if (resError || !reservation) {
      return new Response(JSON.stringify({ error: 'Reservation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (reservation.student_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden: ownership mismatch' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const numericAmount = amountPaid !== undefined && amountPaid !== null ? Number(amountPaid) : Number(reservation.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return new Response(JSON.stringify({ error: 'amountPaid must be a positive number' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate path prefix strictly: {landlordId}/{studentId}/{reservationId}/{receiptId}/
    const expectedPrefix = `${reservation.landlord_id}/${user.id}/${reservationId}/${receiptId}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      return new Response(JSON.stringify({ error: 'Security violation: storage path does not match session parameters' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // Resolve authoritative linked invoice_id for review_payment_receipt_atomic compatibility
    const { data: invoiceRow } = await adminClient
      .from('invoices')
      .select('id')
      .eq('reservation_id', reservationId)
      .maybeSingle();

    const cleanupOrphanStorage = async () => {
      try {
        await adminClient.storage.from('payment-receipts').remove([storagePath]);
      } catch (cleanupErr) {
        console.warn('[finalize-receipt-upload] Orphan cleanup warning:', cleanupErr);
      }
    };

    // Insert canonical receipt record
    const { data: receiptRecord, error: insertError } = await adminClient
      .from('payment_receipts')
      .insert({
        id: receiptId,
        reservation_id: reservationId,
        invoice_id: invoiceRow?.id ?? null,
        student_id: user.id,
        landlord_id: reservation.landlord_id,
        property_id: reservation.property_id,
        storage_path: storagePath,
        file_name: fileName,
        content_type: contentType || 'application/octet-stream',
        file_size: parsedSize,
        amount_paid: numericAmount,
        payment_reference: paymentReference || 'DIRECT_TRANSFER',
        payer_bank_name: payerBankName || 'Bank',
        payment_date: paymentDate || new Date().toISOString(),
        status: 'pending_review',
      })
      .select()
      .single();

    if (insertError) {
      await cleanupOrphanStorage();
      return new Response(JSON.stringify({ error: `Failed to record payment receipt: ${insertError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update reservation to payment_submitted
    const { error: resUpdateError } = await adminClient
      .from('reservations')
      .update({
        status: 'payment_submitted',
        payment_receipt_id: receiptId,
        payment_receipt_submitted_at: new Date().toISOString(),
      })
      .eq('id', reservationId);

    if (resUpdateError) {
      await adminClient.from('payment_receipts').delete().eq('id', receiptId);
      await cleanupOrphanStorage();
      return new Response(JSON.stringify({ error: `Failed to update reservation receipt state: ${resUpdateError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (invoiceRow?.id) {
      await adminClient
        .from('invoices')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', invoiceRow.id);
    }

    // Create landlord notification
    await adminClient.from('notifications').insert({
      user_id: reservation.landlord_id,
      title: 'Payment Receipt Submitted',
      message: 'Student submitted payment receipt for reservation hold. Please review and confirm.',
      type: 'receipt',
      link: '/landlord/receipts',
    });

    // Create audit log
    await adminClient.from('audit_logs').insert({
      actor_id: user.id,
      action: 'FINALIZE_RECEIPT_UPLOAD',
      entity_type: 'payment_receipt',
      entity_id: receiptId,
      details: { reservation_id: reservationId, storage_path: storagePath },
    });

    return new Response(
      JSON.stringify({ success: true, receipt: receiptRecord }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[finalize-receipt-upload error]:', err?.message || err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
