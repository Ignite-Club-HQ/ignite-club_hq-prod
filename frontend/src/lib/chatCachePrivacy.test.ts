import { QueryClient } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
vi.mock("./appNavigator", () => ({ navigateApp: vi.fn() }));
import { bindChatCacheAccount, installChatCachePrivacy } from "./chatCachePrivacy";
import { navigateApp } from "./appNavigator";

describe("chat cache ownership and revocation", () => {
  it("clears all four thread types before a second account uses the client", () => {
    const qc = new QueryClient(); bindChatCacheAccount(qc, "paul");
    for (const type of ["team", "club", "group", "dm"]) qc.setQueryData([`${type}-messages`, "same"], { messages: ["private"] });
    bindChatCacheAccount(qc, "other");
    expect(qc.getQueryCache().getAll()).toHaveLength(0); qc.clear();
  });
  it("removes a cached thread on authoritative access denial", async () => {
    const qc = new QueryClient(); const stop = installChatCachePrivacy(qc);
    qc.setQueryData(["team-messages", "t"], { messages: ["private"] });
    await qc.fetchQuery({ queryKey: ["team-messages", "t"], staleTime: 0, retry: false,
      queryFn: async () => { throw new Error("Open conversation failed: Club chat access forbidden"); } }).catch(() => {});
    expect(qc.getQueryData(["team-messages", "t"])).toBeUndefined();
    expect(navigateApp).toHaveBeenCalledWith("/messages", { replace: true }); stop(); qc.clear();
  });
  it("keeps authorized cache through a temporary network failure", async () => {
    const qc = new QueryClient(); const stop = installChatCachePrivacy(qc);
    qc.setQueryData(["dm-messages", "d"], { messages: ["authorized"] });
    await qc.fetchQuery({ queryKey: ["dm-messages", "d"], staleTime: 0, retry: false,
      queryFn: async () => { throw new Error("Network timed out"); } }).catch(() => {});
    expect(qc.getQueryData(["dm-messages", "d"])).toEqual({ messages: ["authorized"] }); stop(); qc.clear();
  });
});