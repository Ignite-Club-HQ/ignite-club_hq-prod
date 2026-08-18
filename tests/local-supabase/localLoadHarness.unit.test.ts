import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertLocalLoadEnvironment,
  failureReason,
  isExpectedLoadNetworkNoise,
  LOCAL_LOAD_PROFILES,
  resolveLocalLoadProfile,
  summarizeRealtimeDelivery,
  thinkTimeMs,
  workerStartDelayMs,
  workerUserIndex,
} from "../../scripts/local-load-safety.mjs";

const anonKey = `sb_publishable_${"a".repeat(24)}`;
const serviceKey = `sb_secret_${"b".repeat(24)}`;

describe("local load harness safety", () => {
  it.each([
    "https://project.supabase.co",
    "http://project.supabase.co:54321",
    "http://127.0.0.1:54322",
    "https://127.0.0.1:54321",
    "http://user:pass@127.0.0.1:54321",
    "http://127.0.0.1:54321/rest/v1",
  ])("rejects non-local or malformed targets: %s", (url) => {
    expect(() => assertLocalLoadEnvironment({
      LOCAL_SUPABASE_URL: url,
      LOCAL_SUPABASE_ANON_KEY: anonKey,
      LOCAL_SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    })).toThrow();
  });

  it("accepts only the isolated local gateway", () => {
    expect(assertLocalLoadEnvironment({
      LOCAL_SUPABASE_URL: "http://127.0.0.1:54321",
      LOCAL_SUPABASE_ANON_KEY: anonKey,
      LOCAL_SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    })).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey,
      serviceKey,
    });
  });

  it("defaults to the bounded smoke profile and rejects arbitrary profiles", () => {
    expect(resolveLocalLoadProfile([])).toEqual({
      name: "smoke",
      profile: LOCAL_LOAD_PROFILES.smoke,
    });
    expect(() => resolveLocalLoadProfile(["--profile=production"])).toThrow(
      /Unknown load profile/,
    );
  });

  it("keeps every declared profile within the local safety ceiling", () => {
    for (const profile of Object.values(LOCAL_LOAD_PROFILES)) {
      expect(profile.virtualUsers).toBeLessThanOrEqual(1_000);
      expect(profile.durationSeconds).toBeLessThanOrEqual(300);
      expect(profile.totalClubCardinality).toBeLessThanOrEqual(1_000);
      expect(profile.activeClubs * profile.usersPerClub).toBeLessThanOrEqual(1_000);
      if (profile.authShare !== undefined) {
        expect(profile.authShare).toBeGreaterThanOrEqual(0);
        expect(profile.authShare).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it("keeps game-day traffic distinct from the deliberate authentication storm", () => {
    expect(LOCAL_LOAD_PROFILES.gameday.authShare).toBe(0.01);
    expect(LOCAL_LOAD_PROFILES.authstorm.authShare).toBe(0.05);
    expect(LOCAL_LOAD_PROFILES.gameday.virtualUsers)
      .toBe(LOCAL_LOAD_PROFILES.authstorm.virtualUsers);
  });

  it("ramps the scale profile progressively while retaining a full-load hold", () => {
    const profile = LOCAL_LOAD_PROFILES.scale;
    expect(workerStartDelayMs(0, profile)).toBe(0);
    expect(workerStartDelayMs(250, profile)).toBeGreaterThan(60_000);
    expect(workerStartDelayMs(499, profile)).toBe(120_000);
    expect(profile.durationSeconds - (profile.rampSeconds ?? 0)).toBeGreaterThanOrEqual(60);
    expect(workerStartDelayMs(1, LOCAL_LOAD_PROFILES.gameday)).toBe(0);
  });

  it("rejects invalid worker indexes", () => {
    expect(() => workerStartDelayMs(-1, LOCAL_LOAD_PROFILES.scale)).toThrow();
    expect(() => workerStartDelayMs(500, LOCAL_LOAD_PROFILES.scale)).toThrow();
  });

  it("extracts nested transport errors and suppresses only known network noise", () => {
    const error = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
    });
    expect(failureReason(error)).toContain("UND_ERR_SOCKET");
    expect(isExpectedLoadNetworkNoise([error])).toBe(true);
    expect(isExpectedLoadNetworkNoise(["unexpected application defect"])).toBe(false);
    expect(failureReason({ message: "generic", details: "specific database failure" }))
      .toContain("specific database failure");
  });

  it("models 500 established sessions with realistic human pacing", () => {
    const profile = LOCAL_LOAD_PROFILES.realistic500;
    expect(profile.virtualUsers).toBe(500);
    expect(profile.authShare).toBe(0);
    expect(workerStartDelayMs(499, profile)).toBe(180_000);
    expect(thinkTimeMs(profile, 0)).toBe(3_000);
    expect(thinkTimeMs(profile, 0.5)).toBe(6_500);
    expect(thinkTimeMs(profile, 1)).toBe(10_000);
    expect(profile.durationSeconds - profile.rampSeconds).toBe(120);
  });

  it("bounds the 1,000-session profile to the existing synthetic accounts", () => {
    const profile = LOCAL_LOAD_PROFILES.realistic1000;
    expect(profile.virtualUsers).toBe(1_000);
    expect(profile.activeClubs * profile.usersPerClub).toBe(1_000);
    expect(profile.authShare).toBe(0);
    expect(workerStartDelayMs(999, profile)).toBe(180_000);
    expect(profile.durationSeconds - profile.rampSeconds).toBe(120);
    expect(thinkTimeMs(profile, 0)).toBe(3_000);
    expect(thinkTimeMs(profile, 1)).toBe(10_000);
  });

  it("bounds Realtime fan-out to 500 connections across every active club", () => {
    const profile = LOCAL_LOAD_PROFILES.realtime500;
    expect(profile.mode).toBe("realtime");
    expect(profile.virtualUsers).toBe(500);
    expect(profile.activeClubs).toBe(50);
    expect(profile.fanoutWaves).toBe(10);
    expect(profile.fanoutIntervalMs).toBeGreaterThanOrEqual(3_000);
    expect(workerStartDelayMs(499, profile)).toBe(60_000);
  });

  it("does not let duplicate Realtime messages hide missing deliveries", () => {
    expect(summarizeRealtimeDelivery([
      { expected: 100, deliveries: 98 },
      { expected: 100, deliveries: 102 },
    ])).toEqual({
      expectedDeliveries: 200,
      receivedDeliveries: 198,
      missingDeliveries: 2,
      duplicateDeliveries: 2,
      deliveryRate: 0.99,
    });
    expect(summarizeRealtimeDelivery([]).deliveryRate).toBe(0);
  });

  it("raises the Realtime ceiling only after the synthetic local marker is verified", () => {
    const runner = readFileSync("scripts/run-local-load-session.mjs", "utf8");
    const markerCheck = runner.indexOf("Synthetic local database marker was not confirmed");
    const realtimeGuard = runner.indexOf('profileName === "realtime500"');
    const tenantUpdate = runner.indexOf("update _realtime.tenants");
    expect(markerCheck).toBeGreaterThan(-1);
    expect(realtimeGuard).toBeGreaterThan(markerCheck);
    expect(tenantUpdate).toBeGreaterThan(realtimeGuard);
    expect(runner).toContain("set max_concurrent_users = 600");
    expect(runner).toContain("select count(*), min(max_concurrent_users) from updated");
    expect(runner).toContain('realtimeLimit.stdout.trim() !== "1|600"');
    expect(runner).toContain('"env", "PGPASSWORD=postgres"');
    expect(runner).toContain('"psql", "-U", "supabase_admin", "-d", "postgres"');
    expect(runner).toContain("captureFailureLogs(profileName)");
  });


  it("retains aggressive pacing for the explicit stress profiles", () => {
    expect(thinkTimeMs(LOCAL_LOAD_PROFILES.scale, 0)).toBe(100);
    expect(thinkTimeMs(LOCAL_LOAD_PROFILES.scale, 1)).toBe(300);
  });

  it("distributes virtual users evenly across all synthetic active clubs", () => {
    expect(workerUserIndex(0, 500, 1_000)).toBe(0);
    expect(workerUserIndex(250, 500, 1_000)).toBe(500);
    expect(workerUserIndex(499, 500, 1_000)).toBe(998);
    expect(() => workerUserIndex(500, 500, 1_000)).toThrow();
    expect(workerUserIndex(999, 1_000, 1_000)).toBe(999);
  });
});
