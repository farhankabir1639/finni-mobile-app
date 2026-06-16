
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EmailWebhookPayload {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: any[];
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Processing forwarded email...');
    
    const emailData: EmailWebhookPayload = await req.json();
    console.log('Email data received:', { from: emailData.from, subject: emailData.subject });

    // Extract email content (prefer text over html)
    const emailContent = emailData.text || emailData.html || '';
    
    if (!emailContent) {
      console.log('No email content found');
      return new Response(
        JSON.stringify({ message: 'No email content to process' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find user by email address from the forwarded email
    // Extract the original sender from the forwarded email subject or content
    const forwardedTo = emailData.to;
    console.log('Email forwarded to:', forwardedTo);

    // Look for active email connections that match the forwarded-to address
    const { data: connections, error: connectionsError } = await supabase
      .from('email_sms_connections')
      .select('*')
      .eq('connection_type', 'email')
      .eq('is_active', true);

    if (connectionsError) {
      console.error('Error fetching connections:', connectionsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch connections' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For now, we'll process for the first active email connection
    // In a real implementation, you'd want to match the forwarded-to address with user connections
    const activeConnection = connections?.[0];
    
    if (!activeConnection) {
      console.log('No active email connections found');
      return new Response(
        JSON.stringify({ message: 'No active email connections found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing email for user:', activeConnection.user_id);

    // Call the existing extract-transactions function
    const extractionResponse = await supabase.functions.invoke('extract-transactions', {
      body: {
        content: `Subject: ${emailData.subject}\n\nFrom: ${emailData.from}\n\n${emailContent}`,
        connection_id: activeConnection.id,
        user_id: activeConnection.user_id
      }
    });

    if (extractionResponse.error) {
      console.error('Error calling extract-transactions:', extractionResponse.error);
      return new Response(
        JSON.stringify({ error: 'Failed to extract transaction data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Transaction extraction completed:', extractionResponse.data);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Email processed successfully',
        extraction_result: extractionResponse.data
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in process-forwarded-email function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);
