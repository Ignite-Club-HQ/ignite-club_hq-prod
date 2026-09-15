import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PitchBoardActions } from "./PitchBoardActions";

describe("PitchBoardActions", () => {
  it.each(["prepare", "start", "open"] as const)("opens the board from the %s manager action", (primary) => {
    const onOpen = vi.fn();
    render(<PitchBoardActions showLoading={false} primary={primary} showReadOnly={false} onOpen={onOpen} />);
    const label = primary === "prepare" ? "Prepare Lineup & Auto-Subs" : primary === "start" ? "Start Game" : "Open Match";
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it("renders disabled loading and independent read-only actions", () => {
    const onOpen = vi.fn();
    render(<PitchBoardActions showLoading primary={null} showReadOnly onOpen={onOpen} />);
    expect(screen.getByRole("button", { name: "Checking match access…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open Pitch Board" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
