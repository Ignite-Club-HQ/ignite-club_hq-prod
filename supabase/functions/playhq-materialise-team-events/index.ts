// Materialises PlayHQ fixtures for a linked Ignite team into match events.
//
// For a team with `playhq_team_id` + `playhq_competition_id` set, walks every
// row in `competition_matches` belonging to that comp where the team is home
// or away, then:
//   - Links `home_team_id` / `away_team_id` to the Ignite team
//   - Creates a `match` event if one isn't already linked via
//     `home_event_id` / `away_event_id`
//   - Updates the existing event's date / venue / cancellation status
//
// Idempotent: re-running never duplicates events.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  team_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Identify caller (used as created_by on new events).
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  let callerId: string | null = null;
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    callerId = data.user?.id ?? null;
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.team_id) {
    return json({ error: "team_id required" }, 400);
  }

  // Load team.
  const { data: team, error: teamErr } = await supabase
    .from("teams")
    .select("id, club_id, name, playhq_team_id, playhq_competition_id, playhq_auto_create_events, created_by")
    .eq("id", body.team_id)
    .single();

  if (teamErr || !team) return json({ error: teamErr?.message ?? "team not found" }, 404);
  if (!team.playhq_team_id || !team.playhq_competition_id) {
    return json({ error: "team is not linked to a PlayHQ competition" }, 400);
  }
  if (team.playhq_auto_create_events === false) {
    return json({ ok: true, skipped: true, reason: "auto-create disabled" });
  }

  const createdBy = callerId ?? team.created_by;
  if (!createdBy) return json({ error: "no creator id available for events" }, 400);

  // Pull all matches in the linked comp involving this PlayHQ team.
  const { data: matches, error: mErr } = await supabase
    .from("competition_matches")
    .select(
      "id, scheduled_at, venue, status, external_home_team_id, external_away_team_id, home_team_name, away_team_name, home_event_id, away_event_id, home_team_id, away_team_id",
    )
    .eq("competition_id", team.playhq_competition_id)
    .or(
      `external_home_team_id.eq.${team.playhq_team_id},external_away_team_id.eq.${team.playhq_team_id}`,
    );
  if (mErr) return json({ error: mErr.message }, 500);

  let created = 0;
  let updated = 0;
  let cancelled = 0;

  for (const m of matches ?? []) {
    const isHome = m.external_home_team_id === team.playhq_team_id;
    const side = isHome ? "home" : "away";
    const eventIdCol = isHome ? "home_event_id" : "away_event_id";
    const teamIdCol = isHome ? "home_team_id" : "away_team_id";
    const opponentName = (isHome ? m.away_team_name : m.home_team_name) ?? "Opponent";
    const existingEventId = isHome ? m.home_event_id : m.away_event_id;
    const isCancelled = m.status === "cancelled";

    if (existingEventId) {
      // Update existing event to track PlayHQ changes.
      const patch: Record<string, unknown> = {};
      if (m.scheduled_at) patch.event_date = m.scheduled_at;
      if (m.venue) patch.location_name = m.venue;
      patch.is_cancelled = isCancelled;
      const { error: upErr } = await supabase
        .from("events")
        .update(patch)
        .eq("id", existingEventId);
      if (!upErr) {
        if (isCancelled) cancelled++;
        else updated++;
      }
      continue;
    }

    if (!m.scheduled_at) continue; // can't create an event without a date

    // Create event.
    const { data: ev, error: evErr } = await supabase
      .from("events")
      .insert({
        club_id: team.club_id,
        team_id: team.id,
        title: `vs ${opponentName}`,
        type: "game",
        event_date: m.scheduled_at,
        location_name: m.venue ?? null,
        opponent: opponentName,
        is_home_game: isHome,
        is_cancelled: isCancelled,
        created_by: createdBy,
        competition_match_id: m.id,
        competition_side: side,
      })
      .select("id")
      .single();

    if (evErr || !ev) continue;

    // Write back to competition_matches.
    await supabase
      .from("competition_matches")
      .update({ [eventIdCol]: ev.id, [teamIdCol]: team.id })
      .eq("id", m.id);

    created++;
  }

  return json({ ok: true, created, updated, cancelled, total: matches?.length ?? 0 });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
