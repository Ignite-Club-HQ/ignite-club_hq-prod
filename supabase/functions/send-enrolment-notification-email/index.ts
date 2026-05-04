import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRoleAuth } from "../_shared/internal-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authErr = requireServiceRoleAuth(req, corsHeaders);
  if (authErr) return authErr;

  try {
    const { recipientUserId, childName, className, clubName, status, termName } = await req.json();

    if (!recipientUserId || !className || !clubName) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Get recipient email via batched RPC (avoids auth admin pool exhaustion)
    const { data: emailRows } = await supabase
      .rpc("get_user_emails", { user_ids: [recipientUserId] });
    const recipientEmail = emailRows?.[0]?.email as string | undefined;
    if (!recipientEmail) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check notification preferences
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('email_membership_enabled')
      .eq('user_id', recipientUserId)
      .maybeSingle();

    if (prefs && prefs.email_membership_enabled === false) {
      return new Response(JSON.stringify({ skipped: true, reason: 'email_membership_disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // recipientEmail already set above via get_user_emails RPC
    const memberName = childName || 'You';
    const isWaitlisted = status === 'waitlisted';
    const isPromotion = status === 'promoted';

    let subject: string;
    let heading: string;
    let body: string;

    if (isPromotion) {
      subject = `🎉 Spot available — ${memberName} is now enrolled in ${className}`;
      heading = 'Great news!';
      body = `${memberName} has been promoted from the waitlist and is now enrolled in <strong>${className}</strong>${termName ? ` for ${termName}` : ''} at ${clubName}.`;
    } else if (isWaitlisted) {
      subject = `⏳ Waitlisted for ${className} — ${clubName}`;
      heading = 'Added to Waitlist';
      body = `${memberName} has been added to the waitlist for <strong>${className}</strong>${termName ? ` for ${termName}` : ''} at ${clubName}. We'll notify you when a spot opens up.`;
    } else {
      subject = `✅ Enrolled in ${className} — ${clubName}`;
      heading = 'Enrolment Confirmed';
      body = `${memberName} has been successfully enrolled in <strong>${className}</strong>${termName ? ` for ${termName}` : ''} at ${clubName}.`;
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5">
        <div style="max-width:480px;margin:0 auto;padding:24px">
          <div style="background:white;border-radius:12px;padding:32px 24px;text-align:center">
            <div style="width:48px;height:48px;background:#10b981;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center">
              <span style="color:white;font-size:24px">${isWaitlisted ? '⏳' : '✅'}</span>
            </div>
            <h1 style="font-size:20px;margin:0 0 8px;color:#18181b">${heading}</h1>
            <p style="font-size:14px;color:#52525b;line-height:1.6;margin:0 0 24px">${body}</p>
            <a href="https://igniteclubhq.app" style="display:inline-block;background:#10b981;color:white;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:500">
              Open App
            </a>
          </div>
          <p style="text-align:center;font-size:11px;color:#a1a1aa;margin-top:16px">
            Ignite Club HQ • You received this because you're enrolled at ${clubName}
          </p>
        </div>
      </body>
      </html>
    `;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Ignite Club HQ <notifications@igniteclubhq.app>',
        to: [recipientEmail],
        subject,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errorText = await emailRes.text();
      console.error('Resend error:', errorText);
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: (error as Error)?.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
