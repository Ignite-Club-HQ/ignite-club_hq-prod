import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DutyNotificationRequest {
  recipientUserId: string;
  dutyName: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  eventTime?: string;
  teamName?: string;
  clubName: string;
  clubLogoUrl?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      recipientUserId,
      dutyName,
      eventId,
      eventTitle,
      eventDate,
      eventTime,
      teamName,
      clubName,
      clubLogoUrl,
    }: DutyNotificationRequest = await req.json();

    console.log(`Processing duty notification email for user ${recipientUserId}`);

    // Get recipient profile and email preferences
    const { data: recipient } = await supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', recipientUserId)
      .single();

    if (!recipient?.email) {
      console.log('Recipient has no email, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_email' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check email preferences - check if events email is enabled (duty is event-related)
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('email_events_enabled')
      .eq('user_id', recipientUserId)
      .single();

    // Default to true if no preference set
    const emailEnabled = prefs?.email_events_enabled !== false;

    if (!emailEnabled) {
      console.log('User has disabled event emails, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'email_disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format event link
    const eventLink = `/events/${eventId}`;

    // Send email via send-email function
    const { error: emailError } = await supabase.functions.invoke('send-email', {
      body: {
        to: recipient.email,
        subject: `Duty Assignment: ${dutyName} for ${eventTitle}`,
        template: 'duty-assigned',
        templateData: {
          recipientName: recipient.display_name || 'Team Member',
          dutyName,
          eventTitle,
          eventDate,
          eventTime,
          teamName,
          clubName,
          eventLink,
          clubLogoUrl,
        },
      },
    });

    if (emailError) {
      console.error('Error sending duty notification email:', emailError);
      return new Response(
        JSON.stringify({ success: false, error: emailError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Duty notification email sent successfully to ${recipient.email}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in send-duty-notification-email:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
