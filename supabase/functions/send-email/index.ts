import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import * as React from "npm:react@18.3.1";
import { TeamInviteEmail } from "./_templates/team-invite.tsx";
import { ChildAddedEmail } from "./_templates/child-added.tsx";
import { EventReminderEmail } from "./_templates/event-reminder.tsx";
import { MembershipConfirmationEmail } from "./_templates/membership-confirmation.tsx";
import { MagicLinkEmail } from "./_templates/magic-link.tsx";
import { RenewalReminderEmail } from "./_templates/renewal-reminder.tsx";
import { MessageNotificationEmail } from "./_templates/message-notification.tsx";
import { StorageWarningEmail } from "./_templates/storage-warning.tsx";
import { SubscriptionRenewedEmail } from "./_templates/subscription-renewed.tsx";
import { PaymentFailedEmail } from "./_templates/payment-failed.tsx";
import { PhotoUploadedEmail } from "./_templates/photo-uploaded.tsx";
import { PitchBoardNotificationEmail } from "./_templates/pitch-board-notification.tsx";
import { DutyAssignedEmail } from "./_templates/duty-assigned.tsx";
import { PointsAwardedEmail } from "./_templates/points-awarded.tsx";
import { RewardRedeemedEmail } from "./_templates/reward-redeemed.tsx";
import { GameStatsReadyEmail } from "./_templates/game-stats-ready.tsx";
import { JoinRequestResponseEmail } from "./_templates/join-request-response.tsx";
import { sportEmoji, swapTrailingSportEmoji } from "./_templates/sport-meta.ts";

/**
 * Look up the club's sport and the team's team_type for sport-aware /
 * audience-aware email rendering. Best-effort; failures are non-fatal.
 */
async function resolveSportAndTeamType(
  supabaseAdmin: any,
  clubName?: string,
  teamName?: string,
): Promise<{ sport: string | null; teamType: string | null }> {
  if (!supabaseAdmin || !clubName) return { sport: null, teamType: null };
  try {
    const { data: club } = await supabaseAdmin
      .from('clubs')
      .select('id, sport')
      .eq('name', clubName)
      .maybeSingle();
    let sport: string | null = club?.sport ?? null;
    let teamType: string | null = null;
    if (club?.id && teamName) {
      const { data: team } = await supabaseAdmin
        .from('teams')
        .select('team_type, sport')
        .eq('club_id', club.id)
        .eq('name', teamName)
        .maybeSingle();
      if (team) {
        teamType = team.team_type ?? null;
        sport = team.sport ?? sport;
      }
    }
    return { sport, teamType };
  } catch (e) {
    console.warn('[send-email] sport/teamType lookup failed:', (e as Error)?.message);
    return { sport: null, teamType: null };
  }
}


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
const RATE_LIMIT_MAX_EMAILS = 200; // 200 emails per hour per user (supports bulk invite workflows)
const MAX_REQUEST_SIZE = 102400; // 100KB max for email content

// Template types
type TemplateType = 
  | "team-invite" 
  | "invite-reminder" 
  | "child-added"
  | "event-reminder" 
  | "membership-confirmation" 
  | "magic-link"
  | "renewal-reminder"
  | "message-notification"
  | "storage-warning"
  | "subscription-renewed"
  | "payment-failed"
  | "photo-uploaded"
  | "pitch-board-notification"
  | "duty-assigned"
  | "points-awarded"
  | "reward-redeemed"
  | "game-stats-ready"
  | "join-request-response";

interface EmailRequest {
  to: string | string[];
  subject: string;
  html?: string;
  from?: string;
  replyTo?: string;
  senderName?: string;
  // Template-based email
  template?: TemplateType;
  templateData?: TeamInviteTemplateData | EventReminderTemplateData | MembershipConfirmationTemplateData | MagicLinkTemplateData | RenewalReminderTemplateData | MessageNotificationTemplateData | StorageWarningTemplateData | SubscriptionRenewedTemplateData | PaymentFailedTemplateData | PhotoUploadedTemplateData | PitchBoardNotificationTemplateData | DutyAssignedTemplateData | PointsAwardedTemplateData | RewardRedeemedTemplateData | GameStatsReadyTemplateData | JoinRequestResponseTemplateData;
}

interface TeamInviteTemplateData {
  recipientName: string;
  invitedEmail?: string;
  teamName: string;
  clubName: string;
  roleName: string;
  inviteLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  childrenNames?: string[];
  customMessage?: string;
  isMiniLeague?: boolean;
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

interface PhotoUploadedTemplateData {
  recipientName?: string;
  uploaderName: string;
  contextType: 'team' | 'club';
  contextName: string;
  photoLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

interface PitchBoardNotificationTemplateData {
  recipientName: string;
  teamName: string;
  notificationType: 'pending_sub' | 'half_time' | 'full_time' | 'game_linked';
  notificationMessage: string;
  eventLink?: string;
  playerOutName?: string;
  playerInName?: string;
  position?: string;
  elapsedMinutes?: number;
  currentHalf?: number;
}

interface DutyAssignedTemplateData {
  recipientName?: string;
  dutyName: string;
  eventTitle: string;
  eventDate: string;
  eventTime?: string;
  teamName?: string;
  clubName: string;
  eventLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

interface PointsAwardedTemplateData {
  recipientName?: string;
  pointsAwarded: number;
  reason?: string;
  totalPoints: number;
  clubName: string;
  profileLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  rewardUnlocked?: boolean;
  rewardName?: string;
}

interface RewardRedeemedTemplateData {
  recipientName?: string;
  rewardName: string;
  pointsSpent: number;
  remainingPoints: number;
  clubName: string;
  rewardDescription?: string;
  sponsorName?: string;
  showQrCode?: boolean;
  profileLink: string;
  clubLogoUrl?: string;
  rewardLogoUrl?: string;
  primaryColor?: string;
  redeemedForChildName?: string;
}

interface GameStatsReadyTemplateData {
  recipientName?: string;
  teamName: string;
  eventTitle: string;
  eventDate: string;
  opponent?: string;
  totalPlayers: number;
  totalGameTime: string;
  reportLink: string;
  clubName: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

interface JoinRequestResponseTemplateData {
  recipientName: string;
  teamName?: string;
  clubName: string;
  roleName: string;
  approved: boolean;
  teamLink?: string;
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
async function renderEmailTemplate(template: TemplateType, data: any, supabaseAdmin?: any): Promise<string> {
  switch (template) {
    case "team-invite":
    case "invite-reminder": {
      // Check if the invited email belongs to an existing user.
      // Existing users get an "already on the app" template variant — no
      // download-the-app step, just a deep link into the new team/role.
      let isExistingUser = false;
      const emailToCheck = data.invitedEmail || (Array.isArray(data.to) ? data.to[0] : data.to);
      if (supabaseAdmin && emailToCheck) {
        try {
          // Query profiles via email_hash since auth.admin.getUserByEmail isn't available
          const { data: hashResult } = await supabaseAdmin.rpc('generate_email_hash', { email: emailToCheck });
          if (hashResult) {
            const { data: profile } = await supabaseAdmin
              .from('profiles')
              .select('id')
              .eq('email_hash', hashResult)
              .maybeSingle();
            isExistingUser = !!profile;
          }
          console.log(`Existing user check for ${emailToCheck}: ${isExistingUser}`);
        } catch (e) {
          console.warn("Could not check existing user:", e?.message || e);
        }
      }

      // Look up sport + team_type once so the template can render
      // sport-aware copy/emoji and audience-aware (junior vs senior) wording.
      const { sport, teamType } = await resolveSportAndTeamType(
        supabaseAdmin,
        data.clubName,
        data.teamName,
      );

      // Existing user + children → ChildAddedEmail (no download prompts).
      if (isExistingUser && data.childrenNames?.length > 0) {
        return await renderAsync(
          React.createElement(ChildAddedEmail, {
            recipientName: data.recipientName,
            teamName: data.teamName,
            clubName: data.clubName,
            inviteLink: data.inviteLink,
            clubLogoUrl: data.clubLogoUrl,
            primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
            childrenNames: data.childrenNames || [],
            customMessage: data.customMessage,
            sport: data.sport ?? sport,
          })
        );
      }

      return await renderAsync(
        React.createElement(TeamInviteEmail, {
          recipientName: data.recipientName,
          invitedEmail: data.invitedEmail,
          teamName: data.teamName,
          clubName: data.clubName,
          roleName: data.roleName,
          inviteLink: data.inviteLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
          childrenNames: data.childrenNames || [],
          customMessage: data.customMessage,
          isExistingUser,
          isMiniLeague: data.isMiniLeague,
          sport: data.sport ?? sport,
          teamType: data.teamType ?? teamType,
        })
      );
    }

    
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
    
    case "photo-uploaded":
      return await renderAsync(
        React.createElement(PhotoUploadedEmail, {
          recipientName: data.recipientName,
          uploaderName: data.uploaderName,
          contextType: data.contextType,
          contextName: data.contextName,
          photoLink: data.photoLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
        })
      );
    
    case "pitch-board-notification":
      return await renderAsync(
        React.createElement(PitchBoardNotificationEmail, {
          recipientName: data.recipientName,
          teamName: data.teamName,
          notificationType: data.notificationType,
          notificationMessage: data.notificationMessage,
          eventLink: data.eventLink,
          playerOutName: data.playerOutName,
          playerInName: data.playerInName,
          position: data.position,
          elapsedMinutes: data.elapsedMinutes,
          currentHalf: data.currentHalf,
        })
      );
    
    case "duty-assigned":
      return await renderAsync(
        React.createElement(DutyAssignedEmail, {
          recipientName: data.recipientName,
          dutyName: data.dutyName,
          eventTitle: data.eventTitle,
          eventDate: data.eventDate,
          eventTime: data.eventTime,
          teamName: data.teamName,
          clubName: data.clubName,
          eventLink: data.eventLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
        })
      );
    
    case "points-awarded":
      return await renderAsync(
        React.createElement(PointsAwardedEmail, {
          recipientName: data.recipientName,
          pointsAwarded: data.pointsAwarded,
          reason: data.reason,
          totalPoints: data.totalPoints,
          clubName: data.clubName,
          profileLink: data.profileLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
          rewardUnlocked: data.rewardUnlocked,
          rewardName: data.rewardName,
        })
      );
    
    case "reward-redeemed":
      return await renderAsync(
        React.createElement(RewardRedeemedEmail, {
          recipientName: data.recipientName,
          rewardName: data.rewardName,
          pointsSpent: data.pointsSpent,
          remainingPoints: data.remainingPoints,
          clubName: data.clubName,
          rewardDescription: data.rewardDescription,
          sponsorName: data.sponsorName,
          showQrCode: data.showQrCode,
          profileLink: data.profileLink,
          clubLogoUrl: data.clubLogoUrl,
          rewardLogoUrl: data.rewardLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
          redeemedForChildName: data.redeemedForChildName,
        })
      );
    
    case "game-stats-ready":
      return await renderAsync(
        React.createElement(GameStatsReadyEmail, {
          recipientName: data.recipientName,
          teamName: data.teamName,
          eventTitle: data.eventTitle,
          eventDate: data.eventDate,
          opponent: data.opponent,
          totalPlayers: data.totalPlayers,
          totalGameTime: data.totalGameTime,
          reportLink: data.reportLink,
          clubName: data.clubName,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
        })
      );
    
    case "join-request-response":
      return await renderAsync(
        React.createElement(JoinRequestResponseEmail, {
          recipientName: data.recipientName,
          teamName: data.teamName,
          clubName: data.clubName,
          roleName: data.roleName,
          approved: data.approved,
          teamLink: data.teamLink,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
        })
      );
    
    case "child-added":
      return await renderAsync(
        React.createElement(ChildAddedEmail, {
          recipientName: data.recipientName,
          teamName: data.teamName,
          clubName: data.clubName,
          inviteLink: data.inviteLink || `https://igniteclubhq.app`,
          clubLogoUrl: data.clubLogoUrl,
          primaryColor: data.primaryColor || IGNITE_BRAND_COLOR,
          childrenNames: data.childrenNames || (data.childName ? [data.childName] : []),
          customMessage: data.customMessage,
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

    const body = await req.json();
    let { to, subject, html, from, replyTo, senderName, template, templateData } = body as EmailRequest & { toUserId?: string };
    const toUserId = body.toUserId as string | undefined;

    // If toUserId is provided instead of "to", look up the user's email
    // Use batched RPC instead of auth admin REST call to avoid connection pool exhaustion
    if (!to && toUserId) {
      try {
        const { data: emailRows, error: userErr } = await adminClient
          .rpc("get_user_emails", { user_ids: [toUserId] });
        const resolvedEmail = emailRows?.[0]?.email as string | undefined;
        if (userErr || !resolvedEmail) {
          console.error("[send-email] Could not resolve toUserId to email:", userErr?.message);
          return new Response(
            JSON.stringify({ error: "Could not resolve user email" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        to = resolvedEmail;
        console.log(`[send-email] Resolved toUserId ${toUserId} to email`);
      } catch (e) {
        console.error("[send-email] Error resolving toUserId:", e);
        return new Response(
          JSON.stringify({ error: "Could not resolve user email" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

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

    // For team invites, rewrite any trailing sport emoji on the caller-supplied
    // subject so a cricket club doesn't get "⚽" (etc.). Falls back to keeping
    // the existing emoji if no sport is on record.
    if ((template === 'team-invite' || template === 'invite-reminder') && templateData?.clubName) {
      try {
        const { sport } = await resolveSportAndTeamType(
          adminClient,
          templateData.clubName,
          templateData.teamName,
        );
        if (sport) {
          subject = swapTrailingSportEmoji(subject, sport);
        }
      } catch (e) {
        console.warn('[send-email] subject emoji rewrite failed:', (e as Error)?.message);
      }
    }

    // Generate HTML from template or use provided HTML
    let emailHtml = html;
    if (template && templateData) {
      try {
        emailHtml = await renderEmailTemplate(template, templateData, adminClient);
        console.log(`Rendered ${template} template successfully`);
      } catch (templateError) {
        console.error("Template rendering error:", sanitizeError(templateError));
        return new Response(
          JSON.stringify({ error: "Failed to render email template" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }


    // Build sender: use senderName if provided, otherwise fall back to from or default
    let sender: string;
    if (senderName) {
      sender = `${senderName} <support@igniteclubhq.app>`;
    } else {
      sender = from || "Ignite Club HQ <support@igniteclubhq.app>";
    }

    console.log(`Sending ${template || 'custom'} email to ${toArray.length} recipient(s)${replyTo ? ` (reply-to: ${replyTo})` : ''}`);

    // Only BCC support for Bridgewater Soccer Club
    const isBridgewater = templateData?.clubName === 'Bridgewater Soccer Club';
    const sendPayload: any = {
      from: sender,
      to: toArray,
      subject,
      html: emailHtml!,
      ...(isBridgewater ? { bcc: ['support@igniteclubhq.app'] } : {}),
    };
    if (replyTo && isValidEmail(replyTo)) {
      sendPayload.reply_to = replyTo;
    }

    const emailResponse = await resend.emails.send(sendPayload);

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
