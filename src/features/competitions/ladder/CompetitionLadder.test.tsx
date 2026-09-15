import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompetitionLadderView } from "./CompetitionLadder";
import type { CompetitionLadderRow } from "./types";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

function row(overrides: Partial<CompetitionLadderRow> = {}): CompetitionLadderRow {
  return {
    competition_id: "competition-1",
    team_id: "team-1",
    division_id: "division-1",
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals_for: 0,
    goals_against: 0,
    goal_diff: 0,
    points: 0,
    teams: { id: "team-1", name: "Riverside Blue" },
    ...overrides,
  };
}

const visibleDivision = { id: "division-1", name: "Under 10" };

describe("CompetitionLadderView", () => {
  it("shows the not-started state and can collapse and reopen its division card", () => {
    render(<CompetitionLadderView rows={[row()]} divisions={[visibleDivision]} />);

    expect(screen.getByText("Under 10")).toBeTruthy();
    expect(screen.getByText(/No results entered yet/i)).toBeTruthy();
    const toggle = screen.getByRole("button", { name: /Under 10/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/No results entered yet/i)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText(/No results entered yet/i)).toBeTruthy();
  });

  it("renders played standings, rank, signed goal difference and points", () => {
    render(
      <CompetitionLadderView
        rows={[row({ played: 2, wins: 2, goals_for: 5, goal_diff: 3, points: 6 })]}
        divisions={[visibleDivision]}
      />,
    );

    expect(screen.getByText("Riverside Blue")).toBeTruthy();
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Pts" })).toBeTruthy();
  });

  it("hides every standing from members when a division is hidden but marks it for admins", () => {
    const hiddenDivision = { ...visibleDivision, hide_ladder: true };
    const member = render(
      <CompetitionLadderView rows={[row({ played: 1 })]} divisions={[hiddenDivision]} />,
    );
    expect(screen.getByText(/No standings match/i)).toBeTruthy();
    expect(screen.queryByText("Riverside Blue")).toBeNull();
    member.unmount();

    render(
      <CompetitionLadderView rows={[row({ played: 1 })]} divisions={[hiddenDivision]} isAdmin />,
    );
    expect(screen.getByText("Hidden")).toBeTruthy();
    expect(screen.getByText("Riverside Blue")).toBeTruthy();
  });
});
