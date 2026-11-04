import { describe, expect, it } from "vitest";
import { resolveClubProAccess } from "./useClubProAccess";

describe("resolveClubProAccess", () => {
  const now = new Date("2026-07-19T12:00:00Z");

  it("denies a club without a subscription", () => {
    expect(resolveClubProAccess(null, now)).toEqual({
      hasPro: false,
      hasProFootball: false,
      resolved: true,
    });
  });

  it.each([
    [{ is_pro: true }, { hasPro: true, hasProFootball: false }],
    [{ admin_pro_override: true }, { hasPro: true, hasProFootball: false }],
    [{ is_pro_football: true }, { hasPro: true, hasProFootball: true }],
    [{ admin_pro_football_override: true }, { hasPro: true, hasProFootball: true }],
  ])("grants active paid and admin entitlements", (subscription, expected) => {
    expect(resolveClubProAccess(subscription, now)).toMatchObject(expected);
  });

  it("treats football Pro as access to general Pro features", () => {
    expect(resolveClubProAccess({ is_pro_football: true }, now)).toMatchObject({
      hasPro: true,
      hasProFootball: true,
    });
  });

  it.each(["2026-07-19T11:59:59Z", "2026-07-19T12:00:00Z"])(
    "denies an expired entitlement at %s",
    (expires_at) => {
      expect(resolveClubProAccess({ is_pro: true, expires_at }, now)).toMatchObject({
        hasPro: false,
        hasProFootball: false,
      });
    },
  );

  it("grants an entitlement that expires in the future", () => {
    expect(
      resolveClubProAccess({ is_pro: true, expires_at: "2026-07-19T12:00:01Z" }, now),
    ).toMatchObject({ hasPro: true });
  });
});

import { isClubSubscriptionActive } from "@/lib/proEntitlement";
describe("admin Pro override beats an old end date", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  const expired = "2026-10-30T13:30:00Z";
  it("override keeps Pro after expiry", () => {
    expect(resolveClubProAccess({ is_pro: true, admin_pro_override: true, expires_at: expired }, now).hasPro).toBe(true);
    expect(isClubSubscriptionActive({ is_pro: true, admin_pro_override: true, expires_at: expired }, now)).toBe(true);
  });
  it("football override keeps Pro Football after expiry", () => {
    expect(resolveClubProAccess({ admin_pro_football_override: true, expires_at: expired }, now).hasProFootball).toBe(true);
  });
  it("expired promo without override has no Pro", () => {
    expect(isClubSubscriptionActive({ is_pro: true, expires_at: expired }, now)).toBe(false);
  });
});
