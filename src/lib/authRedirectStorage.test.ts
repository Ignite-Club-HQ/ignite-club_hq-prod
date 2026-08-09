import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildAuthPathWithRedirect,
  readRedirectParam,
  safeSessionGet,
  safeSessionSet,
} from "@/lib/authRedirectStorage";

describe("authRedirectStorage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("carries the invite path in the auth URL", () => {
    expect(buildAuthPathWithRedirect("/join/p/abc123")).toBe("/auth?redirect=%2Fjoin%2Fp%2Fabc123");
  });

  it("refuses external destinations", () => {
    expect(buildAuthPathWithRedirect("//evil.example")).toBe("/auth");
    expect(buildAuthPathWithRedirect("https://evil.example")).toBe("/auth");
  });

  it("reads the redirect param back", () => {
    expect(readRedirectParam("?redirect=%2Fjoin%2Fp%2Fabc123")).toBe("/join/p/abc123");
    expect(readRedirectParam("")).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(safeSessionSet("redirectAfterAuth", "/join/p/abc123")).toBe(false);
    expect(safeSessionGet("redirectAfterAuth")).toBeNull();
  });
});
