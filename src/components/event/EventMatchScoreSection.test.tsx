import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventMatchScoreSection } from "./EventMatchScoreSection";

vi.mock("./MatchScoreCard", () => ({
  MatchScoreCard: (props: any) => <div data-testid="score-card">{JSON.stringify(props)}</div>,
}));

describe("EventMatchScoreSection", () => {
  it("passes the resolved event/team/opponent/edit contract to the score card", () => {
    render(<EventMatchScoreSection
      model={{ visible: true, opponent: "Wolves", canEdit: false }}
      eventId="event-1" teamId="team-1" teamName={null} sport="soccer"
    />);
    expect(JSON.parse(screen.getByTestId("score-card").textContent || "{}")).toEqual({
      eventId: "event-1", teamId: "team-1", teamName: "Our Team",
      opponent: "Wolves", sport: "soccer", canEdit: false,
    });
  });
  it("renders nothing when policy hides the section or no team is resolved", () => {
    const { container, rerender } = render(<EventMatchScoreSection
      model={{ visible: false, opponent: null, canEdit: false }} eventId="event-1" teamId="team-1"
    />);
    expect(container).toBeEmptyDOMElement();
    rerender(<EventMatchScoreSection model={{ visible: true, opponent: null, canEdit: true }} eventId="event-1" teamId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
