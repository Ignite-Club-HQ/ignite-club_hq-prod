// PlayHQ sync edge function (Option D — Hybrid).
//
// Syncs a PlayHQ grade into Ignite's canonical competitions tables:
//   - competitions       (source='playhq', external_id=<grade_id>)
//   - competition_matches (source='playhq', external_id=<game_id>)
//   - playhq_player_stats (kept separate; identity-matching is Phase 2)
//
// Ladder is auto-computed from competition_matches via the competition_ladder view.
//
// Modes:
//  - Real:  uses PLAYHQ_API_KEY_<TENANT> + x-phq-tenant header to call https://api.playhq.com/v1
//  - Mock:  no API key configured, or `mock: true` → deterministic sample data.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PLAYHQ_BASE = "https://api.playhq.com/v1";

interface SyncRequest {
  grade_id: string;            // PlayHQ grade id (external_id of the competition)
  tenant: string;              // e.g. "bv", "netball-au"
  organizer_club_id: string;   // Ignite club that owns the competition shell
  competition_name?: string;   // used on first sync if competition doesn't exist
  sport?: string;
  season?: string;
  mock?: boolean;
}

interface MappedGame {
  external_id: string;
  scheduled_at: string | null;
  status: string;              // 'scheduled' | 'completed' | 'cancelled'
  round_number: number | null;
  venue: string | null;
  external_home_team_id: string | null;
  home_team_name: string | null;
  home_score: number | null;
  external_away_team_id: string | null;
  away_team_name: string | null;
  away_score: number | null;
}

interface StatRow {
  playhq_game_id: string;
  playhq_team_id: string;
  playhq_player_id: string;
  player_name: string | null;
  stats: Record<string, number>;
  raw: unknown;
}

function mockGames(gradeId: string): MappedGame[] {
  const teams = [
    { id: "mock-team-a", name: "Northside Hawks" },
    { id: "mock-team-b", name: "Eastvale Tigers" },
    { id: "mock-team-c", name: "Southport Sharks" },
    { id: "mock-team-d", name: "Westfield Wolves" },
  ];
  const now = Date.now();
  return Array.from({ length: 6 }).map((_, i) => {
    const h = teams[i % teams.length];
    const a = teams[(i + 1) % teams.length];
    const played = i < 3;
    return {
      external_id: `mock-${gradeId}-game-${i}`,
      scheduled_at: new Date(now + (i - 3) * 7 * 86_400_000).toISOString(),
      status: played ? "completed" : "scheduled",
      round_number: i + 1,
      venue: "Sample Stadium",
      external_home_team_id: h.id,
      home_team_name: h.name,
      home_score: played ? 40 + i * 3 : null,
      external_away_team_id: a.id,
      away_team_name: a.name,
      away_score: played ? 35 + i * 2 : null,
    };
  });
}

function mockStats(gradeId: string): StatRow[] {
  return Array.from({ length: 3 }).map((_, i) => ({
    playhq_game_id: `mock-${gradeId}-game-0`,
    playhq_team_id: "mock-team-a",
    playhq_player_id: `mock-${gradeId}-p${i}`,
    player_name: `Player ${i + 1}`,
    stats: { points: 8 + i * 4, rebounds: 3 + i, assists: 2 + i },
    raw: { mock: true },
  }));
}

async function playhqGet(path: string, apiKey: string, tenant: string) {
  const res = await fetch(`${PLAYHQ_BASE}${path}`, {
    headers: {
      "x-api-key": apiKey,
      "x-phq-tenant": tenant,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`PlayHQ ${res.status} on ${path}: ${await res.text()}`);
  }
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

function normaliseStatus(s: string | null | undefined): string {
  const v = String(s ?? "").toUpperCase();
  if (/FINAL|COMPLETE|FT/.test(v)) return "completed";
  if (/CANCEL|FORFEIT|WASH/.test(v)) return "cancelled";
  return "scheduled";
}

function mapPlayhqGame(g: any): MappedGame {
  return {
    external_id: g.id,
    scheduled_at: g.schedule?.date ?? g.startsAt ?? null,
    status: normaliseStatus(g.status),
    round_number: Number(g.round?.number ?? g.round?.name?.match?.(/\d+/)?.[0]) || null,
    venue: g.venue?.name ?? null,
    external_home_team_id: g.teams?.home?.id ?? null,
    home_team_name: g.teams?.home?.name ?? null,
    home_score: g.score?.home ?? null,
    external_away_team_id: g.teams?.away?.id ?? null,
    away_team_name: g.teams?.away?.name ?? null,
    away_score: g.score?.away ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = (await req.json().catch(() => ({}))) as SyncRequest;
  if (!body.grade_id || !body.tenant || !body.organizer_club_id) {
    return new Response(
      JSON.stringify({ error: "grade_id, tenant and organizer_club_id are required" }),
      { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const tenantUpper = body.tenant.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const apiKey = Deno.env.get(`PLAYHQ_API_KEY_${tenantUpper}`);
  const useMock = body.mock === true || !apiKey;

  const startedAt = new Date().toISOString();
  let games: MappedGame[] = [];
  let stats: StatRow[] = [];
  let status = "ok";
  let error: string | null = null;
  let competitionId: string | null = null;
  let matchesUpserted = 0;

  try {
    // 1. Upsert competition shell (source='playhq', external_id=grade_id)
    const { data: comp, error: compErr } = await supabase
      .from("competitions")
      .upsert(
        {
          source: "playhq",
          external_id: body.grade_id,
          external_tenant: body.tenant,
          organizer_club_id: body.organizer_club_id,
          name: body.competition_name ?? `PlayHQ Grade ${body.grade_id}`,
          sport: body.sport ?? "basketball",
          season: body.season ?? null,
          status: "active",
          visibility: "public",
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "source,external_id" },
      )
      .select("id")
      .single();
    if (compErr) throw compErr;
    competitionId = comp.id;

    // 2. Pull games (real or mock)
    if (useMock) {
      games = mockGames(body.grade_id);
      stats = mockStats(body.grade_id);
    } else {
      const raw = await fetchAllPages(`/grades/${body.grade_id}/fixture`, apiKey!, body.tenant);
      games = raw.map(mapPlayhqGame);

      for (const g of games.filter((g) => g.status === "completed")) {
        try {
          const sRes = await playhqGet(`/games/${g.external_id}/statistics`, apiKey!, body.tenant);
          const rows = Array.isArray(sRes?.data) ? sRes.data : [];
          for (const r of rows) {
            stats.push({
              playhq_game_id: g.external_id,
              playhq_team_id: r.team?.id ?? r.teamId ?? "",
              playhq_player_id: r.player?.id ?? r.playerId ?? "",
              player_name: r.player?.name ?? null,
              stats: r.statistics ?? r.stats ?? {},
              raw: r,
            });
          }
        } catch (_) { /* stats are best-effort */ }
      }
    }

    // 3. Upsert matches into competition_matches
    if (games.length) {
      const rows = games.map((g) => ({
        source: "playhq",
        external_id: g.external_id,
        competition_id: competitionId!,
        scheduled_at: g.scheduled_at,
        status: g.status,
        round_number: g.round_number,
        venue: g.venue,
        external_home_team_id: g.external_home_team_id,
        home_team_name: g.home_team_name,
        home_score: g.home_score,
        external_away_team_id: g.external_away_team_id,
        away_team_name: g.away_team_name,
        away_score: g.away_score,
        last_synced_at: new Date().toISOString(),
      }));
      const { error: mErr } = await supabase
        .from("competition_matches")
        .upsert(rows, { onConflict: "source,external_id" });
      if (mErr) throw mErr;
      matchesUpserted = rows.length;
    }

    // 4. Player stats stay in their dedicated table (claim flow is Phase 2)
    if (stats.length) {
      const { error: sErr } = await supabase
        .from("playhq_player_stats")
        .upsert(stats, { onConflict: "playhq_game_id,playhq_player_id" });
      if (sErr) throw sErr;
    }
  } catch (err) {
    status = "error";
    error = err instanceof Error ? err.message : String(err);
  }

  await supabase.from("playhq_sync_log").insert({
    playhq_grade_id: body.grade_id,
    tenant: body.tenant,
    status,
    fixtures_synced: matchesUpserted,
    ladder_rows: 0,
    stat_rows: stats.length,
    error,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });

  return new Response(
    JSON.stringify({
      ok: status === "ok",
      mock: useMock,
      competition_id: competitionId,
      matches: matchesUpserted,
      stats: stats.length,
      error,
    }),
    {
      status: status === "ok" ? 200 : 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    },
  );
});
