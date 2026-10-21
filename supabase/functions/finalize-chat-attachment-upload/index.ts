// Supabase Edge Function: finalize-chat-attachment-upload
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
    const { conversationId, messageId, storagePath, fileName, contentType, fileSize, text } = body;

    if (!conversationId || !messageId || !storagePath || !fileName) {
      return new Response(JSON.stringify({ error: 'conversationId, messageId, storagePath, and fileName are required' }), {
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
      return new Response(JSON.stringify({ error: 'Forbidden: not a participant' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify expected path structure: {conversationId}/{senderId}/{messageId}/
    const expectedPrefix = `${conversationId}/${user.id}/${messageId}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      return new Response(JSON.stringify({ error: 'Security violation: invalid storage path' }), {
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

    const messageText = text?.trim() || `Sent an attachment: ${fileName}`;
    const attachmentMetadata = {
      storage_path: storagePath,
      file_name: fileName,
      content_type: contentType || 'application/octet-stream',
      file_size: fileSize || 0,
      uploaded_by: user.id,
      uploaded_at: new Date().toISOString(),
    };

    // Insert message record
    const { data: message, error: msgError } = await adminClient
      .from('messages')
      .insert({
        id: messageId,
        conversation_id: conversationId,
        sender_id: user.id,
        text: messageText,
        attachment: attachmentMetadata,
      })
      .select()
      .single();

    if (msgError) {
      return new Response(JSON.stringify({ error: 'Failed to record chat message' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update conversation last message
    await adminClient
      .from('conversations')
      .update({
        last_message_text: messageText,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    return new Response(
      JSON.stringify({ success: true, message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[finalize-chat-attachment-upload error]:', err?.message || err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
