import { describe, expect, it } from "vitest";
import { clubSetupNotice } from "./clubSetupNotice";
describe("club setup notice", () => {
  it("shows nothing when every step finished", () => {
    expect(clubSetupNotice([], false)).toBeNull();
  });
  it("names failed staff chats and says they retry automatically", () => {
    const n = clubSetupNotice(["staff_chats"], false)!;
    expect(n.description).toContain("staff chats");
    expect(n.description).toContain("retried automatically");
  });
  it("never reports a logo-only failure as an unfinished club", () => {
    expect(clubSetupNotice([], true)!.title).toBe("Club created");
  });
  it("never tells the creator to create the club again", () => {
    expect(clubSetupNotice(["settings", "staff_chats"], true)!.description).not.toMatch(/create (the|your) club again/i);
  });
});
