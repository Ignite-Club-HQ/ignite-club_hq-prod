import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { Resend } from 'npm:resend@2.0.0'
import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
}

const SITE_NAME = 'Ignite Club HQ'
const ROOT_DOMAIN = 'igniteclubhq.app'
const FROM_ADDRESS = `Ignite Club HQ <noreply@notify.igniteclubhq.app>`

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your email',
  invite: "You've been invited to Ignite Club HQ",
  magiclink: 'Your login link',
  recovery: 'Reset your password',
  email_change: 'Confirm your new email',
  reauthentication: 'Your verification code',
}

const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const hookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')

  if (!resendApiKey || !hookSecret) {
    console.error('Missing RESEND_API_KEY or SEND_EMAIL_HOOK_SECRET')
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const payloadRaw = await req.text()
  const headers = Object.fromEntries(req.headers)

  // Verify Supabase Send Email Hook signature (Standard Webhooks format).
  // The secret is stored as `v1,whsec_xxx...`; the library expects the base64 part.
  let data: any
  try {
    const secret = hookSecret.replace(/^v1,whsec_/, '')
    const wh = new Webhook(secret)
    data = wh.verify(payloadRaw, headers)
  } catch (err) {
    console.error('Webhook verification failed:', err)
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { user, email_data } = data as {
    user: { email: string; new_email?: string }
    email_data: {
      token: string
      token_hash: string
      redirect_to: string
      email_action_type: string
      site_url: string
      token_new?: string
      token_hash_new?: string
    }
  }

  const emailType = email_data.email_action_type
  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email type:', emailType)
    return new Response(JSON.stringify({ error: `Unknown email type: ${emailType}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Build the confirmation URL the same way Supabase does.
  const confirmationUrl =
    `${email_data.site_url}/auth/v1/verify?token=${email_data.token_hash}` +
    `&type=${emailType}&redirect_to=${encodeURIComponent(email_data.redirect_to || `https://${ROOT_DOMAIN}`)}`

  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    recipient: user.email,
    confirmationUrl,
    token: email_data.token,
    email: user.email,
    oldEmail: user.email,
    newEmail: user.new_email,
  }

  const html = await renderAsync(React.createElement(EmailTemplate, templateProps))

  const resend = new Resend(resendApiKey)
  const { error: sendError } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [user.email],
    subject: EMAIL_SUBJECTS[emailType] || 'Notification',
    html,
  })

  if (sendError) {
    console.error('Resend send failed:', sendError)
    return new Response(JSON.stringify({ error: sendError.message ?? 'Send failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Auth email sent via Resend', { emailType, to: user.email })
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
