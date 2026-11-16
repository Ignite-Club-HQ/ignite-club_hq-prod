import { describe, expect, it } from "vitest";
import { PUBLIC_INVITE_ORIGIN } from "./inviteLinks";
import { buildMiniLeagueJoinLinkUrl } from "@/components/mini-league/miniLeagueJoinLinkCardContract";

describe("public invitation links", () => {
  it.each([
    ["pending parent/player/admin", "/join/p/share-token"],
    ["short invitation", "/j/short-token"],
    ["team role", "/join/team-token"],
    ["competition", "/competitions/join?token=competition-token"],
    ["competition official", "/competitions/officials/join?token=official-token"],
    ["email-bound official", "/competitions/officials/join?email=1&token=email-token"],
  ])("%s links use the public Ignite address", (_, path) => {
    expect(`${PUBLIC_INVITE_ORIGIN}${path}`).toBe(`https://igniteclubhq.app${path}`);
    expect(new URL(`${PUBLIC_INVITE_ORIGIN}${path}`).hostname).toBe("igniteclubhq.app");
  });

  it("mini-league parent/admin links preserve their existing token", () => {
    expect(buildMiniLeagueJoinLinkUrl("unchanged-share-token")).toBe(
      "https://igniteclubhq.app/join/p/unchanged-share-token",
    );
  });
});