import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import PitchBoardResumeRedirect from "./PitchBoardResumeRedirect";
import {
  PITCH_BOARD_BACKGROUNDED_AT_KEY,
  PITCH_BOARD_OPEN_AT_KEY,
  PITCH_BOARD_OPEN_KEY,
  PITCH_BOARD_OPEN_PATH_KEY,
} from "./types";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderRedirect(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PitchBoardResumeRedirect />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function seedOpenBoard(path = "/teams/team-1") {
  localStorage.setItem(PITCH_BOARD_OPEN_KEY, "true");
  localStorage.setItem(PITCH_BOARD_OPEN_PATH_KEY, path);
  localStorage.setItem(PITCH_BOARD_OPEN_AT_KEY, String(Date.now()));
}

describe("PitchBoardResumeRedirect behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    delete (window as Window & { __pitchBoardMounted?: boolean }).__pitchBoardMounted;
    delete (window as Window & { __pitchBoardMountedThisSession?: boolean })
      .__pitchBoardMountedThisSession;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("restores an open board from home on cold start", () => {
    seedOpenBoard();
    renderRedirect("/");

    act(() => vi.advanceTimersByTime(1));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/teams/team-1?openPitchBoard=1",
    );
  });

  it("reclaims a protected route that wins during bootstrap", () => {
    seedOpenBoard("/events/event-1?tab=details");
    renderRedirect("/messages");

    act(() => vi.advanceTimersByTime(1));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/events/event-1?tab=details&openPitchBoard=1",
    );
  });

  it("does not override an authentication route", () => {
    seedOpenBoard();
    renderRedirect("/auth");

    act(() => vi.advanceTimersByTime(30_000));

    expect(screen.getByTestId("location")).toHaveTextContent("/auth");
  });

  it("clears a stale open flag instead of restoring it", () => {
    seedOpenBoard();
    localStorage.setItem(
      PITCH_BOARD_OPEN_AT_KEY,
      String(Date.now() - 13 * 60 * 60 * 1000),
    );
    renderRedirect("/");

    act(() => vi.advanceTimersByTime(1));

    expect(screen.getByTestId("location")).toHaveTextContent("/");
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBeNull();
    expect(localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY)).toBeNull();
    expect(localStorage.getItem(PITCH_BOARD_OPEN_AT_KEY)).toBeNull();
  });

  it("does not navigate when the board is still mounted", () => {
    seedOpenBoard();
    (window as Window & { __pitchBoardMounted?: boolean }).__pitchBoardMounted = true;
    renderRedirect("/");

    act(() => vi.advanceTimersByTime(30_000));

    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  it("restores the stored board after native route drift to a stale route", () => {
    seedOpenBoard("/teams/team-1");
    // Simulate a resume where the WebView came back on /media.
    localStorage.setItem(PITCH_BOARD_BACKGROUNDED_AT_KEY, String(Date.now()));
    renderRedirect("/media");

    act(() => vi.advanceTimersByTime(1));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/teams/team-1?openPitchBoard=1",
    );
  });

  it("keeps the open marker when the route drifts while the app is hidden", () => {
    seedOpenBoard("/teams/team-1");
    const { rerender } = render(
      <MemoryRouter initialEntries={["/teams/team-1"]}>
        <PitchBoardResumeRedirect />
        <LocationProbe />
      </MemoryRouter>,
    );
    // Let the initial cold-start lease expire.
    act(() => vi.advanceTimersByTime(40_000));
    // App goes to background, then the WebView drifts to a stale route.
    localStorage.setItem(PITCH_BOARD_BACKGROUNDED_AT_KEY, String(Date.now()));
    rerender(
      <MemoryRouter initialEntries={["/messages"]}>
        <PitchBoardResumeRedirect />
        <LocationProbe />
      </MemoryRouter>,
    );
    act(() => vi.advanceTimersByTime(1));

    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBe("true");
  });
});
