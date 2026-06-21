// Syncs an entire club from PlayHQ.
//
// Given a club with `playhq_tenant` + `playhq_org_id` set:
//  1. Lists every PlayHQ team the org runs.
//  2. Groups them by grade and calls `playhq-sync` per grade so the
//     competition + fixture rows exist in our DB.
//  3. For each PlayHQ team:
//       - Finds an Ignite team in this club already linked
//         (`playhq_team_id` match) or by name (case-insensitive). If none
//         exists, creates a fresh team in the club.
//       - Sets `playhq_team_id` + `playhq_competition_id` on it.
//  4. Calls `playhq-materialise-team-events` per team so fixtures become
//     events on each team's schedule.
//
// Supports a `mock: true` flag (or absent tenant API key) for local dev.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PLAYHQ_BASE = "https://api.playhq.com/v1";

interface Body {
  club_id: string;
  mock?: boolean;
}

interface PlayhqTeam {
  id: string;
  name: string;
  grade_id: string;
  grade_name: string;
  season?: string | null;
  sport?: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function playhqGet(path: string, apiKey: string, tenant: string) {
  const res = await fetch(`${PLAYHQ_BASE}${path}`, {
    headers: { "x-api-key": apiKey, "x-phq-tenant": tenant, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`PlayHQ ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function fetchAllPages(path: string, apiKey: string, tenant: string) {
  const items: any[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : path;
    const page = await playhqGet(url, apiKey, tenant);
    if (Array.isArray(page?.data)) items.push(...page.data);
    cursor = page?.metadata?.nextCursor;
    if (!page?.metadata?.hasMore || !cursor) break;
  }
  return items;
}

function mockTeams(): PlayhqTeam[] {
  return [
    { id: "mock-team-a", name: "Northside Hawks U12", grade_id: "mock-grade-u12", grade_name: "U12 Boys", sport: "basketball", season: "Winter 2026" },
    { id: "mock-team-b", name: "Northside Hawks U14", grade_id: "mock-grade-u14", grade_name: "U14 Boys", sport: "basketball", season: "Winter 2026" },
    { id: "mock-team-c", name: "Northside Hawks U16", grade_id: "mock-grade-u14", grade_name: "U14 Boys", sport: "basketball", season: "Winter 2026" },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Identify caller (used as created_by on new teams/events).
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  let callerId: string | null = null;
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    callerId = data.user?.id ?? null;
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.club_id) return json({ error: "club_id required" }, 400);

  const { data: club, error: clubErr } = await supabase
    .from("clubs")
    .select("id, name, playhq_tenant, playhq_org_id")
    .eq("id", body.club_id)
    .single();
  if (clubErr || !club) return json({ error: clubErr?.message ?? "club not found" }, 404);
  if (!club.playhq_tenant || !club.playhq_org_id) {
    return json({ error: "club is missing playhq_tenant or playhq_org_id" }, 400);
  }

  const tenantUpper = club.playhq_tenant.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const apiKey = Deno.env.get(`PLAYHQ_API_KEY_${tenantUpper}`);
  const useMock = body.mock === true || !apiKey;

  let teams: PlayhqTeam[] = [];
  try {
    if (useMock) {
      teams = mockTeams();
    } else {
      const raw = await fetchAllPages(`/organisations/${club.playhq_org_id}/teams`, apiKey!, club.playhq_tenant);
      teams = raw
        .map((t: any) => ({
          id: t.id,
          name: t.name ?? t.team?.name ?? "Unnamed",
          grade_id: t.grade?.id ?? t.gradeId ?? "",
          grade_name: t.grade?.name ?? "Grade",
          season: t.season?.name ?? null,
          sport: t.sport?.name ?? t.sport ?? null,
        }))
        .filter((t) => t.id && t.grade_id);
    }
  } catch (err) {
    return json({ error: `playhq fetch failed: ${(err as Error).message}` }, 502);
  }

  // 1. Per unique grade: sync the competition shell + fixtures.
  const gradeMap = new Map<string, PlayhqTeam>();
  for (const t of teams) if (!gradeMap.has(t.grade_id)) gradeMap.set(t.grade_id, t);

  for (const [gradeId, sample] of gradeMap) {
    try {
      await supabase.functions.invoke("playhq-sync", {
        body: {
          grade_id: gradeId,
          tenant: club.playhq_tenant,
          organizer_club_id: club.id,
          competition_name: sample.grade_name,
          sport: sample.sport ?? "basketball",
          season: sample.season ?? null,
          mock: useMock,
        },
      });
    } catch (_) { /* per-grade errors non-fatal */ }
  }

  // Re-load existing Ignite teams in this club to match against.
  const { data: existingTeams } = await supabase
    .from("teams")
    .select("id, name, playhq_team_id")
    .eq("club_id", club.id)
    .eq("is_archived", false);

  // Resolve comp ids (we just upserted them).
  const { data: comps } = await supabase
    .from("competitions")
    .select("id, external_id")
    .eq("source", "playhq")
    .eq("organizer_club_id", club.id)
    .in("external_id", Array.from(gradeMap.keys()));
  const compByGrade = new Map((comps ?? []).map((c) => [c.external_id, c.id]));

  let teamsLinked = 0;
  let teamsCreated = 0;
  const teamIdsToMaterialise: string[] = [];

  for (const t of teams) {
    // Match: linked already, else by name (case-insensitive) — but only
    // against teams NOT already linked to a different PlayHQ team, and only
    // if the name match is unambiguous. Two local teams sharing a name used
    // to silently re-link to the first match, stealing the link.
    let match = (existingTeams ?? []).find((e) => e.playhq_team_id === t.id);
    if (!match) {
      const norm = (s: string) => s.trim().toLowerCase();
      const target = norm(t.name);
      const candidates = (existingTeams ?? []).filter(
        (e) => norm(e.name) === target && (!e.playhq_team_id || e.playhq_team_id === t.id),
      );
      if (candidates.length === 1) match = candidates[0];
      // candidates.length > 1 → ambiguous, fall through to create a new team
      // so we never silently re-link the wrong one.
    }

    const compId = compByGrade.get(t.grade_id) ?? null;

    if (match) {
      const { error: upErr } = await supabase
        .from("teams")
        .update({
          playhq_team_id: t.id,
          playhq_competition_id: compId,
          playhq_auto_create_events: true,
        })
        .eq("id", match.id);
      if (!upErr) {
        teamsLinked++;
        teamIdsToMaterialise.push(match.id);
      }
    } else {
      const { data: created, error: insErr } = await supabase
        .from("teams")
        .insert({
          club_id: club.id,
          name: t.name,
          created_by: callerId,
          playhq_team_id: t.id,
          playhq_competition_id: compId,
          playhq_auto_create_events: true,
        })
        .select("id")
        .single();
      if (!insErr && created) {
        teamsCreated++;
        teamIdsToMaterialise.push(created.id);
      }
    }
  }

  // 4. Materialise events for every touched team.
  let eventsCreated = 0;
  let eventsUpdated = 0;
  for (const teamId of teamIdsToMaterialise) {
    try {
      const { data: r } = await supabase.functions.invoke("playhq-materialise-team-events", {
        body: { team_id: teamId },
      });
      const rr = r as { created?: number; updated?: number } | null;
      eventsCreated += rr?.created ?? 0;
      eventsUpdated += rr?.updated ?? 0;
    } catch (_) { /* ignore per-team */ }
  }

  return json({
    ok: true,
    mock: useMock,
    teams_seen: teams.length,
    teams_linked: teamsLinked,
    teams_created: teamsCreated,
    events_created: eventsCreated,
    events_updated: eventsUpdated,
  });
});
