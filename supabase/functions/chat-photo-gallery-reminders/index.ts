import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IGNITE_SUPPORT_USER_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Hourly cron: find team-chat image messages posted between 24h and 48h ago
 * whose uploader never published them to the team gallery, group by
 * (team, author), and post a single nudge system message per group.
 *
 * The RPC `post_chat_photo_gallery_reminder` dedupes per (team, author) on a
 * 7-day window, so widening the scan window is safe and self-healing.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Load admin-tunable settings (enabled flag + scan window).
    let enabled = true;
    let windowStartHours = 24;
    let windowEndHours = 48;
    try {
      const { data: settingRow } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "chat_photo_gallery_reminders")
        .maybeSingle();
      const v = (settingRow?.value ?? {}) as Record<string, unknown>;
      if (typeof v.enabled === "boolean") enabled = v.enabled;
      if (typeof v.window_start_hours === "number") windowStartHours = v.window_start_hours;
      if (typeof v.window_end_hours === "number") windowEndHours = v.window_end_hours;
    } catch (e) {
      console.warn("[chat-photo-reminders] settings lookup failed, using defaults", e);
    }

    if (!enabled) {
      return new Response(
        JSON.stringify({ ok: true, disabled: true, scanned: 0, posted: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Normalize window so start < end.
    const startH = Math.max(1, Math.min(windowStartHours, windowEndHours));
    const endH = Math.max(startH + 1, Math.max(windowStartHours, windowEndHours));

    const now = Date.now();
    const lower = new Date(now - endH * 60 * 60 * 1000).toISOString();
    const upper = new Date(now - startH * 60 * 60 * 1000).toISOString();

    // Pull candidate chat-image messages in the window.
    const { data: msgs, error: msgsError } = await supabase
      .from("team_messages")
      .select("id, team_id, author_id, image_url, created_at")
      .not("image_url", "is", null)
      .is("deleted_at", null)
      .eq("is_system_message", false)
      .neq("author_id", IGNITE_SUPPORT_USER_ID)
      .gte("created_at", lower)
      .lte("created_at", upper)
      .limit(2000);

    if (msgsError) {
      console.error("[chat-photo-reminders] msgs query failed", msgsError);
      return new Response(JSON.stringify({ error: msgsError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const candidates = msgs ?? [];
    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, scanned: 0, posted: 0, skipped: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Look up which of these image_urls are already published to the gallery
    // (matched on uploader_id + image_url, mirroring publishChatImageToGallery).
    const allUrls = Array.from(
      new Set(candidates.map((m) => m.image_url as string)),
    );

    const publishedSet = new Set<string>();
    // Chunk to keep IN clause sane.
    for (let i = 0; i < allUrls.length; i += 200) {
      const chunk = allUrls.slice(i, i + 200);
      const { data: pubs, error: pubErr } = await supabase
        .from("photos")
        .select("uploader_id, image_url")
        .in("image_url", chunk)
        .is("deleted_at", null);
      if (pubErr) {
        console.warn("[chat-photo-reminders] photos lookup failed", pubErr);
        continue;
      }
      for (const p of pubs ?? []) {
        publishedSet.add(`${p.uploader_id}::${p.image_url}`);
      }
    }

    // Group unpublished images by (team_id, author_id).
    const groups = new Map<string, { team_id: string; author_id: string; count: number }>();
    for (const m of candidates) {
      const key = `${m.author_id}::${m.image_url}`;
      if (publishedSet.has(key)) continue;
      const groupKey = `${m.team_id}::${m.author_id}`;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(groupKey, {
          team_id: m.team_id as string,
          author_id: m.author_id as string,
          count: 1,
        });
      }
    }

    let posted = 0;
    let skipped = 0;
    let errors = 0;

    // Gate: only nudge teams that had a game within the last 24h.
    // Photos shared outside a match-day window shouldn't trigger this prompt.
    const teamIds = Array.from(new Set(Array.from(groups.values()).map((g) => g.team_id)));
    const gameWindowLower = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const gameWindowUpper = new Date(now).toISOString();
    const teamsWithRecentGame = new Set<string>();
    if (teamIds.length > 0) {
      const { data: recentGames, error: gamesErr } = await supabase
        .from("events")
        .select("team_id")
        .in("team_id", teamIds)
        .eq("type", "game")
        .eq("is_cancelled", false)
        .gte("start_time", gameWindowLower)
        .lte("start_time", gameWindowUpper);
      if (gamesErr) {
        console.warn("[chat-photo-reminders] recent games lookup failed", gamesErr);
      } else {
        for (const r of recentGames ?? []) {
          if (r.team_id) teamsWithRecentGame.add(r.team_id as string);
        }
      }
    }

    for (const g of groups.values()) {
      if (!teamsWithRecentGame.has(g.team_id)) {
        skipped++;
        continue;
      }
      const { data, error } = await supabase.rpc(
        "post_chat_photo_gallery_reminder",
        {
          _team_id: g.team_id,
          _author_id: g.author_id,
          _system_user_id: IGNITE_SUPPORT_USER_ID,
          _photo_count: g.count,
        },
      );
      if (error) {
        console.error("[chat-photo-reminders] RPC failed", g, error);
        errors++;
        continue;
      }
      if (data) posted++;
      else skipped++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: candidates.length,
        groups: groups.size,
        posted,
        skipped,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[chat-photo-reminders] uncaught", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
