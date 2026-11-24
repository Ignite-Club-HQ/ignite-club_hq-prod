import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";

/** App admins unlock members' names; identity_access re-checks app_admin server-side. */
export async function unlockAdminUserNames(
  ctx: FeatureBackendContext,
  rows: ReadonlyArray<{ account_id: string; principal?: Principal; display_name: string | null }>,
): Promise<Map<string, string>> {
  const identity = ctx.target.canisterIds.identity_access;
  const wanted = rows.filter(r => r.principal && r.display_name?.startsWith("pii-display-name:"));
  if (!identity || wanted.length === 0) return new Map();
  const { hydratePrivateProfileNames } = await import("./privateProfileNames");
  const out = await hydratePrivateProfileNames(ctx, wanted, {
    audience: { kind: "app_admin", authority: Principal.fromText(identity), resource: "all", profile_revision: 0n },
    partialNames: true,
  });
  const names = new Map<string, string>();
  out.forEach((r, i) => { if (r.display_name && !r.display_name.startsWith("pii-display-name:")) names.set(wanted[i].account_id, r.display_name); });
  return names;
}
