import { resolveAuthBackend } from "./authBackendMode";
import { getActiveIcpTarget } from "./targetRegistry";

/** Cache identity only: this is not authorization or a routing override. */
export function appSettingSourceKey(): string {
  if (resolveAuthBackend() !== "icp") return "supabase";
  try {
    const target = getActiveIcpTarget();
    return JSON.stringify(["icp", target.host, target.canisterIds.club_domain ?? null]);
  } catch {
    return "icp-unconfigured";
  }
}