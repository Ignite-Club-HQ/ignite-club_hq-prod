import { describe, it, expect, beforeEach, vi } from "vitest";
import { seedClubFilterFromInvite } from "./seedClubFilterFromInvite";

const KEY = (u: string) => `ignite-club-theme-${u}`;
const SENTINEL = "__ignite_no_club__";

describe("seedClubFilterFromInvite", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("seeds when no preference exists", () => {
    const set = vi.fn();
    expect(seedClubFilterFromInvite("u1", "club-1", set)).toBe(true);
    expect(set).toHaveBeenCalledWith("club-1");
  });

  it("replaces the no-club sentinel", () => {
    localStorage.setItem(KEY("u1"), SENTINEL);
    const set = vi.fn();
    expect(seedClubFilterFromInvite("u1", "club-1", set)).toBe(true);
    expect(set).toHaveBeenCalledWith("club-1");
  });

  it("never overrides an explicit club selection", () => {
    localStorage.setItem(KEY("u1"), "club-existing");
    const set = vi.fn();
    expect(seedClubFilterFromInvite("u1", "club-1", set)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("does nothing when user id or club id is missing", () => {
    const set = vi.fn();
    expect(seedClubFilterFromInvite(null, "club-1", set)).toBe(false);
    expect(seedClubFilterFromInvite("u1", null, set)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});
