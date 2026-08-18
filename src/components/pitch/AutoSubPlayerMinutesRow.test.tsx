import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import AutoSubPlayerMinutesRow from "./AutoSubPlayerMinutesRow";
import type { FairnessReport, PlannerPlayer, PlayerTimeForecast } from "./planner/analysis";

interface TestPlayer extends PlannerPlayer { number?: number }

const forecast = (overrides: Partial<PlayerTimeForecast<TestPlayer>> = {}): PlayerTimeForecast<TestPlayer> => ({
  player: { id: "player-1", name: "Alex", number: 12, position: { x: 50, y: 50 } },
  predictedMinutes: 28,
  percentageOfGame: 70,
  startsOnPitch: true,
  ...overrides,
});

const report = (shortShifts = 0, bounceBacks = 0): FairnessReport => ({
  perPlayer: [{
    playerId: "player-1",
    playerName: "Alex",
    totalSeconds: 1_680,
    shortShifts,
    bounceBacks,
    startsOnPitch: true,
  }],
  spreadSeconds: 0,
  minSeconds: 1_680,
  maxSeconds: 1_680,
  avgSeconds: 1_680,
  totalShortShifts: shortShifts,
  totalBounceBacks: bounceBacks,
  totalSubs: 0,
  grade: "good",
});

const renderRow = (
  value = forecast(),
  fairnessReport: FairnessReport | null = null,
  draggable = true,
) => render(
  <DndContext>
    <AutoSubPlayerMinutesRow forecast={value} fairnessReport={fairnessReport} draggable={draggable} />
  </DndContext>,
);

describe("AutoSub player minutes row", () => {
  it("shows identity, starter state and exact forecast", () => {
    renderRow();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("28' (70%)")).toBeInTheDocument();
  });

  it("shows bench state and a safe number fallback", () => {
    renderRow(forecast({
      startsOnPitch: false,
      player: { id: "player-1", name: "Alex", position: null },
    }));
    expect(screen.getByText("Bench")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it.each([
    ["full", "GK"],
    ["1h", "GK 1H"],
    ["2h", "GK 2H"],
  ] as const)("labels %s-match goalkeeper duty", (gkRole, label) => {
    renderRow(forecast({ gkRole }));
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows both short-shift and bounce-back warnings from the fairness report", () => {
    renderRow(forecast(), report(2, 1));
    expect(screen.getByText("2 very short")).toBeInTheDocument();
    expect(screen.getByText("1 bounce")).toBeInTheDocument();
  });

  it("offers an accessible drag handle only for reorderable outfielders", () => {
    const { rerender } = renderRow();
    expect(screen.getByRole("button", { name: "Reorder Alex playing-time priority" })).toBeInTheDocument();

    rerender(
      <DndContext>
        <AutoSubPlayerMinutesRow forecast={forecast()} fairnessReport={null} draggable={false} />
      </DndContext>,
    );
    expect(screen.queryByRole("button", { name: /Reorder Alex/ })).not.toBeInTheDocument();
  });
});
