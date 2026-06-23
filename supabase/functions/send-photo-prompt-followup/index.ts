import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Hourly cron: for each post-game gallery prompt that:
 *   - is_prompt = true
 *   - push_sent = false
 *   - was created 4–24h ago
 *   - still has zero photos for the event
 * send a single push notification to attendees (RSVP "going") — or
 * the active team roster as a fallback — deep-linking to the upload
 * sheet pre-tagged to that event. Mark push_sent = true so we never
 * re-nudge for the same prompt.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const now = Date.now();
    const lowerBound = new Date(now - 24 * 60 * 60 * 1000).toISOString(); // not older than 24h
    const upperBound = new Date(now - 4 * 60 * 60 * 1000).toISOString();  // at least 4h old

    const { data: prompts, error: promptsError } = await supabase
      .from("gallery_chat_cards")
      .select("id, team_id, event_id, created_at")
      .eq("is_prompt", true)
      .eq("push_sent", false)
      .gte("created_at", lowerBound)
      .lte("created_at", upperBound);

    if (promptsError) {
      console.error("[photo-prompt-followup] prompts query failed", promptsError);
      return new Response(JSON.stringify({ error: promptsError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pro gate: drop prompts whose team (or its club) is not Pro / Pro Football.
    const proPromptIds = new Set<string>();
    const teamIdsForPro = [...new Set((prompts ?? []).map((p: any) => p.team_id).filter(Boolean))];
    const teamClub = new Map<string, string | null>();
    if (teamIdsForPro.length) {
      const { data: teamRows } = await supabase
        .from("teams").select("id, club_id").in("id", teamIdsForPro);
      for (const t of teamRows ?? []) {
        teamClub.set((t as any).id, (t as any).club_id ?? null);
      }
      const clubIds = [...new Set((teamRows ?? []).map((t: any) => t.club_id).filter(Boolean) as string[])];

      const [teamSubsRes, clubSubsRes] = await Promise.all([
        supabase.from("team_subscriptions")
          .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
          .in("team_id", teamIdsForPro),
        clubIds.length
          ? supabase.from("club_subscriptions")
              .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
              .in("club_id", clubIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const nowIso = new Date().toISOString();
      const isActive = (s: any) =>
        (s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override)
        && (!s.expires_at || s.expires_at > nowIso);
      const proTeams = new Set((teamSubsRes.data || []).filter(isActive).map((s: any) => s.team_id));
      const proClubs = new Set(((clubSubsRes.data as any[]) || []).filter(isActive).map((s: any) => s.club_id));

      for (const p of prompts ?? []) {
        const club = teamClub.get(p.team_id) ?? null;
        if (proTeams.has(p.team_id) || (club && proClubs.has(club))) proPromptIds.add(p.id);
      }
    }

    // Mark non-pro prompts as push_sent so we don't keep re-evaluating them.
    const nonProIds = (prompts ?? []).filter((p: any) => !proPromptIds.has(p.id)).map((p: any) => p.id);
    if (nonProIds.length) {
      await supabase.from("gallery_chat_cards").update({ push_sent: true }).in("id", nonProIds);
    }
    const filteredPrompts = (prompts ?? []).filter((p: any) => proPromptIds.has(p.id));

    // Pass 1: build per-prompt context (recipients + label). We then
    // group by recipient so a user who's on multiple teams that all
    // played the same round only receives ONE combined push instead of
    // 2–3 near-identical notifications.
    type PromptCtx = {
      promptId: string;
      eventId: string;
      teamId: string;
      clubId: string | null;
      eventLabel: string;
      titleQualifier: string;
      url: string;
      recipientIds: string[];
    };

    const contexts: PromptCtx[] = [];
    let skipped = 0;
    let errors = 0;

    for (const prompt of filteredPrompts) {
      try {
        const { data: event } = await supabase
          .from("events")
          .select("id, title, opponent, type, team_id, start_time")
          .eq("id", prompt.event_id)
          .maybeSingle();

        if (!event) {
          await supabase
            .from("gallery_chat_cards")
            .update({ push_sent: true })
            .eq("id", prompt.id);
          skipped++;
          continue;
        }

        // Re-check that no photos have been uploaded since the event started.
        // Match either event-tagged photos OR team-scoped photos uploaded
        // since kickoff — users often post to the team gallery without
        // tagging the event.
        const sinceIso = event.start_time
          ? new Date(event.start_time as string).toISOString()
          : new Date(new Date(prompt.created_at).getTime() - 6 * 60 * 60 * 1000).toISOString();

        const [{ data: eventPhotos, error: eventPhotosErr }, { data: teamPhotos, error: teamPhotosErr }] = await Promise.all([
          supabase.from("photos").select("id").eq("event_id", prompt.event_id).is("deleted_at", null).limit(1),
          supabase.from("photos").select("id").eq("team_id", prompt.team_id).is("deleted_at", null).gte("created_at", sinceIso).limit(1),
        ]);

        if (eventPhotosErr || teamPhotosErr) {
          console.error("[photo-prompt-followup] photos check failed", prompt.id, eventPhotosErr || teamPhotosErr);
          errors++;
          continue;
        }

        if ((eventPhotos ?? []).length > 0 || (teamPhotos ?? []).length > 0) {
          await supabase
            .from("gallery_chat_cards")
            .update({ push_sent: true })
            .eq("id", prompt.id);
          skipped++;
          continue;
        }


        const { data: rsvps } = await supabase
          .from("rsvps")
          .select("user_id")
          .eq("event_id", prompt.event_id)
          .eq("status", "going")
          .not("user_id", "is", null);

        let recipientIds = [...new Set((rsvps ?? []).map((r) => r.user_id as string))];

        if (recipientIds.length === 0) {
          const { data: memberships } = await supabase
            .from("team_memberships")
            .select("club_player_id, club_players!inner(profile_id)")
            .eq("team_id", prompt.team_id)
            .eq("status", "active");

          recipientIds = [
            ...new Set(
              (memberships ?? [])
                .map((m: any) => m.club_players?.profile_id)
                .filter((id: string | null) => !!id),
            ),
          ];
        }

        if (recipientIds.length === 0) {
          await supabase
            .from("gallery_chat_cards")
            .update({ push_sent: true })
            .eq("id", prompt.id);
          skipped++;
          continue;
        }

        const startMs = event.start_time ? new Date(event.start_time as string).getTime() : now;
        const hoursAgo = (now - startMs) / (60 * 60 * 1000);
        let whenQualifier: string;
        let titleQualifier: string;
        if (hoursAgo < 18) {
          whenQualifier = "today's";
          titleQualifier = "today";
        } else if (hoursAgo < 42) {
          whenQualifier = "yesterday's";
          titleQualifier = "yesterday";
        } else {
          whenQualifier = "the recent";
          titleQualifier = "the match";
        }

        const opponent = event.opponent ? ` vs ${event.opponent}` : "";
        const eventLabel = event.title
          || (event.type === "mini_league" ? `${whenQualifier} match` : `${whenQualifier} game${opponent}`);

        contexts.push({
          promptId: prompt.id,
          eventId: event.id,
          teamId: prompt.team_id,
          clubId: teamClub.get(prompt.team_id) ?? null,
          eventLabel,
          titleQualifier,
          url: `/media?team=${prompt.team_id}&event=${prompt.event_id}&upload=1`,
          recipientIds,
        });
      } catch (err) {
        console.error("[photo-prompt-followup] prompt prep failed", prompt.id, err);
        errors++;
      }
    }

    // Group contexts by recipient.
    const byUser = new Map<string, PromptCtx[]>();
    for (const ctx of contexts) {
      for (const uid of ctx.recipientIds) {
        const arr = byUser.get(uid) ?? [];
        arr.push(ctx);
        byUser.set(uid, arr);
      }
    }

    let totalRecipients = 0;

    // Pass 2: one push per user, combining all their prompts.
    await Promise.allSettled(
      Array.from(byUser.entries()).map(async ([userId, userCtxs]) => {
        // Always write in-app notification rows per prompt.
        await Promise.allSettled(
          userCtxs.map((c) =>
            supabase.from("notifications").insert({
              user_id: userId,
              type: "photo_prompt_reminder",
              message: `Be the first to share photos from ${c.eventLabel}`,
              related_id: c.eventId,
              club_id: c.clubId,
            }),
          ),
        );

        const [{ data: webSubs }, { data: fcm }] = await Promise.all([
          supabase.from("push_subscriptions").select("id").eq("user_id", userId).limit(1),
          supabase.from("fcm_tokens" as any).select("id").eq("user_id", userId).limit(1),
        ]);
        if ((webSubs?.length ?? 0) === 0 && (fcm?.length ?? 0) === 0) return;

        let pushTitle: string;
        let pushBody: string;
        let url: string;
        if (userCtxs.length === 1) {
          const c = userCtxs[0];
          pushTitle = `📸 Got photos from ${c.titleQualifier}?`;
          pushBody = `Be the first to share photos from ${c.eventLabel} — tap to upload.`;
          url = c.url;
        } else {
          const qualifier = userCtxs.every((c) => c.titleQualifier === userCtxs[0].titleQualifier)
            ? userCtxs[0].titleQualifier
            : "the matches";
          pushTitle = `📸 Got photos from ${qualifier}?`;
          pushBody = `Be the first to share photos from ${userCtxs.length} games — tap to upload.`;
          url = `/media`;
        }

        await supabase.functions.invoke("send-push-notification", {
          body: { userId, title: pushTitle, body: pushBody, url, tag: `photo-prompt-${userId}` },
        });
        totalRecipients++;
      }),
    );

    // Mark all processed prompts as push_sent.
    const processedIds = contexts.map((c) => c.promptId);
    if (processedIds.length > 0) {
      await supabase
        .from("gallery_chat_cards")
        .update({ push_sent: true })
        .in("id", processedIds);
    }

    const pushed = contexts.length;

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: prompts?.length ?? 0,
        pushed,
        skipped,
        errors,
        recipients: totalRecipients,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[photo-prompt-followup] uncaught", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
