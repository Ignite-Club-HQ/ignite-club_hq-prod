// Worker: posts pending scheduled_messages whose scheduled_for time has arrived.
// Triggered every minute by a pg_cron job.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type Recurrence = "none" | "daily" | "weekly" | "monthly";

type ScheduledRow = {
  id: string;
  author_id: string;
  chat_type:
    | "team"
    | "club"
    | "group"
    | "direct"
    | "club_admin"
    | "broadcast";
  team_id: string | null;
  club_id: string | null;
  group_id: string | null;
  conversation_id: string | null;
  text: string;
  image_url: string | null;
  reply_to_id: string | null;
  scheduled_for: string;
  recurrence: Recurrence;
  recurrence_until: string | null;
  recurrence_parent_id: string | null;
};

const SELECT_COLS =
  "id, author_id, chat_type, team_id, club_id, group_id, conversation_id, text, image_url, reply_to_id, scheduled_for, recurrence, recurrence_until, recurrence_parent_id";

/** Try to claim a row by atomically flipping pending → sent (we'll roll back to failed if needed). */
async function claim(rowId: string): Promise<ScheduledRow | null> {
  // We mark attempted_at first to avoid double-processing if cron double-fires.
  const { data, error } = await supabase
    .from("scheduled_messages")
    .update({ attempted_at: new Date().toISOString() })
    .eq("id", rowId)
    .eq("status", "pending")
    .select(SELECT_COLS)
    .maybeSingle();
  if (error) {
    console.error("[scheduled] claim error", error);
    return null;
  }
  return (data as ScheduledRow) || null;
}

async function markSent(rowId: string, sentMessageId: string) {
  const { error } = await supabase
    .from("scheduled_messages")
    .update({ status: "sent", sent_message_id: sentMessageId })
    .eq("id", rowId);
  if (error) console.error("[scheduled] markSent error", error);
}

async function markFailed(rowId: string, reason: string) {
  const { error } = await supabase
    .from("scheduled_messages")
    .update({ status: "failed", error_message: reason.slice(0, 500) })
    .eq("id", rowId);
  if (error) console.error("[scheduled] markFailed error", error);
}

function chatTypeLabel(t: ScheduledRow["chat_type"]): string {
  switch (t) {
    case "team": return "team chat";
    case "club": return "club chat";
    case "group": return "group chat";
    case "direct": return "direct message";
    case "club_admin": return "club admin chat";
    case "broadcast": return "broadcast";
  }
}

/**
 * Notify the author that delivery failed. Best-effort: in-app notification +
 * push. Errors are swallowed so a notification failure can't poison the worker.
 */
async function notifyFailure(row: ScheduledRow, reason: string) {
  const message = `Your scheduled ${chatTypeLabel(row.chat_type)} message couldn't be sent: ${reason}`;
  try {
    const { data: notif } = await supabase
      .from("notifications")
      .insert({
        user_id: row.author_id,
        type: "scheduled_message_failed",
        message,
        related_id: row.id,
      })
      .select("id")
      .maybeSingle();

    // Fire-and-forget push; some environments may not have the function or
    // user may have no subscription — that's fine.
    await supabase.functions.invoke("send-push-notification", {
      body: {
        userId: row.author_id,
        title: "Scheduled message failed",
        body: reason.slice(0, 140),
        url: "/scheduled-messages",
        notificationId: notif?.id ?? null,
        notificationType: "scheduled_message_failed",
        tag: `scheduled-failed-${row.id}`,
      },
    });
  } catch (err) {
    console.error("[scheduled] notifyFailure error", err);
  }
}

/**
 * Compute the next occurrence of a recurring message. Returns null if there is
 * no further occurrence (e.g. recurrence_until passed, or no recurrence).
 */
function nextOccurrence(row: ScheduledRow): Date | null {
  if (!row.recurrence || row.recurrence === "none") return null;
  const base = new Date(row.scheduled_for);
  if (Number.isNaN(base.getTime())) return null;

  const next = new Date(base);
  switch (row.recurrence) {
    case "daily":
      next.setDate(next.getDate() + 1);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      return null;
  }

  // If the cron skipped a beat or we restarted, roll forward until in the
  // future (so we don't immediately fire many catch-up messages).
  const now = Date.now();
  while (next.getTime() <= now) {
    switch (row.recurrence) {
      case "daily":
        next.setDate(next.getDate() + 1);
        break;
      case "weekly":
        next.setDate(next.getDate() + 7);
        break;
      case "monthly":
        next.setMonth(next.getMonth() + 1);
        break;
    }
  }

  if (row.recurrence_until) {
    const until = new Date(row.recurrence_until);
    if (next.getTime() > until.getTime()) return null;
  }
  return next;
}

async function scheduleNextOccurrenceIfNeeded(row: ScheduledRow) {
  const nextAt = nextOccurrence(row);
  if (!nextAt) return;

  const parentId = row.recurrence_parent_id || row.id;
  try {
    const { error } = await supabase.from("scheduled_messages").insert({
      author_id: row.author_id,
      chat_type: row.chat_type,
      team_id: row.team_id,
      club_id: row.club_id,
      group_id: row.group_id,
      conversation_id: row.conversation_id,
      text: row.text,
      image_url: row.image_url,
      reply_to_id: row.reply_to_id,
      scheduled_for: nextAt.toISOString(),
      recurrence: row.recurrence,
      recurrence_until: row.recurrence_until,
      recurrence_parent_id: parentId,
      status: "pending",
    });
    if (error) console.error("[scheduled] schedule next occurrence failed", error);
  } catch (err) {
    console.error("[scheduled] schedule next occurrence threw", err);
  }
}

/**
 * Re-validate that the author is still allowed to post in this thread.
 * Returns null if OK, or a reason string if not.
 */
async function validatePermission(row: ScheduledRow): Promise<string | null> {
  switch (row.chat_type) {
    case "team": {
      // Author must be a member of the team
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("user_id", row.author_id)
        .eq("team_id", row.team_id!)
        .limit(1)
        .maybeSingle();
      if (!data) return "You are no longer a member of this team";
      return null;
    }
    case "club": {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("user_id", row.author_id)
        .eq("club_id", row.club_id!)
        .limit(1)
        .maybeSingle();
      if (!data) return "You are no longer a member of this club";
      return null;
    }
    case "group": {
      // Either personal group_members OR a role-scoped chat_group
      const { data: gm } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", row.group_id!)
        .eq("user_id", row.author_id)
        .maybeSingle();
      if (gm) return null;
      const { data: cg } = await supabase
        .from("chat_groups")
        .select("team_id, club_id, allowed_roles")
        .eq("id", row.group_id!)
        .maybeSingle();
      if (!cg) return "Group no longer exists";
      const allowed = (cg.allowed_roles || []) as string[];
      if (allowed.length === 0) return "You are no longer in this group";
      const orgFilter = cg.team_id
        ? { team_id: cg.team_id }
        : cg.club_id
          ? { club_id: cg.club_id }
          : null;
      if (!orgFilter) return "You are no longer in this group";
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", row.author_id)
        .match(orgFilter)
        .in("role", allowed);
      if (!roles || roles.length === 0) return "You are no longer in this group";
      return null;
    }
    case "direct": {
      const { data } = await supabase
        .from("direct_conversations")
        .select("participant_1, participant_2")
        .eq("id", row.conversation_id!)
        .maybeSingle();
      if (!data) return "Conversation no longer exists";
      if (
        data.participant_1 !== row.author_id &&
        data.participant_2 !== row.author_id
      ) {
        return "You are no longer part of this conversation";
      }
      return null;
    }
    case "club_admin": {
      const { data } = await supabase
        .from("club_admin_conversations")
        .select("club_id, member_user_id")
        .eq("id", row.conversation_id!)
        .maybeSingle();
      if (!data) return "Conversation no longer exists";
      if (data.member_user_id === row.author_id) return null;
      // Author must still be a club admin/committee for that club
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", row.author_id)
        .eq("club_id", data.club_id)
        .in("role", ["club_admin", "committee_member", "app_admin"]);
      if (!roles || roles.length === 0)
        return "You no longer have admin access to this club";
      return null;
    }
    case "broadcast": {
      // Broadcasts: only app_admin
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", row.author_id)
        .eq("role", "app_admin");
      if (!roles || roles.length === 0)
        return "You no longer have permission to broadcast";
      return null;
    }
  }
  return "Unknown chat type";
}

async function deliver(row: ScheduledRow): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const text = row.text || "";
  const image_url = row.image_url;
  const reply_to_id = row.reply_to_id;
  const author_id = row.author_id;

  switch (row.chat_type) {
    case "team": {
      const { data, error } = await supabase
        .from("team_messages")
        .insert({ team_id: row.team_id, author_id, text, image_url, reply_to_id })
        .select("id")
        .single();
      if (error) return { ok: false, reason: error.message };
      return { ok: true, id: data.id };
    }
    case "club": {
      const { data, error } = await supabase
        .from("club_messages")
        .insert({ club_id: row.club_id, author_id, text, image_url, reply_to_id })
        .select("id")
        .single();
      if (error) return { ok: false, reason: error.message };
      return { ok: true, id: data.id };
    }
    case "group": {
      const { data, error } = await supabase
        .from("group_messages")
        .insert({ group_id: row.group_id, author_id, text, image_url, reply_to_id })
        .select("id")
        .single();
      if (error) return { ok: false, reason: error.message };
      return { ok: true, id: data.id };
    }
    case "direct": {
      const { data, error } = await supabase
        .from("direct_messages")
        .insert({
          conversation_id: row.conversation_id,
          author_id,
          text,
          image_url,
          reply_to_id,
        })
        .select("id")
        .single();
      if (error) return { ok: false, reason: error.message };
      return { ok: true, id: data.id };
    }
    case "club_admin": {
      const { data, error } = await supabase
        .from("club_admin_messages")
        .insert({
          conversation_id: row.conversation_id,
          author_id,
          text,
          image_url,
          reply_to_id,
        })
        .select("id")
        .single();
      if (error) return { ok: false, reason: error.message };
      return { ok: true, id: data.id };
    }
    case "broadcast": {
      const { data, error } = await supabase
        .from("broadcast_messages")
        .insert({ author_id, text, image_url, reply_to_id })
        .select("id")
        .single();
      if (error) return { ok: false, reason: error.message };
      return { ok: true, id: data.id };
    }
  }
  return { ok: false, reason: "Unknown chat type" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Pick up to 100 due rows
    const { data: due, error } = await supabase
      .from("scheduled_messages")
      .select("id")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(100);

    if (error) {
      console.error("[scheduled] fetch due rows failed", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ids = (due || []).map((r) => r.id);
    let sent = 0;
    let failed = 0;
    let recurringNext = 0;

    for (const id of ids) {
      const row = await claim(id);
      if (!row) continue; // already handled by another invocation

      const permErr = await validatePermission(row);
      if (permErr) {
        await markFailed(id, permErr);
        await notifyFailure(row, permErr);
        failed++;
        continue;
      }

      const result = await deliver(row);
      if (result.ok) {
        await markSent(id, result.id);
        sent++;
        // Schedule next occurrence (if recurring) AFTER successful delivery,
        // so failures don't keep recurring forever.
        if (row.recurrence && row.recurrence !== "none") {
          await scheduleNextOccurrenceIfNeeded(row);
          recurringNext++;
        }
      } else {
        await markFailed(id, result.reason);
        await notifyFailure(row, result.reason);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ processed: ids.length, sent, failed, recurringNext }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[scheduled] fatal", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
