import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import * as React from "npm:react@18.3.1";
import { TeamInviteEmail } from "./_templates/team-invite.tsx";
import { EventReminderEmail } from "./_templates/event-reminder.tsx";
import { MembershipConfirmationEmail } from "./_templates/membership-confirmation.tsx";
import { MagicLinkEmail } from "./_templates/magic-link.tsx";
import { RenewalReminderEmail } from "./_templates/renewal-reminder.tsx";
import { MessageNotificationEmail } from "./_templates/message-notification.tsx";
import { StorageWarningEmail } from "./_templates/storage-warning.tsx";
import { SubscriptionRenewedEmail } from "./_templates/subscription-renewed.tsx";
import { PaymentFailedEmail } from "./_templates/payment-failed.tsx";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// Security headers to prevent common attacks
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'none'",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  ...securityHeaders,
};

// Rate limiting configuration for email sending
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour
const RATE_LIMIT_MAX_EMAILS = 50; // 50 emails per hour per user
const MAX_REQUEST_SIZE = 102400; // 100KB max for email content

// Template types
type TemplateType = 
  | "team-invite" 
  | "invite-reminder" 
  | "event-reminder" 
  | "membership-confirmation" 
  | "magic-link"
  | "renewal-reminder"
  | "message-notification"
  | "storage-warning"
  | "subscription-renewed"
  | "payment-failed";

interface EmailRequest {
  to: string | string[];
  subject: string;
  html?: string;
  from?: string;
  // Template-based email
  template?: TemplateType;
  templateData?: TeamInviteTemplateData | EventReminderTemplateData | MembershipConfirmationTemplateData | MagicLinkTemplateData | RenewalReminderTemplateData | MessageNotificationTemplateData | StorageWarningTemplateData | SubscriptionRenewedTemplateData | PaymentFailedTemplateData;
}

interface TeamInviteTemplateData {
  recipientName: string;
  teamName: string;
  clubName: string;
  roleName: string;
  inviteLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  childrenNames?: string[];
}

interface EventReminderTemplateData {
  recipientName: string;
  eventTitle: string;
  teamName: string;
  clubName: string;
  eventDate: string;
  eventTime: string;
  eventLocation?: string;
  eventType: string;
  eventLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  hoursUntilEvent?: number;
}

interface MembershipConfirmationTemplateData {
  recipientName: string;
  teamName: string;
  clubName: string;
  roleName: string;
  teamLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  welcomeMessage?: string;
}

interface MagicLinkTemplateData {
  recipientName?: string;
  magicLink: string;
  otp?: string;
  expiresInMinutes?: number;
  actionType: 'login' | 'signup' | 'reset-password' | 'verify-email';
  appName?: string;
  logoUrl?: string;
  primaryColor?: string;
}

interface RenewalReminderTemplateData {
  recipientName?: string;
  entityName: string;
  entityType: 'team' | 'club';
  tierName: string;
  expiryDate: string;
  daysUntilExpiry: number;
  manageLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

interface MessageNotificationTemplateData {
  recipientName?: string;
  senderName: string;
  messagePreview: string;
  messageType: 'team' | 'club' | 'group' | 'direct' | 'broadcast';
  contextName?: string;
  messageLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  hasImage?: boolean;
}

interface StorageWarningTemplateData {
  recipientName?: string;
  entityName: string;
  entityType: 'team' | 'club';
  storageUsedGB: number;
  storageLimitGB: number;
  usagePercentage: number;
  upgradeLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

interface SubscriptionRenewedTemplateData {
  recipientName?: string;
  entityName: string;
  entityType: 'team' | 'club';
  tierName: string;
  renewalDate: string;
  nextBillingDate: string;
  manageLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

interface PaymentFailedTemplateData {
  recipientName?: string;
  entityName: string;
  entityType: 'team' | 'club';
  tierName: string;
  failureDate: string;
  updatePaymentLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

// Sanitize error messages
function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const sensitivePatterns = [
    /password/gi,
    /secret/gi,
    /key/gi,
    /token/gi,
    /credential/gi,
    /api[_-]?key/gi,
    /bearer/gi,
  ];
  
  let sanitized = message;
  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

// Validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

async function checkRateLimit(
  supabase: any,
  identifier: string,
  endpoint: string
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000);

  const { data: existing } = await supabase
    .from('rate_limits')
    .select('*')
    .eq('identifier', identifier)
    .eq('endpoint', endpoint)
    .single();

  if (existing) {
    const recordWindowStart = new Date(existing.window_start);
    
    if (recordWindowStart < windowStart) {
      await supabase.from('rate_limits').update({
        request_count: 1,
        window_start: now.toISOString(),
        updated_at: now.toISOString()
      }).eq('id', existing.id);
      
      return { allowed: true, remaining: RATE_LIMIT_MAX_EMAILS - 1, resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
    }

    if (existing.request_count >= RATE_LIMIT_MAX_EMAILS) {
      return { allowed: false, remaining: 0, resetAt: new Date(recordWindowStart.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
    }

    await supabase.from('rate_limits').update({
      request_count: existing.request_count + 1,
      updated_at: now.toISOString()
    }).eq('id', existing.id);

    return { allowed: true, remaining: RATE_LIMIT_MAX_EMAILS - existing.request_count - 1, resetAt: new Date(recordWindowStart.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
  }

  await supabase.from('rate_limits').insert({ identifier, endpoint, request_count: 1, window_start: now.toISOString() });
  return { allowed: true, remaining: RATE_LIMIT_MAX_EMAILS - 1, resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
}

// Ignite brand color - emerald green
const IGNITE_BRAND_COLOR = "#10b981";

// Render email template
async function renderEmailTemplate(template: TemplateType, data: any): Promise<string> {
  switch (template) {
    case "team-invite":
    case "invite-reminder":
      return await renderAsync(
        React.createElement(TeamInviteEmail, {
          recipientName: data.recipientName,
          teamName: data.teamName,
          clubName: data.clubName,
          roleName: data.roleName,
          inviteLink: data.inviteLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
          childrenNames: data.childrenNames || [],
        })
      );
    
    case "event-reminder":
      return await renderAsync(
        React.createElement(EventReminderEmail, {
          recipientName: data.recipientName,
          eventTitle: data.eventTitle,
          teamName: data.teamName,
          clubName: data.clubName,
          eventDate: data.eventDate,
          eventTime: data.eventTime,
          eventLocation: data.eventLocation,
          eventType: data.eventType,
          eventLink: data.eventLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
          hoursUntilEvent: data.hoursUntilEvent,
        })
      );
    
    case "membership-confirmation":
      return await renderAsync(
        React.createElement(MembershipConfirmationEmail, {
          recipientName: data.recipientName,
          teamName: data.teamName,
          clubName: data.clubName,
          roleName: data.roleName,
          teamLink: data.teamLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
          welcomeMessage: data.welcomeMessage,
        })
      );
    
    case "magic-link":
      return await renderAsync(
        React.createElement(MagicLinkEmail, {
          recipientName: data.recipientName,
          magicLink: data.magicLink,
          otp: data.otp,
          expiresInMinutes: data.expiresInMinutes || 60,
          actionType: data.actionType,
          appName: data.appName || "Ignite Club HQ",
          logoUrl: data.logoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
        })
      );
    
    case "renewal-reminder":
      return await renderAsync(
        React.createElement(RenewalReminderEmail, {
          recipientName: data.recipientName,
          entityName: data.entityName,
          entityType: data.entityType,
          tierName: data.tierName,
          expiryDate: data.expiryDate,
          daysUntilExpiry: data.daysUntilExpiry,
          manageLink: data.manageLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
        })
      );
    
    case "message-notification":
      return await renderAsync(
        React.createElement(MessageNotificationEmail, {
          recipientName: data.recipientName,
          senderName: data.senderName,
          messagePreview: data.messagePreview,
          messageType: data.messageType,
          contextName: data.contextName,
          messageLink: data.messageLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
          hasImage: data.hasImage,
        })
      );
    
    case "storage-warning":
      return await renderAsync(
        React.createElement(StorageWarningEmail, {
          recipientName: data.recipientName,
          entityName: data.entityName,
          entityType: data.entityType,
          storageUsedGB: data.storageUsedGB,
          storageLimitGB: data.storageLimitGB,
          usagePercentage: data.usagePercentage,
          upgradeLink: data.upgradeLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
        })
      );
    
    case "subscription-renewed":
      return await renderAsync(
        React.createElement(SubscriptionRenewedEmail, {
          recipientName: data.recipientName,
          entityName: data.entityName,
          entityType: data.entityType,
          tierName: data.tierName,
          renewalDate: data.renewalDate,
          nextBillingDate: data.nextBillingDate,
          manageLink: data.manageLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
        })
      );
    
    case "payment-failed":
      return await renderAsync(
        React.createElement(PaymentFailedEmail, {
          recipientName: data.recipientName,
          entityName: data.entityName,
          entityType: data.entityType,
          tierName: data.tierName,
          failureDate: data.failureDate,
          updatePaymentLink: data.updatePaymentLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
        })
      );
    
    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check request size to prevent memory exhaustion
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
      return new Response(
        JSON.stringify({ error: "Request too large" }),
        { status: 413, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get auth header for rate limiting by user
    const authHeader = req.headers.get("Authorization");
    let userId = "anonymous";
    
    if (authHeader) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        userId = user.id;
      }
    }

    // Rate limit check
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    
    const rateLimitResult = await checkRateLimit(adminClient, userId, 'send-email');
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for send-email`);
      return new Response(
        JSON.stringify({ 
          error: "Too many email requests. Please try again later.",
          retryAfter: Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000)
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000))
          } 
        }
      );
    }

    const { to, subject, html, from, template, templateData }: EmailRequest = await req.json();

    // Validate required fields
    if (!to || !subject) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to and subject" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Either html or template must be provided
    if (!html && !template) {
      return new Response(
        JSON.stringify({ error: "Either html or template must be provided" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate email addresses
    const toArray = Array.isArray(to) ? to : [to];
    for (const email of toArray) {
      if (!isValidEmail(email)) {
        return new Response(
          JSON.stringify({ error: "Invalid email format" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // Limit recipients to prevent abuse
    if (toArray.length > 50) {
      return new Response(
        JSON.stringify({ error: "Too many recipients" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate HTML from template or use provided HTML
    let emailHtml = html;
    if (template && templateData) {
      try {
        emailHtml = await renderEmailTemplate(template, templateData);
        console.log(`Rendered ${template} template successfully`);
      } catch (templateError) {
        console.error("Template rendering error:", sanitizeError(templateError));
        return new Response(
          JSON.stringify({ error: "Failed to render email template" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // Use verified domain sender
    const sender = from || "Ignite Club HQ <support@igniteclubhq.app>";

    console.log(`Sending ${template || 'custom'} email to ${toArray.length} recipient(s)`);

    const emailResponse = await resend.emails.send({
      from: sender,
      to: toArray,
      subject,
      html: emailHtml!,
    });

    // Verify the response has an ID (successful send)
    if (!emailResponse.data?.id) {
      console.error("Email send failed - no ID returned:", emailResponse.error);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: emailResponse.error?.message || "Email send failed - no confirmation received",
          verified: false
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Email sent successfully, ID:", emailResponse.data.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        verified: true,
        emailId: emailResponse.data.id,
        recipientCount: toArray.length,
        template: template || 'custom'
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error in send-email function:", sanitizeError(error));
    return new Response(
      JSON.stringify({ success: false, error: "Failed to send email", verified: false }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
