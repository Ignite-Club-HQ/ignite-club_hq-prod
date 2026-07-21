import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, authState, responses } = vi.hoisted(() => ({
  from: vi.fn(),
  authState: { user: undefined as undefined | { id: string } },
  responses: [] as Array<Promise<any> | any>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from },
}));
vi.mock("./useAuth", () => ({
  useAuth: () => authState,
}));

import {
  checkPitchBoardNotificationsEnabled,
  usePitchBoardNotifications,
} from "./usePitchBoardNotifications";

function preferenceQuery() {
  const response = responses.shift() ?? { data: null, error: null };
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.single = vi.fn(() => response);
  return query;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("pitch-board notification preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responses.length = 0;
    authState.user = undefined;
    from.mockImplementation(() => preferenceQuery());
  });

  it("defaults to enabled and does not query without an authenticated user", () => {
    const { result } = renderHook(() => usePitchBoardNotifications());

    expect(result.current.pitchBoardNotificationsEnabled).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it("honours an authenticated user's explicit opt-out", async () => {
    authState.user = { id: "user-1" };
    responses.push(Promise.resolve({ data: { pitch_board_enabled: false }, error: null }));
    const query = preferenceQuery();
    from.mockReturnValue(query);

    const { result } = renderHook(() => usePitchBoardNotifications());

    await waitFor(() => expect(result.current.pitchBoardNotificationsEnabled).toBe(false));
    expect(from).toHaveBeenCalledWith("notification_preferences");
    expect(query.select).toHaveBeenCalledWith("pitch_board_enabled");
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(query.single).toHaveBeenCalledOnce();
  });

  it("defaults to enabled when the preference row or field is missing", async () => {
    authState.user = { id: "user-1" };
    responses.push(
      Promise.resolve({ data: null, error: null }),
      Promise.resolve({ data: { pitch_board_enabled: null }, error: null }),
    );

    const first = renderHook(() => usePitchBoardNotifications());
    await act(async () => undefined);
    expect(first.result.current.pitchBoardNotificationsEnabled).toBe(true);
    first.unmount();

    const second = renderHook(() => usePitchBoardNotifications());
    await act(async () => undefined);
    expect(second.result.current.pitchBoardNotificationsEnabled).toBe(true);
  });

  it("the standalone check skips the database for an empty user identity", async () => {
    await expect(checkPitchBoardNotificationsEnabled("")).resolves.toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    [false, false],
    [true, true],
    [null, true],
  ])("the standalone check maps stored value %s to %s", async (stored, expected) => {
    responses.push(Promise.resolve({ data: { pitch_board_enabled: stored }, error: null }));

    await expect(checkPitchBoardNotificationsEnabled("user-1")).resolves.toBe(expected);
  });

  it("the standalone check fails safely to enabled when the query throws", async () => {
    responses.push(Promise.reject(new Error("preferences unavailable")));

    await expect(checkPitchBoardNotificationsEnabled("user-1")).resolves.toBe(true);
  });

  it("reloads the preference when the authenticated account changes", async () => {
    authState.user = { id: "user-1" };
    responses.push(
      Promise.resolve({ data: { pitch_board_enabled: true }, error: null }),
      Promise.resolve({ data: { pitch_board_enabled: false }, error: null }),
    );
    const { result, rerender } = renderHook(() => usePitchBoardNotifications());
    await act(async () => undefined);
    expect(result.current.pitchBoardNotificationsEnabled).toBe(true);

    authState.user = { id: "user-2" };
    rerender();

    await waitFor(() => expect(result.current.pitchBoardNotificationsEnabled).toBe(false));
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("must ignore a stale preference response from the previous account", async () => {
    const firstUser = deferred<{ data: { pitch_board_enabled: boolean }; error: null }>();
    const secondUser = deferred<{ data: { pitch_board_enabled: boolean }; error: null }>();
    authState.user = { id: "user-1" };
    responses.push(firstUser.promise, secondUser.promise);
    const { result, rerender } = renderHook(() => usePitchBoardNotifications());

    authState.user = { id: "user-2" };
    rerender();
    await act(async () => secondUser.resolve({ data: { pitch_board_enabled: false }, error: null }));
    expect(result.current.pitchBoardNotificationsEnabled).toBe(false);

    await act(async () => firstUser.resolve({ data: { pitch_board_enabled: true }, error: null }));
    expect(result.current.pitchBoardNotificationsEnabled).toBe(false);
  });
});
