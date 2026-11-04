export interface ClubSubscriptionEntitlements {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
  expires_at?: string | null;
}

/**
 * Admin overrides always grant access, whatever the end date says; paid/promo
 * Pro only counts until `expires_at`.
 */
export function resolveClubProAccess(
  sub: ClubSubscriptionEntitlements | null,
  now = new Date(),
) {
  if (!sub) return { hasPro: false, hasProFootball: false, resolved: true };

  const notExpired = !sub.expires_at || new Date(sub.expires_at) > now;
  const hasPro = !!sub.admin_pro_override || (notExpired && !!sub.is_pro);
  const hasProFootball =
    !!sub.admin_pro_football_override || (notExpired && !!sub.is_pro_football);

  return {
    hasPro: hasPro || hasProFootball,
    hasProFootball,
    resolved: true,
  };
}

/** True when the club has any active Pro (incl. Pro Football or overrides). */
export function isClubSubscriptionActive(
  sub: ClubSubscriptionEntitlements | null | undefined,
  now = new Date(),
): boolean {
  return resolveClubProAccess(sub ?? null, now).hasPro;
}
