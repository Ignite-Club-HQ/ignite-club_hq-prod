import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AutoSubPlanStatusCard from "./AutoSubPlanStatusCard";

const renderCard = (overrides: Partial<React.ComponentProps<typeof AutoSubPlanStatusCard>> = {}) =>
  render(
    <AutoSubPlanStatusCard
      totalSubs={6}
      spreadMin={3}
      shortShifts={0}
      hasHalftimeClash={false}
      {...overrides}
    />,
  );

describe("AutoSub plan status card", () => {
  it("shows the exact substitution, minute-spread and short-turn summary", () => {
    renderCard({ totalSubs: 8, spreadMin: 2.75, shortShifts: 1 });

    expect(screen.getByText("Subs").nextElementSibling).toHaveTextContent("8");
    expect(screen.getByText("Minutes diff").nextElementSibling).toHaveTextContent("2.8m");
    expect(screen.getByText("Very short turns").nextElementSibling).toHaveTextContent("1");
  });

  it("marks a calm plan as not needing adjustment", () => {
    renderCard({ spreadMin: 6, shortShifts: 0, hasHalftimeClash: false });
    expect(screen.getByTestId("autosub-plan-status")).toHaveAttribute("data-needs-adjustment", "false");
  });

  it.each([
    ["spread above six minutes", { spreadMin: 6.1 }],
    ["a very short turn", { shortShifts: 1 }],
    ["a substitution near halftime", { hasHalftimeClash: true }],
  ])("marks the plan for attention when there is %s", (_label, props) => {
    renderCard(props);
    expect(screen.getByTestId("autosub-plan-status")).toHaveAttribute("data-needs-adjustment", "true");
  });

  it("does not visually flag a six-minute spread until it exceeds the existing threshold", () => {
    renderCard({ spreadMin: 6 });
    expect(screen.getByText("6.0m")).toHaveClass("text-foreground");
  });
});
