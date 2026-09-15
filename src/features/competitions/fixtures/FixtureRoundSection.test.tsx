import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FixtureRoundSection } from "./FixtureRoundSection";
import type { CompetitionFixtureRow } from "./types";

function match(id: string, overrides: Partial<CompetitionFixtureRow> = {}): CompetitionFixtureRow {
  return { id, competition_id: "competition-1", status: "scheduled", ...overrides };
}

describe("FixtureRoundSection", () => {
  it("shows match count, inclusive date range and completion progress", () => {
    const items = [
      match("match-1", { scheduled_at: "2026-08-03T09:00:00Z", status: "completed" }),
      match("match-2", { scheduled_at: "2026-08-10T09:00:00Z" }),
    ];
    render(
      <FixtureRoundSection
        label="Round 1"
        items={items}
        renderMatch={(item) => <div key={item.id}>{item.id}</div>}
      />,
    );
    expect(screen.getByText("Round 1")).toBeTruthy();
    expect(screen.getByText(/2 Matches.*Mon 3 Aug.*Mon 10 Aug/)).toBeTruthy();
    expect(screen.getByText("1/2 Complete")).toBeTruthy();
    expect(screen.getByText("match-1")).toBeTruthy();
    expect(screen.getByText("match-2")).toBeTruthy();
  });

  it("collapses and restores injected match rows without invoking mutations", () => {
    const renderMatch = vi.fn((item: CompetitionFixtureRow) => <div key={item.id}>{item.id}</div>);
    render(
      <FixtureRoundSection label="Final" items={[match("final-1")]} renderMatch={renderMatch} />,
    );
    const toggle = screen.getByRole("button", { name: /Final/i });
    expect(screen.getByText("final-1")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText("final-1")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("final-1")).toBeTruthy();
    expect(renderMatch).toHaveBeenCalled();
  });

  it("omits the date summary when every match is unscheduled", () => {
    render(
      <FixtureRoundSection
        label="Other matches"
        items={[match("match-1")]}
        renderMatch={(item) => <div key={item.id}>{item.id}</div>}
      />,
    );
    expect(screen.getByText("1 Match")).toBeTruthy();
    expect(screen.getByText("0/1 Complete")).toBeTruthy();
  });
});
