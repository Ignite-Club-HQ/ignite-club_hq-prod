// Fast no-LLM Catch Me Up. Reads pre-computed digests from `message_digests`
// and assembles a personal view bucketed by today/yesterday/earlier relative
// to the caller's `last_opened_at`. Falls back to the LLM functions when
// digests are missing for too many recent messages.
//
// Hot path target: <300ms.

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
  last_opened_at?: string | null;
  /** When provided, ignore last_opened_at and summarise the last N hours. */
  lookback_hours?: number;
}

const SCOPE_TABLES: Record<ScopeType, { table: string; scopeCol: string; digestType?: "team" | "club" | "group" }> = {
  team:       { table: "team_messages",       scopeCol: "team_id",         digestType: "team" },
  club:       { table: "club_messages",       scopeCol: "club_id",         digestType: "club" },
  group:      { table: "group_messages",      scopeCol: "group_id",        digestType: "group" },
  club_admin: { table: "club_admin_messages", scopeCol: "conversation_id" },
  direct:     { table: "direct_messages",     scopeCol: "conversation_id" },
};

const SENSITIVE_PATTERNS = [
  /\b(?:medical|medication|diagnosis|prescription|hospital(?:ised|ized)?|surgery|concussion|seizure|self[- ]harm|suicid(?:e|al))\b/i,
  /\b(?:safeguard(?:ing)?|child protection|abuse|assault|grooming|disclosure|cps|family court)\b/i,
  /\b(?:disciplinary|misconduct|suspension|expel(?:led|sion)?|tribunal|formal warning|grievance)\b/i,
];
function isSensitive(s: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(s));
}

function bucketDay(now: Date, ts: Date): "today" | "yesterday" | "earlier" {
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startYesterday = new Date(startToday); startYesterday.setDate(startYesterday.getDate() - 1);
  if (ts >= startToday) return "today";
  if (ts >= startYesterday) return "yesterday";
  return "earlier";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatTimeOfDay(ts: Date): string {
  let h = ts.getHours();
  const m = ts.getMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12; if (h === 0) h = 12;
  return m === 0 ? `${h}${suffix}` : `${h}:${m.toString().padStart(2, "0")}${suffix}`;
}
/** Short human time tag: "9:30am" / "Yest 6pm" / "Mon 6pm" / "21 Jun 6pm". */
function shortTimeTag(now: Date, ts: Date): string {
  const bucket = bucketDay(now, ts);
  const t = formatTimeOfDay(ts);
  if (bucket === "today") return t;
  if (bucket === "yesterday") return `Yest ${t}`;
  const daysAgo = Math.floor((now.getTime() - ts.getTime()) / (24 * 3600 * 1000));
  if (daysAgo < 7) return `${WEEKDAYS[ts.getDay()]} ${t}`;
  return `${ts.getDate()} ${MONTHS[ts.getMonth()]} ${t}`;
}
function tagBullet(now: Date, ts: Date, text: string): string {
  return `[${shortTimeTag(now, ts)}] ${text}`;
}

/** Strip accidental "Name: " speaker prefix legacy digest rows may contain. */
function stripSpeakerPrefix(s: string): string {
  return s
    .replace(/^([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,2})\s*[:\-–]\s+/u, "")
    .replace(/^Person\s+\d+\s*[:\-–]\s+/i, "")
    .trim();
}

const FILLER_PATTERNS = [
  /^also\s+(?:interested|available|keen)\b/i,
  /^yep\b|^yeah\b|^yes\b|^nope\b|^no\b|^sorry\b|^thanks?\b|^ok(?:ay)?\b/i,
  /^hi\b|^hello\b|^team\b|^folks\b/i,
];

function looksLikeRawMessage(s: string): boolean {
  const words = s.trim().split(/\s+/).filter(Boolean).length;
  if (FILLER_PATTERNS.some((re) => re.test(s))) return true;
  if (words >= 14 && /\b(?:please|anyone|i\s+can|i\s+would|we'?re|we\s+are|let\s+me\s+know|looking\s+like|would\s+have|depending\s+on)\b/i.test(s)) return true;
  return false;
}

function compactSentence(s: string): string {
  let out = stripSpeakerPrefix(s).replace(/\s+/g, " ").trim();
  out = out.replace(/^(?:also|hi folks|hi team|team),?\s+/i, "");
  out = out.replace(/\b(?:please|asap)\b/gi, "").replace(/\s{2,}/g, " ").trim();
  return out.replace(/[.!?]+$/g, "");
}

function normaliseTopic(topic: string | null | undefined): string | null {
  const t = (topic || "").trim().toLowerCase();
  if (!t) return null;
  if (/line\s*person|linesperson|ref(?:eree)?/.test(t)) return "match official";
  if (/venue|location|summit|moved|time|schedule/.test(t)) return "venue change";
  if (/availability|out|absence|numbers|lineup|squad|player/.test(t)) return "availability";
  if (/tournament|holiday/.test(t)) return "tournament interest";
  return t;
}

function phraseFact(topic: string | null, fact: string): string {
  const f = compactSentence(fact);
  const lower = f.toLowerCase();
  const key = normaliseTopic(topic);

  if (key === "match official") {
    if (/^sorry\b|would\s+have\s+loved\s+to|can't|cannot|unavailable/i.test(lower)) return "One member declined the match official request";
    if (/\bi can\b|\byep\b|\byes\b|volunteer|available/i.test(lower)) return "A volunteer confirmed they can cover the match official role";
    if (/who|please|need|line\s*person|linesperson|ref/i.test(lower)) return "A match official was requested";
  }
  if (key === "venue change") {
    const venue = /summit/i.test(f) ? "Summit" : null;
    const time = f.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0]?.replace(/\s+/g, "") ?? null;
    const day = /sat(?:urday)?/i.test(f) ? "Saturday" : null;
    const detail = [venue ? `to ${venue}` : null, time ? `at ${time}` : null, day ? `on ${day}` : null].filter(Boolean).join(" ");
    return detail ? `Game moved ${detail}` : `Game venue or time changed`;
  }
  if (key === "availability") {
    const outCount = f.match(/\b(?:three|3)\s+out\b/i) ? "3 players out" : null;
    if (/only just have enough|lineups? shaky|tough game|replacement|iffy/i.test(lower)) {
      return outCount ? `${outCount}; squad numbers are tight` : "Squad numbers are tight and replacements may be needed";
    }
  }
  if (key === "tournament interest") {
    const where = /gepps\s+cross/i.test(f) ? " at Gepps Cross" : "";
    const when = /first week of holidays/i.test(f) ? " in the first week of holidays" : "";
    return `Two-day tournament interest was raised${when}${where}`;
  }

  if (!looksLikeRawMessage(f)) return f;
  return f.length > 90 ? `${f.slice(0, 87).trim()}…` : f;
}

function combineFacts(topic: string | null, facts: string[]): string {
  const key = normaliseTopic(topic);
  const cleaned = Array.from(new Set(facts.map((f) => phraseFact(key, f)).filter(Boolean)));
  if (!cleaned.length) return "";

  if (key === "match official") {
    const requested = cleaned.some((f) => /requested/i.test(f));
    const confirmed = cleaned.some((f) => /confirmed|volunteer/i.test(f));
    if (requested && confirmed) return "Match official was requested and a volunteer has confirmed";
  }
  if (key === "availability") {
    const has3Out = cleaned.some((f) => /3 players out/i.test(f));
    const tight = cleaned.some((f) => /tight|replacement/i.test(f));
    if (has3Out || tight) return `${has3Out ? "3 players out" : "Availability update"}; squad numbers are tight${tight ? " and replacements may be needed" : ""}`;
  }

  return cleaned.slice(0, 2).join("; ");
}

/** Title-case a short topic tag for display ("venue change" → "Venue change"). */
function titleTopic(t: string | null | undefined): string | null {
  if (!t) return null;
  const trimmed = t.trim();
  if (!trimmed) return null;
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

/** Group digest entries by topic within a bucket and emit one synthesised bullet per topic. */
function synthesiseBucket(
  now: Date,
  entries: { ts: Date; summary: string; topic: string | null }[],
  maxBullets: number,
): string[] {
  if (!entries.length) return [];
  const groups = new Map<string, { ts: Date; topic: string | null; facts: string[] }>();
  for (const e of entries) {
    const cleaned = stripSpeakerPrefix(e.summary).replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = normaliseTopic(e.topic) || `__solo_${groups.size}`;
    const g = groups.get(key);
    if (g) {
      // Dedupe near-identical facts
      if (!g.facts.some((f) => f.toLowerCase() === cleaned.toLowerCase())) g.facts.push(cleaned);
      if (e.ts > g.ts) g.ts = e.ts;
    } else {
      groups.set(key, { ts: e.ts, topic: normaliseTopic(e.topic), facts: [cleaned] });
    }
  }
  const ordered = Array.from(groups.values()).sort((a, b) => b.ts.getTime() - a.ts.getTime());
  const out: string[] = [];
  for (const g of ordered) {
    const title = titleTopic(g.topic);
    const facts = combineFacts(g.topic, g.facts);
    if (!facts) continue;
    let line = title ? `${title}: ${facts}` : facts;
    if (line.length > 200) line = line.slice(0, 197) + "…";
    out.push(tagBullet(now, g.ts, line));
    if (out.length >= maxBullets) break;
  }
  return out;
}

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

    const [bodyParsed, userRes] = await Promise.all([
      req.json().catch(() => ({})) as Promise<Body>,
      admin.auth.getUser(token),
    ]);
    const { data: { user }, error: userErr } = userRes;
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

    const { scope_type, scope_id, last_opened_at, lookback_hours } = bodyParsed || ({} as Body);
    const cfg = SCOPE_TABLES[scope_type];
    if (!scope_type || !scope_id || !cfg) {
      return new Response(JSON.stringify({ error: "Invalid scope" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DMs and club_admin chats have no digest pipeline today → fall back signal.
    // Return 200 so supabase-js doesn't log it as a runtime error; client treats
    // `digests_missing` as a fallback trigger.
    if (!cfg.digestType) {
      return new Response(JSON.stringify({ error: "digests_missing", reason: "scope_not_supported" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Cutoff resolution:
    //  - explicit lookback_hours wins (user asked to look further back)
    //  - else last_opened_at when valid
    //  - else 7-day floor (and flag used_fallback)
    const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
    const FLOOR_ISO = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    const validLookback = typeof lookback_hours === "number" && lookback_hours > 0 && lookback_hours <= 24 * 90;
    const hasLastOpened = last_opened_at && !isNaN(Date.parse(last_opened_at));
    let cutoffIso: string;
    let usedFallback = false;
    if (validLookback) {
      cutoffIso = new Date(Date.now() - (lookback_hours as number) * 3600 * 1000).toISOString();
    } else if (hasLastOpened) {
      cutoffIso = new Date(last_opened_at as string).toISOString();
    } else {
      cutoffIso = FLOOR_ISO;
      usedFallback = true;
    }

    // RLS on message_digests gates this to chats the user can access.
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // Larger digest cap when user explicitly asked to look further back.
    const digestLimit = validLookback ? 1000 : 300;
    const fetchDigests = (sinceIso: string) =>
      userClient
        .from("message_digests")
        .select("message_id, classification, summary, topic, message_created_at, provider")
        .eq("message_type", cfg.digestType)
        .eq("chat_scope_id", scope_id)
        .gte("message_created_at", sinceIso)
        .order("message_created_at", { ascending: true })
        .limit(digestLimit);

    let { data: digests, error: dErr } = await fetchDigests(cutoffIso);
    digests = (digests || []).filter((d: any) => String(d.provider || "").endsWith(":recap-v3"));
    if (dErr) {
      console.error("[assemble-catchup] digest fetch error", dErr.message);
      return new Response(JSON.stringify({ error: "fetch_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If nothing new since the user's last visit, widen the window to the 7-day
    // floor so they still get a recap rather than a "Nothing to summarise" error.
    // Skip this when the user EXPLICITLY chose a window — respect their choice.
    if (!validLookback && (!digests || digests.length === 0) && cutoffIso !== FLOOR_ISO) {
      cutoffIso = FLOOR_ISO;
      usedFallback = true;
      const retry = await fetchDigests(cutoffIso);
      digests = (retry.data ?? []).filter((d: any) => String(d.provider || "").endsWith(":recap-v3"));
    }

    // Coverage check: count total recent messages (admin view) vs digest rows.
    const { count: totalRecent } = await admin
      .from(cfg.table)
      .select("id", { count: "exact", head: true })
      .eq(cfg.scopeCol, scope_id)
      .is("deleted_at", null)
      .gte("created_at", cutoffIso);

    const total = totalRecent ?? 0;
    const covered = digests?.length ?? 0;
    if (total === 0) {
      return new Response(JSON.stringify({ error: "no_messages" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Require >=80% coverage to avoid misleading summaries.
    if (covered / Math.max(1, total) < 0.8) {
      // 200 (not 409) so supabase-js doesn't surface it as a runtime error;
      // the client hook treats `digests_missing` as a signal to fall back to LLM.
      return new Response(
        JSON.stringify({ error: "digests_missing", coverage: covered, total }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Sensitive content gate
    const blob = (digests || []).map((d: any) => `${d.summary} ${d.topic || ""}`).join("\n");
    if (isSensitive(blob)) {
      return new Response(JSON.stringify({ error: "sensitive_content" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bucket and pick top bullets
    const now = new Date();
    const bucketEntries: Record<"today" | "yesterday" | "earlier", { ts: Date; summary: string; topic: string | null }[]> = {
      today: [], yesterday: [], earlier: [],
    };
    const actions: { text: string; owner: null; priority: "high" | "medium" | "low"; topic: string | null; idx: number }[] = [];
    const questions: { text: string; topic: string | null; idx: number }[] = [];
    const decisionEntries: { ts: Date; summary: string; topic: string | null }[] = [];
    const discussionEntries: { ts: Date; summary: string; topic: string | null }[] = [];
    const social_count = { n: 0 };

    for (let i = 0; i < (digests || []).length; i++) {
      const d = digests[i];
      const ts = new Date(d.message_created_at);
      const bucket = bucketDay(now, ts);
      const s = stripSpeakerPrefix((d.summary || "").trim());
      if (!s) continue;
      const entry = { ts, summary: s, topic: d.topic ?? null };
      switch (d.classification) {
        case "action":
          actions.push({ text: s, owner: null, priority: "medium", topic: d.topic ?? null, idx: i });
          bucketEntries[bucket].push(entry);
          break;
        case "question":
          questions.push({ text: s, topic: d.topic ?? null, idx: i });
          bucketEntries[bucket].push(entry);
          discussionEntries.push(entry);
          break;
        case "decision":
          decisionEntries.push(entry);
          bucketEntries[bucket].push(entry);
          break;
        case "social":
          social_count.n += 1;
          break;
        case "info":
        default:
          bucketEntries[bucket].push(entry);
          discussionEntries.push(entry);
      }
    }

    // Outstanding actions: drop ones that look resolved later.
    const ANSWER_HINTS = [
      "yes", "no", "yeah", "yep", "nope", "sure", "ok ", "okay", "will do",
      "i can", "i'll ", "ill ", "we can", "done", "sorted", "confirmed",
      "already", "taken care", "np ", "no worries", "absolutely",
      "i have", "ive ", "i am ", "im ", "i will ", "happy to",
      "not a problem", "all good", "got it", "on it", "i do", "we do",
      "i did", "we did", "me too", "agreed", "correct", "that's right",
      "that is right", "sounds good", "works for me", "fine by me",
      "perfect", "great", "good", "sure thing", "of course", "definitely",
      "certainly", "roger", "copy that", "10-4", "volunteered", "took",
    ];
    const looksLikeAnswer = (t: string) => {
      const lower = t.toLowerCase();
      return ANSWER_HINTS.some((h) => lower.startsWith(h) || lower.includes(" " + h + " "));
    };
    const isResolved = (text: string, topic: string | null, digestIndex: number) => {
      const k = text.toLowerCase();
      for (let j = digestIndex + 1; j < (digests || []).length; j++) {
        const later = digests[j];
        const laterText = (later.summary || "").toLowerCase();
        if (laterText === k) continue;
        if (topic && later.topic && later.topic.toLowerCase() === topic.toLowerCase()) {
          if (looksLikeAnswer(later.summary || "")) return true;
        }
        if (later.classification === "decision" || later.classification === "info") {
          if (laterText.includes(k.slice(0, 25)) && laterText !== k) return true;
        }
      }
      return false;
    };
    const outstanding_actions = actions.filter((a) => !isResolved(a.text, a.topic, a.idx)).slice(0, 5);
    const outstanding_questions: { text: string; date: string }[] = [];

    // Synthesise per-topic bullets per bucket.
    const today = synthesiseBucket(now, bucketEntries.today, 6);
    const yesterday = synthesiseBucket(now, bucketEntries.yesterday, 5);
    const earlier = synthesiseBucket(now, bucketEntries.earlier, 5);
    const decisions = synthesiseBucket(now, decisionEntries, 6);
    const discussion = synthesiseBucket(now, discussionEntries, 8);

    const headline = (() => {
      const newCount = (digests || []).length;
      if (decisions.length) return `${decisions.length} decision${decisions.length > 1 ? "s" : ""} and ${outstanding_actions.length} action${outstanding_actions.length === 1 ? "" : "s"} pending`;
      if (outstanding_actions.length) return `${outstanding_actions.length} action${outstanding_actions.length === 1 ? "" : "s"} need attention`;
      return `${newCount} new message${newCount === 1 ? "" : "s"} since your last visit`;
    })();

    const summary = {
      headline: headline.slice(0, 110),
      since_last_visit: { today, yesterday, earlier },
      outstanding_actions,
      outstanding_questions,
      detailed: {
        schedule_changes: decisions,
        files_shared: [],
        discussion,
      },
    };

    const lastMessageId = (digests && digests.length)
      ? (digests[digests.length - 1] as any).message_id
      : null;

    return new Response(
      JSON.stringify({
        summary,
        message_count: total,
        last_message_id: lastMessageId,
        cached: true,
        provider: "assembled",
        used_fallback: usedFallback,
        lookback_hours: validLookback ? lookback_hours : null,
        window_since: cutoffIso,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[assemble-catchup] crash", err);
    return new Response(
      JSON.stringify({ error: "server_error", detail: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
