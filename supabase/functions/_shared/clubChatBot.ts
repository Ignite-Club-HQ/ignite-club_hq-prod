// Shared club auto-bot helpers used to post into team chats as the club.
// Used by auto-post-event-to-chat and playhq-materialise-team-events.

// deno-lint-ignore no-explicit-any
type Admin = any;

export const LOCAL_TIME_ZONE = "Australia/Adelaide";

/** E.g. "Sat 16 May, 2:30 PM" in club-local time (edge runtime is UTC). */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: LOCAL_TIME_ZONE,
  });
  const time = d.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: LOCAL_TIME_ZONE,
  });
  return `${date}, ${time}`;
}

export async function ensureBot(
  admin: Admin,
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
      // deno-lint-ignore no-explicit-any
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

  await admin.from("profiles").upsert({ id: botUserId, display_name: clubName, avatar_url: logoUrl });
  await admin.from("clubs").update({ bot_user_id: botUserId }).eq("id", clubId);
  return botUserId;
}

export async function ensureBotInTeam(admin: Admin, botUserId: string, clubId: string, teamId: string) {
  const { data: existing } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", botUserId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (existing) return;
  await admin.from("user_roles").insert({
    user_id: botUserId,
    club_id: clubId,
    team_id: teamId,
    role: "basic_user",
  });
}

/** Posts a club-announcement message into a team chat as the club bot. */
export async function postTeamChatAsClubBot(
  admin: Admin,
  opts: { clubId: string; teamId: string; text: string },
): Promise<string | null> {
  const { data: club } = await admin
    .from("clubs")
    .select("name, logo_url")
    .eq("id", opts.clubId)
    .maybeSingle();
  const clubName = club?.name || "Club";
  const botUserId = await ensureBot(admin, opts.clubId, clubName, club?.logo_url ?? null);
  if (!botUserId) return null;
  await ensureBotInTeam(admin, botUserId, opts.clubId, opts.teamId);
  const { data: inserted, error } = await admin
    .from("team_messages")
    .insert({
      team_id: opts.teamId,
      author_id: botUserId,
      text: opts.text,
      is_club_announcement: true,
      club_announcement_name: clubName,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    console.error("team_messages insert failed", error);
    return null;
  }
  return inserted.id as string;
}
