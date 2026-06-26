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
        .select("message_id, classification, summary, topic, message_created_at")
        .eq("message_type", cfg.digestType)
        .eq("chat_scope_id", scope_id)
        .gte("message_created_at", sinceIso)
        .order("message_created_at", { ascending: true })
        .limit(digestLimit);

    let { data: digests, error: dErr } = await fetchDigests(cutoffIso);
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
      digests = retry.data ?? [];
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
    const buckets: Record<"today" | "yesterday" | "earlier", string[]> = { today: [], yesterday: [], earlier: [] };
    const actions: { text: string; owner: null; priority: "high" | "medium" | "low"; topic: string | null; idx: number }[] = [];
    const questions: { text: string; topic: string | null; idx: number }[] = [];
    const decisions: string[] = [];
    const social_count = { n: 0 };

    for (let i = 0; i < (digests || []).length; i++) {
      const d = digests[i];
      const ts = new Date(d.message_created_at);
      const bucket = bucketDay(now, ts);
      const s = (d.summary || "").trim();
      if (!s) continue;
      switch (d.classification) {
        case "action":
          actions.push({ text: s, owner: null, priority: "medium", topic: d.topic ?? null, idx: i });
          buckets[bucket].push(s);
          break;
        case "question":
          questions.push({ text: s, topic: d.topic ?? null, idx: i });
          buckets[bucket].push(s);
          break;
        case "decision":
          decisions.push(s);
          buckets[bucket].push(s);
          break;
        case "social":
          social_count.n += 1;
          break;
        case "info":
        default:
          buckets[bucket].push(s);
      }
    }

    // Outstanding actions/questions: drop ones that look resolved later.
    const ANSWER_HINTS = [
      "yes", "no", "yeah", "yep", "nope", "sure", "ok ", "okay", "will do",
      "i can", "i'll ", "ill ", "we can", "done", "sorted", "confirmed",
      "already", "taken care", "np ", "no worries", "absolutely",
      "i have", "ive ", "i am ", "im ", "i will ", "happy to",
      "not a problem", "all good", "got it", "on it", "i do", "we do",
      "i did", "we did", "me too", "agreed", "correct", "that's right",
      "that is right", "sounds good", "works for me", "fine by me",
      "perfect", "great", "good", "sure thing", "of course", "definitely",
      "certainly", "roger", "copy that", "10-4"
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
        // Same topic with answer-like language → likely answered.
        if (topic && later.topic && later.topic.toLowerCase() === topic.toLowerCase()) {
          if (looksLikeAnswer(later.summary || "")) return true;
        }
        // Decision or info that mentions the question's key phrase.
        if (later.classification === "decision" || later.classification === "info") {
          if (laterText.includes(k.slice(0, 25)) && laterText !== k) return true;
        }
      }
      return false;
    };
    const outstanding_actions = actions.filter((a) => !isResolved(a.text, a.topic, a.idx)).slice(0, 5);
    // Open questions: only surface from genuinely unread messages (since the
    // user's last visit). If we had to fall back to the 7-day floor because
    // there were no new messages, suppress the section entirely — questions
    // from previous history are not "open" to the user. Explicit lookback
    // (user clicked "Look further back") is honoured.
    const questionsFromUnreadOnly = validLookback || (hasLastOpened && !usedFallback);
    const outstanding_questions = questionsFromUnreadOnly
      ? questions.filter((q) => !isResolved(q.text, q.topic, q.idx)).slice(0, 5).map((q) => ({
          text: q.text,
          date: new Date(digests[q.idx].message_created_at).toISOString().slice(0, 10),
        }))
      : [];

    const headline = (() => {
      const newCount = (digests || []).length;
      if (decisions.length) return `${decisions.length} decision${decisions.length > 1 ? "s" : ""} and ${outstanding_actions.length} action${outstanding_actions.length === 1 ? "" : "s"} pending`;
      if (outstanding_actions.length) return `${outstanding_actions.length} action${outstanding_actions.length === 1 ? "" : "s"} need attention`;
      if (outstanding_questions.length) return `${outstanding_questions.length} open question${outstanding_questions.length === 1 ? "" : "s"}`;
      return `${newCount} new message${newCount === 1 ? "" : "s"} since your last visit`;
    })();

    const summary = {
      headline: headline.slice(0, 110),
      since_last_visit: {
        today: buckets.today.slice(0, 3),
        yesterday: buckets.yesterday.slice(0, 2),
        earlier: buckets.earlier.slice(0, 2),
      },
      outstanding_actions,
      outstanding_questions,
      detailed: {
        schedule_changes: decisions.slice(0, 5),
        files_shared: [],
        discussion: (digests || [])
          .filter((d: any) => d.classification === "info")
          .map((d: any) => d.summary)
          .filter(Boolean)
          .slice(0, 5),
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
