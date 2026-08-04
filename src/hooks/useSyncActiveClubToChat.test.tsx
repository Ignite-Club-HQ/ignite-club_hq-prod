import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncActiveClubToChat } from "./useSyncActiveClubToChat";

const setActiveClubTheme = vi.fn();
let activeClubFilter: string | null = "club-a";

vi.mock("./useClubTheme", () => ({
  useClubTheme: () => ({ activeClubFilter, setActiveClubTheme }),
}));

describe("useSyncActiveClubToChat", () => {
  beforeEach(() => {
    activeClubFilter = "club-a";
    setActiveClubTheme.mockReset();
  });

  it("switches global club context when a routed chat belongs to another club", async () => {
    renderHook(() => useSyncActiveClubToChat("club-b"));

    await waitFor(() => expect(setActiveClubTheme).toHaveBeenCalledWith("club-b"));
    expect(setActiveClubTheme).toHaveBeenCalledTimes(1);
  });

  it("does not write when the routed chat already matches the active club", () => {
    renderHook(() => useSyncActiveClubToChat("club-a"));

    expect(setActiveClubTheme).not.toHaveBeenCalled();
  });

  it("does nothing until the routed chat club is known", () => {
    renderHook(() => useSyncActiveClubToChat(undefined));

    expect(setActiveClubTheme).not.toHaveBeenCalled();
  });
});
