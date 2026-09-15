import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  calls: [] as Array<{ method: string; args: unknown[] }>,
  response: { data: [] as unknown[], error: null as unknown },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));

import {
  fetchCompetitionFixtures,
  fetchLinkedCompetitionTeams,
} from "./repository";

function builderFor(table: string) {
  type BuilderMethod = (...args: unknown[]) => TestBuilder;
  type TestBuilder = PromiseLike<unknown> & {
    select: BuilderMethod;
    eq: BuilderMethod;
    order: BuilderMethod;
    in: BuilderMethod;
  };
  const builder = {} as TestBuilder;
  mocks.calls.push({ method: "from", args: [table] });
  for (const method of ["select", "eq", "order", "in"] as const) {
    builder[method] = vi.fn((...args: unknown[]) => {
      mocks.calls.push({ method, args });
      return builder;
    });
  }
  Object.defineProperty(builder, "then", {
    value: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(mocks.response).then(resolve, reject),
  });
  return builder;
}

describe("competition fixture repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls = [];
    mocks.response = { data: [], error: null };
    mocks.from.mockImplementation(builderFor);
  });

  it("reads competition fixtures with the exact established select, scope and ordering", async () => {
    mocks.response.data = [{ id: "match-1", competition_id: "competition-1" }];

    await expect(fetchCompetitionFixtures("competition-1")).resolves.toEqual(
      mocks.response.data,
    );
    expect(mocks.calls).toEqual([
      { method: "from", args: ["competition_matches"] },
      {
        method: "select",
        args: [
          "*, home:home_team_id(id, name, logo_url), away:away_team_id(id, name, logo_url), competition_divisions:division_id(name)",
        ],
      },
      { method: "eq", args: ["competition_id", "competition-1"] },
      { method: "order", args: ["round_number", { ascending: true, nullsFirst: false }] },
      { method: "order", args: ["scheduled_at", { ascending: true, nullsFirst: false }] },
    ]);
  });

  it("propagates fixture read failures", async () => {
    mocks.response = { data: [], error: { message: "fixtures unavailable" } };

    await expect(fetchCompetitionFixtures("competition-1")).rejects.toMatchObject({
      message: "fixtures unavailable",
    });
  });

  it("reads linked teams with the exact established select and external ids", async () => {
    mocks.response.data = [{ id: "team-1", playhq_team_id: "external-1" }];

    await expect(
      fetchLinkedCompetitionTeams(["external-1", "external-2"]),
    ).resolves.toEqual(mocks.response.data);
    expect(mocks.calls).toEqual([
      { method: "from", args: ["teams"] },
      {
        method: "select",
        args: ["id, name, playhq_team_id, club_id, clubs:club_id(id, name)"],
      },
      { method: "in", args: ["playhq_team_id", ["external-1", "external-2"]] },
    ]);
  });

  it("propagates linked-team read failures", async () => {
    mocks.response = { data: [], error: { message: "linked teams unavailable" } };

    await expect(fetchLinkedCompetitionTeams(["external-1"])).rejects.toMatchObject({
      message: "linked teams unavailable",
    });
  });
});
