import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResponse = { data: unknown[] | null; error: { message: string } | null };
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  responses: new Map<string, QueryResponse>(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));

import { fetchCompetitionLadder } from "./repository";

function queryBuilder(table: string) {
  type BuilderMethod = (...args: unknown[]) => TestBuilder;
  type TestBuilder = PromiseLike<unknown> & {
    select: BuilderMethod;
    eq: BuilderMethod;
    order: BuilderMethod;
    in: BuilderMethod;
    is: BuilderMethod;
  };
  const builder = {} as TestBuilder;
  for (const method of ["select", "eq", "order", "in", "is"] as const) {
    builder[method] = vi.fn((...args: unknown[]) => {
      mocks.calls.push({ table, method, args });
      return builder;
    });
  }
  Object.defineProperty(builder, "then", {
    value: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(mocks.responses.get(table) ?? { data: [], error: null }).then(resolve, reject),
  });
  return builder;
}

describe("competition ladder repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls = [];
    mocks.responses = new Map();
    mocks.from.mockImplementation(queryBuilder);
  });

  it("preserves ladder scope/order, accepted-entry scope, enrichment and placeholders", async () => {
    mocks.responses.set("competition_ladder", {
      data: [{ competition_id: "competition-1", team_id: "team-1", division_id: null, played: 1, points: 3 }],
      error: null,
    });
    mocks.responses.set("competition_entries", {
      data: [{ team_id: "team-2", division_id: null, status: "accepted", teams: { deleted_at: null } }],
      error: null,
    });
    mocks.responses.set("teams", {
      data: [{ id: "team-1", name: "Riverside" }, { id: "team-2", name: "Hilltown" }],
      error: null,
    });

    const rows = await fetchCompetitionLadder("competition-1");
    expect(rows.map((item) => [item.team_id, item.teams?.name, item.played]))
      .toEqual([
        ["team-1", "Riverside", 1],
        ["team-2", "Hilltown", 0],
      ]);
    expect(mocks.calls).toEqual([
      { table: "competition_ladder", method: "select", args: ["*"] },
      { table: "competition_ladder", method: "eq", args: ["competition_id", "competition-1"] },
      { table: "competition_ladder", method: "order", args: ["points", { ascending: false }] },
      { table: "competition_ladder", method: "order", args: ["goal_diff", { ascending: false }] },
      { table: "competition_ladder", method: "order", args: ["goals_for", { ascending: false }] },
      { table: "competition_entries", method: "select", args: ["team_id, division_id, status, teams!inner(deleted_at)"] },
      { table: "competition_entries", method: "eq", args: ["competition_id", "competition-1"] },
      { table: "competition_entries", method: "eq", args: ["status", "accepted"] },
      { table: "competition_entries", method: "is", args: ["teams.deleted_at", null] },
      { table: "teams", method: "select", args: ["id, name, logo_url"] },
      { table: "teams", method: "in", args: ["id", ["team-1", "team-2"]] },
    ]);
  });

  it.each([
    ["competition_ladder", "ladder unavailable"],
    ["competition_entries", "entries unavailable"],
    ["teams", "teams unavailable"],
  ])("propagates %s failures", async (table, message) => {
    mocks.responses.set("competition_ladder", {
      data: [{ competition_id: "competition-1", team_id: "team-1", division_id: null }],
      error: table === "competition_ladder" ? { message } : null,
    });
    mocks.responses.set("competition_entries", {
      data: [],
      error: table === "competition_entries" ? { message } : null,
    });
    mocks.responses.set("teams", {
      data: [],
      error: table === "teams" ? { message } : null,
    });

    await expect(fetchCompetitionLadder("competition-1")).rejects.toMatchObject({ message });
  });

  it("skips team enrichment for a genuinely empty ladder", async () => {
    await expect(fetchCompetitionLadder("competition-1")).resolves.toEqual([]);
    expect(mocks.from).not.toHaveBeenCalledWith("teams");
  });
});
