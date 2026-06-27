import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ScopeType = "team" | "club" | "group" | "club_admin" | "direct";

interface Body {
  scope_type: ScopeType;
  scope_id: string;
  /** When true, ignore cache and force a fresh summary. */
  force?: boolean;
  /** ISO timestamp of when the user last opened this thread (used to anchor "since your last visit"). */
  last_opened_at?: string | null;
  /** When provided, ignore last_opened_at and summarise the last N hours. */
  lookback_hours?: number;
}

const MAX_MESSAGES = 50;
const MAX_MESSAGES_LOOKBACK = 200; // legacy fallback
// Tier lookback caps by window length so longer recaps actually cover the
// requested period instead of silently truncating to the most recent N.
function lookbackMessageCap(hours: number): number {
  if (hours <= 24) return 100;
  if (hours <= 24 * 7) return 250;
  return 500; // up to 90d (Gemini 2.0 Flash has plenty of context headroom)
}
const SUMMARY_TTL_HOURS = 48;
const RECAP_VERSION = "recap-v12";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatTimeOfDay(ts: Date): string {
  let h = ts.getHours();
  const m = ts.getMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${suffix}` : `${h}:${m.toString().padStart(2, "0")}${suffix}`;
}

function localTag(createdAt: string): string {
  const ts = new Date(createdAt);
  if (Number.isNaN(ts.getTime())) return "";
  return `[${WEEKDAYS[ts.getDay()]} ${ts.getDate()} ${MONTHS[ts.getMonth()]} ${formatTimeOfDay(ts)}] `;
}

function localDayLabel(createdAt: string): string {
  const ts = new Date(createdAt);
  if (Number.isNaN(ts.getTime())) return "training";
  return `${WEEKDAYS[ts.getDay()]} ${ts.getDate()} ${MONTHS[ts.getMonth()]}`;
}

function extractLine(text: string, label: RegExp): string | null {
  const line = text.split(/\n+/).find((part) => label.test(part));
  if (!line) return null;
  return line.replace(label, "").replace(/^\s*[:\-–]\s*/, "").trim() || null;
}

function localBulletForMessage(message: any): string | null {
  const raw = String(message?.text || "").replace(/\r/g, "").trim();
  const compact = raw.replace(/\s+/g, " ").trim();
  const lower = compact.toLowerCase();
  const tag = localTag(message?.created_at as string);
  // Image-only/gallery-card messages have no visual context in the transcript.
  // Do not invent a generic "photo was shared" recap bullet; it adds no value
  // unless surrounding text describes what the media is of.
  if (!compact && message?.image_url) return null;
  if (/^\[gallery(?:prompt)?:/i.test(compact)) return null;
  if (/happy birthday|haha thanks|in the zone/i.test(compact)) return null;

  if (/\bevent cancelled\b|\bgame cancelled\b/i.test(compact)) {
    const reason = compact.match(/cancelled(?:\s+due\s+to|:)?\s*([^\n.]+)/i)?.[1]?.trim();
    return `${tag}A game or event was cancelled${reason ? ` because of ${reason}` : ""}.`;
  }

  if (/\b(?:game|match|kick[- ]?off|opponent|rostered role|subs manager|game steward|snacks)\b/i.test(compact)) {
    const opponent = compact.match(/([A-Z][\w'’ -]+\s+v(?:s|ersus)?\.?\s+[A-Z][\w'’ -]+)/i)?.[1]?.trim() ?? null;
    const kickoff = extractLine(raw, /^\s*Kick[- ]?off\s*/i) ?? compact.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0] ?? null;
    const location = extractLine(raw, /^\s*Location\s*/i);
    const date = compact.match(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?\s+\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i)?.[0]
      ?? compact.match(/\bSaturday\s+\d{1,2}\s+June\b/i)?.[0]
      ?? null;
    const parts = [opponent ? `opponent ${opponent}` : null, date, kickoff ? `kick-off ${kickoff.replace(/\s+/g, "")}` : null, location ? `location ${location}` : null].filter(Boolean);
    if (parts.length) return `${tag}Game details were shared, including ${parts.join(", ")}.`;
    return `${tag}A fixture update was shared with game details and roster information.`;
  }

  if (/\b(?:won'?t|wont|can't|cannot|unavailable|out)\b.*\btraining\b/i.test(compact) || /\btraining\b.*\b(?:won'?t|wont|can't|cannot|unavailable|out)\b/i.test(compact)) {
    const name = compact.match(/\b([A-Z][a-z'’.-]{2,})\s+(?:won'?t|wont|can't|cannot|is unavailable|out)\b/)?.[1] ?? "A player";
    return `${tag}${name} is unavailable for ${localDayLabel(message?.created_at as string)} training.`;
  }

  if (/\bvolunteer\b|\bhappy to help\b|\bhelp out\b/i.test(compact)) {
    if (/keeper|goalkeeper/i.test(compact)) return `${tag}A volunteer was requested to help with goalkeeper practice at training.`;
    return `${tag}A parent or member offered to help with a team task.`;
  }

  return null;
}

function localFallbackBullets(messages: any[]): string[] {
  const bullets: string[] = [];
  const seen = new Set<string>();
  for (const message of messages.slice().reverse()) {
    const bullet = localBulletForMessage(message);
    if (!bullet) continue;
    const key = bullet.replace(/^\[[^\]]+\]\s*/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.unshift(bullet);
    if (bullets.length >= 6) break;
  }
  return bullets;
}


// Sensitive-topic blocklist — if the recent transcript hits any of these we
// refuse to send it to the LLM. Keeps medical, safeguarding and disciplinary
// context out of third-party AI even when an admin tries to summarise it.
const SENSITIVE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "medical", re: /\b(?:medical|medication|diagnosis|diagnosed|prescription|prescribed|hospital(?:ised|ized)?|surgery|injur(?:y|ies|ed)\s+report|concussion|seizure|allerg(?:y|ic)|epi[- ]?pen|asthma|insulin|mental health|self[- ]harm|suicid(?:e|al)|overdose)\b/i },
  { label: "safeguarding", re: /\b(?:safeguard(?:ing)?|child protection|abuse|abusive|assault|grooming|inappropriate touch|disclosure|mandatory report|police report|incident report|welfare concern|cps|family court|restraining order|dvo|avo|domestic violence)\b/i },
  { label: "disciplinary", re: /\b(?:disciplinary|misconduct|suspension|suspended|expel(?:led|sion)?|tribunal|hearing\s+(?:date|panel)|formal warning|grievance|complaint\s+against|investigation\s+into|sanction(?:ed)?|banned\s+from)\b/i },
];

function detectSensitive(text: string): string | null {
  for (const { label, re } of SENSITIVE_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}

const SCOPE_TABLES: Record<ScopeType, { table: string; scopeCol: string }> = {
  team: { table: "team_messages", scopeCol: "team_id" },
  club: { table: "club_messages", scopeCol: "club_id" },
  group: { table: "group_messages", scopeCol: "group_id" },
  club_admin: { table: "club_admin_messages", scopeCol: "conversation_id" },
  direct: { table: "direct_messages", scopeCol: "conversation_id" },
};

async function getClubIdForScope(
  admin: ReturnType<typeof createClient>,
  scope_type: ScopeType,
  scope_id: string,
): Promise<string | null> {
  if (scope_type === "club") return scope_id;
  if (scope_type === "team") {
    const { data } = await admin.from("teams").select("club_id").eq("id", scope_id).maybeSingle();
    return (data?.club_id as string) ?? null;
  }
  if (scope_type === "group") {
    const { data } = await admin.from("chat_groups").select("club_id").eq("id", scope_id).maybeSingle();
    return (data?.club_id as string) ?? null;
  }
  if (scope_type === "club_admin") {
    const { data } = await admin
      .from("club_admin_conversations")
      .select("club_id")
      .eq("id", scope_id)
      .maybeSingle();
    return (data?.club_id as string) ?? null;
  }
  return null; // direct
}

const SYSTEM_PROMPT = `You are an AI Club Secretary summarising sports-club chat threads for a busy parent, player, coach or committee member. Your goal is to let them understand the useful recent activity in under 15 seconds — not only what is actionable.

You are given a transcript with timestamps. The user message will tell you the cutoff time for "their last visit". Group new updates into the legacy JSON buckets by send date: current-date bucket, previous-date bucket, and earlier bucket. The bucket names are schema keys only and must never appear in user-visible strings.

Prioritise updates that affect schedules, attendance, fixtures, training, availability, safety, compliance or club operations. Also include useful informational posts such as match reminders, duty rosters, arrival times, venues, player availability and coach updates even when no action is required. You cannot see uploaded images or videos. Only mention photos/files when the sender wrote an explicit caption or description in the same message that says what the media/file is of or why it matters; never infer image content from surrounding replies or thanks. Never output generic lines like "a photo was shared in the team chat". Ignore casual banter, jokes, emoji-only messages and greetings.

An action is "outstanding" only if nobody in later messages confirms it is done, cancelled, or resolved. Drop anything that was already resolved in the transcript.

Return STRICT JSON only that matches this TypeScript type:
{
  "headline": string, // <=110 chars, one plain-text sentence describing the single most important thing the user needs to know
  "since_last_visit": {
    "today": string[],     // legacy schema key for messages sent on the current date; max 8 bullets
    "yesterday": string[], // legacy schema key for messages sent on the previous date; max 5 bullets
    "earlier": string[]    // legacy schema key for older messages; max 5 bullets
  },
  "outstanding_actions": Array<{
    "text": string,                        // <=200 chars, the action itself
    "owner": string | null,                // who needs to act, if clearly identified, otherwise null
    "priority": "high" | "medium" | "low" // high = time-sensitive / affects upcoming event; low = nice to do
  }>, // max 5, sorted high -> low priority
  "outstanding_questions": [], // ALWAYS return an empty array. Do not extract open questions. Instead, fold the substance of any unresolved question into the relevant since_last_visit bullet so context is preserved.
  "detailed": {
    "schedule_changes": string[], // max 8 bullets — training/match time, date, location changes
    "files_shared": string[],     // max 8 bullets — only photos/docs with meaningful described content; never generic media-share notices
    "discussion": string[]        // max 10 bullets — other notable discussion, decisions, questions raised, opinions, suggestions
  }
}

Across "since_last_visit.today/yesterday/earlier" combined, return 4-9 bullets total — fewer only if the chat genuinely had less useful activity. NEVER return an empty recap while the transcript contains fixture details, training/availability updates, rosters or coach/club information. SYNTHESISE, DO NOT TRANSCRIBE: combine related messages into one fact and never output speaker-prefixed lines like "Dan: ..." or message-like replies such as "Yep I can", "Also interested", "Sorry I can't", or "Could someone please...". Each bullet should explain the outcome or state of play (who volunteered, what changed, who is unavailable, what still needs a response, or what information was shared) rather than repeating what was typed. If something was asked but not answered, state it as a fact ("A ref is still needed for the U10 game Sat") rather than quoting the question. Do not include photo/video/file bullets unless the uploader's own message text explicitly says what was shared (e.g. "photos of the trophy presentation" is useful; "a photo was shared in the team chat" and "photos of kids celebrating" inferred from thanks/replies are forbidden). Every array and object MUST exist (use [] or null). Preserve concrete facts when stated in the transcript: who is doing what (referee, coach, volunteer, driver), opponent, kick-off time, venue/pitch, date, score, deadline. Names ARE allowed when the person owns a role, decision, action or assignment (e.g. "Sam is reffing the U10 game Sat 27 at 10am"). Only omit names for generic chat. Do not invent details.

PARAPHRASE ONLY (critical): Never copy chat sentences verbatim, never use quotation marks around message text, and never paste internal route paths like "/events/abc-123", "/messages/...", "/clubs/...", URLs, www links, or raw UUIDs into a bullet. If a message is a long copy/paste, rewrite it into one concise parent-friendly sentence ("Training was cancelled due to rain"; "Event details were shared"). Use neutral parent-facing language, not system wording like "View event", "Open link", "Tap here", or "Notification sent".

EVENT FACT EXTRACTION: When a message announces an event, distil it into the useful facts only — date/weekday, cancellation status, kick-off time, opponent, location, arrival time. Drop everything else from that message.

BULLET LENGTH (hard cap): EVERY bullet, headline, action and detail string MUST be <=140 characters (after the bracketed timeline tag). Aim for ONE short sentence per day in since_last_visit.today/yesterday/earlier — if multiple things happened on the same day, combine them into one tight sentence or pick the single most useful fact.

BULLET DESCRIPTIVENESS (required): Each bullet MUST be a complete, descriptive sentence (aim 10-22 words) that names WHO/WHAT/WHEN/WHY where the transcript provides it. NEVER emit terse fragments like "Archer out", "Training cancelled", "Ref needed" — instead write "Archer is unavailable for Wednesday's training" or "A referee is still needed for Saturday's U10 game at 10am". If you only have a name with no context, drop the bullet rather than shipping a vague one.

USE REAL NAMES (critical): When the transcript identifies WHO said or did something, you MUST use that person's actual name from the speaker label or @mention. NEVER substitute vague placeholders like "someone", "a player", "a parent", "one member", "another member", "a coach", "a volunteer", or "a club member" when a name is available in the transcript. Examples: write "Jas volunteered to be linesperson for Friday's match" (not "Someone has volunteered..."), "Dan asked for a linesperson for Friday's match" (not "A linesperson was requested"), "Bec is interested in the holiday tournament pending dates" (not "A player has expressed interest"). Only fall back to a generic descriptor if the transcript truly does not identify the speaker.


TIMELINE TAG (required): EVERY bullet inside since_last_visit.today / yesterday / earlier AND inside detailed.discussion / detailed.schedule_changes MUST begin with a bracketed explicit send-date tag derived from when the underlying message was sent. Format: "[Sat 27 Jun 9:30am]" or "[Wed 2 Jul 6pm]". Always include weekday, day number, month, and time. Always lowercase am/pm, no leading zero on the hour, omit ":00". One space after the closing bracket. NEVER use relative tags such as "[Today]", "[Yest]", "[Yesterday]", "[Tomorrow]", or a bare "[9:30am]". Do NOT use the old "[YYYY-MM-DD HH:MM]" machine format anywhere. If multiple messages contributed to one bullet, tag it with the time of the most relevant (usually latest) message.

EVENT DATE ACCURACY (critical): Inside every user-visible string (headline, bullets, actions, details), NEVER use "today", "tonight", "tomorrow", "yesterday", "this morning", "this afternoon", "this evening", "this week", or "next week". Always use an explicit weekday/date when an event/training/match date is clear (e.g. "Wednesday's training", "Sat 27 Jun", "Sat 5 Jul at 10am"). The transcript's relative words were written from the SENDER's message timestamp — resolve "today/tomorrow/yesterday" against the timestamp on that specific transcript line, then write the resulting concrete weekday/date. NOW is only for knowing the generation time; do not use NOW to interpret a sender's relative word. Example: a Monday message saying "training tomorrow" must be written as "Tuesday's training", never as "training tomorrow" or "training today". If a date cannot be resolved with confidence, omit the time reference rather than guessing. Output JSON only — no prose, no markdown.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.slice("Bearer ".length).trim();

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ALLOWLIST = new Set(["f51dd664-b0d5-4956-b2d5-cec9222ae3dc"]);
    if (!ALLOWLIST.has(user.id)) {
      return new Response(JSON.stringify({ error: "Chat Recap is currently in restricted beta." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const rawGeminiKey = Deno.env.get("GEMINI_API_KEY");
    const geminiKey = rawGeminiKey?.trim();
    if (!geminiKey) {
      console.error("[summarize-chat] GEMINI_API_KEY unavailable", {
        present: rawGeminiKey !== undefined,
        blank: rawGeminiKey !== undefined && rawGeminiKey.trim().length === 0,
      });
      return new Response(JSON.stringify({ error: "ai_not_configured", detail: "missing_or_blank_gemini_api_key" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    const { scope_type, scope_id, force, last_opened_at, lookback_hours } = body || ({} as Body);
    const validLookback = typeof lookback_hours === "number" && lookback_hours > 0 && lookback_hours <= 24 * 90;
    // The client sends lookback_hours=24 by default — treat that as the
    // standard "default" window so it still benefits from cache and TTL.
    const isDefaultLookback = validLookback && (lookback_hours as number) === 24;
    const lookbackCutoffIso = validLookback
      ? new Date(Date.now() - (lookback_hours as number) * 3600 * 1000).toISOString()
      : null;
    if (!scope_type || !scope_id || !SCOPE_TABLES[scope_type]) {
      return new Response(JSON.stringify({ error: "Invalid scope" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Require the user to have acknowledged the AI Catch Me Up disclosure once.
    const { data: prof } = await admin
      .from("profiles")
      .select("ai_catch_up_acknowledged_at")
      .eq("id", user.id)
      .maybeSingle();
    if (!(prof as any)?.ai_catch_up_acknowledged_at) {
      return new Response(JSON.stringify({ error: "disclosure_required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pro gate + club-level AI Catch Me Up toggle (skip for direct messages — no single club to evaluate).
    let isJuniorClub = false;
    if (scope_type !== "direct") {
      const clubId = await getClubIdForScope(admin, scope_type, scope_id);
      if (clubId) {
        // Junior club detection — if any team in the club is a junior team we apply stricter rules.
        const { data: juniorTeams } = await admin
          .from("teams")
          .select("id")
          .eq("club_id", clubId)
          .eq("team_type", "junior")
          .limit(1);
        isJuniorClub = Array.isArray(juniorTeams) && juniorTeams.length > 0;

        // Admin bypass: app_admin / club_admin / committee_member can use the feature
        // even when the club-level toggle is off (mirrors useAICatchUpAvailability on the client).
        const { data: isAppAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "app_admin" });
        let isClubAdmin = false;
        if (!isAppAdmin) {
          const { data: clubRoles } = await admin
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("club_id", clubId)
            .in("role", ["club_admin", "committee_member"]);
          isClubAdmin = Array.isArray(clubRoles) && clubRoles.length > 0;
        }
        // For junior clubs we DO NOT allow committee_member to bypass — only app_admin or club_admin.
        let adminBypass = isAppAdmin === true || isClubAdmin;
        if (isJuniorClub && !isAppAdmin) {
          const { data: strictRoles } = await admin
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("club_id", clubId)
            .eq("role", "club_admin");
          adminBypass = Array.isArray(strictRoles) && strictRoles.length > 0;
        }

        if (!adminBypass) {
          const { data: clubRow } = await admin
            .from("clubs")
            .select("ai_catch_up_enabled")
            .eq("id", clubId)
            .maybeSingle();
          if ((clubRow as any)?.ai_catch_up_enabled === false) {
            return new Response(JSON.stringify({ error: "feature_disabled", club_id: clubId }), {
              status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        const { data: hasPro } = await admin.rpc("has_active_pro_for_club", { _club_id: clubId });
        if (hasPro !== true) {
          return new Response(JSON.stringify({ error: "pro_required", club_id: clubId }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Fetch messages using the user's JWT so RLS enforces access.
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { table, scopeCol } = SCOPE_TABLES[scope_type];
    const msgLimit = validLookback ? lookbackMessageCap(lookback_hours as number) : MAX_MESSAGES;
    let msgQuery = userClient
      .from(table)
      .select("id, text, author_id, created_at, image_url")
      .eq(scopeCol, scope_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(msgLimit);

    if (lookbackCutoffIso) {
      msgQuery = msgQuery.gte("created_at", lookbackCutoffIso);
    }
    const { data: msgRows, error: msgErr } = await msgQuery;

    if (msgErr) {
      console.error("[summarize-chat] msg fetch failed", msgErr);
      return new Response(JSON.stringify({ error: "fetch_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messages = (msgRows || []).slice().reverse();
    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "no_messages" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lastMessageId = messages[messages.length - 1].id as string;

    // Cache hit? (respect TTL) — skip cache only when the user asked for a
    // bespoke (non-default) time window so we don't return a narrower cached
    // recap. The default 24h call still uses the cache.
    if (!force && (!validLookback || isDefaultLookback)) {
      const { data: cached } = await admin
        .from("chat_summaries")
        .select("summary, message_count, last_message_id, created_at, expires_at, model")
        .eq("user_id", user.id)
        .eq("scope_type", scope_type)
        .eq("scope_id", scope_id)
        .eq("last_message_id", lastMessageId)
        .maybeSingle();
      const stillFresh = cached?.expires_at ? new Date(cached.expires_at as string).getTime() > Date.now() : false;
      const cacheVersionOk = typeof cached?.model === "string" && cached.model.includes(RECAP_VERSION);
      if (cached?.summary && stillFresh && cacheVersionOk) {
        return new Response(
          JSON.stringify({
            summary: cached.summary,
            message_count: cached.message_count,
            last_message_id: cached.last_message_id,
            cached: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Sensitive content block — refuse to send any medical / safeguarding /
    // disciplinary discussion to a third-party LLM.
    const sensitiveHit = detectSensitive(messages.map((m: any) => m.text || "").join("\n"));
    if (sensitiveHit) {
      return new Response(
        JSON.stringify({ error: "sensitive_content", category: sensitiveHit }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve author names
    const authorIds = [...new Set(messages.map((m: any) => m.author_id).filter(Boolean))];
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", authorIds.length ? authorIds : ["00000000-0000-0000-0000-000000000000"]);
    const nameMap = new Map<string, string>();
    (profiles || []).forEach((p: any) => nameMap.set(p.id, p.display_name || "Someone"));

    // ---------- Privacy: anonymise transcript before sending to Gemini ----------
    // Replace real names with stable pseudonyms (Person 1, Person 2…) and redact
    // emails / phone numbers / URLs / long digit strings. We keep a reverse map
    // so the model's output can be re-hydrated with real names before caching.
    const pseudoByRealName = new Map<string, string>(); // real -> "Person N"
    const realByPseudo = new Map<string, string>();     // "Person N" -> real
    let personCounter = 0;
    const getPseudo = (real: string) => {
      const key = real.trim();
      if (!key) return "Someone";
      const existing = pseudoByRealName.get(key);
      if (existing) return existing;
      personCounter += 1;
      const p = `Person ${personCounter}`;
      pseudoByRealName.set(key, p);
      realByPseudo.set(p, key);
      return p;
    };
    // Pre-seed with author display names so mentions in body match the speaker label.
    Array.from(nameMap.values()).forEach((n) => getPseudo(n));

    // Additionally pseudonymise CHILD names belonging to parents in this club.
    // Children are minors — never allow their real names to leave our infra.
    // Rehydrate to "<ParentFirst>'s child" so users see meaningful context
    // instead of a leaked "Child N" pseudonym.
    try {
      const clubIdForChildren = await getClubIdForScope(admin, scope_type, scope_id);
      if (clubIdForChildren) {
        const { data: clubParents } = await admin
          .from("user_roles")
          .select("user_id")
          .eq("club_id", clubIdForChildren);
        const parentIds = Array.from(new Set((clubParents || []).map((r: any) => r.user_id).filter(Boolean)));
        if (parentIds.length) {
          const { data: parentProfiles } = await admin
            .from("profiles")
            .select("id, display_name")
            .in("id", parentIds);
          const parentNameById = new Map<string, string>();
          (parentProfiles || []).forEach((p: any) =>
            parentNameById.set(p.id, (p.display_name || "").trim()),
          );
          const { data: kids } = await admin
            .from("children")
            .select("name, parent_id")
            .in("parent_id", parentIds);
          (kids || []).forEach((k: any) => {
            const n = (k?.name || "").trim();
            if (!n) return;
            const parentFull = parentNameById.get(k.parent_id) || "";
            const parentFirst = parentFull.split(/\s+/)[0] || "";
            const descriptor = parentFirst ? `${parentFirst}'s child` : "a child";
            const key = n;
            if (!pseudoByRealName.has(key)) {
              personCounter += 1;
              const p = `Child ${personCounter}`;
              pseudoByRealName.set(key, p);
              realByPseudo.set(p, descriptor);
            }
            const first = n.split(/\s+/)[0];
            if (first && first.length >= 2 && !pseudoByRealName.has(first)) {
              pseudoByRealName.set(first, pseudoByRealName.get(key)!);
            }
          });
        }
      }
    } catch (e) {
      console.error("[summarize-chat] child name seeding failed", e);
    }

    // Also pseudonymise FIRST names of every known adult so "Hi Sarah" gets caught
    // even when the message uses only the first name.
    Array.from(nameMap.values()).forEach((full) => {
      const first = (full || "").trim().split(/\s+/)[0];
      if (first && first.length >= 2 && !pseudoByRealName.has(first)) {
        pseudoByRealName.set(first, pseudoByRealName.get(full)!);
      }
    });

    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Strip identifying PII outright before sending to Gemini.
    // We deliberately KEEP venue / location names (Bridgewater Oval, etc.) because
    // they're useful context for sport summaries. We REMOVE: emails, phone numbers,
    // URLs, street addresses, postcodes (UK/US/CA/AU), long digit runs,
    // IBAN-like tokens, sort codes, credit cards, dates of birth, and @handles.
    const STREET_WORDS =
      "(?:st|street|rd|road|ave|avenue|dr|drive|ln|lane|ct|court|cres|crescent|pl|place|blvd|boulevard|way|terr|terrace|hwy|highway|cl|close|pde|parade|sq|square)";
    const AU_STATES = "(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)";
    const redactPII = (raw: string): string => {
      let t = raw;
      // Emails
      t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "");
      // URLs (full + bare www domain + bare hostnames)
      t = t.replace(/https?:\/\/\S+/gi, "");
      t = t.replace(/\bwww\.[^\s]+/gi, "");
      t = t.replace(/\b[a-z0-9-]+\.(?:com|net|org|io|co|uk|au|ai)(?:\/\S*)?\b/gi, "");
      // Social @handles
      t = t.replace(/(^|\s)@[\w.]{2,}/g, "$1");
      // Street addresses: "12 Smith Street", "4/22 Park Rd"
      t = t.replace(
        new RegExp(`\\b\\d{1,5}[a-z]?(?:\\/\\d{1,5})?\\s+[A-Z][\\w'-]+(?:\\s+[A-Z][\\w'-]+)?\\s+${STREET_WORDS}\\b\\.?`, "gi"),
        "",
      );
      // PO Box
      t = t.replace(/\bP\.?O\.?\s*Box\s+\d+\b/gi, "");
      // Postcodes — UK (SW1A 1AA), CA (A1A 1A1), AU (NSW 2000), US ZIP
      t = t.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g, "");
      t = t.replace(/\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/g, "");
      t = t.replace(new RegExp(`\\b${AU_STATES}\\s+\\d{4}\\b`, "g"), "");
      t = t.replace(/\b\d{5}(?:-\d{4})?\b/g, "");
      // Credit card numbers (16 digits with spaces or dashes)
      t = t.replace(/\b(?:\d[ -]?){13,19}\b/g, "");
      // Phone numbers (loose: 7+ digits with optional separators, allow leading +)
      t = t.replace(/\+?\d[\d\s().-]{6,}\d/g, "");
      // UK sort codes (12-34-56) and US SSN (123-45-6789)
      t = t.replace(/\b\d{2}-\d{2}-\d{2}\b/g, "");
      t = t.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "");
      // IBAN-ish (2 letters + 13+ alnum)
      t = t.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, "");
      // Dates of birth — with prefix
      t = t.replace(/\b(?:dob|d\.o\.b\.?|born)[\s:]*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/gi, "");
      // Bare dd/mm/yyyy or dd-mm-yyyy with 4-digit year (likely DOB / sensitive)
      t = t.replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:19|20)\d{2}\b/g, "");
      // Remaining long digit runs (account / licence / member numbers)
      t = t.replace(/\b\d{6,}\b/g, "");
      // Replace known real names (adults + children + first names) with pseudonyms.
      const names = Array.from(pseudoByRealName.keys()).sort((a, b) => b.length - a.length);
      for (const name of names) {
        if (name.length < 2) continue;
        const re = new RegExp(`\\b${escapeRe(name)}\\b`, "gi");
        t = t.replace(re, pseudoByRealName.get(name)!);
      }
      // Collapse whitespace left by removals
      return t.replace(/\s{2,}/g, " ").trim();
    };

    const transcript = messages
      .map((m: any) => {
        const real = nameMap.get(m.author_id) || "Someone";
        const speaker = getPseudo(real);
        const ts = new Date(m.created_at).toISOString().slice(0, 16).replace("T", " ");
        const t = redactPII((m.text || "").replace(/\s+/g, " ").trim());
        return { line: `[${ts}] ${speaker}: ${t}`, keep: !!t };
      })
      .filter((x) => x.keep)
      .map((x) => x.line)
      .join("\n");

    // Rehydrate pseudonyms back to real names in any string the model returns.
    const rehydrate = (s: string): string => {
      if (!s) return s;
      let out = s;
      // Replace longer pseudonyms first (Person 10 before Person 1).
      const pseudos = Array.from(realByPseudo.keys()).sort((a, b) => b.length - a.length);
      for (const p of pseudos) {
        const re = new RegExp(`\\b${escapeRe(p)}\\b`, "g");
        out = out.replace(re, realByPseudo.get(p)!);
      }
      // Safety net: any "Child N" / "Person N" pseudonym that escaped rehydration
      // (e.g. model invented an unseen number) becomes a neutral descriptor.
      out = out.replace(/\bChild\s+\d+\b/g, "a child");
      out = out.replace(/\bPerson\s+\d+\b/g, "someone");
      return out;
    };
    const stripSpeakerPrefix = (s: string): string => s
      .replace(/^([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,2})\s*[:\-–]\s+/u, "")
      .replace(/^Person\s+\d+\s*[:\-–]\s+/i, "")
      .trim();
    const isBareMediaShare = (s: string): boolean => {
      const t = stripSpeakerPrefix(s)
        .replace(/^\[[^\]]{1,40}\]\s*/, "")
        .replace(/^[•\-*]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!/\b(?:photo|photos|image|images|picture|pictures|video|videos|file|files|document|documents)\b.{0,50}\b(?:shared|posted|uploaded|added|sent)\b/i.test(t)) return false;
      const descriptive = t
        .replace(/\b(?:a|an|some|the)?\s*(?:photo|photos|image|images|picture|pictures|video|videos|file|files|document|documents)\b/gi, " ")
        .replace(/\b(?:is|are|was|were|has|have|been|shared|posted|uploaded|added|sent|in|to|on|the|a|an|of|from|via|with|into|team|group|club|chat|thread|message|conversation|recent|activity)\b/gi, " ")
        .replace(/[^A-Za-z\s]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      return descriptive.split(/\s+/).filter((w) => w.length > 2).length === 0;
    };
    const isInferredMediaDescription = (s: string): boolean => {
      const t = stripSpeakerPrefix(s)
        .replace(/^\[[^\]]{1,40}\]\s*/, "")
        .replace(/^[•\-*]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
      return /\b(?:thanks?|thank you|thanked|cheers|appreciate(?:d)?)\b.{0,80}\b(?:shared|posted|uploaded|added|sent|sharing|posting|uploading|adding|sending)\b.{0,80}\b(?:photo|photos|image|images|picture|pictures|video|videos)\b/i.test(t)
        || /\b(?:photo|photos|image|images|picture|pictures|video|videos)\b.{0,80}\b(?:thanks?|thank you|thanked|cheers|appreciate(?:d)?)\b/i.test(t);
    };
    const sanitizeOutputBullet = (s: string): string => {
      let out = s;
      out = out.replace(/https?:\/\/\S+/gi, "");
      out = out.replace(/\bwww\.[^\s)]+/gi, "");
      out = out.replace(/\/(?:events?|messages?|chats?|clubs?|teams?|groups?|threads?|broadcasts?|polls?|files?|vault|photos?)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?/gi, "");
      out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "");
      out = out.replace(/\b(?:view|open|see|tap|click)\s+(?:event|details|link|here|message|thread)\b[^.!?]*/gi, "");
      out = out.replace(/[“”„‟«»]/g, "");
      out = out.replace(/(^|\s)"([^"]{0,400})"(?=\s|[.,;!?]|$)/g, (_m, lead, inner) => `${lead}${inner}`);
      out = out.replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
      out = out.replace(/[\s,;:–-]+$/g, "").trim();
      // Hard cap visible bullet at 140 chars (keep any leading [tag] outside the cap).
      const tagMatch = out.match(/^(\[[^\]]{1,40}\]\s*)/);
      const tag = tagMatch?.[1] ?? "";
      const body = tag ? out.slice(tag.length) : out;
      if (body.length > 140) {
        const slice = body.slice(0, 140);
        const lastSpace = slice.lastIndexOf(" ");
        const truncated = (lastSpace > 80 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;:–-]+$/g, "") + "…";
        out = `${tag}${truncated}`;
      }
      return out;
    };
    const cleanBullet = (s: string): string => {
      const cleaned = sanitizeOutputBullet(stripSpeakerPrefix(rehydrate(s)).replace(/\s+/g, " ").trim());
      return isBareMediaShare(cleaned) || isInferredMediaDescription(cleaned) ? "" : cleaned;
    };
    const rehydrateArr = (arr: any): string[] =>
      Array.isArray(arr) ? arr.map((x) => (typeof x === "string" ? cleanBullet(x) : "")).filter(Boolean) : [];
    const rehydrateQuestions = (arr: any): Array<{ text: string; date?: string }> => {
      if (!Array.isArray(arr)) return [];
      return arr.map((x: any) => {
        if (typeof x === "string") return { text: rehydrate(x) };
        const text = typeof x?.text === "string" ? rehydrate(x.text) : "";
        const date = typeof x?.date === "string" ? x.date : undefined;
        return text ? { text, date } : null;
      }).filter(Boolean) as Array<{ text: string; date?: string }>;
    };

    const nowIso = new Date().toISOString();
    const lastVisitLine = validLookback
      ? `The user explicitly asked for a recap of the last ${lookback_hours} hours (since ${lookbackCutoffIso}). Treat the whole transcript as the relevant window. Use the legacy today/yesterday/earlier JSON keys only as internal buckets; do not write those words in any user-visible text.`
      : last_opened_at
        ? `The user last opened this thread at ${new Date(last_opened_at).toISOString()}. Treat anything newer than that as "since their last visit".`
        : `The user has not opened this thread recently. Treat the whole transcript as "since their last visit".`;
    const userPrompt =
      `Now is ${nowIso}. ${lastVisitLine}\n\nSummarise the following ${messages.length} chat messages from a sports-club ${scope_type} chat. Return JSON only matching the schema in the system instructions.\n\n${transcript}`;

    const GEMINI_MODEL = "gemini-2.5-flash-lite";
    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.25, maxOutputTokens: 1600 },
        }),
      },
    );
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("[summarize-chat] gemini error", aiRes.status, txt);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "ai_failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const aiJson = await aiRes.json();
    const raw: string = aiJson?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "{}";

    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const sinceRaw = (parsed.since_last_visit && typeof parsed.since_last_visit === "object") ? parsed.since_last_visit : {};
    const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const actionsArr: Array<{ text: string; owner: string | null; priority: "high" | "medium" | "low" }> =
      (Array.isArray(parsed.outstanding_actions) ? parsed.outstanding_actions : [])
        .map((a: any) => {
          if (typeof a === "string") return { text: rehydrate(a), owner: null, priority: "medium" as const };
          const text = typeof a?.text === "string" ? rehydrate(a.text) : "";
          const owner = typeof a?.owner === "string" && a.owner.trim() ? rehydrate(a.owner.trim()) : null;
          const p = (a?.priority === "high" || a?.priority === "low") ? a.priority : "medium";
          return { text, owner, priority: p as "high" | "medium" | "low" };
        })
        .filter((a: any) => a.text)
        .sort((a: any, b: any) => priorityRank[a.priority] - priorityRank[b.priority])
        .slice(0, 5);

    const detailedRaw = (parsed.detailed && typeof parsed.detailed === "object") ? parsed.detailed : {};

    const localBullets = localFallbackBullets(messages);
    const summary = {
      headline: typeof parsed.headline === "string" ? rehydrate(parsed.headline) : "",
      since_last_visit: {
        today: rehydrateArr(sinceRaw.today).slice(0, 8),
        yesterday: rehydrateArr(sinceRaw.yesterday).slice(0, 5),
        earlier: rehydrateArr(sinceRaw.earlier).slice(0, 5),
      },
      outstanding_actions: actionsArr,
      // Open questions removed — context is now folded into since_last_visit/discussion.
      outstanding_questions: [],
      detailed: {
        schedule_changes: rehydrateArr(detailedRaw.schedule_changes ?? parsed.schedule_changes).slice(0, 8),
        files_shared: rehydrateArr(detailedRaw.files_shared ?? parsed.files_shared).slice(0, 8),
        discussion: rehydrateArr(detailedRaw.discussion ?? parsed.important_updates).slice(0, 10),
      },
    };

    const hasUsefulSummary =
      summary.since_last_visit.today.length +
      summary.since_last_visit.yesterday.length +
      summary.since_last_visit.earlier.length +
      summary.outstanding_actions.length +
      summary.detailed.schedule_changes.length +
      summary.detailed.files_shared.length +
      summary.detailed.discussion.length > 0;
    if (!hasUsefulSummary && localBullets.length) {
      summary.headline = "Useful recent team updates were shared in the chat.";
      summary.since_last_visit.earlier = localBullets.slice(0, 6);
      summary.detailed.discussion = localBullets.slice(0, 8);
    }

    // Upsert cache — skip for explicit lookback windows so they don't pollute
    // the default "since last visit" cache entry.
    if (!validLookback) {
      await admin
        .from("chat_summaries")
        .upsert(
          {
            user_id: user.id,
            scope_type,
            scope_id,
            last_message_id: lastMessageId,
            message_count: messages.length,
            summary,
            model: `gemini-2.5-flash-lite:${RECAP_VERSION}`,
            expires_at: new Date(Date.now() + SUMMARY_TTL_HOURS * 60 * 60 * 1000).toISOString(),
          },
          { onConflict: "user_id,scope_type,scope_id,last_message_id" },
        );
    }

    const windowSinceIso = lookbackCutoffIso
      ?? (last_opened_at && !isNaN(Date.parse(last_opened_at)) ? new Date(last_opened_at as string).toISOString() : null)
      ?? (messages[0]?.created_at as string | undefined)
      ?? null;
    return new Response(
      JSON.stringify({
        summary,
        message_count: messages.length,
        last_message_id: lastMessageId,
        cached: false,
        used_fallback: !validLookback && !last_opened_at,
        lookback_hours: validLookback ? lookback_hours : null,
        window_since: windowSinceIso,
        truncated: validLookback && messages.length >= msgLimit,
        message_cap: validLookback ? msgLimit : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },

    );
  } catch (err) {
    console.error("[summarize-chat] crash", err);
    return new Response(JSON.stringify({ error: "server_error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
