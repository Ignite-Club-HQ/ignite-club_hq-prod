import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authMethodEmailClubNames,
  shouldOfferAuthMethodChoice,
} from "./authBackendMode";
import { applyBackendRoutingConfig } from "./backendRouting";
import { applyIcpAdminOverrides } from "./icpAdminOverrides";

const VALID_CANISTER_ID = "ryjl3-tyaaa-aaaaa-aaaba-cai";
const BRIDGE = "966bdaec-ebf1-46da-b2b3-cc53bf05c422";
const BASKET = "493ee2e3-c834-487d-93be-d1c8a0dbc4a8";

const ALLOWLIST = [
  { id: BRIDGE, name: "Bridgewater Soccer Club" },
  { id: BASKET, name: "Basket Range Cricket Club" },
];

function resetState(): void {
  applyBackendRoutingConfig(null);
  applyIcpAdminOverrides(null);
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetState();
});

describe("shouldOfferAuthMethodChoice", () => {
  it("is false with no allowlist — email is still open to everyone", () => {
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
    applyBackendRoutingConfig({
      defaultBackend: "icp",
      countryRules: {},
      targets: [],
      countryTargets: {},
      clubBackendOverrides: {},
    });
    expect(shouldOfferAuthMethodChoice()).toBe(false);
    expect(authMethodEmailClubNames()).toEqual([]);
  });

  it("is false when secure sign-in is not configured", () => {
    vi.stubEnv("IGNITE_LIVE_ICP_CANISTER_IDS_JSON", "{}");
    applyBackendRoutingConfig({
      defaultBackend: "icp",
      countryRules: {},
      targets: [],
      countryTargets: {},
      clubBackendOverrides: {},
      emailAuthClubs: ALLOWLIST,
    });
    expect(shouldOfferAuthMethodChoice()).toBe(false);
  });

  it("is true once both paths genuinely exist, and names the email clubs", () => {
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
    applyBackendRoutingConfig({
      defaultBackend: "icp",
      countryRules: {},
      targets: [],
      countryTargets: {},
      clubBackendOverrides: {},
      emailAuthClubs: ALLOWLIST,
    });
    expect(shouldOfferAuthMethodChoice()).toBe(true);
    expect(authMethodEmailClubNames()).toEqual([
      "Bridgewater Soccer Club",
      "Basket Range Cricket Club",
    ]);
  });
});
