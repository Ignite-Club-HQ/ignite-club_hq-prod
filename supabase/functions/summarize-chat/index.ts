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
}

const MAX_MESSAGES = 80;

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

const SYSTEM_PROMPT = `You summarise sports-club chat threads for a busy parent, player, coach or committee member who is catching up.

Focus only on actionable, factual information for the club: training changes, match times, locations, RSVP requests, volunteer requests, player availability, coach instructions, committee decisions, files/photos shared, and questions still unanswered.

Ignore casual banter, jokes, emoji-only messages, and greetings unless they directly affect an action or decision.

Return STRICT JSON only that matches this TypeScript type:
{
  "headline": string, // one short sentence (<= 110 chars) describing the most important update overall. Plain text only.
  "important_updates": string[], // bullets, max 5
  "actions_needed": string[],    // bullets, max 5; include who needs to act if known
  "schedule_changes": string[],  // bullets, max 5; training/match time, date, location changes
  "people_mentioned": string[],  // names mentioned in an actionable context, max 8
  "files_shared": string[],      // short description per file/photo shared, max 5
  "unanswered_questions": string[] // open questions nobody answered, max 5
}

Every array MUST exist (use [] if nothing applies). Keep each bullet short (<= 140 chars). Do not invent details that are not in the messages. Do not include casual banter. Output JSON only — no prose, no markdown.`;

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
    const { scope_type, scope_id, force } = body || ({} as Body);
    if (!scope_type || !scope_id || !SCOPE_TABLES[scope_type]) {
      return new Response(JSON.stringify({ error: "Invalid scope" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pro gate + club-level AI Catch Me Up toggle (skip for direct messages — no single club to evaluate).
    if (scope_type !== "direct") {
      const clubId = await getClubIdForScope(admin, scope_type, scope_id);
      if (clubId) {
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
        const adminBypass = isAppAdmin === true || isClubAdmin;

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
    const { data: msgRows, error: msgErr } = await userClient
      .from(table)
      .select("id, text, author_id, created_at, image_url")
      .eq(scopeCol, scope_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_MESSAGES);

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

    // Cache hit?
    if (!force) {
      const { data: cached } = await admin
        .from("chat_summaries")
        .select("summary, message_count, last_message_id, created_at")
        .eq("user_id", user.id)
        .eq("scope_type", scope_type)
        .eq("scope_id", scope_id)
        .eq("last_message_id", lastMessageId)
        .maybeSingle();
      if (cached?.summary) {
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

    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Strip identifying PII outright (not placeholder) before sending to Gemini.
    // We deliberately KEEP venue / location names (Bridgewater Oval, etc.) because
    // they're useful context for sport summaries. We REMOVE: emails, phone numbers,
    // URLs, street addresses (number + street word), postcodes (UK/AU/US/CA),
    // long digit runs (card / account / licence numbers), IBAN-like tokens,
    // dates of birth, and @handles.
    const STREET_WORDS =
      "(?:st|street|rd|road|ave|avenue|dr|drive|ln|lane|ct|court|cres|crescent|pl|place|blvd|boulevard|way|terr|terrace|hwy|highway|cl|close|pde|parade|sq|square)";
    const redactPII = (raw: string): string => {
      let t = raw;
      // Emails
      t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "");
      // URLs (full + bare www domain)
      t = t.replace(/https?:\/\/\S+/gi, "");
      t = t.replace(/\bwww\.[^\s]+/gi, "");
      // Social @handles
      t = t.replace(/(^|\s)@[\w.]{2,}/g, "$1");
      // Street addresses: "12 Smith Street", "4/22 Park Rd"
      t = t.replace(
        new RegExp(`\\b\\d{1,5}[a-z]?(?:\\/\\d{1,5})?\\s+[A-Z][\\w'-]+(?:\\s+[A-Z][\\w'-]+)?\\s+${STREET_WORDS}\\b\\.?`, "gi"),
        "",
      );
      // PO Box
      t = t.replace(/\bP\.?O\.?\s*Box\s+\d+\b/gi, "");
      // Postcodes — UK (SW1A 1AA), US ZIP, CA (A1A 1A1)
      t = t.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g, "");
      t = t.replace(/\b\d{5}(?:-\d{4})?\b/g, "");
      t = t.replace(/\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/g, "");
      // Phone numbers (loose: 7+ digits with optional separators, allow leading +)
      t = t.replace(/\+?\d[\d\s().-]{6,}\d/g, "");
      // IBAN-ish (2 letters + 13+ alnum)
      t = t.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, "");
      // Dates of birth ("dob 12/03/1990", "born 12-3-90")
      t = t.replace(/\b(?:dob|d\.o\.b\.?|born)[\s:]*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/gi, "");
      // Remaining long digit runs (account / licence / member numbers)
      t = t.replace(/\b\d{6,}\b/g, "");
      // Replace known real names with pseudonyms (longest first to avoid partial overlaps)
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

    const userPrompt =
      `Summarise the following ${messages.length} chat messages from a sports-club ${scope_type} chat. Return JSON only.\n\n${transcript}`;

    const GEMINI_MODEL = "gemini-2.0-flash";
    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
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

    const summary = {
      headline: typeof parsed.headline === "string" ? rehydrate(parsed.headline) : "",
      important_updates: rehydrateArr(parsed.important_updates).slice(0, 5),
      actions_needed: rehydrateArr(parsed.actions_needed).slice(0, 5),
      schedule_changes: rehydrateArr(parsed.schedule_changes).slice(0, 5),
      people_mentioned: rehydrateArr(parsed.people_mentioned).slice(0, 8),
      files_shared: rehydrateArr(parsed.files_shared).slice(0, 5),
      unanswered_questions: rehydrateArr(parsed.unanswered_questions).slice(0, 5),
    };

    // Upsert cache
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
          model: "gemini-2.0-flash",
        },
        { onConflict: "user_id,scope_type,scope_id,last_message_id" },
      );

    return new Response(
      JSON.stringify({
        summary,
        message_count: messages.length,
        last_message_id: lastMessageId,
        cached: false,
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
