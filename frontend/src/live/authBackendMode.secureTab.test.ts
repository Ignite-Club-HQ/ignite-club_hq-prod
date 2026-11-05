import { afterEach, describe, expect, it } from "vitest";
import { markMountedAuthProvider, resolveAuthBackend, setAuthMethodChoice } from "./authBackendMode";
import { applyBackendRoutingConfig } from "./backendRouting";
import { applyIcpAdminOverrides } from "./icpAdminOverrides";

afterEach(() => {
  localStorage.clear();
  applyBackendRoutingConfig(null);
  applyIcpAdminOverrides(null);
});

describe("secure sign-in tab", () => {
  it("switches to secure sign-in even when an old email session is left on the device", () => {
    applyIcpAdminOverrides({ canisterIds: { identity_access: "ryjl3-tyaaa-aaaaa-aaaba-cai" } });
    localStorage.setItem("sb-ecsdwrarzfexssxtrymj-auth-token", "{\"access_token\":\"old\"}");
    markMountedAuthProvider("supabase");
    expect(resolveAuthBackend()).toBe("supabase");
    setAuthMethodChoice("icp");
    expect(resolveAuthBackend()).toBe("icp");
  });
});
