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
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-lovable-signature, x-lovable-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your email',
  invite: "You've been invited",
  magiclink: 'Your login link',
  recovery: 'Reset your password',
  email_change: 'Confirm your new email',
  reauthentication: 'Your verification code',
}

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Configuration
const SITE_NAME = 'Ignite Club HQ'
const FROM_EMAIL = 'Ignite Club HQ <support@igniteclubhq.app>'

interface SupabaseSendEmailHookPayload {
  user?: {
    email?: string
  }
  email_data?: {
    email_action_type?: string
    token?: string
    token_hash?: string
    redirect_to?: string
    site_url?: string
    token_new?: string
    token_hash_new?: string
  }
}

function normalizeWebhookSecret(secret: string): string {
  return secret.startsWith('v1,') ? secret.slice(3) : secret
}

function buildConfirmationUrl(emailData: SupabaseSendEmailHookPayload['email_data']): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const tokenHash = emailData?.token_hash || emailData?.token_hash_new
  const actionType = emailData?.email_action_type
  const redirectTo = emailData?.redirect_to || emailData?.site_url || 'https://igniteclubhq.app'

  if (!supabaseUrl || !tokenHash || !actionType) {
    return redirectTo
  }

  const url = new URL(`${supabaseUrl}/auth/v1/verify`)
  url.searchParams.set('token', tokenHash)
  url.searchParams.set('type', actionType)
  url.searchParams.set('redirect_to', redirectTo)
  return url.toString()
}

// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder (RFC 6761 .test TLD) so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = "https://ignite-club-launchpad.lovable.app"
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: {
    token: '123456',
  },
}

// Preview endpoint handler - returns rendered HTML without sending email
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewCorsHeaders })
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const authHeader = req.headers.get('Authorization')

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type]

  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const sampleData = SAMPLE_DATA[type] || {}
  const html = await renderAsync(React.createElement(EmailTemplate, sampleData))

  return new Response(html, {
    status: 200,
    headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// Webhook handler - verifies Supabase Auth hook signature and sends via Resend
async function handleWebhook(req: Request): Promise<Response> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const hookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')

  if (!resendApiKey || !hookSecret) {
    console.error('Missing auth email secrets', {
      has_RESEND_API_KEY: Boolean(resendApiKey),
      has_SEND_EMAIL_HOOK_SECRET: Boolean(hookSecret),
    })
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let payload: SupabaseSendEmailHookPayload
  try {
    const headers = Object.fromEntries(req.headers.entries())
    const rawBody = await req.text()
    payload = new Webhook(normalizeWebhookSecret(hookSecret)).verify(rawBody, headers) as SupabaseSendEmailHookPayload
  } catch (error) {
    console.error('Webhook verification failed', { error })
    return new Response(
      JSON.stringify({ error: 'Invalid signature' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const emailType = payload.email_data?.email_action_type
  const recipient = payload.user?.email
  if (!emailType || !recipient) {
    console.error('Webhook payload missing required auth email data', { hasEmailType: Boolean(emailType), hasRecipient: Boolean(recipient) })
    return new Response(
      JSON.stringify({ error: 'Invalid webhook payload' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log('Received auth email event', { emailType, email: recipient })

  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email type', { emailType })
    return new Response(
      JSON.stringify({ error: `Unknown email type: ${emailType}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Build template props from payload.data (HookData structure)
  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: payload.email_data?.site_url || 'https://igniteclubhq.app',
    recipient,
    confirmationUrl: buildConfirmationUrl(payload.email_data),
    token: payload.email_data?.token || payload.email_data?.token_new,
    email: recipient,
    oldEmail: recipient,
    newEmail: recipient,
  }

  // Render React Email to HTML and plain text
  const html = await renderAsync(React.createElement(EmailTemplate, templateProps))
  const text = await renderAsync(React.createElement(EmailTemplate, templateProps), {
    plainText: true,
  })

  const resend = new Resend(resendApiKey)
  const { error: sendError } = await resend.emails.send({
    from: FROM_EMAIL,
    to: [recipient],
    subject: EMAIL_SUBJECTS[emailType] || 'Notification',
    html,
    text,
  })

  if (sendError) {
    console.error('Failed to send auth email via Resend', { error: sendError, emailType })
    return new Response(JSON.stringify({ error: 'Failed to send email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Auth email sent', { emailType, email: recipient })

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Handle CORS preflight for main endpoint
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Route to preview handler for /preview path
  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  // Main webhook handler
  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Webhook handler error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
