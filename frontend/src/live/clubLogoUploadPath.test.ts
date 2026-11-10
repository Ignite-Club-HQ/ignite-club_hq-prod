import { describe, expect, it } from "vitest";
import { clubLogoUploadPath, isClubLogoUploadPath } from "./clubLogoUploadPath";

describe("new logo upload scope", () => {
  it("keeps team logos in the owning club, not a team-only audience", () => {
    expect(clubLogoUploadPath("club-logos/basket-range/team-1/logo.png")).toBe("clubs/basket-range/logos/team-1/logo.png");
  });
  it("keeps requested team logos in their club audience", () => {
    expect(clubLogoUploadPath("club-logos/team-requests/basket-range/logo.png")).toBe("clubs/basket-range/logos/team-requests/logo.png");
  });
  it("preserves canonical logos and unrelated private files", () => {
    expect(clubLogoUploadPath("clubs/basket-range/logos/logo.png")).toBe("clubs/basket-range/logos/logo.png");
    expect(clubLogoUploadPath("clubs/basket-range/vault/logo.png")).toBe("clubs/basket-range/vault/logo.png");
    expect(isClubLogoUploadPath("clubs/basket-range/vault/logo.png")).toBe(false);
  });
});