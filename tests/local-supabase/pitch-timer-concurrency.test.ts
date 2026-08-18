import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSyntheticLocalMarker,
  createSecurityFixture,
  service,
  type SecurityFixture,
  type SyntheticUser,
} from "./fixtures";

const edgeEnabled = process.env.LOCAL_SUPABASE_EDGE_ENABLED === "true";
const edgeDescribe = edgeEnabled ? describe : describe.skip;

async function tokenFor(user: SyntheticUser) {
  const session = await user.client.auth.getSession();
  if (!session.data.session?.access_token) throw new Error("Synthetic local user has no session");
  return session.data.session.access_token;
}

async function event(user: SyntheticUser, teamId: string, name: string, payload: Record<string, unknown> = {}) {
  const response = await fetch(`${process.env.LOCAL_SUPABASE_URL}/functions/v1/pitch-timer-event`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await tokenFor(user)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ team_id: teamId, event: name, minutes_per_half: 40, payload }),
  });
  const body = await response.json();
  return { status: response.status, body };
}

edgeDescribe("local Edge Runtime: concurrent pitch timer convergence", () => {
  let fixture: SecurityFixture;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
    const secondController = await service.from("user_roles").insert({
      user_id: fixture.memberA.id,
      role: "coach",
      club_id: fixture.clubA,
      team_id: fixture.teamA,
    });
    if (secondController.error) throw secondController.error;
  });

  afterAll(async () => {
    await service.from("active_games").delete().eq("team_id", fixture?.teamA);
    await fixture?.cleanup();
  });

  it("rejects a valid user who cannot control the selected team", async () => {
    const result = await event(fixture.outsiderB, fixture.teamA, "start_half");
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: "forbidden" });
  });

  it("creates one authoritative anchored row before concurrent writers begin", async () => {
    const result = await event(fixture.adminA, fixture.teamA, "start_half");
    expect(result.status).toBe(200);
    expect(result.body.timer_state).toMatchObject({
      schema_version: 2,
      current_half: 1,
      minutes_per_half: 40,
      is_running: true,
    });
    expect(result.body.timer_state.half_started_at).toBeTruthy();
    expect((await service.from("active_games").select("id").eq("team_id", fixture.teamA)).data).toHaveLength(1);
  });

  it("serializes simultaneous pause and adjust events without clobbering the anchor", async () => {
    const attempts = await Promise.all([
      event(fixture.adminA, fixture.teamA, "pause"),
      event(fixture.memberA, fixture.teamA, "adjust", { delta_seconds: 30 }),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 200]);

    const row = await service.from("active_games")
      .select("timer_state")
      .eq("team_id", fixture.teamA)
      .eq("is_active", true)
      .single();
    expect(row.error).toBeNull();
    expect(row.data?.timer_state).toMatchObject({ schema_version: 2, is_running: false });
    expect(row.data?.timer_state.half_started_at).toBeTruthy();
    expect(row.data?.timer_state.half_paused_at).toBeTruthy();
  });

  it("converges repeated cross-device resume events without duplicate rows", async () => {
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      event(index % 2 ? fixture.adminA : fixture.memberA, fixture.teamA, "resume"),
    ));
    expect(attempts.every((attempt) => attempt.status === 200)).toBe(true);

    const rows = await service.from("active_games")
      .select("id, timer_state")
      .eq("team_id", fixture.teamA);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(1);
    expect(rows.data?.[0].timer_state).toMatchObject({
      schema_version: 2,
      current_half: 1,
      is_running: true,
      is_game_finished: false,
    });
    expect(rows.data?.[0].timer_state.half_started_at).toBeTruthy();
    expect(Number(rows.data?.[0].timer_state.accumulated_pause_ms)).toBeGreaterThanOrEqual(0);
  });

  it("preserves the winner when stale pause, adjust and resume requests collide", async () => {
    const attempts = await Promise.all([
      event(fixture.adminA, fixture.teamA, "pause"),
      event(fixture.memberA, fixture.teamA, "adjust", { delta_seconds: -15 }),
      event(fixture.adminA, fixture.teamA, "resume"),
      event(fixture.memberA, fixture.teamA, "adjust", { delta_seconds: 20 }),
    ]);
    expect(attempts.every((attempt) => attempt.status === 200 || attempt.status === 409)).toBe(true);
    expect(attempts.filter((attempt) => attempt.status === 200).length).toBeGreaterThanOrEqual(1);

    const row = await service.from("active_games")
      .select("timer_state")
      .eq("team_id", fixture.teamA)
      .single();
    expect(row.error).toBeNull();
    expect(row.data?.timer_state.schema_version).toBe(2);
    expect(row.data?.timer_state.half_started_at).toBeTruthy();
    expect(Number.isFinite(new Date(row.data?.timer_state.last_event_at).getTime())).toBe(true);
    expect(Number(row.data?.timer_state.accumulated_pause_ms)).toBeGreaterThanOrEqual(0);
  });

  it("publishes one authoritative reset and never resurrects the old running state", async () => {
    const reset = await event(fixture.adminA, fixture.teamA, "reset");
    expect(reset.status).toBe(200);
    expect(reset.body.timer_state).toMatchObject({
      schema_version: 2,
      current_half: 1,
      half_started_at: null,
      is_running: false,
      is_game_finished: false,
    });
    const row = await service.from("active_games").select("timer_state, is_active").eq("team_id", fixture.teamA).single();
    expect(row.data?.is_active).toBe(false);
    expect(row.data?.timer_state.half_started_at).toBeNull();
  });
});
