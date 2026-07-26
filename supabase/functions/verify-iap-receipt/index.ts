import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fallbackExpiry, getIapProduct, type IapProduct } from "../_shared/iapCatalogue.ts";
import {
  readAppleConfig,
  readGoogleConfig,
  StoreVerificationError,
  verifyApplePurchase,
  verifyGooglePurchase,
  type IapPlatform,
  type VerifiedPurchase,
} from "../_shared/iapStoreVerification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BODY_BYTES = 8 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Structured, non-sensitive server-side diagnostics only. */
function diag(event: string, fields: Record<string, unknown>) {
  console.log(`[IAP] ${event}`, JSON.stringify(fields));
}

async function isAuthorizedForEntity(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  product: IapProduct,
  entityId: string,
): Promise<boolean> {
  const { data: isAppAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "app_admin",
    _club_id: null,
    _team_id: null,
  });
  if (isAppAdmin) return true;

  if (product.entityType === "club") {
    const { data: isClubAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "club_admin",
      _club_id: entityId,
      _team_id: null,
    });
    return !!isClubAdmin;
  }

  const { data: isTeamAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "team_admin",
    _club_id: null,
    _team_id: entityId,
  });
  if (isTeamAdmin) return true;

  const { data: isCoach } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "coach",
    _club_id: null,
    _team_id: entityId,
  });
  if (isCoach) return true;

  const { data: team } = await supabase.from("teams").select("club_id").eq("id", entityId).maybeSingle();
  if (!team?.club_id) return false;
  const { data: isClubAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "club_admin",
    _club_id: team.club_id,
    _team_id: null,
  });
  return !!isClubAdmin;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // ---- auth: fail closed ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ---- request size limit ----
    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return json({ error: "Request too large" }, 413);
    }
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return json({ error: "Request too large" }, 413);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch (_e) {
      return json({ error: "Invalid request" }, 400);
    }

    // ---- strict input validation. Only these fields are ever read. ----
    const platformRaw = payload.platform;
    const platform: IapPlatform | null = platformRaw === "ios" || platformRaw === "android" ? platformRaw : null;
    if (!platform) {
      return json({ error: "Invalid request" }, 400);
    }

    const productId = typeof payload.productId === "string" ? payload.productId : "";
    const entityId = typeof payload.entityId === "string" ? payload.entityId.trim() : "";
    const transactionId = typeof payload.transactionId === "string" ? payload.transactionId.trim() : "";
    const purchaseToken = typeof payload.receipt === "string" ? payload.receipt.trim() : "";

    if (!productId || !entityId || !UUID_RE.test(entityId)) {
      return json({ error: "Invalid request" }, 400);
    }

    const product = getIapProduct(productId);
    if (!product) {
      diag("unknown_product", { userId: user.id, platform });
      return json({ error: "This plan is not available." }, 400);
    }

    // Requirement: the requested entity type must match the verified product
    // configuration. The client's value is NEVER used to derive anything.
    if (payload.entityType !== undefined && payload.entityType !== product.entityType) {
      diag("entity_type_mismatch", { userId: user.id, productId, requested: String(payload.entityType) });
      return json({ error: "This plan doesn't match the selected club or team." }, 400);
    }

    // ---- authorization for the target club/team ----
    const authorized = await isAuthorizedForEntity(supabase, user.id, product, entityId);
    if (!authorized) {
      diag("not_authorized", { userId: user.id, productId, entityType: product.entityType });
      return json(
        {
          error: product.entityType === "club"
            ? "Only club administrators can purchase this plan"
            : "Only team administrators, coaches, or club administrators can purchase this plan",
        },
        403,
      );
    }

    // ---- store verification: no store credentials => fail closed ----
    let verified: VerifiedPurchase;
    try {
      if (platform === "ios") {
        const appleConfig = readAppleConfig((k) => Deno.env.get(k));
        if (!appleConfig) throw new StoreVerificationError("store_not_configured", { store: "apple", reason: "secrets_missing" });
        if (!transactionId) throw new StoreVerificationError("purchase_not_found", { store: "apple", reason: "no_transaction_id" });
        verified = await verifyApplePurchase({
          config: appleConfig,
          transactionId,
          expectedProductId: product.productId,
        });
      } else {
        const googleConfig = readGoogleConfig((k) => Deno.env.get(k));
        if (!googleConfig) throw new StoreVerificationError("store_not_configured", { store: "google", reason: "secrets_missing" });
        const token = purchaseToken || transactionId;
        if (!token) throw new StoreVerificationError("purchase_not_found", { store: "google", reason: "no_purchase_token" });
        verified = await verifyGooglePurchase({
          config: googleConfig,
          purchaseToken: token,
          expectedProductId: product.productId,
        });
      }
    } catch (err) {
      if (err instanceof StoreVerificationError) {
        diag("verification_failed", { userId: user.id, productId, code: err.code, ...err.diagnostic });
        return json({ error: err.clientMessage }, err.httpStatus);
      }
      diag("verification_error", { userId: user.id, productId, name: (err as Error)?.name });
      return json({ error: "We couldn't confirm your purchase. Please try again shortly." }, 502);
    }

    // Defence in depth: the store must have confirmed the exact product.
    if (verified.productId !== product.productId || verified.platform !== platform) {
      diag("post_verification_mismatch", { userId: user.id, productId });
      return json({ error: "This purchase doesn't match the selected plan." }, 400);
    }

    // ---- atomic entitlement application (all-or-nothing, replay safe) ----
    const expiresAt = verified.expiresAt ?? fallbackExpiry(product).toISOString();
    const { data: applied, error: rpcError } = await supabase.rpc("apply_verified_iap_purchase", {
      p_facts: {
        user_id: user.id,
        platform: verified.platform,
        transaction_id: verified.transactionId,
        original_transaction_id: verified.originalTransactionId,
        purchase_token: verified.purchaseToken,
        product_id: product.productId,
        entity_id: entityId,
        entity_type: product.entityType,
        tier: product.tier,
        plan: product.plan ?? null,
        storage_gb: product.storageGb ?? null,
        is_storage: product.isStorage,
        expires_at: product.isStorage ? null : expiresAt,
        purchased_at: verified.purchasedAt,
        environment: verified.environment,
        store_status: verified.storeStatus,
      },
    });

    if (rpcError) {
      const message = rpcError.message || "";
      diag("apply_failed", { userId: user.id, productId, code: rpcError.code, message });
      if (message.includes("transaction_conflict")) {
        return json({ error: "This purchase has already been used." }, 409);
      }
      if (message.includes("unknown_club") || message.includes("unknown_team")) {
        return json({ error: "The selected club or team no longer exists." }, 400);
      }
      return json({ error: "We couldn't apply your purchase. Please contact support." }, 500);
    }

    diag("applied", {
      userId: user.id,
      productId,
      entityType: product.entityType,
      platform: verified.platform,
      environment: verified.environment,
      applied: (applied as any)?.applied ?? null,
      idempotent: (applied as any)?.idempotent ?? false,
    });

    return json({ success: true, idempotent: !!(applied as any)?.idempotent }, 200);
  } catch (error) {
    // Never leak internals to the client.
    console.error("[IAP] unexpected_error", (error as Error)?.name, (error as Error)?.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
