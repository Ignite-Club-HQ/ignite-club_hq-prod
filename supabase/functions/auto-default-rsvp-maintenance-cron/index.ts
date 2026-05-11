// Phase 3 cron: auto-pause stale defaults + season rollover prompts
// - Soft-pause: a default with no user-confirmation in the last 28 days
//   AND ≥3 trainings have passed where every RSVP stayed source='default' →
//   auto_paused_at is set, parent gets a DM.
// - Rollover: an active (not paused) default older than 180 days whose last
//   confirmation (or creation) is >180 days ago → DM "Still good?" once per
//   180d window (deduped via default_rollover_log).
//
// Runs every 6h via pg_cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SOFT_PAUSE_DAYS = 28;
const SOFT_PAUSE_MIN_TRAININGS = 3;
const ROLLOVER_DAYS = 180;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface DefaultRow {
  id: string;
  team_id: string;
  child_id: string | null;
  user_id: string | null;
  created_at: string;
  last_confirmation_at: string | null;
  auto_paused_at: string | null;
  default_status: string;
}

async function dmSystemMessage(
  admin: ReturnType<typeof createClient>,
  recipientUserId: string,
  body: string,
) {
  // Find or create a 1:1 with system bot
  const SYSTEM_BOT = Deno.env.get("SYSTEM_BOT_USER_ID");
  if (!SYSTEM_BOT) return;

  const { data: convo } = await admin
    .from("direct_conversations")
    .select("id")
    .or(
      `and(user_a.eq.${SYSTEM_BOT},user_b.eq.${recipientUserId}),and(user_a.eq.${recipientUserId},user_b.eq.${SYSTEM_BOT})`,
    )
    .maybeSingle();

  let convoId = convo?.id as string | undefined;
  if (!convoId) {
    const { data: created, error } = await admin
      .from("direct_conversations")
      .insert({ user_a: SYSTEM_BOT, user_b: recipientUserId })
      .select("id")
      .single();
    if (error) return;
    convoId = created.id;
  }

  await admin.from("direct_messages").insert({
    conversation_id: convoId,
    sender_id: SYSTEM_BOT,
    body,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = Date.now();
  const softCutoff = new Date(now - SOFT_PAUSE_DAYS * 86400_000).toISOString();
  const rolloverCutoff = new Date(now - ROLLOVER_DAYS * 86400_000).toISOString();

  let pausedCount = 0;
  let rolloverCount = 0;

  const { data: defaults, error } = await admin
    .from("child_training_defaults")
    .select("id, team_id, child_id, user_id, created_at, last_confirmation_at, auto_paused_at, default_status")
    .is("deleted_at", null)
    .eq("default_status", "going")
    .returns<DefaultRow[]>();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const d of defaults ?? []) {
    const lastTouchIso = d.last_confirmation_at ?? d.created_at;
    const lastTouchMs = new Date(lastTouchIso).getTime();

    // --- Soft-pause check (only if not already paused) ---
    if (!d.auto_paused_at && lastTouchIso < softCutoff) {
      // Count past trainings on this team in the silence window where this
      // child/user had a source='default' RSVP.
      let q = admin
        .from("rsvps")
        .select("id, events!inner(team_id, type, event_date)", { count: "exact", head: true })
        .eq("source", "default")
        .lt("events.event_date", new Date(now).toISOString())
        .gte("events.event_date", lastTouchIso)
        .eq("events.team_id", d.team_id)
        .eq("events.type", "training");
      q = d.child_id ? q.eq("child_id", d.child_id) : q.is("child_id", null).eq("user_id", d.user_id!);

      const { count } = await q;
      if ((count ?? 0) >= SOFT_PAUSE_MIN_TRAININGS) {
        await admin
          .from("child_training_defaults")
          .update({
            auto_paused_at: new Date().toISOString(),
            auto_paused_reason: "stale",
          })
          .eq("id", d.id);

        const recipient = d.user_id ?? (
          await admin
            .from("child_guardians")
            .select("guardian_user_id")
            .eq("child_id", d.child_id!)
            .limit(1)
            .maybeSingle()
        ).data?.guardian_user_id;

        if (recipient) {
          await dmSystemMessage(
            admin,
            recipient,
            "We've paused your auto-RSVP for trainings — you haven't confirmed in a while. Tap any training to resume.",
          );
        }
        pausedCount++;
        continue; // don't double-process
      }
    }

    // --- Rollover prompt ---
    if (!d.auto_paused_at && lastTouchIso < rolloverCutoff) {
      const { data: lastLog } = await admin
        .from("default_rollover_log")
        .select("notified_at")
        .eq("default_id", d.id)
        .order("notified_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastLog || lastLog.notified_at < rolloverCutoff) {
        await admin.from("default_rollover_log").insert({ default_id: d.id });

        const recipient = d.user_id ?? (
          await admin
            .from("child_guardians")
            .select("guardian_user_id")
            .eq("child_id", d.child_id!)
            .limit(1)
            .maybeSingle()
        ).data?.guardian_user_id;

        if (recipient) {
          await dmSystemMessage(
            admin,
            recipient,
            "It's been a while since you set training defaults. Still going? Open the team to confirm or change.",
          );
        }
        rolloverCount++;
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, paused: pausedCount, rollover: rolloverCount, scanned: defaults?.length ?? 0 }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
