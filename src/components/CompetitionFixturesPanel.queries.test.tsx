/**
 * Regression tests for competition fixtures + ladder error handling.
 *
 * Defects covered:
 *  1. Fixture read failures must NOT be shown as an empty fixture list.
 *  2. Ladder accepted-entry query failures must propagate (no partial ladder).
 *  3. Ladder team-enrichment failures must propagate (no `teams: null` rows).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// ---- mocks --------------------------------------------------------------
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/components/AddressAutocomplete", () => ({
  AddressAutocomplete: () => null,
}));

type Res = { data: any; error: any };

/** Per-table queued responses. */
const responses: Record<string, Res[]> = {};

function queue(table: string, res: Res) {
  responses[table] = responses[table] ?? [];
  responses[table].push(res);
}

function nextRes(table: string): Res {
  const q = responses[table];
  if (!q || q.length === 0) return { data: [], error: null };
  return q.length === 1 ? q[0] : q.shift()!;
}

function makeBuilder(table: string) {
  const result = () => Promise.resolve(nextRes(table));
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          const p = result();
          return p.then.bind(p);
        }
        if (prop === "catch" || prop === "finally") {
          const p = result();
          return (p as any)[prop].bind(p);
        }
        return () => builder;
      },
    },
  );
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
  },
}));

// import after mocks
import {
  CompetitionFixturesPanel,
  CompetitionLadderPanel,
} from "./CompetitionFixturesPanel";
import { ImportFixturesSheet } from "./competitions/ImportFixturesMenuItem";

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  for (const k of Object.keys(responses)) delete responses[k];
});

describe("CompetitionFixturesPanel — fixture read failures", () => {
  it("shows a finals badge on a fixture with TBD teams", async () => {
    queue("competition_matches", { data: [{
      id: "final-1", notes: "Finals", status: "scheduled",
      scheduled_at: "2026-10-10T18:30:00Z", round_number: null,
      home: { id: "blue", name: "Blue" }, away: null,
    }], error: null });
    wrap(<CompetitionFixturesPanel competitionId="c1" isAdmin={false} divisions={[]} entries={[]} />);
    // Shown both as the section heading and as the card badge.
    await waitFor(() => expect(screen.getAllByText("Finals").length).toBe(2));
    expect(screen.getByText("Blue")).toBeTruthy();
    expect(screen.getByText("TBD")).toBeTruthy();
  });

  it("preserves finals labels in the import preview", async () => {
    wrap(<ImportFixturesSheet competitionId="c1" entries={[]} divisions={[]} open setOpen={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value:
      "Date,Time,Round,Home,Away,Pitch\n10/10/2026,18:30,Grand Final,TBD,TBD,TBD",
    } });
    expect(screen.getByText("Grand Final · TBD vs TBD")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 fixture" }).hasAttribute("disabled")).toBe(false));
  });

  it("labels finals from a notes column and skips fixtures already imported", async () => {
    const blue = { status: "accepted", teams: { id: "blue", name: "Blue" } };
    queue("competition_matches", { data: [{
      scheduled_at: new Date(2026, 2, 3, 18, 30).toISOString(), home_team_id: "blue", away_team_id: null, venue: null, pitch_number: null, notes: "Finals",
    }], error: null });
    wrap(<ImportFixturesSheet competitionId="c1" entries={[blue]} divisions={[]} open setOpen={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value:
      "Date,Time,Home,Away,Notes\n03/03/2026,18:30,Blue,TBD,Finals fixture\n03/03/2026,19:30,Blue,TBD,Finals fixture",
    } });
    await waitFor(() => expect(screen.getByText(/1 already imported/)).toBeTruthy());
    expect(screen.getAllByText("Finals · Blue vs TBD").length).toBe(2);
    expect(screen.getByRole("button", { name: "Import 1 fixture" })).toBeTruthy();
  });

  it("shows an error state (not 'No fixtures yet') when the fixture query fails", async () => {
    queue("competition_matches", { data: null, error: { message: "boom" } });
    wrap(
      <CompetitionFixturesPanel
        competitionId="c1"
        isAdmin={false}
        divisions={[]}
        entries={[]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Couldn't load fixtures/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/No fixtures yet/i)).toBeNull();
  });

  it("still shows the empty state for a genuine successful empty response", async () => {
    queue("competition_matches", { data: [], error: null });
    wrap(
      <CompetitionFixturesPanel
        competitionId="c1"
        isAdmin={false}
        divisions={[]}
        entries={[]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/No fixtures yet/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/Couldn't load fixtures/i)).toBeNull();
  });
});

describe("CompetitionLadderPanel — dependency failures", () => {
  it("errors when the accepted-entry query fails (no partial ladder)", async () => {
    queue("competition_ladder", { data: [], error: null });
    queue("competition_entries", { data: null, error: { message: "denied" } });
    wrap(<CompetitionLadderPanel competitionId="c1" divisions={[]} />);
    await waitFor(() =>
      expect(screen.getByText(/Couldn't load the ladder/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/No ladder yet/i)).toBeNull();
  });

  it("errors when team enrichment fails instead of returning teams: null", async () => {
    queue("competition_ladder", {
      data: [{ team_id: "t1", division_id: null, points: 3 }],
      error: null,
    });
    queue("competition_entries", { data: [], error: null });
    queue("teams", { data: null, error: { message: "denied" } });
    wrap(<CompetitionLadderPanel competitionId="c1" divisions={[]} />);
    await waitFor(() =>
      expect(screen.getByText(/Couldn't load the ladder/i)).toBeTruthy(),
    );
  });

  it("shows the empty state for a genuinely empty ladder", async () => {
    queue("competition_ladder", { data: [], error: null });
    queue("competition_entries", { data: [], error: null });
    wrap(<CompetitionLadderPanel competitionId="c1" divisions={[]} />);
    await waitFor(() => expect(screen.getByText(/No ladder yet/i)).toBeTruthy());
  });
});
