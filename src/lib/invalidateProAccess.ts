import type { QueryClient } from "@tanstack/react-query";

/**
 * Entitlement query keys that must be refreshed whenever a club/team gains or
 * loses Pro access (promo code redemption, IAP purchase, admin override).
 *
 * Historically the upgrade pages only invalidated `club-subscription` /
 * `team-subscription`, so the HomePage Pro gates (`user-has-pro-access`,
 * `reward-clubs-home`) and the shared hooks (`club-pro-access`,
 * `user-has-any-club-pro`) kept serving their cached "Free" answer — the
 * "Pro Only" rewards lock and "Upgrade to Pro" ad stayed on screen after a
 * successful promo upgrade.
 *
 * Prefix-matching invalidation is used deliberately: these keys embed userId,
 * club filter and membership arrays, so exact-key invalidation is unreliable.
 */
export const PRO_ACCESS_QUERY_KEY_PREFIXES = [
  "user-has-pro-access",
  "user-has-any-club-pro",
  "club-pro-access",
  "reward-clubs-home",
  "upgradable-clubs",
  "upgradable-teams",
] as const;

export function invalidateProAccessQueries(queryClient: QueryClient) {
  for (const prefix of PRO_ACCESS_QUERY_KEY_PREFIXES) {
    queryClient.invalidateQueries({ queryKey: [prefix] });
  }
}
