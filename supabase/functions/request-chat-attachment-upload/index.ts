// Supabase Edge Function: request-chat-attachment-upload
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'];
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
    const { conversationId, fileName, contentType, fileSize } = body;

    if (!conversationId || !fileName || !contentType || !fileSize) {
      return new Response(JSON.stringify({ error: 'conversationId, fileName, contentType, and fileSize are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      return new Response(JSON.stringify({ error: 'Invalid attachment type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (fileSize > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: 'Attachment exceeds 10MB limit' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify conversation participant
    const { data: participant, error: partError } = await client
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .single();

    if (partError || !participant) {
      return new Response(JSON.stringify({ error: 'Forbidden: you are not a participant in this conversation' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const messageId = crypto.randomUUID();
    const storagePath = `${conversationId}/${user.id}/${messageId}/${cleanFileName}`;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: uploadData, error: uploadError } = await adminClient.storage
      .from('chat-attachments')
      .createSignedUploadUrl(storagePath);

    if (uploadError) {
      return new Response(JSON.stringify({ error: 'Failed to create attachment upload session', details: uploadError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId,
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
