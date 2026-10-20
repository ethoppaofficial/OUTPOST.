// Supabase Edge Function: get-private-asset-url
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPIRY_SECONDS = 900; // 15 minutes

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

    if (!assetType || !recordId) {
      return new Response(JSON.stringify({ error: 'assetType and recordId are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if caller is admin
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    const isAdmin = profile?.role === 'admin';

    let bucketName = '';
    let storagePath = '';

    if (assetType === 'payment-receipt') {
      const { data: receipt } = await adminClient
        .from('payment_receipts')
        .select('student_id, landlord_id, storage_path')
        .eq('id', recordId)
        .single();

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
    } else if (assetType === 'chat-attachment') {
      const { data: message } = await adminClient
        .from('messages')
        .select('conversation_id, attachment')
        .eq('id', recordId)
        .single();

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
          .single();

        if (!participant) {
          return new Response(JSON.stringify({ error: 'Forbidden: not a participant in this conversation' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      bucketName = 'chat-attachments';
      storagePath = message.attachment.storage_path;
    } else if (assetType === 'student-document') {
      const { data: doc } = await adminClient
        .from('student_verification_documents')
        .select('student_id, storage_path')
        .eq('id', recordId)
        .single();

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
    } else if (assetType === 'landlord-document') {
      const { data: doc } = await adminClient
        .from('landlord_verification_submissions')
        .select('landlord_id, storage_path')
        .eq('id', recordId)
        .single();

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
    } else {
      return new Response(JSON.stringify({ error: 'Invalid assetType' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: signedData, error: signError } = await adminClient.storage
      .from(bucketName)
      .createSignedUrl(storagePath, EXPIRY_SECONDS);

    if (signError || !signedData?.signedUrl) {
      return new Response(JSON.stringify({ error: 'Failed to generate signed URL', details: signError?.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
