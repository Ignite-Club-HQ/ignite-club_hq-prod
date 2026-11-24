import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSuccessfulAuthMethod, readPendingAuthMethod, readSuccessfulAuthMethod, rememberSuccessfulAuthMethod, resolveAuthScreenVariant, selectPendingAuthMethod } from "./authExperience";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); forgetSuccessfulAuthMethod(); selectPendingAuthMethod(null); });
afterEach(() => { vi.unstubAllGlobals(); forgetSuccessfulAuthMethod(); });
describe("adaptive authentication presentation", () => {
  it.each(["Bridgewater", "Basket Range"])("retains recognised %s email members", () => {
    rememberSuccessfulAuthMethod("supabase");
    expect(resolveAuthScreenVariant({ successfulMethod: readSuccessfulAuthMethod(), secureAvailable: true })).toBe("email");
  });
  it("offers email recovery on a new or cleared device without assuming a new account", () => {
    expect(resolveAuthScreenVariant({ successfulMethod: readSuccessfulAuthMethod(), secureAvailable: true })).toBe("default");
    rememberSuccessfulAuthMethod("icp"); localStorage.clear();
    expect(readSuccessfulAuthMethod()).toBeNull();
    expect(resolveAuthScreenVariant({ secureAvailable: true })).toBe("default");
  });
  it.each(["Bridgewater", "Basket Range"])("verified %s invitation beats remembered secure sign-in", () => {
    expect(resolveAuthScreenVariant({ verifiedMethod: "supabase", successfulMethod: "icp", selectedMethod: "icp", secureAvailable: true })).toBe("email");
  });
  it("returning Internet Identity users see secure sign-in", () => {
    expect(resolveAuthScreenVariant({ successfulMethod: "icp", secureAvailable: true })).toBe("secure");
  });
  it("ICP invitations and new-club onboarding override email preference", () => {
    expect(resolveAuthScreenVariant({ verifiedMethod: "icp", successfulMethod: "supabase", secureAvailable: true })).toBe("secure");
  });
  it("shared devices can deliberately switch without overwriting the successful preference", () => {
    rememberSuccessfulAuthMethod("supabase");
    expect(resolveAuthScreenVariant({ selectedMethod: "icp", successfulMethod: readSuccessfulAuthMethod(), secureAvailable: true })).toBe("secure");
    expect(readSuccessfulAuthMethod()).toBe("supabase");
  });
  it("the last successful email method beats a recoverable older II session on shared devices", () => {
    expect(resolveAuthScreenVariant({ successfulMethod: "supabase", restoredMethod: "icp", secureAvailable: true })).toBe("email");
  });
  it("persists only the successful method, not an identity or memberships", () => {
    rememberSuccessfulAuthMethod("icp");
    expect(localStorage.getItem("ignite.authLastSuccess")).toBe("icp");
    expect(readSuccessfulAuthMethod()).toBe("icp");
    expect(localStorage.length).toBe(1);
  });
  it("keeps unsuccessful choices memory-only and clears them after successful authentication", () => {
    selectPendingAuthMethod("icp");
    expect(readPendingAuthMethod()).toBe("icp");
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
    rememberSuccessfulAuthMethod("supabase");
    expect(readPendingAuthMethod()).toBeNull();
    expect(readSuccessfulAuthMethod()).toBe("supabase");
  });
  it("handles storage refusal with a memory-only hint", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("Unavailable"); }, setItem() { throw new Error("Unavailable"); }, removeItem() { throw new Error("Unavailable"); } });
    rememberSuccessfulAuthMethod("supabase");
    expect(readSuccessfulAuthMethod()).toBe("supabase");
  });
});