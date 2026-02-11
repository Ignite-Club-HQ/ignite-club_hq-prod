import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Product ID to subscription mapping
const PRODUCT_MAP: Record<string, { 
  entityType: "club" | "team";
  tier: "pro" | "pro_football";
  plan?: "starter" | "standard" | "unlimited";
  isAnnual: boolean;
  storageGb?: number;
  isStorage?: boolean;
}> = {
  // Club Pro plans
  ignite_pro_starter_monthly: { entityType: "club", tier: "pro", plan: "starter", isAnnual: false },
  ignite_pro_starter_annual: { entityType: "club", tier: "pro", plan: "starter", isAnnual: true },
  ignite_pro_standard_monthly: { entityType: "club", tier: "pro", plan: "standard", isAnnual: false },
  ignite_pro_standard_annual: { entityType: "club", tier: "pro", plan: "standard", isAnnual: true },
  ignite_pro_unlimited_monthly: { entityType: "club", tier: "pro", plan: "unlimited", isAnnual: false },
  ignite_pro_unlimited_annual: { entityType: "club", tier: "pro", plan: "unlimited", isAnnual: true },
  // Club Pro Football plans
  ignite_pf_starter_monthly: { entityType: "club", tier: "pro_football", plan: "starter", isAnnual: false },
  ignite_pf_starter_annual: { entityType: "club", tier: "pro_football", plan: "starter", isAnnual: true },
  ignite_pf_standard_monthly: { entityType: "club", tier: "pro_football", plan: "standard", isAnnual: false },
  ignite_pf_standard_annual: { entityType: "club", tier: "pro_football", plan: "standard", isAnnual: true },
  ignite_pf_unlimited_monthly: { entityType: "club", tier: "pro_football", plan: "unlimited", isAnnual: false },
  ignite_pf_unlimited_annual: { entityType: "club", tier: "pro_football", plan: "unlimited", isAnnual: true },
  // Team Pro plans
  ignite_team_pro_monthly: { entityType: "team", tier: "pro", isAnnual: false },
  ignite_team_pro_annual: { entityType: "team", tier: "pro", isAnnual: true },
  ignite_team_pf_monthly: { entityType: "team", tier: "pro_football", isAnnual: false },
  ignite_team_pf_annual: { entityType: "team", tier: "pro_football", isAnnual: true },
  // Storage
  ignite_storage_10gb_monthly: { entityType: "club", tier: "pro", isAnnual: false, storageGb: 10, isStorage: true },
  ignite_storage_10gb_annual: { entityType: "club", tier: "pro", isAnnual: true, storageGb: 10, isStorage: true },
  ignite_storage_50gb_monthly: { entityType: "club", tier: "pro", isAnnual: false, storageGb: 50, isStorage: true },
  ignite_storage_50gb_annual: { entityType: "club", tier: "pro", isAnnual: true, storageGb: 50, isStorage: true },
};

const TEAM_LIMITS: Record<string, number | null> = {
  starter: 10,
  standard: 20,
  unlimited: null,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user token
    const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { platform, transactionId, productId, entityId, entityType, receipt } = await req.json();

    if (!platform || !transactionId || !productId || !entityId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productConfig = PRODUCT_MAP[productId];
    if (!productConfig) {
      return new Response(JSON.stringify({ error: `Unknown product: ${productId}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // TODO: Add proper receipt validation with Apple/Google servers
    // For Apple: Verify with App Store Server API (https://developer.apple.com/documentation/appstoreserverapi)
    // For Google: Verify with Google Play Developer API (https://developers.google.com/android-publisher)
    // 
    // For now, we trust the client-side transaction and apply the subscription.
    // In production, you should:
    // 1. Validate the receipt/transaction with Apple/Google servers
    // 2. Check for duplicate transactions
    // 3. Handle subscription renewals via server notifications
    
    console.log(`[IAP] Verifying ${platform} purchase: product=${productId}, transaction=${transactionId}, entity=${entityId}`);

    // Check for duplicate transactions
    const { data: existingTransaction } = await supabase
      .from("iap_transactions")
      .select("id")
      .eq("transaction_id", transactionId)
      .maybeSingle();

    if (existingTransaction) {
      return new Response(JSON.stringify({ error: "Transaction already processed" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record the transaction
    await supabase.from("iap_transactions").insert({
      user_id: user.id,
      transaction_id: transactionId,
      original_transaction_id: receipt || transactionId,
      product_id: productId,
      platform,
      entity_id: entityId,
      entity_type: entityType,
      status: "completed",
    });

    // Apply the purchase
    if (productConfig.isStorage) {
      // Storage purchase - add to club's storage
      const { data: subscription } = await supabase
        .from("club_subscriptions")
        .select("storage_purchased_gb")
        .eq("club_id", entityId)
        .maybeSingle();

      const currentStorage = subscription?.storage_purchased_gb || 0;
      const newStorage = currentStorage + (productConfig.storageGb || 0);

      await supabase
        .from("club_subscriptions")
        .update({ storage_purchased_gb: newStorage })
        .eq("club_id", entityId);

      console.log(`[IAP] Applied storage: +${productConfig.storageGb}GB for club ${entityId}`);
    } else if (entityType === "club") {
      // Club subscription upgrade
      const now = new Date();
      const expiresAt = productConfig.isAnnual
        ? new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
        : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

      const updateData = productConfig.tier === "pro"
        ? { is_pro: true, is_pro_football: false }
        : { is_pro: true, is_pro_football: true };

      const teamLimit = productConfig.plan ? TEAM_LIMITS[productConfig.plan] : null;

      await supabase
        .from("club_subscriptions")
        .upsert({
          club_id: entityId,
          plan: productConfig.plan || "starter",
          team_limit: teamLimit,
          ...updateData,
          activated_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          stripe_subscription_id: `iap_${platform}_${transactionId}`,
        }, { onConflict: "club_id" });

      // Also update clubs.is_pro
      await supabase
        .from("clubs")
        .update({ is_pro: true })
        .eq("id", entityId);

      console.log(`[IAP] Applied club upgrade: ${productConfig.tier} ${productConfig.plan} for club ${entityId}`);
    } else if (entityType === "team") {
      // Team subscription upgrade
      const now = new Date();
      const expiresAt = productConfig.isAnnual
        ? new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
        : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

      const updateData = productConfig.tier === "pro"
        ? { is_pro: true }
        : { is_pro: true, is_pro_football: true };

      await supabase
        .from("team_subscriptions")
        .upsert({
          team_id: entityId,
          ...updateData,
          activated_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        }, { onConflict: "team_id" });

      console.log(`[IAP] Applied team upgrade: ${productConfig.tier} for team ${entityId}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[IAP] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
