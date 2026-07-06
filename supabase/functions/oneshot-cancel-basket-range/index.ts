// ONE-SHOT: Cancel the orphaned legacy Stripe subscription for
// Basket Range Cricket Club (club 493ee2e3-c834-487d-93be-d1c8a0dbc4a8,
// sub sub_1TIkKcD2HIRCsShe0KIZbwJH). Delete this function after it runs.
//
// Safety: hardcoded club_id + sub_id, refuses to run if a live
// club_subscriptions row exists for that sub.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const CLUB_ID = "493ee2e3-c834-487d-93be-d1c8a0dbc4a8";
const SUB_ID = "sub_1TIkKcD2HIRCsShe0KIZbwJH";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: club, error: clubErr } = await sb
      .from("clubs")
      .select("id, name, stripe_subscription_id, stripe_customer_id")
      .eq("id", CLUB_ID)
      .maybeSingle();
    if (clubErr) throw clubErr;
    if (!club) return json({ error: "club_not_found" }, 404);
    if (club.stripe_subscription_id !== SUB_ID) {
      return json({ error: "sub_id_mismatch", found: club.stripe_subscription_id }, 409);
    }

    const { data: owned } = await sb
      .from("club_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", SUB_ID)
      .maybeSingle();
    if (owned) return json({ error: "owned_by_club_subscriptions_refusing" }, 409);

    const { data: appCfg } = await sb
      .from("app_stripe_config")
      .select("stripe_secret_key, is_enabled")
      .eq("is_enabled", true)
      .maybeSingle();
    if (!appCfg?.stripe_secret_key) return json({ error: "no_stripe_key" }, 500);

    const stripe = new Stripe(appCfg.stripe_secret_key, { apiVersion: "2023-10-16" });

    let cancelled = false;
    let alreadyGone = false;
    let cancelError: string | null = null;
    try {
      await stripe.subscriptions.cancel(SUB_ID);
      cancelled = true;
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "resource_missing") alreadyGone = true;
      else cancelError = err.message ?? "unknown_stripe_error";
    }

    if (cancelled || alreadyGone) {
      await sb.from("clubs")
        .update({ stripe_subscription_id: null, is_pro: false })
        .eq("id", CLUB_ID);
    }

    await sb.from("admin_alerts").insert({
      alert_type: cancelError
        ? "legacy_subscription_reconcile_failed"
        : "legacy_subscription_reconciled",
      details: {
        club_id: CLUB_ID,
        club_name: club.name,
        stripe_subscription_id: SUB_ID,
        stripe_customer_id: club.stripe_customer_id,
        cancelled,
        already_gone_in_stripe: alreadyGone,
        error: cancelError,
        note: "One-shot reconciliation for Basket Range CC. Refunds must be issued manually in Stripe.",
      },
    });

    return json({ ok: true, cancelled, already_gone_in_stripe: alreadyGone, error: cancelError });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("oneshot-cancel-basket-range error:", e);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
