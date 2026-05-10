// Auto-DM cadence (T-72h / T-24h / T-3h) for non-responders.
// Triggered by pg_cron every 15 minutes. Sends a DM from the club's system
// bot to each team member who still hasn't RSVP'd (themselves or any of
// their linked children) for an upcoming event.
//
// Dedupe: event_auto_dm_log unique(event_id, user_id, cadence) prevents
// double-sends. Pro-only and respects per-team auto_rsvp_dm_enabled toggle.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Cadence = "t72" | "t24" | "t3";

// Hours-before-event for each cadence.
const CADENCE_HOURS: Record<Cadence, number> = {
  t72: 72,
  t24: 24,
  t3: 3,
};

// Cron runs every 15 min, so use a 15-min window (slightly wider to absorb drift).
const WINDOW_MINUTES = 18;

interface EventRow {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  type: string;
  team_id: string;
  club_id: string | null;
  teams: { name: string; auto_rsvp_dm_enabled: boolean | null } | null;
  clubs: { name: string; logo_url: string | null; bot_user_id: string | null } | null;
}

function copyForCadence(cadence: Cadence, title: string, eventId: string, when: string): string {
  // Append [rsvp:<eventId>] token — the chat client renders inline
  // Going / Maybe / Out buttons under the bubble. Falls back to readable text
  // for any client that doesn't parse it.
  const token = `[rsvp:${eventId}]`;
  switch (cadence) {
    case "t72":
      return `📅 Heads up — "${title}" is on ${when}. We don't have your RSVP yet — tap below to respond.\n${token}`;
    case "t24":
      return `⏰ "${title}" is tomorrow (${when}) and we still need your RSVP. Tap below to confirm.\n${token}`;
    case "t3":
      return `🚨 "${title}" is starting in a few hours (${when}) and we don't have your RSVP yet. Please tap below to confirm.\n${token}`;
  }
}

function formatWhen(eventDate: string, startTime: string | null): string {
  const d = new Date(eventDate);
  const datePart = d.toLocaleDateString("en-AU", { weekday: "short", month: "short", day: "numeric" });
  if (!startTime) return datePart;
  const timeStr = String(startTime);
  const parsed = timeStr.includes("T") || timeStr.includes(" ")
    ? new Date(timeStr)
    : new Date(`2000-01-01T${timeStr}`);
  if (isNaN(parsed.getTime())) return datePart;
  const timePart = parsed.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${datePart} at ${timePart}`;
}

async function ensureClubBot(
  admin: ReturnType<typeof createClient>,
  clubId: string,
  clubName: string,
  clubLogoUrl: string | null,
  existingBotId: string | null,
): Promise<string | null> {
  if (existingBotId) return existingBotId;

  const botEmail = `bot-${clubId}@club.igniteapp.internal`;
  const botPassword = crypto.randomUUID() + crypto.randomUUID();

  let botUserId: string | null = null;
  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email: botEmail,
    password: botPassword,
    email_confirm: true,
    user_metadata: { full_name: clubName, is_club_bot: true, club_id: clubId },
  });
  if (createError) {
    if (createError.message?.includes("already been registered")) {
      const { data: existingUsers } = await admin.auth.admin.listUsers();
      const existing = existingUsers?.users?.find((u: any) => u.email === botEmail);
      if (existing) botUserId = existing.id;
    }
    if (!botUserId) {
      console.error("Failed to create bot for club", clubId, createError);
      return null;
    }
  } else {
    botUserId = newUser.user.id;
  }

  await admin.from("profiles").upsert({
    id: botUserId,
    display_name: clubName,
    avatar_url: clubLogoUrl,
  });
  await admin.from("clubs").update({ bot_user_id: botUserId }).eq("id", clubId);
  return botUserId;
}

async function getOrCreateDmConversation(
  admin: ReturnType<typeof createClient>,
  botUserId: string,
  userId: string,
): Promise<string | null> {
  // direct_conversations are 1:1 between participant_1 and participant_2.
  // Order doesn't matter — check both orderings.
  const { data: existing } = await admin
    .from("direct_conversations")
    .select("id")
    .or(
      `and(participant_1.eq.${botUserId},participant_2.eq.${userId}),and(participant_1.eq.${userId},participant_2.eq.${botUserId})`,
    )
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await admin
    .from("direct_conversations")
    .insert({
      participant_1: botUserId,
      participant_2: userId,
      created_by: botUserId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create DM conversation", { botUserId, userId, error });
    return null;
  }
  return created.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Authenticate the cron caller via shared secret. Anon-key calls are rejected.
  const cronSecret = Deno.env.get("AUTO_RSVP_DM_CRON_SECRET");
  const provided = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret");
  if (cronSecret && provided !== cronSecret) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const summary: Record<Cadence, { events: number; sent: number; skipped: number }> = {
    t72: { events: 0, sent: 0, skipped: 0 },
    t24: { events: 0, sent: 0, skipped: 0 },
    t3: { events: 0, sent: 0, skipped: 0 },
  };

  try {
    for (const cadence of ["t72", "t24", "t3"] as Cadence[]) {
      const hours = CADENCE_HOURS[cadence];
      const target = new Date(Date.now() + hours * 60 * 60 * 1000);
      const lo = new Date(target.getTime() - WINDOW_MINUTES * 60 * 1000).toISOString();
      const hi = new Date(target.getTime() + WINDOW_MINUTES * 60 * 1000).toISOString();

      const { data: events, error: eventsError } = await admin
        .from("events")
        .select(`
          id, title, event_date, start_time, type, team_id, club_id,
          teams!inner (name, auto_rsvp_dm_enabled),
          clubs (name, logo_url, bot_user_id)
        `)
        .gte("event_date", lo)
        .lte("event_date", hi)
        .not("team_id", "is", null)
        .returns<EventRow[]>();

      if (eventsError) {
        console.error("Failed to load events for cadence", cadence, eventsError);
        continue;
      }
      if (!events || events.length === 0) continue;

      // Restrict to match and training events only.
      const rsvpEvents = events.filter((e) =>
        ["match", "training"].includes((e.type || "").toLowerCase())
        && (e.teams?.auto_rsvp_dm_enabled ?? true)
      );
      if (rsvpEvents.length === 0) continue;

      // Pro check — batch by team_id and club_id.
      const teamIds = [...new Set(rsvpEvents.map((e) => e.team_id))];
      const clubIds = [...new Set(rsvpEvents.map((e) => e.club_id).filter(Boolean) as string[])];

      const [teamSubsRes, clubSubsRes] = await Promise.all([
        admin
          .from("team_subscriptions")
          .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("team_id", teamIds),
        clubIds.length
          ? admin
              .from("club_subscriptions")
              .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
              .in("club_id", clubIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const proTeams = new Set(
        (teamSubsRes.data || [])
          .filter((s: any) => s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override)
          .map((s: any) => s.team_id),
      );
      const proClubs = new Set(
        ((clubSubsRes.data as any[]) || [])
          .filter((s: any) => s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override)
          .map((s: any) => s.club_id),
      );

      for (const event of rsvpEvents) {
        const isPro = proTeams.has(event.team_id) || (event.club_id ? proClubs.has(event.club_id) : false);
        if (!isPro) continue;

        // Compute non-responders via SQL helper.
        const { data: nonResp, error: nonRespError } = await admin.rpc("get_event_non_responders", {
          _event_id: event.id,
        });
        if (nonRespError) {
          console.error("get_event_non_responders failed", event.id, nonRespError);
          continue;
        }
        const candidateUserIds: string[] = (nonResp || []).map((r: any) => r.user_id).filter(Boolean);
        if (candidateUserIds.length === 0) continue;

        // Filter out already-sent for this cadence.
        const { data: alreadySent } = await admin
          .from("event_auto_dm_log")
          .select("user_id")
          .eq("event_id", event.id)
          .eq("cadence", cadence)
          .in("user_id", candidateUserIds);
        const sentSet = new Set((alreadySent || []).map((r: any) => r.user_id));
        const targets = candidateUserIds.filter((u) => !sentSet.has(u));
        if (targets.length === 0) continue;

        // Resolve bot. Skip if there's no club (rare — direct team without club).
        if (!event.club_id || !event.clubs) {
          console.warn("Skipping event without club for auto-DM", event.id);
          continue;
        }
        const botUserId = await ensureClubBot(
          admin,
          event.club_id,
          event.clubs.name,
          event.clubs.logo_url,
          event.clubs.bot_user_id,
        );
        if (!botUserId) continue;

        // Don't DM the bot itself.
        const realTargets = targets.filter((u) => u !== botUserId);
        summary[cadence].events += 1;

        const when = formatWhen(event.event_date, event.start_time);
        const text = copyForCadence(cadence, event.title, event.id, when);

        // Send DMs sequentially per event so we don't blow the auth/profile
        // pool when many events fire in the same window. Within an event, fan
        // out with Promise.all is safe because each user is independent.
        const results = await Promise.all(
          realTargets.map(async (userId) => {
            try {
              const conversationId = await getOrCreateDmConversation(admin, botUserId, userId);
              if (!conversationId) return false;

              const { data: msg, error: msgError } = await admin
                .from("direct_messages")
                .insert({
                  conversation_id: conversationId,
                  author_id: botUserId,
                  text,
                  is_system_message: true,
                })
                .select("id")
                .single();
              if (msgError) {
                console.error("DM insert failed", { userId, eventId: event.id, msgError });
                return false;
              }

              await admin.from("event_auto_dm_log").insert({
                event_id: event.id,
                user_id: userId,
                cadence,
                dm_message_id: msg.id,
              });
              return true;
            } catch (err) {
              console.error("Auto-DM send failed", { userId, eventId: event.id, err });
              return false;
            }
          }),
        );

        const sent = results.filter(Boolean).length;
        summary[cadence].sent += sent;
        summary[cadence].skipped += realTargets.length - sent;
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auto-rsvp-dm-cron fatal", err);
    return new Response(JSON.stringify({ error: (err as Error).message, summary }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
