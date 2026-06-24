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
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const body = (await req.json()) as Body;
    const { scope_type, scope_id, force } = body || ({} as Body);
    if (!scope_type || !scope_id || !SCOPE_TABLES[scope_type]) {
      return new Response(JSON.stringify({ error: "Invalid scope" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pro gate (skip for direct messages — no single club to evaluate).
    if (scope_type !== "direct") {
      const clubId = await getClubIdForScope(admin, scope_type, scope_id);
      if (clubId) {
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

    const transcript = messages
      .map((m: any) => {
        const name = nameMap.get(m.author_id) || "Someone";
        const ts = new Date(m.created_at).toISOString().slice(0, 16).replace("T", " ");
        const t = (m.text || "").replace(/\s+/g, " ").trim();
        const imgNote = m.image_url ? " [shared a photo]" : "";
        return `[${ts}] ${name}: ${t}${imgNote}`;
      })
      .join("\n");

    // Call Lovable AI Gateway
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `Summarise the following ${messages.length} chat messages from a sports-club ${scope_type} chat. Return JSON only.\n\n${transcript}`,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("[summarize-chat] ai error", aiRes.status, txt);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "credits_exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "ai_failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const raw: string = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const summary = {
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      important_updates: Array.isArray(parsed.important_updates) ? parsed.important_updates.slice(0, 5) : [],
      actions_needed: Array.isArray(parsed.actions_needed) ? parsed.actions_needed.slice(0, 5) : [],
      schedule_changes: Array.isArray(parsed.schedule_changes) ? parsed.schedule_changes.slice(0, 5) : [],
      people_mentioned: Array.isArray(parsed.people_mentioned) ? parsed.people_mentioned.slice(0, 8) : [],
      files_shared: Array.isArray(parsed.files_shared) ? parsed.files_shared.slice(0, 5) : [],
      unanswered_questions: Array.isArray(parsed.unanswered_questions) ? parsed.unanswered_questions.slice(0, 5) : [],
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
          model: "google/gemini-3-flash-preview",
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
