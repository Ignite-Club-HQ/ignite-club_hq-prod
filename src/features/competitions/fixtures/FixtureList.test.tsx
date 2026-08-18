import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitionFixtureRow } from "./types";

const mocks = vi.hoisted(() => ({ controller: vi.fn() }));
vi.mock("./useFixtureListController", () => ({
  useFixtureListController: mocks.controller,
}));

import { FixtureList } from "./FixtureList";

const match: CompetitionFixtureRow = {
  id: "match-1",
  competition_id: "competition-1",
  round_number: 1,
};

function controller(overrides: Record<string, unknown> = {}) {
  return {
    filters: { divisionId: "_all", teamId: "_all", clubId: "_all" },
    setDivisionId: vi.fn(),
    setTeamId: vi.fn(),
    setClubId: vi.fn(),
    teamSheetOpen: false,
    setTeamSheetOpen: vi.fn(),
    teamOptions: [],
    clubOptions: [],
    filteredMatches: [match],
    groups: [{ key: "r1", label: "Round 1", items: [match] }],
    summary: { roundNumbers: [1], totalRounds: 1, maximumRound: 1 },
    ...overrides,
  };
}

describe("FixtureList", () => {
  beforeEach(() => mocks.controller.mockReturnValue(controller()));

  it("shows role-specific guidance for a genuinely empty fixture list", () => {
    const admin = render(
      <FixtureList
        matches={[]}
        divisions={[]}
        isAdmin
        competitionId="competition-1"
        renderRound={vi.fn()}
      />,
    );
    expect(screen.getByText(/Invite teams first/i)).toBeTruthy();
    admin.unmount();

    render(
      <FixtureList
        matches={[]}
        divisions={[]}
        isAdmin={false}
        competitionId="competition-1"
        renderRound={vi.fn()}
      />,
    );
    expect(screen.getByText(/organiser adds them/i)).toBeTruthy();
  });

  it("renders the round summary, injected admin action and every grouped round", () => {
    render(
      <FixtureList
        matches={[match]}
        divisions={[]}
        isAdmin
        competitionId="competition-1"
        renderSummaryAction={(summary) => <button>Max {summary.maximumRound}</button>}
        renderRound={(group) => <div key={group.key}>{group.label}</div>}
      />,
    );
    expect(screen.getByText("1 round scheduled")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Max 1" })).toBeTruthy();
    expect(screen.getByText("Round 1")).toBeTruthy();
  });

  it("distinguishes a filter with no matches from a genuinely empty competition", () => {
    mocks.controller.mockReturnValue(controller({ filteredMatches: [], groups: [] }));
    render(
      <FixtureList
        matches={[match]}
        divisions={[]}
        isAdmin={false}
        competitionId="competition-1"
        renderRound={vi.fn()}
      />,
    );
    expect(screen.getByText(/No fixtures match the current filter/i)).toBeTruthy();
    expect(screen.queryByText(/No fixtures yet/i)).toBeNull();
  });
});
