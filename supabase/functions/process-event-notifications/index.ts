import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { outboundBlockedResponse } from "../_shared/outboundGuard.ts";
import { requireServiceRoleAuth } from "../_shared/internal-auth.ts";
import { AudienceResolutionError, resolveRecipients } from "./recipients.ts";
import { buildUpdateMessage, type ChangedField } from "./messages.ts";
import { buildDedupeKey, changeVersion } from "./dedupe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Event notification fan-out. Called by DB triggers via net.http_post.
 *
 * 1. Authenticate (service-role only — no anon/user JWT can reach this).
 * 2. Load the event from the DB. Caller-supplied club/team/title/audience is
 *    IGNORED: scope is always re-derived from the stored row. Only `action`
 *    and `changedFields` are read from the body.
 * 3. Resolve the recipient audience (team / mini-league / club-wide /
 *    targeted) — unchanged, characterization-tested behaviour.
 * 4. `enqueue_event_push_v2` atomically creates the notification row AND its
 *    push_delivery_queue job, deduplicated by a database-enforced
 *    idempotency key, so retries/concurrent runs cannot duplicate anything.
 * 5. Kick the worker for latency; pg_cron is the authoritative drainer.
 *
 * Enqueue failures are never reported as success: the response is non-2xx
 * with counts so the caller/operator can retry safely (retries are
 * idempotent).
 */

interface EventPayload {
  action: "event_created" | "event_cancelled" | "event_updated";
  eventId: string;
  changedFields?: ChangedField[];
}

const ENQUEUE_BATCH_SIZE = 500;

async function kickWorker(supabaseUrl: string, serviceKey: string) {
  try {
    fetch(`${supabaseUrl}/functions/v1/process-push-delivery-queue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ source: "event-notify" }),
    }).then((r) => r.body?.cancel()).catch(() => {});
  } catch { /* noop */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authFail = requireServiceRoleAuth(req, corsHeaders);
  if (authFail) return authFail;

  const outboundBlocked = outboundBlockedResponse("process-event-notifications");
  if (outboundBlocked) return outboundBlocked;

  const startTime = Date.now();

  try {
    const payload = (await req.json()) as EventPayload;
    const { action, eventId, changedFields } = payload;

    if (!eventId || !action) {
      return new Response(
        JSON.stringify({ error: "Missing action or eventId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authoritative event lookup — never trust caller scope.
    const { data: eventRow, error: eventErr } = await supabase
      .from("events")
      .select("id, club_id, team_id, mini_league_id, created_by, title, is_cancelled, parent_event_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eventErr) {
      console.error("[EVENT-NOTIFY] Event lookup error", eventErr.code ?? "", eventErr.message ?? "");
      return new Response(
        JSON.stringify({ error: "event_lookup_failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!eventRow) {
      return new Response(
        JSON.stringify({ message: "Event not found, skipping" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { club_id: clubId, team_id: teamId, mini_league_id: miniLeagueId, created_by: createdBy } = eventRow as any;
    const title: string = eventRow.title || "an event";

    let recipientUserIds: string[] = [];
    let notificationType: string;
    let message: string;
    // Change-version keeps different legitimate updates deliverable while a
    // retry of the *same* update is deduplicated. Invites/cancellations are
    // one-per-(event,user).
    let dedupeVersion: string | null = null;
    const notificationUrl = `/events/${eventId}`;

    if (action === "event_created") {
      if (eventRow.parent_event_id || eventRow.is_cancelled) {
        return new Response(JSON.stringify({ message: "Not eligible for invite" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      notificationType = "event_invite";
      message = `You've been invited to: ${title}`;
      try {
        recipientUserIds = await resolveRecipients(supabase, eventId, clubId, teamId, miniLeagueId, createdBy);
      } catch (e) {
        if (e instanceof AudienceResolutionError) {
          // Fail closed: no notifications, no push jobs. Retriable.
          console.error("[EVENT-NOTIFY] Aborting fan-out: audience lookup failed");
          return new Response(
            JSON.stringify({ error: "event_audience_lookup_failed" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw e;
      }

    } else if (action === "event_cancelled") {
      notificationType = "event_cancelled";
      message = `Event cancelled: ${title} has been cancelled`;
      const { data: rsvps } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", eventId)
        .not("user_id", "is", null);
      recipientUserIds = [...new Set((rsvps || []).map((r: any) => r.user_id))];
    } else if (action === "event_updated") {
      notificationType = "event_updated";
      if (!changedFields || changedFields.length === 0) {
        return new Response(JSON.stringify({ message: "No tracked fields changed, skipping" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      message = buildUpdateMessage(title, changedFields);
      dedupeVersion = await changeVersion(changedFields);
      const { data: rsvps } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", eventId)
        .not("user_id", "is", null);
      recipientUserIds = [...new Set((rsvps || []).map((r: any) => r.user_id))].filter(
        (id) => id !== createdBy,
      );
    } else {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expected = recipientUserIds.length;
    console.log(`[EVENT-NOTIFY] ${expected} recipients for ${action}`);

    let created = 0;
    let alreadyExisting = 0;
    let queued = 0;
    let resolved = 0;
    let batchFailures = 0;

    for (let i = 0; i < recipientUserIds.length; i += ENQUEUE_BATCH_SIZE) {
      const batch = recipientUserIds.slice(i, i + ENQUEUE_BATCH_SIZE);
      const rows = batch.map((userId) => ({
        user_id: userId,
        type: notificationType,
        message,
        related_id: eventId,
        dedupe_key: buildDedupeKey({
          notificationType,
          eventId,
          userId,
          version: dedupeVersion,
        }),
      }));
      const { data, error } = await supabase.rpc("enqueue_event_push_v2", {
        p_url: notificationUrl,
        p_rows: rows,
      });
      if (error) {
        // Previously-committed batches are intentionally NOT rolled back —
        // the dedupe key makes a retry safe and non-duplicating.
        batchFailures += batch.length;
        console.error("[EVENT-NOTIFY] enqueue failed", error.code ?? "", error.message ?? "");
        continue;
      }
      const rowsOut = (data as any[]) || [];
      resolved += rowsOut.length;
      created += rowsOut.filter((r) => r.created).length;
      alreadyExisting += rowsOut.filter((r) => !r.created).length;
      queued += rowsOut.filter((r) => r.queued).length;
    }

    if (queued > 0) {
      await kickWorker(supabaseUrl, supabaseServiceKey);
    }

    const elapsed = Date.now() - startTime;
    const unresolved = expected - resolved;
    const complete = batchFailures === 0 && unresolved === 0;

    console.log(
      `[EVENT-NOTIFY] Done action=${action} expected=${expected} created=${created} existing=${alreadyExisting} queued=${queued} unresolved=${unresolved} failed=${batchFailures} in ${elapsed}ms`,
    );

    return new Response(
      JSON.stringify({
        message: complete ? "Event notifications enqueued" : "Event notifications partially enqueued",
        action,
        expected,
        created,
        already_existing: alreadyExisting,
        queued,
        unresolved,
        failed: batchFailures,
        elapsed_ms: elapsed,
        ...(complete ? {} : { error: "partial_enqueue" }),
      }),
      {
        status: complete ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    // Sanitised — never leak DB messages, tokens or internal URLs.
    console.error("[EVENT-NOTIFY] Error:", error instanceof Error ? error.message : String(error));
    return new Response(
      JSON.stringify({ error: "event_notification_processing_failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
