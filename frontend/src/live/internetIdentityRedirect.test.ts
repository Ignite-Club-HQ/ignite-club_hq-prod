import { describe, expect, it } from "vitest";
import { shouldUseRedirectSignIn } from "./internetIdentityAuth";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const CANISTER = "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io";

describe("phone sign-in uses a full-page redirect instead of a second tab", () => {
  it("Android Chrome on the app's canister address", () => {
    expect(shouldUseRedirectSignIn(CANISTER, ANDROID)).toBe(true);
  });
  it("iPhone Safari on the app's canister address", () => {
    expect(shouldUseRedirectSignIn(CANISTER, IPHONE)).toBe(true);
  });
  it("iPad (desktop user agent with touch)", () => {
    expect(shouldUseRedirectSignIn(CANISTER, MAC, 5)).toBe(true);
  });
  it("desktop keeps the sign-in window", () => {
    expect(shouldUseRedirectSignIn(CANISTER, MAC, 0)).toBe(false);
  });
  it("other canister addresses also redirect", () => {
    expect(shouldUseRedirectSignIn("https://proe7-kqaaa-aaaas-qg6gq-cai.icp.net", ANDROID)).toBe(true);
  });
  it("Android Chrome on the live website uses the browser-only /auth callback", () => {
    expect(shouldUseRedirectSignIn("https://igniteclubhq.app", ANDROID)).toBe(true);
  });
  it("iOS and desktop custom-domain transport remain unchanged", () => {
    expect(shouldUseRedirectSignIn("https://igniteclubhq.app", IPHONE)).toBe(false);
    expect(shouldUseRedirectSignIn("https://igniteclubhq.app", MAC, 0)).toBe(false);
  });
  it("does not opt native private origins or lookalike domains into website redirects", () => {
    for (const origin of ["https://localhost", "capacitor://localhost", "http://igniteclubhq.app", "https://igniteclubhq.app.evil", "https://www.igniteclubhq.app"]) {
      expect(shouldUseRedirectSignIn(origin, ANDROID)).toBe(false);
    }
  });
  it("addresses without a return allow-list keep the sign-in window", () => {
    expect(shouldUseRedirectSignIn("https://ignite-canister-connect.lovable.app", ANDROID)).toBe(false);
    expect(shouldUseRedirectSignIn("http://localhost:8080", ANDROID)).toBe(false);
  });
});

describe("live website return allow-list", () => {
  it("lists the live website's /auth return address", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const file = JSON.parse(readFileSync(resolve(__dirname, "../../public/.well-known/ii-auth-callbacks"), "utf8"));
    expect(file.callbacks).toContain("https://igniteclubhq.app/auth");
  });
  it("both current Android scaffolds keep /auth out of claimed shared links", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("../codemagic.yaml", "utf8");
    const filters = source.match(/a = \('[\s\S]*?android:pathPrefix[\s\S]*?\)\n/g) ?? [];
    expect(filters).toHaveLength(2);
    for (const filter of filters) {
      const prefixes = [...filter.matchAll(/android:pathPrefix="([^"]+)"/g)].map(match => match[1]);
      expect(prefixes).toContain('/join');
      expect(prefixes.some(prefix => '/auth'.startsWith(prefix))).toBe(false);
      expect(prefixes.some(prefix => '/native-sign-in.html'.startsWith(prefix))).toBe(false);
    }
  });
});
