// Pro-gated write gateway for scheduled messages (Phase 3 pilot).
// Validates JWT + zod input, enforces Pro per chat scope, then writes
// using a user-scoped Supabase client (RLS still applies).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import {
  requireAnyClubPro,
  requireClubPro,
  requireTeamPro,
} from "../_shared/proGuard.ts";

const ChatType = z.enum(["team", "club", "group", "direct", "club_admin", "broadcast"]);
const Recurrence = z.enum(["none", "daily", "weekly", "monthly"]);

const CreateSchema = z.object({
  action: z.literal("create"),
  chat_type: ChatType,
  team_id: z.string().uuid().nullish(),
  club_id: z.string().uuid().nullish(),
  group_id: z.string().uuid().nullish(),
  conversation_id: z.string().uuid().nullish(),
  text: z.string().max(10_000).default(""),
  image_url: z.string().url().nullish(),
  reply_to_id: z.string().uuid().nullish(),
  scheduled_for: z.string().datetime(),
  recurrence: Recurrence.default("none"),
  recurrence_until: z.string().datetime().nullish(),
});

const UpdateSchema = z.object({
  action: z.literal("update"),
  id: z.string().uuid(),
  text: z.string().max(10_000).optional(),
  image_url: z.string().url().nullable().optional(),
  scheduled_for: z.string().datetime().optional(),
  recurrence: Recurrence.optional(),
  recurrence_until: z.string().datetime().nullable().optional(),
});

const CancelSchema = z.object({
  action: z.literal("cancel"),
  id: z.string().uuid(),
});

const BodySchema = z.discriminatedUnion("action", [CreateSchema, UpdateSchema, CancelSchema]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  let parsed;
  try {
    parsed = BodySchema.safeParse(await req.json());
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const body = parsed.data;

  // ---- Pro gate per scope ---------------------------------------------------
  async function gateForScope(args: {
    chat_type: z.infer<typeof ChatType>;
    team_id?: string | null;
    club_id?: string | null;
    group_id?: string | null;
  }): Promise<Response | null> {
    const { chat_type, team_id, club_id, group_id } = args;
    if (chat_type === "team" && team_id) {
      return await requireTeamPro(supabase, team_id, corsHeaders);
    }
    if ((chat_type === "club" || chat_type === "club_admin" || chat_type === "broadcast") && club_id) {
      return await requireClubPro(supabase, club_id, corsHeaders);
    }
    if (chat_type === "group" && group_id) {
      const { data: g } = await supabase
        .from("chat_groups")
        .select("club_id")
        .eq("id", group_id)
        .maybeSingle();
      if (g?.club_id) return await requireClubPro(supabase, g.club_id, corsHeaders);
      return await requireAnyClubPro(supabase, userId, corsHeaders);
    }
    // direct, or scopes missing the expected id → fall back to any-club-pro
    return await requireAnyClubPro(supabase, userId, corsHeaders);
  }

  // ---- Actions --------------------------------------------------------------
  if (body.action === "create") {
    const denied = await gateForScope(body);
    if (denied) return denied;

    const { data, error } = await supabase
      .from("scheduled_messages")
      .insert({
        author_id: userId,
        chat_type: body.chat_type,
        team_id: body.team_id ?? null,
        club_id: body.club_id ?? null,
        group_id: body.group_id ?? null,
        conversation_id: body.conversation_id ?? null,
        text: body.text ?? "",
        image_url: body.image_url ?? null,
        reply_to_id: body.reply_to_id ?? null,
        scheduled_for: body.scheduled_for,
        recurrence: body.recurrence,
        recurrence_until: body.recurrence_until ?? null,
      })
      .select("*")
      .single();
    if (error) {
      console.error("[scheduled-messages-write] insert error:", error);
      return json({ error: error.message }, 400);
    }
    return json({ row: data });
  }

  if (body.action === "update") {
    // Load existing row to determine scope for Pro check.
    const { data: existing, error: loadErr } = await supabase
      .from("scheduled_messages")
      .select("chat_type, team_id, club_id, group_id, status, author_id")
      .eq("id", body.id)
      .maybeSingle();
    if (loadErr || !existing) return json({ error: "not_found" }, 404);
    if (existing.author_id !== userId) return json({ error: "forbidden" }, 403);
    if (existing.status !== "pending") return json({ error: "not_pending" }, 409);

    const denied = await gateForScope({
      chat_type: existing.chat_type as z.infer<typeof ChatType>,
      team_id: existing.team_id,
      club_id: existing.club_id,
      group_id: existing.group_id,
    });
    if (denied) return denied;

    const patch: Record<string, unknown> = {};
    if (body.text !== undefined) patch.text = body.text;
    if (body.image_url !== undefined) patch.image_url = body.image_url;
    if (body.scheduled_for !== undefined) patch.scheduled_for = body.scheduled_for;
    if (body.recurrence !== undefined) patch.recurrence = body.recurrence;
    if (body.recurrence_until !== undefined) patch.recurrence_until = body.recurrence_until;

    const { data, error } = await supabase
      .from("scheduled_messages")
      .update(patch)
      .eq("id", body.id)
      .select("*")
      .single();
    if (error) {
      console.error("[scheduled-messages-write] update error:", error);
      return json({ error: error.message }, 400);
    }
    return json({ row: data });
  }

  if (body.action === "cancel") {
    // Cancel = delete. RLS already restricts to author + pending; no Pro gate
    // needed (users must always be able to cancel even if Pro lapsed).
    const { error } = await supabase
      .from("scheduled_messages")
      .delete()
      .eq("id", body.id);
    if (error) {
      console.error("[scheduled-messages-write] delete error:", error);
      return json({ error: error.message }, 400);
    }
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
