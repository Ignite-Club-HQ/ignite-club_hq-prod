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

const SYSTEM_PROMPT = `You are an AI Club Secretary summarising sports-club chat threads for a busy parent, player, coach or committee member. Your goal is to let them understand what changed, what needs attention and what remains unresolved in under 15 seconds.

You are given a transcript with timestamps. The user message will tell you the cutoff time for "their last visit". Group new updates by when they happened RELATIVE TO NOW: "today" (since 00:00 local today), "yesterday", "earlier" (older than yesterday but still within the window).

Prioritise updates that affect schedules, attendance, fixtures, training, availability, safety, compliance or club operations. Ignore casual banter, jokes, emoji-only messages and greetings.

An action is "outstanding" only if nobody in later messages confirms it is done, cancelled, or resolved. A question is "outstanding" only if nobody clearly answers it later in the transcript. An answer includes responses such as "yes", "no", "I can", "I'll do it", "done", "sorted", "confirmed", "ok", "sure", or any message that directly resolves the question. Drop anything that was already resolved in the transcript.

Return STRICT JSON only that matches this TypeScript type:
{
  "headline": string, // <=110 chars, one plain-text sentence describing the single most important thing the user needs to know
  "since_last_visit": {
    "today": string[],     // max 5 bullets, most important first
    "yesterday": string[], // max 3 bullets
    "earlier": string[]    // max 3 bullets ("Earlier this week")
  },
  "outstanding_actions": Array<{
    "text": string,                        // <=200 chars, the action itself
    "owner": string | null,                // who needs to act, if clearly identified, otherwise null
    "priority": "high" | "medium" | "low" // high = time-sensitive / affects upcoming event; low = nice to do
  }>, // max 5, sorted high -> low priority
  "outstanding_questions": string[], // max 5, only questions nobody has answered
  "detailed": {
    "schedule_changes": string[], // max 5 bullets — training/match time, date, location changes
    "files_shared": string[],     // max 5 bullets — photos / docs shared, with sender if useful
    "discussion": string[]        // max 5 bullets — other notable discussion that wasn't an action or schedule change
  }
}

Across "since_last_visit.today/yesterday/earlier" combined, return 4-8 bullets total — fewer only if the chat genuinely had less activity. Every array and object MUST exist (use [] or null). Keep bullets <=200 chars. Preserve concrete facts when stated in the transcript: who is doing what (referee, coach, volunteer, driver), opponent, kick-off time, venue/pitch, date, score, deadline. Names ARE allowed when the person owns a role, decision, action or assignment (e.g. "Sam is reffing the U10 game Sat 27 at 10am"). Only omit names for generic chat. Do not invent details. Output JSON only — no prose, no markdown.`;

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

    // Cache hit? (respect TTL) — skip cache entirely when user asked for a
    // bespoke time window so we don't return a narrower cached recap.
    if (!force && !validLookback) {
      const { data: cached } = await admin
        .from("chat_summaries")
        .select("summary, message_count, last_message_id, created_at, expires_at")
        .eq("user_id", user.id)
        .eq("scope_type", scope_type)
        .eq("scope_id", scope_id)
        .eq("last_message_id", lastMessageId)
        .maybeSingle();
      const stillFresh = cached?.expires_at ? new Date(cached.expires_at as string).getTime() > Date.now() : false;
      if (cached?.summary && stillFresh) {
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
    try {
      const clubIdForChildren = await getClubIdForScope(admin, scope_type, scope_id);
      if (clubIdForChildren) {
        const { data: clubParents } = await admin
          .from("user_roles")
          .select("user_id")
          .eq("club_id", clubIdForChildren);
        const parentIds = Array.from(new Set((clubParents || []).map((r: any) => r.user_id).filter(Boolean)));
        if (parentIds.length) {
          const { data: kids } = await admin
            .from("children")
            .select("name")
            .in("parent_id", parentIds);
          (kids || []).forEach((k: any) => {
            const n = (k?.name || "").trim();
            if (n) {
              // Use a distinct "Child N" label so the model knows it's a minor.
              const key = n;
              if (!pseudoByRealName.has(key)) {
                personCounter += 1;
                const p = `Child ${personCounter}`;
                pseudoByRealName.set(key, p);
                realByPseudo.set(p, key);
              }
              // Also pseudonymise first-name-only mentions
              const first = n.split(/\s+/)[0];
              if (first && first.length >= 2 && !pseudoByRealName.has(first)) {
                pseudoByRealName.set(first, pseudoByRealName.get(key)!);
              }
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
        const imgNote = m.image_url ? " [shared a photo]" : "";
        return { line: `[${ts}] ${speaker}: ${t}${imgNote}`, keep: !!(t || m.image_url) };
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
      return out;
    };
    const rehydrateArr = (arr: any): string[] =>
      Array.isArray(arr) ? arr.map((x) => (typeof x === "string" ? rehydrate(x) : "")) : [];

    const nowIso = new Date().toISOString();
    const lastVisitLine = validLookback
      ? `The user explicitly asked for a recap of the last ${lookback_hours} hours (since ${lookbackCutoffIso}). Treat the whole transcript as the relevant window — group by today / yesterday / earlier relative to now.`
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
          generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 700 },
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

    const summary = {
      headline: typeof parsed.headline === "string" ? rehydrate(parsed.headline) : "",
      since_last_visit: {
        today: rehydrateArr(sinceRaw.today).slice(0, 3),
        yesterday: rehydrateArr(sinceRaw.yesterday).slice(0, 2),
        earlier: rehydrateArr(sinceRaw.earlier).slice(0, 2),
      },
      outstanding_actions: actionsArr,
      outstanding_questions: rehydrateArr(parsed.outstanding_questions ?? parsed.unanswered_questions).slice(0, 5),
      detailed: {
        schedule_changes: rehydrateArr(detailedRaw.schedule_changes ?? parsed.schedule_changes).slice(0, 5),
        files_shared: rehydrateArr(detailedRaw.files_shared ?? parsed.files_shared).slice(0, 5),
        discussion: rehydrateArr(detailedRaw.discussion ?? parsed.important_updates).slice(0, 5),
      },
    };

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
            model: "gemini-2.5-flash-lite",
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
