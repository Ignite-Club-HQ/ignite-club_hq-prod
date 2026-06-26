// Mirror of `summarize-chat` that calls Qwen 3 32B on the Internet Computer's
// hosted LLM canister (w36hm-eqaaa-aaaal-qr76a-cai) instead of Gemini.
// All access gates, PII scrubbing, sensitive-content blocking and cache logic
// are identical to the Gemini version — only the LLM call differs.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HttpAgent, Actor } from "npm:@dfinity/agent@2.1.3";
import { Principal } from "npm:@dfinity/principal@2.1.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ScopeType = "team" | "club" | "group" | "club_admin" | "direct";

interface Body {
  scope_type: ScopeType;
  scope_id: string;
  force?: boolean;
  last_opened_at?: string | null;
  lookback_hours?: number;
}

const MAX_MESSAGES = 25;
// Qwen ingress window is tight; tier lookback caps by window length so a 30d
// recap doesn't silently truncate to a few days of an active thread.
const MAX_MESSAGES_LOOKBACK = 120; // legacy fallback
function lookbackMessageCap(hours: number): number {
  if (hours <= 24) return 80;
  if (hours <= 24 * 7) return 200;
  return 400; // up to 90d
}
const SUMMARY_TTL_HOURS = 48;


const LLM_CANISTER_ID = "w36hm-eqaaa-aaaal-qr76a-cai";
const IC_HOST = "https://icp-api.io";
// Qwen 3 32B produces higher-quality summaries than Llama 3.1 8B; keep it as
// the primary and only fall back to Llama if Qwen times out on the IC ingress
// window. MAX_MESSAGES is capped at 25 to keep Qwen within that window.
const ICP_MODEL = "qwen3:32b";
const ICP_FALLBACK_MODEL = "llama3.1:8b";

const idlFactory = ({ IDL }: any) => {
  const ChatMessageV1 = IDL.Record({
    role: IDL.Variant({ user: IDL.Null, assistant: IDL.Null, system: IDL.Null }),
    content: IDL.Text,
  });
  const ChatRequestV1 = IDL.Record({
    model: IDL.Text,
    messages: IDL.Vec(ChatMessageV1),
  });
  return IDL.Service({
    v0_chat: IDL.Func([ChatRequestV1], [IDL.Text], []),
  });
};

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
  return null;
}

const SYSTEM_PROMPT = `You are an AI Club Secretary summarising sports-club chat threads for a busy parent, player, coach or committee member. Your goal is to let them understand what changed, what needs attention and what remains unresolved in under 15 seconds.

You are given a transcript with timestamps. The user message will tell you the cutoff time for "their last visit". Group new updates by when they happened RELATIVE TO NOW: "today" (since 00:00 local today), "yesterday", "earlier" (older than yesterday but still within the window).

Prioritise updates that affect schedules, attendance, fixtures, training, availability, safety, compliance or club operations. Ignore casual banter, jokes, emoji-only messages and greetings.

An action is "outstanding" only if nobody in later messages confirms it is done, cancelled, or resolved. A question is "outstanding" only if nobody clearly answers it later in the transcript. An answer includes responses such as "yes", "no", "I can", "I'll do it", "done", "sorted", "confirmed", "ok", "sure", or any message that directly resolves the question. Drop anything that was already resolved in the transcript.

Return STRICT JSON only that matches this TypeScript type:
{
  "headline": string,
  "since_last_visit": {
    "today": string[],
    "yesterday": string[],
    "earlier": string[]
  },
  "outstanding_actions": Array<{
    "text": string,
    "owner": string | null,
    "priority": "high" | "medium" | "low"
  }>,
  "outstanding_questions": Array<{ "text": string, "date": string }>, // max 5; ONLY include questions asked WITHIN the "since their last visit" window that are still unanswered. Exclude any question whose message timestamp is OLDER than the user's last-visit cutoff, even if it appears unanswered. Also exclude questions answered later in the transcript (yes/no/will do/done/sorted/I'll do it/on it/confirmed/etc.). The "date" field must be the YYYY-MM-DD extracted from the transcript timestamp of the message that asked the question.
  "detailed": {
    "schedule_changes": string[],
    "files_shared": string[],
    "discussion": string[]
  }
}

Across "since_last_visit.today/yesterday/earlier" combined, return 4-8 bullets total — fewer only if the chat genuinely had less activity. Headline <=110 chars. Every array and object MUST exist (use [] or null). Keep bullets <=200 chars. Preserve concrete facts when they are stated in the transcript: who is doing what (referee, coach, volunteer, driver), opponent name, kick-off time, venue/pitch, date, score, deadline. Names ARE allowed when the person owns a role, decision, action or assignment (e.g. "Sam is reffing the U10 game Sat 27 at 10am"). Only omit names for generic chat. Do not invent details. Output JSON only — no prose, no markdown, no code fences.`;

// Extract JSON object from a possibly-noisy LLM string.
function extractJson(s: string): any {
  if (!s) return {};
  let cleaned = s.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Strip closed <think>…</think> blocks (Qwen 3 reasoning prefix)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // Strip an UNCLOSED leading <think> tail — Qwen can run out of tokens
  // mid-reasoning and never emit </think>; the JSON (if any) is later.
  if (/^<think>/i.test(cleaned)) {
    const firstBrace = cleaned.indexOf("{");
    if (firstBrace > 0) cleaned = cleaned.slice(firstBrace).trim();
    else cleaned = cleaned.replace(/^<think>[\s\S]*$/i, "").trim();
  }
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* ignore */ }
  }
  return {};
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
    const tPre = Date.now();

    // Parse body and authenticate user in parallel.
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
    const { scope_type, scope_id, force, last_opened_at, lookback_hours } = bodyParsed || ({} as Body);
    if (!scope_type || !scope_id || !SCOPE_TABLES[scope_type]) {
      return new Response(JSON.stringify({ error: "Invalid scope" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const validLookback = typeof lookback_hours === "number" && lookback_hours > 0 && lookback_hours <= 24 * 90;
    const lookbackCutoffIso = validLookback
      ? new Date(Date.now() - (lookback_hours as number) * 3600 * 1000).toISOString()
      : null;
    const msgLimit = validLookback ? lookbackMessageCap(lookback_hours as number) : MAX_MESSAGES;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { table, scopeCol } = SCOPE_TABLES[scope_type];

    let baseMsgQuery = userClient
      .from(table)
      .select("id, text, author_id, created_at, image_url")
      .eq(scopeCol, scope_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(msgLimit);
    if (lookbackCutoffIso) baseMsgQuery = baseMsgQuery.gte("created_at", lookbackCutoffIso);

    // Fire profile, clubId, messages, and the IC agent in parallel.
    const [profRes, clubId, msgRes, agentPromise] = await Promise.all([
      admin.from("profiles").select("ai_catch_up_acknowledged_at").eq("id", user.id).maybeSingle(),
      scope_type === "direct" ? Promise.resolve(null) : getClubIdForScope(admin, scope_type, scope_id),
      baseMsgQuery,
      HttpAgent.create({ host: IC_HOST }), // warm transport
    ]);

    if (!(profRes.data as any)?.ai_catch_up_acknowledged_at) {
      return new Response(JSON.stringify({ error: "disclosure_required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // With clubId known, fan out remaining access checks in parallel.
    let isJuniorClub = false;
    if (clubId) {
      const [juniorRes, isAppAdminRes, rolesRes, clubRowRes, hasProRes] = await Promise.all([
        admin.from("teams").select("id").eq("club_id", clubId).eq("team_type", "junior").limit(1),
        admin.rpc("has_role", { _user_id: user.id, _role: "app_admin" }),
        admin.from("user_roles").select("role").eq("user_id", user.id).eq("club_id", clubId)
          .in("role", ["club_admin", "committee_member"]),
        admin.from("clubs").select("ai_catch_up_enabled").eq("id", clubId).maybeSingle(),
        admin.rpc("has_active_pro_for_club", { _club_id: clubId }),
      ]);

      isJuniorClub = Array.isArray(juniorRes.data) && juniorRes.data.length > 0;
      const isAppAdmin = isAppAdminRes.data === true;
      const roleList = (rolesRes.data || []).map((r: any) => r.role);
      const isClubAdmin = roleList.includes("club_admin") || roleList.includes("committee_member");
      const isStrictClubAdmin = roleList.includes("club_admin");
      const adminBypass = isAppAdmin
        || (isJuniorClub ? isStrictClubAdmin : isClubAdmin);

      if (!adminBypass && (clubRowRes.data as any)?.ai_catch_up_enabled === false) {
        return new Response(JSON.stringify({ error: "feature_disabled", club_id: clubId }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (hasProRes.data !== true) {
        return new Response(JSON.stringify({ error: "pro_required", club_id: clubId }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: msgRows, error: msgErr } = msgRes;
    if (msgErr) {
      console.error("[summarize-chat-icp] msg fetch failed", msgErr);
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
    console.log("[summarize-chat-icp] preflight done", { ms: Date.now() - tPre, msgs: messages.length });

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

    const sensitiveHit = detectSensitive(messages.map((m: any) => m.text || "").join("\n"));
    if (sensitiveHit) {
      return new Response(
        JSON.stringify({ error: "sensitive_content", category: sensitiveHit }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authorIds = [...new Set(messages.map((m: any) => m.author_id).filter(Boolean))];
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", authorIds.length ? authorIds : ["00000000-0000-0000-0000-000000000000"]);
    const nameMap = new Map<string, string>();
    (profiles || []).forEach((p: any) => nameMap.set(p.id, p.display_name || "Someone"));

    const pseudoByRealName = new Map<string, string>();
    const realByPseudo = new Map<string, string>();
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
    Array.from(nameMap.values()).forEach((n) => getPseudo(n));

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
              const key = n;
              if (!pseudoByRealName.has(key)) {
                personCounter += 1;
                const p = `Child ${personCounter}`;
                pseudoByRealName.set(key, p);
                realByPseudo.set(p, key);
              }
              const first = n.split(/\s+/)[0];
              if (first && first.length >= 2 && !pseudoByRealName.has(first)) {
                pseudoByRealName.set(first, pseudoByRealName.get(key)!);
              }
            }
          });
        }
      }
    } catch (e) {
      console.error("[summarize-chat-icp] child name seeding failed", e);
    }

    Array.from(nameMap.values()).forEach((full) => {
      const first = (full || "").trim().split(/\s+/)[0];
      if (first && first.length >= 2 && !pseudoByRealName.has(first)) {
        pseudoByRealName.set(first, pseudoByRealName.get(full)!);
      }
    });

    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const STREET_WORDS =
      "(?:st|street|rd|road|ave|avenue|dr|drive|ln|lane|ct|court|cres|crescent|pl|place|blvd|boulevard|way|terr|terrace|hwy|highway|cl|close|pde|parade|sq|square)";
    const AU_STATES = "(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)";
    const redactPII = (raw: string): string => {
      let t = raw;
      t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "");
      t = t.replace(/https?:\/\/\S+/gi, "");
      t = t.replace(/\bwww\.[^\s]+/gi, "");
      t = t.replace(/\b[a-z0-9-]+\.(?:com|net|org|io|co|uk|au|ai)(?:\/\S*)?\b/gi, "");
      t = t.replace(/(^|\s)@[\w.]{2,}/g, "$1");
      t = t.replace(
        new RegExp(`\\b\\d{1,5}[a-z]?(?:\\/\\d{1,5})?\\s+[A-Z][\\w'-]+(?:\\s+[A-Z][\\w'-]+)?\\s+${STREET_WORDS}\\b\\.?`, "gi"),
        "",
      );
      t = t.replace(/\bP\.?O\.?\s*Box\s+\d+\b/gi, "");
      t = t.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g, "");
      t = t.replace(/\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/g, "");
      t = t.replace(new RegExp(`\\b${AU_STATES}\\s+\\d{4}\\b`, "g"), "");
      t = t.replace(/\b\d{5}(?:-\d{4})?\b/g, "");
      t = t.replace(/\b(?:\d[ -]?){13,19}\b/g, "");
      t = t.replace(/\+?\d[\d\s().-]{6,}\d/g, "");
      t = t.replace(/\b\d{2}-\d{2}-\d{2}\b/g, "");
      t = t.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "");
      t = t.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, "");
      t = t.replace(/\b(?:dob|d\.o\.b\.?|born)[\s:]*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/gi, "");
      t = t.replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:19|20)\d{2}\b/g, "");
      t = t.replace(/\b\d{6,}\b/g, "");
      const names = Array.from(pseudoByRealName.keys()).sort((a, b) => b.length - a.length);
      for (const name of names) {
        if (name.length < 2) continue;
        const re = new RegExp(`\\b${escapeRe(name)}\\b`, "gi");
        t = t.replace(re, pseudoByRealName.get(name)!);
      }
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

    const rehydrate = (s: string): string => {
      if (!s) return s;
      let out = s;
      const pseudos = Array.from(realByPseudo.keys()).sort((a, b) => b.length - a.length);
      for (const p of pseudos) {
        const re = new RegExp(`\\b${escapeRe(p)}\\b`, "g");
        out = out.replace(re, realByPseudo.get(p)!);
      }
      return out;
    };
    const rehydrateArr = (arr: any): string[] =>
      Array.isArray(arr) ? arr.map((x) => (typeof x === "string" ? rehydrate(x) : "")) : [];
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
      ? `The user explicitly asked for a recap of the last ${lookback_hours} hours (since ${lookbackCutoffIso}). Treat the whole transcript as the relevant window — group by today / yesterday / earlier relative to now.`
      : last_opened_at
      ? `The user last opened this thread at ${new Date(last_opened_at).toISOString()}. Treat anything newer than that as "since their last visit".`
      : `The user has not opened this thread recently. Treat the whole transcript as "since their last visit".`;
    // `/no_think` disables Qwen's reasoning preamble so the token budget goes
    // straight to JSON output (Llama ignores it harmlessly).
    const userPrompt =
      `/no_think\nNow is ${nowIso}. ${lastVisitLine}\n\nSummarise the following ${messages.length} chat messages from a sports-club ${scope_type} chat. Return JSON only matching the schema in the system instructions. Do not include <think> blocks, prose, or code fences.\n\n${transcript}`;

    // Call ICP — Qwen 3 32B as primary (best quality), Llama 3.1 8B as
    // fallback if Qwen times out. The DFINITY canister occasionally rejects
    // with "Reject code: 4 Timeout" under load.
    let raw = "";
    let modelUsed = ICP_MODEL;
    const callIcp = async (model: string): Promise<string> => {
      const agent = await agentPromise; // warmed in preflight Promise.all
      const actor: any = Actor.createActor(idlFactory, {
        agent,
        canisterId: Principal.fromText(LLM_CANISTER_ID),
      });
      const candidMessages = [
        { role: { system: null }, content: SYSTEM_PROMPT },
        { role: { user: null }, content: userPrompt },
      ];
      return await actor.v0_chat({ model, messages: candidMessages });
    };
    const t0 = Date.now();
    try {
      raw = await callIcp(ICP_MODEL);
      console.log("[summarize-chat-icp] primary ok", { model: ICP_MODEL, ms: Date.now() - t0, messages: messages.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = /Timeout|Reject code:\s*4/i.test(msg);
      console.error("[summarize-chat-icp] primary call failed", { model: ICP_MODEL, isTimeout, ms: Date.now() - t0, msg });
      try {
        modelUsed = ICP_FALLBACK_MODEL;
        const tf = Date.now();
        raw = await callIcp(modelUsed);
        console.log("[summarize-chat-icp] fallback succeeded", { model: modelUsed, ms: Date.now() - tf });
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        console.error("[summarize-chat-icp] fallback call failed", { model: modelUsed, msg: msg2 });
        return new Response(JSON.stringify({ error: isTimeout ? "ai_timeout" : "ai_failed", detail: msg2, provider: "icp" }), {
          status: isTimeout ? 504 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const parsed = extractJson(raw);
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
      // Open questions only from the unread window — suppress entirely when
      // there is no last-visit cutoff and no explicit lookback.
      outstanding_questions: (validLookback || last_opened_at)
        ? rehydrateArr(parsed.outstanding_questions ?? parsed.unanswered_questions).slice(0, 5)
        : [],
      detailed: {
        schedule_changes: rehydrateArr(detailedRaw.schedule_changes ?? parsed.schedule_changes).slice(0, 5),
        files_shared: rehydrateArr(detailedRaw.files_shared ?? parsed.files_shared).slice(0, 5),
        discussion: rehydrateArr(detailedRaw.discussion ?? parsed.important_updates).slice(0, 5),
      },
    };

    if (!summary.headline) {
      console.error("[summarize-chat-icp] empty/invalid model output", raw.slice(0, 400));
      return new Response(
        JSON.stringify({ error: "ai_invalid_output", provider: "icp", model: modelUsed, raw_preview: (raw || "").slice(0, 200) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Don't pollute the cache with lookback-window summaries — they're
    // bespoke time windows the user explicitly requested.
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
            model: `icp:${modelUsed}`,
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
        provider: "icp",
        model: modelUsed,
        lookback_hours: validLookback ? lookback_hours : null,
        window_since: windowSinceIso,
        truncated: validLookback && messages.length >= msgLimit,
        message_cap: validLookback ? msgLimit : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[summarize-chat-icp] crash", err);
    return new Response(JSON.stringify({ error: "server_error", detail: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
