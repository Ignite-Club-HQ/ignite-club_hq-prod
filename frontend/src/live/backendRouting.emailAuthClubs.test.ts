import { afterEach, describe, expect, it } from "vitest";
import {
  applyBackendRoutingConfig,
  emailAuthClubNames,
  getBackendRoutingConfig,
  isEmailAuthAllowlistActive,
  isEmailAuthAllowedForClubs,
  parseBackendRoutingConfig,
} from "./backendRouting";

// Real DEV club ids: the two clubs whose members keep email sign-in.
const BRIDGE = "966bdaec-ebf1-46da-b2b3-cc53bf05c422";
const BASKET = "493ee2e3-c834-487d-93be-d1c8a0dbc4a8";
const OTHER = "0f2a1b6c-7d3e-4a5b-8c9d-0e1f2a3b4c5d";

const BASE = {
  defaultBackend: "icp",
  countryRules: {},
  targets: [],
  countryTargets: {},
  clubBackendOverrides: {},
} as const;

afterEach(() => applyBackendRoutingConfig(null));

describe("emailAuthClubs config parsing", () => {
  it("treats an absent list as the switch being off", () => {
    const config = parseBackendRoutingConfig({ ...BASE });
    expect(config?.emailAuthClubs).toEqual([]);
    expect(isEmailAuthAllowlistActive(config!)).toBe(false);
    expect(emailAuthClubNames(config!)).toEqual([]);
  });

  it("keeps each club's label so the sign-in screen can name them", () => {
    const config = parseBackendRoutingConfig({
      ...BASE,
      emailAuthClubs: [{ id: BRIDGE, name: "Bridgewater Soccer Club" }],
    });
    expect(config?.emailAuthClubs).toEqual([{ id: BRIDGE, name: "Bridgewater Soccer Club" }]);
    expect(isEmailAuthAllowlistActive(config!)).toBe(true);
    expect(emailAuthClubNames(config!)).toEqual(["Bridgewater Soccer Club"]);
  });

  it("normalises case and spacing, and keeps a repeated club once", () => {
    const config = parseBackendRoutingConfig({
      ...BASE,
      emailAuthClubs: [
        { id: ` ${BRIDGE.toUpperCase()} `, name: "  Bridgewater Soccer Club  " },
        { id: BRIDGE, name: "Bridgewater Soccer Club" },
      ],
    });
    expect(config?.emailAuthClubs).toEqual([{ id: BRIDGE, name: "Bridgewater Soccer Club" }]);
  });

  it("refuses a club id that is not a club id", () => {
    expect(() => parseBackendRoutingConfig({
      ...BASE,
      emailAuthClubs: [{ id: "bridgewater", name: "Bridgewater Soccer Club" }],
    })).toThrow(/is not a club id/);
  });

  it("refuses an entry with no name — the sign-in screen needs one", () => {
    expect(() => parseBackendRoutingConfig({
      ...BASE,
      emailAuthClubs: [{ id: BRIDGE, name: "   " }],
    })).toThrow(/needs a name/);
  });
});

describe("isEmailAuthAllowedForClubs", () => {
  const armed = parseBackendRoutingConfig({
    ...BASE,
    emailAuthClubs: [
      { id: BRIDGE, name: "Bridgewater Soccer Club" },
      { id: BASKET, name: "Basket Range Cricket Club" },
    ],
  })!;
  const off = parseBackendRoutingConfig({ ...BASE })!;

  it("allows everyone while the switch is off", () => {
    expect(isEmailAuthAllowedForClubs(off, [OTHER])).toBe(true);
    expect(isEmailAuthAllowedForClubs(off, [])).toBe(true);
  });

  it("allows an account with no known clubs (app admin, failed lookup, pending invite)", () => {
    expect(isEmailAuthAllowedForClubs(armed, [])).toBe(true);
  });

  it("allows a member of an allowlisted club", () => {
    expect(isEmailAuthAllowedForClubs(armed, [BASKET])).toBe(true);
    expect(isEmailAuthAllowedForClubs(armed, [OTHER, BRIDGE])).toBe(true);
  });

  it("refuses an account whose clubs are all outside the allowlist", () => {
    expect(isEmailAuthAllowedForClubs(armed, [OTHER])).toBe(false);
  });

  it("applies the same rule through the live config after a save", () => {
    applyBackendRoutingConfig(armed);
    expect(isEmailAuthAllowedForClubs(getBackendRoutingConfig(), [OTHER])).toBe(false);
    expect(isEmailAuthAllowedForClubs(getBackendRoutingConfig(), [BRIDGE])).toBe(true);
  });
});
