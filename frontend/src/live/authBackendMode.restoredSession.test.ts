import { afterEach, describe, expect, it } from "vitest";
import { markMountedAuthProvider, resolveAuthBackend } from "./authBackendMode";
import { applyBackendRoutingConfig } from "./backendRouting";
import { applyIcpAdminOverrides } from "./icpAdminOverrides";

afterEach(() => {
  localStorage.clear();
  markMountedAuthProvider("supabase");
  applyBackendRoutingConfig(null);
  applyIcpAdminOverrides(null);
});

describe("restored Internet Identity account routing", () => {
  const restore = () => {
    localStorage.setItem("ignite_icp_internet_identity_session", JSON.stringify({ principal: "synthetic-member" }));
    applyBackendRoutingConfig(null); // the live email default is not an account migration
    applyIcpAdminOverrides({ canisterIds: { identity_access: "ryjl3-tyaaa-aaaaa-aaaba-cai" } });
  };

  it("keeps a restored II account on ICP before provider mount without a URL choice", () => {
    restore();
    expect(resolveAuthBackend()).toBe("icp");
  });

  it("keeps mounted II membership readers on ICP when placement says email", () => {
    restore();
    markMountedAuthProvider("icp");
    expect(resolveAuthBackend()).toBe("icp");
  });

  it("does not move a mounted email account because an old II record exists", () => {
    restore();
    localStorage.setItem("sb-synthetic-auth-token", JSON.stringify({ access_token: "synthetic" }));
    markMountedAuthProvider("supabase");
    expect(resolveAuthBackend()).toBe("supabase");
  });

  it("retains an explicit email choice with an old II record", () => {
    restore();
    localStorage.setItem("ignite.authChoice", "supabase");
    expect(resolveAuthBackend()).toBe("supabase");
  });
});