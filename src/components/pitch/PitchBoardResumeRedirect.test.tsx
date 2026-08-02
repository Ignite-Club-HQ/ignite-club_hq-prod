import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isNative: true,
  appStateHandler: null as null | ((state: { isActive: boolean }) => void),
  remove: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.isNative },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_event: string, handler: (state: { isActive: boolean }) => void) => {
      native.appStateHandler = handler;
      return { remove: native.remove };
    }),
  },
}));

import PitchBoardResumeRedirect from "./PitchBoardResumeRedirect";
import {
  PITCH_BOARD_LAST_CONTEXT_KEY,
  PITCH_BOARD_OPEN_AT_KEY,
  PITCH_BOARD_OPEN_KEY,
  PITCH_BOARD_OPEN_PATH_KEY,
} from "./types";

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{location.pathname}{location.search}</output>
      <button onClick={() => navigate("/")}>home</button>
    </>
  );
}

function mountAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PitchBoardResumeRedirect />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function persistOpenBoard(path: string) {
  localStorage.setItem(PITCH_BOARD_OPEN_KEY, "true");
  localStorage.setItem(PITCH_BOARD_OPEN_PATH_KEY, path);
  localStorage.setItem(PITCH_BOARD_OPEN_AT_KEY, String(Date.now()));
  localStorage.setItem(
    PITCH_BOARD_LAST_CONTEXT_KEY,
    JSON.stringify({ teamId: "team-1", teamName: "U10 Blue", readOnly: false }),
  );
}

async function signalNativeResume() {
  await waitFor(() => expect(native.appStateHandler).toBeTypeOf("function"));
  await act(async () => native.appStateHandler?.({ isActive: true }));
}

describe("PitchBoardResumeRedirect lock/unlock recovery", () => {
  beforeEach(() => {
    localStorage.clear();
    native.isNative = true;
    native.appStateHandler = null;
    native.remove.mockClear();
    delete (window as any).__pitchBoardMounted;
    delete (window as any).__pitchBoardMountedThisSession;
    vi.spyOn(performance, "now").mockReturnValue(1_000);
  });

  afterEach(() => vi.restoreAllMocks());

  it("cold-starts from home back onto the exact event pitchboard route", async () => {
    persistOpenBoard("/events/event-1?tab=attendance");
    mountAt("/");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/events/event-1?tab=attendance&openPitchBoard=1",
      ),
    );
  });

  it("restores a team-scoped board and preserves its existing query", async () => {
    persistOpenBoard("/teams/team-1?from=game-day");
    mountAt("/");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/teams/team-1?from=game-day&openPitchBoard=1",
      ),
    );
  });

  it("warm unlock reopens a board whose React modal was lost on its existing route", async () => {
    vi.mocked(performance.now).mockReturnValue(30_000);
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    (window as any).__pitchBoardMounted = false;
    mountAt("/events/event-1");

    await signalNativeResume();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/events/event-1?openPitchBoard=1",
      ),
    );
  });

  it("does not navigate while the pitchboard remains mounted", async () => {
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    (window as any).__pitchBoardMounted = true;
    mountAt("/");

    await signalNativeResume();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("does not hijack an unrelated non-neutral page after unlock", async () => {
    vi.mocked(performance.now).mockReturnValue(30_000);
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    mountAt("/media");

    await signalNativeResume();
    expect(screen.getByTestId("location")).toHaveTextContent("/media");
  });

  it("clears a stale previous-session flag instead of reopening it on warm resume", async () => {
    vi.mocked(performance.now).mockReturnValue(30_000);
    persistOpenBoard("/events/event-1");
    localStorage.removeItem(PITCH_BOARD_OPEN_AT_KEY);
    mountAt("/");

    await signalNativeResume();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBeNull();
    expect(localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY)).toBeNull();
    expect(localStorage.getItem(PITCH_BOARD_LAST_CONTEXT_KEY)).toBeNull();
  });

  it("treats navigation from the board route to Home as an explicit close", async () => {
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    mountAt("/events/event-1");

    await act(async () => screen.getByRole("button", { name: "home" }).click());
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBeNull();

    await signalNativeResume();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("leaves a home-overlay board for HomePage to restore", async () => {
    persistOpenBoard("/");
    mountAt("/");
    await signalNativeResume();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBe("true");
  });

  it("cancels delayed native-resume retries when the redirect unmounts", async () => {
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    (window as any).__pitchBoardMounted = true;
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const view = mountAt("/media");

    await signalNativeResume();
    const resumeTimerIds = setTimeoutSpy.mock.calls.flatMap(([, delay], index) =>
      delay === 400 || delay === 1200
        ? [setTimeoutSpy.mock.results[index].value]
        : [],
    );
    expect(resumeTimerIds).toHaveLength(2);
    view.unmount();

    // These are the two timers that previously escaped teardown and fired
    // after jsdom had removed `window`.
    const clearedIds = clearTimeoutSpy.mock.calls.map(([id]) => id);
    expect(clearedIds).toEqual(expect.arrayContaining(resumeTimerIds));
  });
});
