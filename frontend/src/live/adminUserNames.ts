import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";

/** App admins unlock members' names; identity_access re-checks app_admin server-side. */
export async function unlockAdminUserNames(
  ctx: FeatureBackendContext,
  rows: ReadonlyArray<{ account_id: string; principal?: Principal; principals?: readonly Principal[]; display_name: string | null }>,
  reasons?: Map<string, string>,
): Promise<Map<string, string>> {
  const identity = ctx.target.canisterIds.identity_access;
  const wanted = rows.flatMap(row => {
    if (!row.display_name?.startsWith("pii-display-name:")) return [];
    // The original encryption subject may not be the first current alias.
    // Select only an alias returned by the authenticated admin directory;
    // never accept a profile pointer to an unrelated person's name.
    const subject = row.display_name.split(":").at(-1);
    const principal = row.principals ? row.principals.find(alias => alias.toText() === subject) : row.principal;
    if (!principal) reasons?.set(row.account_id, "Private-name reference does not match this member.");
    return principal ? [{ ...row, principal }] : [];
  });
  if (!identity) wanted.forEach(w => reasons?.set(w.account_id, "diagnostic: identity service id missing from active target"));
  if (!identity || wanted.length === 0) return new Map();
  const { hydratePrivateProfileNames } = await import("./privateProfileNames");
  const { createAdminNameAuthorityResolver } = await import("./adminNameAuthority");
  const out = await hydratePrivateProfileNames(ctx, wanted, {
    audience: { kind: "app_admin", authority: Principal.fromText(identity), resource: "all", profile_revision: 0n },
    partialNames: true,
    resolveAuthority: createAdminNameAuthorityResolver(ctx),
  });
  const names = new Map<string, string>();
  out.forEach((r, i) => {
    if (r.display_name && !r.display_name.startsWith("pii-display-name:")) names.set(wanted[i].account_id, r.display_name);
    else if (r.name_error) {
      console.warn("[admin-names] name not unlocked", wanted[i].account_id, r.name_error);
      reasons?.set(wanted[i].account_id, r.name_error);
    } else reasons?.set(wanted[i].account_id, `diagnostic: no name and no error returned (value ${r.display_name ? "still locked reference" : "empty"})`);
  });
  return names;
}
