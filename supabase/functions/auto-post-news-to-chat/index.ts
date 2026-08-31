// Auto-post a published Club News item into the relevant chat(s) from the
// club's auto bot.
//
// Behaviour:
// - Whole-club news  -> one message in the club chat (`club_messages`)
// - Team-targeted news -> one message per targeted team (`team_messages`,
//   flagged as a club announcement so it renders with the club identity)
// - Idempotent: `club_news.chat_posted_at` is stamped after a successful post,
//   so re-fires are no-ops.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function ensureBot(
  clubId: string,
  clubName: string,
  logoUrl: string | null,
): Promise<string | null> {
  const { data: club } = await admin
    .from("clubs")
    .select("bot_user_id")
    .eq("id", clubId)
    .maybeSingle();
  if (club?.bot_user_id) return club.bot_user_id;

  const botEmail = `bot-${clubId}@club.igniteapp.internal`;
  const botPassword = crypto.randomUUID() + crypto.randomUUID();

  let botUserId: string | null = null;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: botEmail,
    password: botPassword,
    email_confirm: true,
    user_metadata: { full_name: clubName, is_club_bot: true, club_id: clubId },
  });
  if (createErr) {
    if (createErr.message?.includes("already been registered")) {
      const { data: existing } = await admin.auth.admin.listUsers();
      const found = existing?.users?.find((u: any) => u.email === botEmail);
      if (found) botUserId = found.id;
    }
    if (!botUserId) {
      console.error("ensureBot create failed", clubId, createErr);
      return null;
    }
  } else {
    botUserId = created.user.id;
  }

  await admin
    .from("profiles")
    .upsert({ id: botUserId, display_name: clubName, avatar_url: logoUrl });
  await admin.from("clubs").update({ bot_user_id: botUserId }).eq("id", clubId);
  return botUserId;
}

async function ensureBotMembership(
  botUserId: string,
  clubId: string,
  teamId: string | null,
) {
  let query = admin
    .from("user_roles")
    .select("id")
    .eq("user_id", botUserId)
    .eq("club_id", clubId);
  query = teamId ? query.eq("team_id", teamId) : query.is("team_id", null);
  const { data: existing } = await query.maybeSingle();
  if (existing) return;
  await admin.from("user_roles").insert({
    user_id: botUserId,
    club_id: clubId,
    team_id: teamId,
    role: "basic_user",
  });
}

function buildText(
  news: {
    id: string;
    title: string;
    content: string;
    is_important: boolean;
  },
  teamNames: string[],
): string {
  const link = `https://igniteclubhq.app/news/${news.id}`;
  const headline = news.is_important
    ? `📢 Important club news: ${news.title}`
    : `📰 Club news: ${news.title}`;
  const body = (news.content || "").trim();
  const excerpt =
    body.length > 280 ? `${body.slice(0, 280).trimEnd()}…` : body;

  let audienceLine = "";
  if (teamNames.length > 0) {
    if (teamNames.length === 1) {
      audienceLine = `Sent to ${teamNames[0]}`;
    } else {
      audienceLine = `Sent to ${teamNames.slice(0, -1).join(", ")} and ${teamNames[teamNames.length - 1]}`;
    }
  } else {
    audienceLine = "Sent to the whole club";
  }

  const lines = [headline];
  if (excerpt) {
    lines.push("");
    lines.push(excerpt);
  }
  lines.push("");
  lines.push(audienceLine);
  lines.push(link);
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const newsId = body.newsId as string | undefined;
    if (!newsId) return json({ error: "newsId required" }, 400);

    // Authorisation: the caller must be a club admin for the post's club.
    // The service-role client below bypasses RLS, so this check is the gate.
    const authHeader = req.headers.get("Authorization") ?? "";
    const caller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: callerNews, error: callerErr } = await caller
      .from("club_news")
      .select("id, club_id")
      .eq("id", newsId)
      .maybeSingle();
    if (callerErr || !callerNews) return json({ error: "not authorised" }, 403);
    const { data: isAdmin, error: adminErr } = await caller.rpc("is_club_admin_for", {
      _club_id: callerNews.club_id,
    });
    if (adminErr || isAdmin !== true) return json({ error: "not authorised" }, 403);

    const { data: news, error: newsErr } = await admin
      .from("club_news")
      .select(
        "id, club_id, title, content, is_important, is_published, target_team_ids, chat_posted_at",
      )
      .eq("id", newsId)
      .maybeSingle();

    if (newsErr || !news) return json({ error: "news not found" }, 404);
    if (!news.is_published) return json({ skipped: "not published" });
    if (news.chat_posted_at) return json({ skipped: "already posted" });

    const { data: club } = await admin
      .from("clubs")
      .select("name, logo_url")
      .eq("id", news.club_id)
      .maybeSingle();
    const clubName = club?.name || "Club";

    const botUserId = await ensureBot(
      news.club_id,
      clubName,
      club?.logo_url ?? null,
    );
    if (!botUserId) return json({ error: "bot unavailable" }, 500);

    const text = buildText(news as any);
    const teamIds = (news.target_team_ids || []) as string[];
    let posted = 0;

    if (teamIds.length > 0) {
      // Only post to teams that still belong to this club.
      const { data: teams } = await admin
        .from("teams")
        .select("id")
        .eq("club_id", news.club_id)
        .in("id", teamIds);
      const validTeamIds = (teams || []).map((t) => t.id as string);

      for (const teamId of validTeamIds) {
        await ensureBotMembership(botUserId, news.club_id, teamId);
      }

      if (validTeamIds.length > 0) {
        const { error: insErr } = await admin.from("team_messages").insert(
          validTeamIds.map((teamId) => ({
            team_id: teamId,
            author_id: botUserId,
            text,
            is_club_announcement: true,
            club_announcement_name: clubName,
          })),
        );
        if (insErr) {
          console.error("team_messages insert failed", insErr);
          return json({ error: insErr.message }, 500);
        }
        posted = validTeamIds.length;
      }
    } else {
      await ensureBotMembership(botUserId, news.club_id, null);
      const { error: insErr } = await admin.from("club_messages").insert({
        club_id: news.club_id,
        author_id: botUserId,
        text,
      });
      if (insErr) {
        console.error("club_messages insert failed", insErr);
        return json({ error: insErr.message }, 500);
      }
      posted = 1;
    }

    if (posted > 0) {
      await admin
        .from("club_news")
        .update({ chat_posted_at: new Date().toISOString() })
        .eq("id", news.id);
    }

    return json({ ok: true, posted });
  } catch (err) {
    console.error("auto-post-news-to-chat fatal", err);
    return json({ error: (err as Error).message }, 500);
  }
});
