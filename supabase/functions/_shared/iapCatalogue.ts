/**
 * SERVER-OWNED in-app purchase catalogue.
 *
 * This is the ONLY source of truth for what a store product grants. Nothing in
 * a client request may influence entity type, tier, plan, duration or storage
 * allocation — the client may only name a product id, and that product id must
 * additionally be confirmed by the store (Apple/Google) verification response.
 */

export type IapEntityType = "club" | "team";
export type IapTier = "pro" | "pro_football";
export type IapPlan = "starter" | "standard" | "unlimited";

export interface IapProduct {
  productId: string;
  entityType: IapEntityType;
  tier: IapTier;
  plan?: IapPlan;
  isAnnual: boolean;
  /** Extra storage granted (storage packs only). */
  storageGb?: number;
  isStorage: boolean;
  /** Every current SKU is an auto-renewing store subscription. */
  kind: "subscription";
}

function product(p: Omit<IapProduct, "kind" | "isStorage"> & { isStorage?: boolean }): IapProduct {
  return { kind: "subscription", isStorage: false, ...p };
}

export const IAP_CATALOGUE: Readonly<Record<string, IapProduct>> = Object.freeze({
  // ---- Club Pro plans ----
  ignite_pro_starter_monthly: product({ productId: "ignite_pro_starter_monthly", entityType: "club", tier: "pro", plan: "starter", isAnnual: false }),
  ignite_pro_starter_annual: product({ productId: "ignite_pro_starter_annual", entityType: "club", tier: "pro", plan: "starter", isAnnual: true }),
  ignite_pro_standard_monthly: product({ productId: "ignite_pro_standard_monthly", entityType: "club", tier: "pro", plan: "standard", isAnnual: false }),
  ignite_pro_standard_annual: product({ productId: "ignite_pro_standard_annual", entityType: "club", tier: "pro", plan: "standard", isAnnual: true }),
  ignite_pro_unlimited_monthly: product({ productId: "ignite_pro_unlimited_monthly", entityType: "club", tier: "pro", plan: "unlimited", isAnnual: false }),

  // ---- Club Pro Football plans ----
  ignite_pf_starter_monthly: product({ productId: "ignite_pf_starter_monthly", entityType: "club", tier: "pro_football", plan: "starter", isAnnual: false }),
  ignite_pf_standard_monthly: product({ productId: "ignite_pf_standard_monthly", entityType: "club", tier: "pro_football", plan: "standard", isAnnual: false }),
  ignite_pf_unlimited_monthly: product({ productId: "ignite_pf_unlimited_monthly", entityType: "club", tier: "pro_football", plan: "unlimited", isAnnual: false }),

  // ---- Team plans ----
  ignite_team_pro_monthly: product({ productId: "ignite_team_pro_monthly", entityType: "team", tier: "pro", isAnnual: false }),
  ignite_team_pro_annual: product({ productId: "ignite_team_pro_annual", entityType: "team", tier: "pro", isAnnual: true }),
  ignite_team_pf_monthly: product({ productId: "ignite_team_pf_monthly", entityType: "team", tier: "pro_football", isAnnual: false }),
  ignite_team_pf_annual: product({ productId: "ignite_team_pf_annual", entityType: "team", tier: "pro_football", isAnnual: true }),

  // ---- Storage packs (club scoped, never grant Pro) ----
  ignite_storage_10gb_monthly: product({ productId: "ignite_storage_10gb_monthly", entityType: "club", tier: "pro", isAnnual: false, storageGb: 10, isStorage: true }),
  ignite_storage_10gb_annual: product({ productId: "ignite_storage_10gb_annual", entityType: "club", tier: "pro", isAnnual: true, storageGb: 10, isStorage: true }),
  ignite_storage_50gb_monthly: product({ productId: "ignite_storage_50gb_monthly", entityType: "club", tier: "pro", isAnnual: false, storageGb: 50, isStorage: true }),
  ignite_storage_50gb_annual: product({ productId: "ignite_storage_50gb_annual", entityType: "club", tier: "pro", isAnnual: true, storageGb: 50, isStorage: true }),
});

export function getIapProduct(productId: unknown): IapProduct | null {
  if (typeof productId !== "string") return null;
  return IAP_CATALOGUE[productId] ?? null;
}

/** Fallback expiry when the store response carries no expiry date. */
export function fallbackExpiry(product: IapProduct, from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  if (product.isAnnual) d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
