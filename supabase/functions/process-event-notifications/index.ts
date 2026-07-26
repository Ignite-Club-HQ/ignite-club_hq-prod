import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { outboundBlockedResponse } from "../_shared/outboundGuard.ts";
import { requireServiceRoleAuth } from "../_shared/internal-auth.ts";
import { resolveRecipients } from "./recipients.ts";
import { buildUpdateMessage, type ChangedField } from "./messages.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Event notification fan-out. Called by DB triggers via net.http_post.
 *
 * Behaviour:
 * 1. Load the event from the DB (authoritative — caller cannot spoof scope).
 * 2. Resolve the recipient audience (team/mini-league/club-wide/targeted).
 * 3. Call `enqueue_event_push` to atomically create notification rows AND
 *    push_delivery_queue rows in one transaction.
 * 4. Fire-and-forget kick the `process-push-delivery-queue` worker so
 *    delivery starts immediately; the worker also runs on a 30s cron so a
 *    killed request can never lose queued jobs.
 *
 * The old dispatchPushBatch() loop (20-at-a-time inline sends) is gone —
 * it caused fan-outs > ~20 recipients to be silently truncated when the
 * edge function hit its wall-clock limit.
 */

interface EventPayload {
  action: "event_created" | "event_cancelled" | "event_updated";
  eventId: string;
  changedFields?: ChangedField[];
}

const ENQUEUE_BATCH_SIZE = 500;

async function kickWorker(supabaseUrl: string, serviceKey: string) {
  try {
    // fire-and-forget so we never block event creation
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
      console.error("[EVENT-NOTIFY] Event lookup error", eventErr);
      return new Response(
        JSON.stringify({ error: "Event lookup failed" }),
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
    const notificationUrl = `/events/${eventId}`;

    if (action === "event_created") {
      if (eventRow.parent_event_id || eventRow.is_cancelled) {
        return new Response(JSON.stringify({ message: "Not eligible for invite" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      notificationType = "event_invite";
      message = `You've been invited to: ${title}`;
      recipientUserIds = await resolveRecipients(supabase, eventId, clubId, teamId, miniLeagueId, createdBy);
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

    console.log(`[EVENT-NOTIFY] ${recipientUserIds.length} recipients for ${action}`);

    // Enqueue notifications + delivery jobs atomically via RPC.
    let enqueuedTotal = 0;
    for (let i = 0; i < recipientUserIds.length; i += ENQUEUE_BATCH_SIZE) {
      const batch = recipientUserIds.slice(i, i + ENQUEUE_BATCH_SIZE);
      const rows = batch.map((userId) => ({
        user_id: userId,
        type: notificationType,
        message,
        related_id: eventId,
      }));
      const { data, error } = await supabase.rpc("enqueue_event_push", {
        p_url: notificationUrl,
        p_rows: rows,
      });
      if (error) {
        console.error("[EVENT-NOTIFY] enqueue_event_push error", error);
      } else {
        enqueuedTotal += (data as any[])?.length ?? 0;
      }
    }

    // Kick worker so delivery starts within ~1s (cron is the safety net).
    if (enqueuedTotal > 0) {
      await kickWorker(supabaseUrl, supabaseServiceKey);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[EVENT-NOTIFY] Done: ${enqueuedTotal} enqueued in ${elapsed}ms`);

    return new Response(
      JSON.stringify({
        message: "Event notifications enqueued",
        action,
        recipients: recipientUserIds.length,
        enqueued: enqueuedTotal,
        elapsed_ms: elapsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[EVENT-NOTIFY] Error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process event notifications", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
