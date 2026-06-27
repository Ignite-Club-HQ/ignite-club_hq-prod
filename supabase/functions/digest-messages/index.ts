// Background worker: classifies recent chat messages and writes a single,
// shared digest row per message into `public.message_digests`. This means
// "Catch me up" can be assembled for any user in a thread without re-running
// the LLM. Runs every 2 minutes via pg_cron. Idempotent on (message_type, message_id).
//
// Provider: Gemini Flash-Lite (cheap, fast). Falls back to no-op if key missing.
// Master switch: app_settings.digest_worker_enabled (jsonb true/false).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ScopeType = "team" | "club" | "group";
const SOURCES: { type: ScopeType; table: string; scopeCol: string }[] = [
  { type: "team", table: "team_messages", scopeCol: "team_id" },
  { type: "club", table: "club_messages", scopeCol: "club_id" },
  { type: "group", table: "group_messages", scopeCol: "group_id" },
];

const MAX_PER_RUN = 200;        // total messages digested per invocation
const BATCH_SIZE = 10;           // messages per LLM call
const LOOKBACK_HOURS = 48;       // only digest recent messages
const GEMINI_MODEL = "gemini-2.5-flash-lite";
const RECAP_VERSION = "recap-v12";
const DIGEST_PROVIDER = `gemini:${GEMINI_MODEL}:${RECAP_VERSION}`;

interface DigestRow {
  message_id: string;
  message_type: ScopeType;
  chat_scope_id: string;
  message_created_at: string;
  classification: "action" | "question" | "decision" | "social" | "info";
  summary: string;
  topic: string | null;
  mentions_user_ids: string[];
  provider: string;
}

// PII scrub — same patterns as summarize-chat-icp, kept tight.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function redactPII(raw: string, nameMap: Map<string, string>): string {
  let t = raw;
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  t = t.replace(/https?:\/\/\S+/gi, "[link]");
  t = t.replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone]");
  t = t.replace(/\b(?:\d[ -]?){13,19}\b/g, "[card]");
  // Replace real first names with pseudonyms — keeps mentions trackable without leaking identities.
  for (const [real, pseudo] of nameMap.entries()) {
    if (real.length < 2) continue;
    t = t.replace(new RegExp(`\\b${escapeRe(real)}\\b`, "gi"), pseudo);
  }
  return t.replace(/\s{2,}/g, " ").trim();
}

const SYSTEM_PROMPT = `You classify individual sports-club chat messages and produce a SYNTHESISED fact note for each.

You receive a JSON array of messages including created_at ISO timestamps. For EACH message return one object with:
- "message_id": echo back exactly
- "classification": one of "action"|"question"|"decision"|"social"|"info"
  - "action": someone is asked to do something, or commits to do something
  - "question": an unanswered or open question to the group
  - "decision": a concrete decision is announced (time changed, venue moved, role assigned)
  - "social": banter, thanks, emoji, greetings
  - "info": anything else useful (status updates, sharing files, FYI)
- "summary": ONE short third-person fact (<=140 chars) that says what the message MEANS. STRICT RULES:
  * NEVER start with a speaker name or "Name:" prefix.
  * NEVER copy the sentence structure or wording of the original message — paraphrase only.
  * NEVER wrap message text in quotes, and NEVER include URLs, www links, raw UUIDs, or internal route paths like "/events/abc-123" or "/messages/...".
  * NEVER use system-style CTAs ("View event", "Open link", "Tap here", "Notification sent"). Use parent-friendly wording.
  * If a message is a long copy/paste, rewrite it as one concise sentence (e.g. "Training was cancelled due to rain"; "Event details were shared").
  * For event messages, extract only the useful facts: date, cancellation, kick-off time, opponent, location, arrival time.
  * NEVER output a chat reply such as "Yep I can", "Also interested", "Sorry I can't", "Could someone please...".
  * Convert chat wording into a neutral club-secretary fact: who/what changed, who volunteered, who declined, what decision was made.
  * NO greetings, sign-offs, filler ("hi folks", "thanks", "sorry").
  * USE REAL NAMES: when the speaker is identified, refer to them by their actual first name. NEVER write "someone", "a player", "a parent", "one member", "another member", "a coach", or "a club member" if the speaker label gives you a name. Example: prefer "Jas volunteered to be linesperson" or "Bec is interested in the tournament" over "Someone volunteered" or "A player is interested". Drop the name only when the transcript truly does not identify who did the thing.
  * Prefer concrete nouns (venue, time, role, count) over pronouns.
  * Do NOT copy relative time words ("today", "tonight", "tomorrow", "yesterday", "this week", "next week") from the message. Resolve them against that message's created_at timestamp: "today" = created_at date, "tomorrow" = created_at + 1 day, "yesterday" = created_at - 1 day. Write an explicit weekday/date when useful; otherwise omit the time reference entirely.
  * You cannot see uploaded images or videos. Only mention photos/files when the sender wrote an explicit caption or description in the same message that says what the media/file is of or why it matters. Never infer image content from surrounding replies or thanks.
  * If the message only says a photo/video/file was shared and gives no description of what it shows or contains, classify it as "social" and set summary to "". Never write generic summaries like "A photo was shared in the team chat" or inferred captions like "photos of kids celebrating".
  * If the message has no informational value, classify as "social" and set summary to "".

- "topic": 1-3 word tag describing the subject (e.g. "linesperson", "venue change", "tournament interest"). Messages on the same subject MUST share the same topic string.

Examples:
- "Dan: Could someone please be linesperson today?" → summary "Dan asked for a linesperson for the match", topic "match official".
- "Andrew: Yep I can do it this week" → summary "Andrew volunteered to be linesperson this week", topic "match official".
- "Bec: Also interested depending on days" → summary "Bec is interested in the tournament if the dates work", topic "tournament interest".
- "Jas: Sorry Dan, I would have loved to" → summary "Jas declined the linesperson request, unavailable", topic "match official".

Return STRICT JSON: { "items": [ {...}, ... ] }. No prose, no markdown, no code fences.`;

async function callGemini(messages: any[], apiKey: string): Promise<DigestRow[] | null> {
  const userPrompt = `Classify these ${messages.length} messages:\n${JSON.stringify(
    messages.map((m) => ({ message_id: m.id, created_at: m.created_at, speaker: m.speaker, text: m.text })),
  )}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1500, temperature: 0.2 },
      }),
    },
  );
  if (!res.ok) {
    console.error("[digest-messages] gemini error", res.status, await res.text().catch(() => ""));
    return null;
  }
  const json = await res.json().catch(() => null);
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed?.items)) return null;
    return parsed.items as DigestRow[];
  } catch (e) {
    console.error("[digest-messages] parse failed", text.slice(0, 200));
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const t0 = Date.now();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    // Master switch + optional club allowlist for staged rollout
    const { data: settings } = await admin
      .from("app_settings")
      .select("key, value")
      .in("key", ["digest_worker_enabled", "digest_worker_club_allowlist"]);
    const flag = settings?.find((s: any) => s.key === "digest_worker_enabled")?.value;
    const allowRaw = settings?.find((s: any) => s.key === "digest_worker_club_allowlist")?.value;
    const enabled = flag === true || flag === "true";
    if (!enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!geminiKey) {
      return new Response(JSON.stringify({ ok: false, error: "no_gemini_key" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const allowedClubIds: string[] | null = Array.isArray(allowRaw) && allowRaw.length
      ? allowRaw.filter((x: any) => typeof x === "string")
      : null;

    // Resolve scope filters when an allowlist is set: only digest messages
    // whose owning club is in the allowlist.
    let allowedTeamIds: Set<string> | null = null;
    let allowedGroupIds: Set<string> | null = null;
    let allowedClubIdSet: Set<string> | null = null;
    if (allowedClubIds) {
      allowedClubIdSet = new Set(allowedClubIds);
      const [teamsRes, groupsRes] = await Promise.all([
        admin.from("teams").select("id").in("club_id", allowedClubIds),
        admin.from("chat_groups").select("id").in("club_id", allowedClubIds),
      ]);
      allowedTeamIds = new Set((teamsRes.data || []).map((r: any) => r.id));
      allowedGroupIds = new Set((groupsRes.data || []).map((r: any) => r.id));
    }

    const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
    let totalQueued = 0;
    let totalWritten = 0;
    const allBatches: { rows: any[]; type: ScopeType; scopeCol: string }[] = [];

    // Pull recent undigested messages from each source.
    for (const src of SOURCES) {
      if (totalQueued >= MAX_PER_RUN) break;
      const remaining = MAX_PER_RUN - totalQueued;
      // Existing digested ids (just message_ids) for this source within the window.
      const { data: existing } = await admin
        .from("message_digests")
        .select("message_id, provider")
        .eq("message_type", src.type)
        .gte("message_created_at", sinceIso);
      const seen = new Set(
        (existing || [])
          .filter((r: any) => String(r.provider || "").endsWith(`:${RECAP_VERSION}`))
          .map((r: any) => r.message_id),
      );

      const { data: rows, error } = await admin
        .from(src.table)
        .select(`id, text, author_id, created_at, ${src.scopeCol}`)
        .is("deleted_at", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(remaining * 2);
      if (error) {
        console.error("[digest-messages] fetch failed", src.type, error.message);
        continue;
      }
      let fresh = (rows || []).filter((r: any) => !seen.has(r.id) && (r.text || "").trim().length > 0);
      if (allowedClubIdSet) {
        if (src.type === "club") fresh = fresh.filter((r: any) => allowedClubIdSet!.has(r.club_id));
        else if (src.type === "team") fresh = fresh.filter((r: any) => allowedTeamIds!.has(r.team_id));
        else if (src.type === "group") fresh = fresh.filter((r: any) => allowedGroupIds!.has(r.group_id));
      }
      if (!fresh.length) continue;
      allBatches.push({ rows: fresh.slice(0, remaining), type: src.type, scopeCol: src.scopeCol });
      totalQueued += fresh.length;
    }

    // Author profile names for PII scrub
    const authorIds = Array.from(
      new Set(allBatches.flatMap((b) => b.rows.map((r) => r.author_id).filter(Boolean))),
    );
    const { data: profiles } = authorIds.length
      ? await admin.from("profiles").select("id, display_name").in("id", authorIds)
      : { data: [] };
    const profileName = new Map<string, string>();
    (profiles || []).forEach((p: any) => profileName.set(p.id, p.display_name || "Someone"));
    const nameMap = new Map<string, string>();
    let n = 0;
    for (const real of profileName.values()) {
      const first = (real || "").split(/\s+/)[0];
      if (first && first.length >= 2 && !nameMap.has(first)) {
        n += 1;
        nameMap.set(first, `Person ${n}`);
      }
    }

    // Run batches of BATCH_SIZE through Gemini in parallel (cap concurrency 4).
    const inserts: any[] = [];
    const flat: { src: { type: ScopeType; scopeCol: string }; row: any }[] = [];
    for (const b of allBatches) for (const r of b.rows) flat.push({ src: b, row: r });

    for (let i = 0; i < flat.length; i += BATCH_SIZE * 4) {
      const chunk = flat.slice(i, i + BATCH_SIZE * 4);
      const batches: typeof flat[] = [];
      for (let j = 0; j < chunk.length; j += BATCH_SIZE) batches.push(chunk.slice(j, j + BATCH_SIZE));

      const results = await Promise.all(
        batches.map((batch) =>
          callGemini(
            batch.map((x) => ({
              id: x.row.id,
              created_at: x.row.created_at,
              speaker: profileName.get(x.row.author_id) || "Someone",
              text: redactPII((x.row.text || "").slice(0, 600), nameMap),
            })),
            geminiKey,
          ),
        ),
      );

      results.forEach((items, idx) => {
        if (!items) return;
        const byId = new Map<string, any>();
        items.forEach((it: any) => byId.set(it.message_id, it));
        for (const x of batches[idx]) {
          const cls = byId.get(x.row.id);
          if (!cls) continue;
          const classification = ["action", "question", "decision", "social", "info"].includes(cls.classification)
            ? cls.classification : "info";
          inserts.push({
            message_id: x.row.id,
            message_type: x.src.type,
            chat_scope_id: x.row[x.src.scopeCol],
            message_created_at: x.row.created_at,
            classification,
            summary: typeof cls.summary === "string" ? cls.summary.slice(0, 280) : "",
            topic: typeof cls.topic === "string" ? cls.topic.slice(0, 60) : null,
            mentions_user_ids: [],
            provider: DIGEST_PROVIDER,
          });
        }
      });
    }

    if (inserts.length) {
      const { error: insErr, count } = await admin
        .from("message_digests")
        .upsert(inserts, { onConflict: "message_type,message_id", count: "exact" });
      if (insErr) console.error("[digest-messages] insert error", insErr.message);
      totalWritten = count ?? inserts.length;
    }

    console.log("[digest-messages] done", { queued: totalQueued, written: totalWritten, ms: Date.now() - t0 });
    return new Response(
      JSON.stringify({ ok: true, queued: totalQueued, written: totalWritten, ms: Date.now() - t0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[digest-messages] crash", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
