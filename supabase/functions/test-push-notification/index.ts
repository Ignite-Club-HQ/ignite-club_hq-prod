import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the user from the JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      console.error('User auth error:', userError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Sending test push to user: ${user.id}`);

    // Get delay from request body (default 5 seconds)
    let delaySeconds = 5;
    try {
      const body = await req.json();
      if (body.delay && typeof body.delay === 'number') {
        delaySeconds = Math.min(Math.max(body.delay, 1), 30); // Between 1-30 seconds
      }
    } catch {
      // No body or invalid JSON, use default
    }

    console.log(`Will send notification after ${delaySeconds} second delay`);

    // Wait for the specified delay
    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));

    console.log('Delay complete, creating notification...');

    // Create a test notification in the database
    const { data: notification, error: notificationError } = await supabaseClient
      .from('notifications')
      .insert({
        user_id: user.id,
        type: 'test',
        message: 'Test notification - Push is working!',
        related_id: null,
      })
      .select()
      .single();

    if (notificationError) {
      console.error('Failed to create notification:', notificationError);
      return new Response(JSON.stringify({ error: 'Failed to create notification' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Created notification:', notification.id);

    // Call the send-push-notification function
    const pushResponse = await supabaseClient.functions.invoke('send-push-notification', {
      body: {
        userId: user.id,
        title: 'Test Notification',
        body: 'If you see this, push notifications are working!',
        url: '/notifications',
        notificationId: notification.id,
      },
    });

    console.log('Push function response:', pushResponse);

    if (pushResponse.error) {
      console.error('Push function error:', pushResponse.error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Push function failed',
        details: pushResponse.error 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Test notification sent',
      notification_id: notification.id,
      push_result: pushResponse.data 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in test-push-notification:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
