// PlayHQ sync edge function.
// Pulls fixtures, ladder, and player stats for a given PlayHQ grade and upserts
// into the mirror tables (playhq_fixtures / playhq_ladder / playhq_player_stats).
//
// Modes:
//  - Real:  uses PLAYHQ_API_KEY_<TENANT> + tenant header to call https://api.playhq.com/v1
//  - Mock:  no API key yet, or `mock: true` in the request body → returns deterministic
//           sample data so the UI is end-to-end testable before the key arrives.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PLAYHQ_BASE = "https://api.playhq.com/v1";

interface SyncRequest {
  grade_id: string;       // PlayHQ grade id
  tenant: string;         // e.g. "bv", "netball"
  season_id?: string;
  mock?: boolean;
}

interface FixtureRow {
  playhq_game_id: string;
  playhq_grade_id: string;
  scheduled_at: string | null;
  status: string | null;
  round: string | null;
  venue_name: string | null;
  venue_address: string | null;
  court: string | null;
  home_playhq_team_id: string | null;
  home_team_name: string | null;
  home_score: number | null;
  away_playhq_team_id: string | null;
  away_team_name: string | null;
  away_score: number | null;
  raw: unknown;
}

interface LadderRow {
  playhq_grade_id: string;
  playhq_team_id: string;
  team_name: string;
  position: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  points_for: number;
  points_against: number;
  points_diff: number;
  raw: unknown;
}

interface StatRow {
  playhq_game_id: string;
  playhq_team_id: string;
  playhq_player_id: string;
  player_name: string | null;
  stats: Record<string, number>;
  raw: unknown;
}

function mockData(gradeId: string): {
  fixtures: FixtureRow[];
  ladder: LadderRow[];
  stats: StatRow[];
} {
  const teams = [
    { id: "mock-team-a", name: "Northside Hawks" },
    { id: "mock-team-b", name: "Eastvale Tigers" },
    { id: "mock-team-c", name: "Southport Sharks" },
    { id: "mock-team-d", name: "Westfield Wolves" },
  ];
  const now = Date.now();
  const fixtures: FixtureRow[] = [];
  for (let i = 0; i < 6; i++) {
    const h = teams[i % teams.length];
    const a = teams[(i + 1) % teams.length];
    const played = i < 3;
    fixtures.push({
      playhq_game_id: `mock-${gradeId}-game-${i}`,
      playhq_grade_id: gradeId,
      scheduled_at: new Date(now + (i - 3) * 7 * 86400_000).toISOString(),
      status: played ? "FINAL" : "UPCOMING",
      round: `Round ${i + 1}`,
      venue_name: "Sample Stadium",
      venue_address: "1 Sample St",
      court: `Court ${1 + (i % 2)}`,
      home_playhq_team_id: h.id,
      home_team_name: h.name,
      home_score: played ? 40 + i * 3 : null,
      away_playhq_team_id: a.id,
      away_team_name: a.name,
      away_score: played ? 35 + i * 2 : null,
      raw: { mock: true },
    });
  }
  const ladder: LadderRow[] = teams.map((t, idx) => ({
    playhq_grade_id: gradeId,
    playhq_team_id: t.id,
    team_name: t.name,
    position: idx + 1,
    played: 3,
    wins: 3 - idx,
    draws: 0,
    losses: idx,
    points: (3 - idx) * 2,
    points_for: 120 - idx * 8,
    points_against: 80 + idx * 6,
    points_diff: 40 - idx * 14,
    raw: { mock: true },
  }));
  const stats: StatRow[] = fixtures
    .filter((f) => f.status === "FINAL")
    .flatMap((f) =>
      Array.from({ length: 3 }).map((_, i) => ({
        playhq_game_id: f.playhq_game_id,
        playhq_team_id: f.home_playhq_team_id!,
        playhq_player_id: `${f.playhq_game_id}-p${i}`,
        player_name: `Player ${i + 1}`,
        stats: { points: 8 + i * 4, rebounds: 3 + i, assists: 2 + i },
        raw: { mock: true },
      })),
    );
  return { fixtures, ladder, stats };
}

async function playhqGet(
  path: string,
  apiKey: string,
  tenant: string,
): Promise<any> {
  const url = `${PLAYHQ_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      "x-phq-tenant": tenant,
      "accept": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PlayHQ ${res.status} on ${path}: ${body}`);
  }
  return res.json();
}

async function fetchAllPages(
  path: string,
  apiKey: string,
  tenant: string,
): Promise<any[]> {
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

function mapPlayhqGame(grade_id: string, g: any): FixtureRow {
  return {
    playhq_game_id: g.id,
    playhq_grade_id: grade_id,
    scheduled_at: g.schedule?.date ?? g.startsAt ?? null,
    status: g.status ?? null,
    round: g.round?.name ?? null,
    venue_name: g.venue?.name ?? null,
    venue_address: g.venue?.address ?? null,
    court: g.court?.name ?? null,
    home_playhq_team_id: g.teams?.home?.id ?? null,
    home_team_name: g.teams?.home?.name ?? null,
    home_score: g.score?.home ?? null,
    away_playhq_team_id: g.teams?.away?.id ?? null,
    away_team_name: g.teams?.away?.name ?? null,
    away_score: g.score?.away ?? null,
    raw: g,
  };
}

function mapPlayhqLadder(grade_id: string, row: any, idx: number): LadderRow {
  return {
    playhq_grade_id: grade_id,
    playhq_team_id: row.team?.id ?? row.teamId,
    team_name: row.team?.name ?? "Unknown",
    position: row.position ?? idx + 1,
    played: row.played ?? 0,
    wins: row.wins ?? 0,
    draws: row.draws ?? 0,
    losses: row.losses ?? 0,
    points: row.points ?? 0,
    points_for: row.pointsFor ?? 0,
    points_against: row.pointsAgainst ?? 0,
    points_diff: (row.pointsFor ?? 0) - (row.pointsAgainst ?? 0),
    raw: row,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = (await req.json().catch(() => ({}))) as SyncRequest;
  if (!body.grade_id || !body.tenant) {
    return new Response(
      JSON.stringify({ error: "grade_id and tenant are required" }),
      { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const tenantUpper = body.tenant.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const apiKey = Deno.env.get(`PLAYHQ_API_KEY_${tenantUpper}`);
  const useMock = body.mock === true || !apiKey;

  const startedAt = new Date().toISOString();
  let fixtures: FixtureRow[] = [];
  let ladder: LadderRow[] = [];
  let stats: StatRow[] = [];
  let status = "ok";
  let error: string | null = null;

  try {
    if (useMock) {
      const m = mockData(body.grade_id);
      fixtures = m.fixtures;
      ladder = m.ladder;
      stats = m.stats;
    } else {
      // Real PlayHQ calls
      const games = await fetchAllPages(
        `/grades/${body.grade_id}/fixture`,
        apiKey!,
        body.tenant,
      );
      fixtures = games.map((g) => mapPlayhqGame(body.grade_id, g));

      const ladderRes = await playhqGet(
        `/grades/${body.grade_id}/ladder`,
        apiKey!,
        body.tenant,
      );
      const ladderRows = Array.isArray(ladderRes?.data) ? ladderRes.data : [];
      ladder = ladderRows.map((r: any, i: number) =>
        mapPlayhqLadder(body.grade_id, r, i),
      );

      // Stats per finished game (best-effort; PlayHQ stat endpoint varies by sport)
      for (const f of fixtures.filter((f) => f.status && /FINAL|COMPLETE/i.test(f.status))) {
        try {
          const sRes = await playhqGet(
            `/games/${f.playhq_game_id}/statistics`,
            apiKey!,
            body.tenant,
          );
          const rows = Array.isArray(sRes?.data) ? sRes.data : [];
          for (const r of rows) {
            stats.push({
              playhq_game_id: f.playhq_game_id,
              playhq_team_id: r.team?.id ?? r.teamId ?? "",
              playhq_player_id: r.player?.id ?? r.playerId ?? "",
              player_name: r.player?.name ?? null,
              stats: r.statistics ?? r.stats ?? {},
              raw: r,
            });
          }
        } catch (_) { /* stats are optional */ }
      }
    }

    // Upserts
    if (fixtures.length) {
      const { error: e } = await supabase
        .from("playhq_fixtures")
        .upsert(fixtures, { onConflict: "playhq_game_id" });
      if (e) throw e;
    }
    if (ladder.length) {
      // wipe-and-reload keeps positions accurate after demotions/withdrawals
      await supabase.from("playhq_ladder").delete().eq("playhq_grade_id", body.grade_id);
      const { error: e } = await supabase.from("playhq_ladder").insert(ladder);
      if (e) throw e;
    }
    if (stats.length) {
      const { error: e } = await supabase
        .from("playhq_player_stats")
        .upsert(stats, { onConflict: "playhq_game_id,playhq_player_id" });
      if (e) throw e;
    }
  } catch (err) {
    status = "error";
    error = err instanceof Error ? err.message : String(err);
  }

  await supabase.from("playhq_sync_log").insert({
    playhq_grade_id: body.grade_id,
    tenant: body.tenant,
    status,
    fixtures_synced: fixtures.length,
    ladder_rows: ladder.length,
    stat_rows: stats.length,
    error,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });

  return new Response(
    JSON.stringify({
      ok: status === "ok",
      mock: useMock,
      fixtures: fixtures.length,
      ladder: ladder.length,
      stats: stats.length,
      error,
    }),
    {
      status: status === "ok" ? 200 : 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    },
  );
});
