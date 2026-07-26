import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { outboundBlockedResponse } from "../_shared/outboundGuard.ts";
import { requireServiceRoleAuth } from "../_shared/internal-auth.ts";
import {
  BATCH,
  type Deps,
  type Job,
  processBatch,
  PUSH_TIMEOUT_MS,
  type QueueUpdate,
} from "./delivery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Push delivery worker. Drains public.push_delivery_queue in short bursts:
 *
 *  1. claim_push_delivery_jobs(BATCH) — atomic FOR UPDATE SKIP LOCKED, also
 *     reclaims rows stuck in `processing` for > 2 minutes. Terminal rows
 *     (delivered/skipped/failed) are never reclaimed.
 *  2. per job: POST to send-push-notification with a per-push AbortController
 *     timeout.
 *  3. mark delivered / skipped / failed / retry-with-backoff, conditional on
 *     the row still being `processing` so a concurrent worker can never
 *     downgrade an already-delivered row.
 *  4. self-chain (latency optimisation only) while a full batch was claimed.
 *
 * The authoritative recovery mechanism is the pg_cron job
 * `ignite-push-delivery-queue-worker` (every minute) — self-chaining is
 * never relied upon to survive Edge Function termination.
 */

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

  const { data: jobs, error: claimErr } = await supabase.rpc("claim_push_delivery_jobs", {
    p_limit: BATCH,
  });
  if (claimErr) {
    // Sanitised: never echo database internals.
    console.error("[PUSH-QUEUE] claim error", claimErr.code ?? "", claimErr.message ?? "");
    return new Response(JSON.stringify({ error: "claim_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const claimedJobs = (jobs || []) as Job[];

  const deps: Deps = {
    timeoutMs: PUSH_TIMEOUT_MS,
    async sendPush(job, signal) {
      const resp = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: "POST",
        signal,
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
      let body: any = null;
      try { body = await resp.json(); } catch { /* unparseable */ }
      return { ok: resp.ok, status: resp.status, body };
    },
    async updateJob(jobId: string, patch: QueueUpdate) {
      // `.eq("status", "processing")` is the concurrency guard: a duplicate
      // worker that lost the race cannot convert delivered → skipped/failed.
      const { data, error } = await supabase
        .from("push_delivery_queue")
        .update(patch)
        .eq("id", jobId)
        .eq("status", "processing")
        .select("id");
      if (error) {
        console.error("[PUSH-QUEUE] status update failed", error.code ?? "", error.message ?? "");
        return { updated: 0, error };
      }
      return { updated: (data || []).length, error: null };
    },
  };

  const counters = await processBatch(claimedJobs, deps);

  // Latency optimisation only — cron is the durable scheduler.
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
  console.log(
    `[PUSH-QUEUE] claimed=${counters.claimed} delivered=${counters.delivered} skipped=${counters.skipped} retried=${counters.retried} failed=${counters.failed} update_failures=${counters.status_update_failures} in ${elapsed}ms`,
  );

  // A status-update failure means the run was only partially recorded — do
  // not report a clean 200.
  const status = counters.status_update_failures > 0 ? 500 : 200;
  return new Response(JSON.stringify({ ...counters, elapsed_ms: elapsed }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
