// Auto RSVP push cadence (Pro): T-6d / T-48h / T-6h for non-responders.
//
// Offsets are deliberately chosen to NOT collide with the auto-DM cadence
// (T-72h / T-24h / T-3h). Closest gap is 21h so a member never gets a DM
// and a push for the same event within a couple of hours.
//
// Triggered by pg_cron every 15 min. Dedupes via event_auto_push_log
// unique(event_id, user_id, cadence). Pro-only, opt-in per team via
// teams.auto_rsvp_push_enabled.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Cadence = "t6d" | "t48h" | "t6h";

// Hours-before-event for each cadence.
const CADENCE_HOURS: Record<Cadence, number> = {
  t6d: 6 * 24, // 144h
  t48h: 48,
  t6h: 6,
};

// Cron runs every 15 min; widen slightly to absorb drift.
const WINDOW_MINUTES = 18;

interface EventRow {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  type: string;
  team_id: string;
  club_id: string | null;
  teams: {
    name: string;
    auto_rsvp_push_enabled: boolean | null;
    auto_rsvp_push_cadences: string[] | null;
    auto_rsvp_push_event_types: string[] | null;
  } | null;
}

function copyForCadence(cadence: Cadence, title: string, when: string): { title: string; body: string } {
  switch (cadence) {
    case "t6d":
      return {
        title: "📅 Coming up next week",
        body: `"${title}" is on ${when}. Tap to RSVP.`,
      };
    case "t48h":
      return {
        title: "⏰ Two days to go",
        body: `"${title}" is on ${when}. We still need your RSVP.`,
      };
    case "t6h":
      return {
        title: "🚨 Starting soon",
        body: `"${title}" is in a few hours (${when}). Please confirm now.`,
      };
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Optional shared-secret auth (mirrors auto-rsvp-dm-cron).
  const cronSecret = Deno.env.get("AUTO_RSVP_DM_CRON_SECRET");
  const provided = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret");
  if (cronSecret && provided !== cronSecret) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const summary: Record<Cadence, { events: number; sent: number; skipped: number }> = {
    t6d: { events: 0, sent: 0, skipped: 0 },
    t48h: { events: 0, sent: 0, skipped: 0 },
    t6h: { events: 0, sent: 0, skipped: 0 },
  };

  try {
    for (const cadence of ["t6d", "t48h", "t6h"] as Cadence[]) {
      const hours = CADENCE_HOURS[cadence];
      const target = new Date(Date.now() + hours * 60 * 60 * 1000);
      const lo = new Date(target.getTime() - WINDOW_MINUTES * 60 * 1000).toISOString();
      const hi = new Date(target.getTime() + WINDOW_MINUTES * 60 * 1000).toISOString();

      const { data: events, error: eventsError } = await admin
        .from("events")
        .select(`
          id, title, event_date, start_time, type, team_id, club_id,
          teams!inner (name, auto_rsvp_push_enabled, auto_rsvp_push_cadences, auto_rsvp_push_event_types)
        `)
        .gte("event_date", lo)
        .lte("event_date", hi)
        .eq("is_cancelled", false)
        .not("team_id", "is", null)
        .returns<EventRow[]>();

      if (eventsError) {
        console.error("Failed to load events for cadence", cadence, eventsError);
        continue;
      }
      if (!events?.length) continue;

      // Apply per-team toggle + cadence allow-list + event-type allow-list.
      const rsvpEvents = events.filter((e) => {
        if (!(e.teams?.auto_rsvp_push_enabled ?? false)) return false;
        const allowedTypes = e.teams?.auto_rsvp_push_event_types ?? ["match", "training", "game"];
        const allowedCadences = e.teams?.auto_rsvp_push_cadences ?? ["t6d", "t48h", "t6h"];
        if (!allowedCadences.includes(cadence)) return false;
        return allowedTypes.includes((e.type || "").toLowerCase());
      });
      if (!rsvpEvents.length) continue;

      // Pro check batched across teams + clubs.
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

        const { data: nonResp, error: nonRespError } = await admin.rpc("get_event_non_responders", {
          _event_id: event.id,
        });
        if (nonRespError) {
          console.error("get_event_non_responders failed", event.id, nonRespError);
          continue;
        }
        const candidateUserIds: string[] = (nonResp || []).map((r: any) => r.user_id).filter(Boolean);
        if (!candidateUserIds.length) continue;

        // Filter out already-sent for this cadence.
        const { data: alreadySent } = await admin
          .from("event_auto_push_log")
          .select("user_id")
          .eq("event_id", event.id)
          .eq("cadence", cadence)
          .in("user_id", candidateUserIds);
        const sentSet = new Set((alreadySent || []).map((r: any) => r.user_id));
        const targets = candidateUserIds.filter((u) => !sentSet.has(u));
        if (!targets.length) continue;

        summary[cadence].events += 1;

        const when = formatWhen(event.event_date, event.start_time);
        const { title, body } = copyForCadence(cadence, event.title, when);
        const url = `/events/${event.id}`;

        const results = await Promise.all(
          targets.map(async (userId) => {
            try {
              // Insert notification first so the bell + push share the same row.
              const { data: notif, error: notifError } = await admin
                .from("notifications")
                .insert({
                  user_id: userId,
                  type: "event_reminder",
                  message: `${title} — ${body}`,
                  related_id: event.id,
                  skip_push: true, // we trigger push explicitly below
                })
                .select("id")
                .single();
              if (notifError) {
                console.error("notif insert failed", { userId, eventId: event.id, notifError });
                return false;
              }

              await admin.functions.invoke("send-push-notification", {
                body: {
                  userId,
                  title,
                  body,
                  url,
                  tag: `auto-rsvp-${event.id}-${cadence}`,
                  notificationType: "event_reminder",
                  notificationId: notif.id,
                  data: { eventId: event.id, type: "event_reminder", cadence },
                },
              });

              await admin.from("event_auto_push_log").insert({
                event_id: event.id,
                user_id: userId,
                cadence,
                notification_id: notif.id,
              });
              return true;
            } catch (err) {
              console.error("auto push send failed", { userId, eventId: event.id, err });
              return false;
            }
          }),
        );
        const sent = results.filter(Boolean).length;
        summary[cadence].sent += sent;
        summary[cadence].skipped += targets.length - sent;
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auto-rsvp-push-cron fatal", err);
    return new Response(JSON.stringify({ error: (err as Error).message, summary }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
