import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { outboundBlockedResponse } from "../_shared/outboundGuard.ts";
import { requireServiceRoleAuth } from "../_shared/internal-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Push delivery worker. Drains public.push_delivery_queue in short bursts:
 *
 *  1. claim_push_delivery_jobs(BATCH) — atomic FOR UPDATE SKIP LOCKED
 *  2. for each: POST to send-push-notification with the stored payload
 *  3. mark delivered / skipped / failed (with retry backoff)
 *  4. if more pending jobs remain, fire-and-forget re-invoke ourselves so
 *     large fan-outs (200+) drain across multiple short invocations without
 *     ever exceeding a single edge function's wall-clock budget.
 *
 * A pg_cron job re-invokes this every minute as a safety net.
 */

const BATCH = 30;
const MAX_ATTEMPTS = 5;

function backoffSeconds(attempt: number): number {
  // 30s, 2m, 8m, 30m, 2h
  return Math.min(30 * Math.pow(4, attempt - 1), 60 * 60 * 2);
}

interface Job {
  id: string;
  notification_id: string;
  user_id: string;
  payload: {
    title: string;
    body: string;
    url: string;
    tag: string;
    notificationType: string;
  };
  attempt_count: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authFail = requireServiceRoleAuth(req, corsHeaders);
  if (authFail) return authFail;

  const outboundBlocked = outboundBlockedResponse("process-push-delivery-queue");
  if (outboundBlocked) return outboundBlocked;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const start = Date.now();
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  let retried = 0;

  // Claim a batch
  const { data: jobs, error: claimErr } = await supabase.rpc("claim_push_delivery_jobs", { p_limit: BATCH });
  if (claimErr) {
    console.error("[PUSH-QUEUE] claim error", claimErr);
    return new Response(JSON.stringify({ error: "claim failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const claimedJobs = (jobs || []) as Job[];

  await Promise.allSettled(
    claimedJobs.map(async (job) => {
      const attempt = (job.attempt_count || 0) + 1;
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            userId: job.user_id,
            title: job.payload.title,
            body: job.payload.body,
            url: job.payload.url,
            notificationId: job.notification_id,
            tag: job.payload.tag,
            notificationType: job.payload.notificationType,
          }),
        });

        let bodyJson: any = null;
        try { bodyJson = await resp.json(); } catch { /* noop */ }

        if (resp.ok) {
          // Distinguish delivered vs skipped (preference off / no subscription).
          const isSkipped = bodyJson?.skipped === true || bodyJson?.sent === 0;
          await supabase.from("push_delivery_queue")
            .update({
              status: isSkipped ? "skipped" : "delivered",
              attempt_count: attempt,
              completed_at: new Date().toISOString(),
              last_error: null,
            })
            .eq("id", job.id);
          if (isSkipped) skipped++; else delivered++;
          return;
        }

        // Non-OK: decide retry vs terminal
        const status = resp.status;
        const errText = typeof bodyJson === "object" ? JSON.stringify(bodyJson) : `HTTP ${status}`;
        const permanent = status === 400 || status === 404 || status === 410;
        if (permanent || attempt >= MAX_ATTEMPTS) {
          await supabase.from("push_delivery_queue")
            .update({
              status: "failed",
              attempt_count: attempt,
              completed_at: new Date().toISOString(),
              last_error: `[${status}] ${errText}`,
            })
            .eq("id", job.id);
          failed++;
        } else {
          const nextAt = new Date(Date.now() + backoffSeconds(attempt) * 1000).toISOString();
          await supabase.from("push_delivery_queue")
            .update({
              status: "pending",
              attempt_count: attempt,
              next_attempt_at: nextAt,
              last_error: `[${status}] ${errText}`,
            })
            .eq("id", job.id);
          retried++;
        }
      } catch (err) {
        // Network/timeout — retry
        if (attempt >= MAX_ATTEMPTS) {
          await supabase.from("push_delivery_queue")
            .update({
              status: "failed",
              attempt_count: attempt,
              completed_at: new Date().toISOString(),
              last_error: `network: ${String(err)}`,
            })
            .eq("id", job.id);
          failed++;
        } else {
          const nextAt = new Date(Date.now() + backoffSeconds(attempt) * 1000).toISOString();
          await supabase.from("push_delivery_queue")
            .update({
              status: "pending",
              attempt_count: attempt,
              next_attempt_at: nextAt,
              last_error: `network: ${String(err)}`,
            })
            .eq("id", job.id);
          retried++;
        }
      }
    }),
  );

  // If we processed a full batch there is likely more — self-chain.
  if (claimedJobs.length === BATCH) {
    try {
      fetch(`${supabaseUrl}/functions/v1/process-push-delivery-queue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ source: "self-chain" }),
      }).then((r) => r.body?.cancel()).catch(() => {});
    } catch { /* noop */ }
  }

  const elapsed = Date.now() - start;
  console.log(`[PUSH-QUEUE] claimed=${claimedJobs.length} delivered=${delivered} skipped=${skipped} retried=${retried} failed=${failed} in ${elapsed}ms`);

  return new Response(
    JSON.stringify({
      claimed: claimedJobs.length,
      delivered,
      skipped,
      retried,
      failed,
      elapsed_ms: elapsed,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
