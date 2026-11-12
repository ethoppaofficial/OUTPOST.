/**
 * @file supabase/functions/get-private-asset-url/index.ts
 * @description Supabase Edge Function: get-private-asset-url
 * 
 * Central authorization gatekeeper for accessing private storage objects:
 * - Generates 15-minute expiring signed download URLs for private assets.
 * - Supported asset types:
 *   1. `student-document`: Verifiable only by owning student or an active administrator.
 *   2. `landlord-document`: Verifiable only by owning landlord or an active administrator.
 *   3. `payment-receipt`: Verifiable by owning student, property landlord, or administrator.
 *   4. `chat-attachment`: Verifiable only by active participants of the corresponding conversation.
 * - Prevents raw storage path leakage, URL forging, or unauthorized object traversal.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPIRY_SECONDS = 900; // 15 minutes

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const { assetType, recordId } = body;

    if (!assetType || !recordId || typeof recordId !== 'string' || !UUID_REGEX.test(recordId.trim())) {
      return new Response(JSON.stringify({ error: 'Valid assetType and UUID recordId are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanRecordId = recordId.trim();
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check caller profile (must not be suspended; admin privileges require account_status === 'active')
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role, account_status')
      .eq('id', user.id)
      .single();

    if (!profile || profile.account_status === 'suspended') {
      return new Response(JSON.stringify({ error: 'Forbidden: Account is suspended or missing' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isAdmin = profile.role === 'admin' && profile.account_status === 'active';

    let bucketName = '';
    let storagePath = '';
    let resolvedEntityId = cleanRecordId;

    if (assetType === 'payment-receipt') {
      const { data: receipt } = await adminClient
        .from('payment_receipts')
        .select('id, student_id, landlord_id, storage_path')
        .eq('id', cleanRecordId)
        .maybeSingle();

      if (!receipt) {
        return new Response(JSON.stringify({ error: 'Receipt not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!isAdmin && receipt.student_id !== user.id && receipt.landlord_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Forbidden: not authorized to view this receipt' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      bucketName = 'payment-receipts';
      storagePath = receipt.storage_path;
      resolvedEntityId = receipt.id;
    } else if (assetType === 'chat-attachment') {
      const { data: message } = await adminClient
        .from('messages')
        .select('id, conversation_id, attachment')
        .eq('id', cleanRecordId)
        .maybeSingle();

      if (!message || !message.attachment?.storage_path) {
        return new Response(JSON.stringify({ error: 'Attachment not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!isAdmin) {
        const { data: participant } = await adminClient
          .from('conversation_participants')
          .select('id')
          .eq('conversation_id', message.conversation_id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!participant) {
          return new Response(JSON.stringify({ error: 'Forbidden: not a participant in this conversation' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      bucketName = 'chat-attachments';
      storagePath = message.attachment.storage_path;
      resolvedEntityId = message.id;
    } else if (assetType === 'student-document') {
      // Strictly query by document primary ID first; if caller passed student_id, check safely without string-interpolated .or()
      let { data: doc } = await adminClient
        .from('student_verification_documents')
        .select('id, student_id, storage_path')
        .eq('id', cleanRecordId)
        .maybeSingle();

      if (!doc) {
        const fallback = await adminClient
          .from('student_verification_documents')
          .select('id, student_id, storage_path')
          .eq('student_id', cleanRecordId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        doc = fallback.data;
      }

      if (!doc) {
        return new Response(JSON.stringify({ error: 'Document not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!isAdmin && doc.student_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Forbidden: not authorized to view this document' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      bucketName = 'student-docs';
      storagePath = doc.storage_path;
      resolvedEntityId = doc.id;
    } else if (assetType === 'landlord-document') {
      let { data: doc } = await adminClient
        .from('landlord_verification_submissions')
        .select('id, landlord_id, storage_path')
        .eq('id', cleanRecordId)
        .maybeSingle();

      if (!doc) {
        const fallback = await adminClient
          .from('landlord_verification_submissions')
          .select('id, landlord_id, storage_path')
          .eq('landlord_id', cleanRecordId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        doc = fallback.data;
      }

      if (!doc) {
        return new Response(JSON.stringify({ error: 'Document not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!isAdmin && doc.landlord_id !== user.id) {
        return new Response(JSON.stringify({ error: 'Forbidden: not authorized to view this document' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      bucketName = 'landlord-docs';
      storagePath = doc.storage_path;
      resolvedEntityId = doc.id;
    } else {
      return new Response(JSON.stringify({ error: 'Invalid assetType' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!storagePath) {
      return new Response(JSON.stringify({ error: 'No storage path associated with this record' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize path if bucket prefix was stored accidentally
    const normalizedPath = storagePath.startsWith(`${bucketName}/`)
      ? storagePath.slice(bucketName.length + 1)
      : storagePath;

    const { data: signedData, error: signError } = await adminClient.storage
      .from(bucketName)
      .createSignedUrl(normalizedPath, EXPIRY_SECONDS);

    if (signError || !signedData?.signedUrl) {
      return new Response(JSON.stringify({ error: 'Failed to generate signed download URL' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Write immutable audit trail entry for sensitive private evidence access
    try {
      await adminClient.from('audit_logs').insert({
        actor_id: user.id,
        action: isAdmin ? 'ADMIN_VIEW_PRIVATE_EVIDENCE' : 'VIEW_PRIVATE_EVIDENCE',
        entity_type: assetType,
        entity_id: resolvedEntityId,
        details: { bucket: bucketName, expiresInSeconds: EXPIRY_SECONDS },
      });
    } catch (auditErr) {
      console.warn('[get-private-asset-url audit warning]:', auditErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        downloadUrl: signedData.signedUrl,
        expiresInSeconds: EXPIRY_SECONDS,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[get-private-asset-url error]:', err?.message || err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
