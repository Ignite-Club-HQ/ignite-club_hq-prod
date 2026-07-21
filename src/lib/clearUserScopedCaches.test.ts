import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearMediaCache: vi.fn(),
  clearProfileCache: vi.fn(),
  clearRolesCache: vi.fn(),
  clearClubTeamCache: vi.fn(),
  clearMessagesPageCache: vi.fn(),
}));

vi.mock("./mediaCache", () => ({ clearMediaCache: mocks.clearMediaCache }));
vi.mock("./profileCache", () => ({ clearProfileCache: mocks.clearProfileCache }));
vi.mock("./rolesCache", () => ({ clearRolesCache: mocks.clearRolesCache }));
vi.mock("./clubTeamCache", () => ({ clearClubTeamCache: mocks.clearClubTeamCache }));
vi.mock("./messagesPageCache", () => ({ clearMessagesPageCache: mocks.clearMessagesPageCache }));

import { clearUserScopedCaches } from "./clearUserScopedCaches";

describe("clearUserScopedCaches account isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("clears every in-memory cache mirror", () => {
    clearUserScopedCaches();

    expect(mocks.clearMediaCache).toHaveBeenCalledOnce();
    expect(mocks.clearProfileCache).toHaveBeenCalledOnce();
    expect(mocks.clearRolesCache).toHaveBeenCalledOnce();
    expect(mocks.clearClubTeamCache).toHaveBeenCalledOnce();
    expect(mocks.clearMessagesPageCache).toHaveBeenCalledOnce();
  });

  it("continues clearing later caches when an earlier cache throws", () => {
    mocks.clearMediaCache.mockImplementation(() => { throw new Error("media cache unavailable"); });
    mocks.clearRolesCache.mockImplementation(() => { throw new Error("roles cache unavailable"); });

    expect(() => clearUserScopedCaches()).not.toThrow();
    expect(mocks.clearProfileCache).toHaveBeenCalledOnce();
    expect(mocks.clearClubTeamCache).toHaveBeenCalledOnce();
    expect(mocks.clearMessagesPageCache).toHaveBeenCalledOnce();
  });

  it.each([
    "ignite_photos_cache",
    "ignite_message_cache_team_team-1",
    "ignite_user_roles_cache",
    "ignite_rsvp_queue",
    "ignite_event_detail_event-1",
    "ignite_cached_profile",
  ])("removes the user-scoped localStorage key %s", key => {
    localStorage.setItem(key, "private-user-data");

    clearUserScopedCaches();

    expect(localStorage.getItem(key)).toBeNull();
  });

  it("preserves unrelated application and third-party localStorage", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("third_party_consent", "granted");
    localStorage.setItem("notignite_cached", "keep");

    clearUserScopedCaches();

    expect(Object.fromEntries(Object.entries(localStorage))).toEqual({
      theme: "dark",
      third_party_consent: "granted",
      notignite_cached: "keep",
    });
  });

  it("removes all matching keys without skipping entries as storage shrinks", () => {
    for (let i = 0; i < 25; i++) localStorage.setItem(`ignite_cache_${i}`, `value-${i}`);

    clearUserScopedCaches();

    expect(Array.from({ length: 25 }, (_, i) => localStorage.getItem(`ignite_cache_${i}`)))
      .toEqual(Array(25).fill(null));
  });

  it("still sweeps browser storage when every module cache clearer fails", () => {
    for (const clear of [
      mocks.clearMediaCache,
      mocks.clearProfileCache,
      mocks.clearRolesCache,
      mocks.clearClubTeamCache,
      mocks.clearMessagesPageCache,
    ]) {
      clear.mockImplementation(() => { throw new Error("cache failure"); });
    }
    localStorage.setItem("ignite_private_cache", "user-1-data");

    clearUserScopedCaches();

    expect(localStorage.getItem("ignite_private_cache")).toBeNull();
  });

  it("must clear pending chat and notification navigation from sessionStorage", () => {
    sessionStorage.setItem("ignite_pending_chat_jump_v1", JSON.stringify({ targetId: "private-team" }));
    sessionStorage.setItem("ignite_pending_web_push_nav", "/messages/private-team");
    sessionStorage.setItem("ignite_from_notification_team_private-team", String(Date.now()));
    sessionStorage.setItem("unrelated_session_state", "keep");

    clearUserScopedCaches();

    expect(sessionStorage.getItem("ignite_pending_chat_jump_v1")).toBeNull();
    expect(sessionStorage.getItem("ignite_pending_web_push_nav")).toBeNull();
    expect(sessionStorage.getItem("ignite_from_notification_team_private-team")).toBeNull();
    expect(sessionStorage.getItem("unrelated_session_state")).toBe("keep");
  });

  it("is idempotent when invoked repeatedly during an auth transition", () => {
    localStorage.setItem("ignite_private_cache", "user-1-data");

    expect(() => {
      clearUserScopedCaches();
      clearUserScopedCaches();
    }).not.toThrow();
    expect(localStorage.getItem("ignite_private_cache")).toBeNull();
    expect(mocks.clearMediaCache).toHaveBeenCalledTimes(2);
  });
});
