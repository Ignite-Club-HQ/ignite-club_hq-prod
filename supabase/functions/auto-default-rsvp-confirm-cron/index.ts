// Phase 2: 18h-before confirmation nudge for "default" training RSVPs.
//
// For each upcoming training event ~18h out, find every RSVP with
// status='going' and source='default' that hasn't been confirmed yet,
// and DM the responsible parent (or the user themselves if it's an adult
// member) from the club's system bot asking them to confirm.
//
// One DM per (event, parent_user_id, child_id|null) — enforced by the
// event_default_confirm_log unique index.
//
// Cron: every 30 min. Window: 16h..20h to absorb drift and event-time
// edits (we deliberately err on the wider side because we ONLY ever send
// one nudge per default-applied RSVP so there's no spam risk).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

interface DefaultRsvpRow {
  id: string;
  event_id: string;
  user_id: string | null;
  child_id: string | null;
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

function copy(eventId: string, title: string, when: string, subject: string): string {
  const link = `https://igniteclubhq.app/events/${eventId}`;
  const token = `[rsvp:${eventId}]`;
  return `⏰ ${subject} for "${title}" tomorrow (${when}) via your training default. Tap to confirm or change.\nOpen event: ${link}\n${token}`;
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
    .insert({ participant_1: botUserId, participant_2: userId, created_by: botUserId })
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

  const cronSecret = Deno.env.get("AUTO_RSVP_DM_CRON_SECRET");
  const provided = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret");
  if (cronSecret && provided !== cronSecret) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 16h..20h window from now.
  const now = Date.now();
  const lo = new Date(now + 16 * 60 * 60 * 1000).toISOString();
  const hi = new Date(now + 20 * 60 * 60 * 1000).toISOString();

  let totalEvents = 0;
  let totalSent = 0;
  let totalSkipped = 0;

  try {
    const { data: events, error: eventsError } = await admin
      .from("events")
      .select(`
        id, title, event_date, start_time, type, team_id, club_id, is_cancelled,
        teams!inner (name, auto_rsvp_dm_enabled),
        clubs (name, logo_url, bot_user_id)
      `)
      .gte("event_date", lo)
      .lte("event_date", hi)
      .eq("is_cancelled", false)
      .eq("type", "training")
      .not("team_id", "is", null)
      .returns<EventRow[]>();

    if (eventsError) throw eventsError;
    if (!events || events.length === 0) {
      return new Response(JSON.stringify({ ok: true, totalEvents: 0, totalSent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trainings = events.filter((e) => e.teams?.auto_rsvp_dm_enabled ?? false);
    if (trainings.length === 0) {
      return new Response(JSON.stringify({ ok: true, totalEvents: 0, totalSent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pro gate (training defaults are a Pro behavior)
    const teamIds = [...new Set(trainings.map((e) => e.team_id))];
    const clubIds = [...new Set(trainings.map((e) => e.club_id).filter(Boolean) as string[])];
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

    for (const event of trainings) {
      const isPro = proTeams.has(event.team_id) || (event.club_id ? proClubs.has(event.club_id) : false);
      if (!isPro) continue;
      if (!event.club_id || !event.clubs) continue;

      // All default-applied "going" RSVPs for this event
      const { data: rsvps, error: rsvpsErr } = await admin
        .from("rsvps")
        .select("id, event_id, user_id, child_id")
        .eq("event_id", event.id)
        .eq("status", "going")
        .eq("source", "default")
        .returns<DefaultRsvpRow[]>();
      if (rsvpsErr) {
        console.error("rsvp load failed", event.id, rsvpsErr);
        continue;
      }
      if (!rsvps || rsvps.length === 0) continue;

      // Map child_id → parent user_id (for child rsvps)
      const childIds = [...new Set(rsvps.map((r) => r.child_id).filter(Boolean) as string[])];
      const childParentMap = new Map<string, { name: string; parent_id: string }>();
      if (childIds.length) {
        const { data: kids } = await admin
          .from("children")
          .select("id, name, parent_id")
          .in("id", childIds);
        for (const c of kids || []) {
          if (c.parent_id) childParentMap.set(c.id, { name: c.name, parent_id: c.parent_id });
        }
      }

      // Build the (parent_user_id, child_id|null, rsvp_id, subject) targets
      type Target = { parentUserId: string; childId: string | null; rsvpId: string; subject: string };
      const targets: Target[] = [];
      for (const r of rsvps) {
        if (r.child_id) {
          const meta = childParentMap.get(r.child_id);
          if (!meta) continue;
          targets.push({
            parentUserId: meta.parent_id,
            childId: r.child_id,
            rsvpId: r.id,
            subject: `${meta.name} is set to Going`,
          });
        } else if (r.user_id) {
          targets.push({
            parentUserId: r.user_id,
            childId: null,
            rsvpId: r.id,
            subject: "You're set to Going",
          });
        }
      }
      if (targets.length === 0) continue;

      // Filter out already-sent
      const { data: alreadySent } = await admin
        .from("event_default_confirm_log")
        .select("parent_user_id, child_id")
        .eq("event_id", event.id);
      const sentSet = new Set(
        (alreadySent || []).map((r: any) => `${r.parent_user_id}:${r.child_id ?? "self"}`),
      );
      const fresh = targets.filter(
        (t) => !sentSet.has(`${t.parentUserId}:${t.childId ?? "self"}`),
      );
      if (fresh.length === 0) continue;

      const botUserId = await ensureClubBot(
        admin,
        event.club_id,
        event.clubs.name,
        event.clubs.logo_url,
        event.clubs.bot_user_id,
      );
      if (!botUserId) continue;

      const when = formatWhen(event.event_date, event.start_time);
      totalEvents += 1;

      const results = await Promise.all(
        fresh.map(async (t) => {
          if (t.parentUserId === botUserId) return false;
          try {
            const conversationId = await getOrCreateDmConversation(admin, botUserId, t.parentUserId);
            if (!conversationId) return false;

            const text = copy(event.id, event.title, when, t.subject);
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
              console.error("DM insert failed", { eventId: event.id, t, msgError });
              return false;
            }

            await admin.from("event_default_confirm_log").insert({
              event_id: event.id,
              parent_user_id: t.parentUserId,
              child_id: t.childId,
              rsvp_id: t.rsvpId,
              dm_message_id: msg.id,
            });
            return true;
          } catch (err) {
            console.error("default-confirm DM failed", { eventId: event.id, t, err });
            return false;
          }
        }),
      );

      const sent = results.filter(Boolean).length;
      totalSent += sent;
      totalSkipped += fresh.length - sent;
    }

    return new Response(JSON.stringify({ ok: true, totalEvents, totalSent, totalSkipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auto-default-rsvp-confirm-cron fatal", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
