/**
 * Computes the cascading Pro / Ignite Football Pro admin-override pair for a single
 * toggle change. Turning the Pro override off also clears the Ignite Football Pro
 * override (a team can't have free Ignite Football Pro without free Pro); turning
 * the Ignite Football Pro override on implies Pro is on too. Pure and side-effect
 * free — the caller owns the actual Supabase upsert.
 */
export interface TeamAppAdminOverrideSource {
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
}

export type TeamAppAdminOverrideChange =
  | { admin_pro_override: boolean }
  | { admin_pro_football_override: boolean };

export function computeAppAdminOverride(
  change: TeamAppAdminOverrideChange,
  current: TeamAppAdminOverrideSource | null | undefined,
) {
  const isProChange = "admin_pro_override" in change;
  const adminProOverride = isProChange
    ? change.admin_pro_override
    : change.admin_pro_football_override
      ? true
      : current?.admin_pro_override || false;
  const adminProFootballOverride = isProChange
    ? change.admin_pro_override
      ? current?.admin_pro_football_override || false
      : false
    : change.admin_pro_football_override;

  return { adminProOverride, adminProFootballOverride };
}
