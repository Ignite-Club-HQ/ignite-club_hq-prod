import { beforeEach, describe, it, expect } from "vitest";
import { cacheMessages, getCachedMessages, clearAllMessageCaches } from "./messageCache";
import { retirePrivateProfileSession } from "@/live/privateProfileSession";
beforeEach(() => { clearAllMessageCaches(); localStorage.clear(); });
describe("account-scoped chat device cache", () => {
  it("never reads another Internet Identity account's messages", () => {
    localStorage.setItem("ignite_icp_internet_identity_session", JSON.stringify({ principal: "paul" }));
    cacheMessages("team", "team", [{ id: "m", text: "private", author_id: "paul", created_at: "2026-11-07", image_url: null, reply_to_id: null, profiles: null }]);
    localStorage.setItem("ignite_icp_internet_identity_session", JSON.stringify({ principal: "other" }));
    expect(getCachedMessages("team", "team")).toEqual([]);
  });
  it("retires pending device-cache writes and messages on revoked access", () => {
    cacheMessages("group", "group", [{ id: "m", text: "private", author_id: "paul", created_at: "2026-11-07", image_url: null, reply_to_id: null, profiles: null }]);
    retirePrivateProfileSession(); expect(getCachedMessages("group", "group")).toEqual([]);
  });
});