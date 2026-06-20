// Creates a "club social event" originated by an association and fans it out
// to each invited member club. Each invited club gets a real event row
// (so RSVPs / notifications work normally), all linked back to a parent
// event via `association_event_id` for lineage and future updates.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  association_id: string;
  club_ids: string[];
  title: string;
  description?: string | null;
  event_date: string;          // ISO
  start_time?: string | null;  // ISO
  end_time?: string | null;    // ISO
  location_name?: string | null;
  address?: string | null;
  allow_guests?: boolean;
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "auth required" }, 401);
  const { data: userRes } = await supabase.auth.getUser(token);
  const callerId = userRes.user?.id;
  if (!callerId) return json({ error: "auth required" }, 401);

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.association_id || !body.title || !body.event_date) {
    return json({ error: "association_id, title and event_date are required" }, 400);
  }
  if (!Array.isArray(body.club_ids) || body.club_ids.length === 0) {
    return json({ error: "at least one club_id is required" }, 400);
  }

  // Authorise: caller must be a club_admin of the association.
  const { data: isAdmin } = await supabase.rpc("has_club_role", {
    _user_id: callerId,
    _club_id: body.association_id,
    _role: "club_admin",
  });
  if (!isAdmin) return json({ error: "only association admins can create club events" }, 403);

  const { data: assoc } = await supabase
    .from("clubs")
    .select("id, kind")
    .eq("id", body.association_id)
    .single();
  if (!assoc) return json({ error: "association not found" }, 404);
  if (assoc.kind !== "association") {
    return json({ error: "club is not an association" }, 400);
  }

  // Only fan out to clubs actually linked to the association.
  const { data: members } = await supabase
    .from("clubs")
    .select("id")
    .in("id", body.club_ids)
    .eq("parent_org_id", body.association_id);
  const allowedClubIds = new Set((members ?? []).map((c) => c.id));
  const invitedClubIds = body.club_ids.filter((c) => allowedClubIds.has(c));
  if (invitedClubIds.length === 0) {
    return json({ error: "no invited clubs belong to this association" }, 400);
  }

  const eventBase = {
    title: body.title,
    description: body.description ?? null,
    event_date: body.event_date,
    start_time: body.start_time ?? null,
    end_time: body.end_time ?? null,
    location_name: body.location_name ?? null,
    address: body.address ?? null,
    type: "social" as const,
    created_by: callerId,
    association_id: body.association_id,
    allow_guests: body.allow_guests ?? true,
  };

  // 1. Parent event lives on the association's own clubs row.
  const { data: parent, error: parentErr } = await supabase
    .from("events")
    .insert({ ...eventBase, club_id: body.association_id })
    .select("id")
    .single();
  if (parentErr || !parent) return json({ error: parentErr?.message ?? "parent insert failed" }, 500);

  // 2. Fan out one child event per invited club.
  const childRows = invitedClubIds.map((clubId) => ({
    ...eventBase,
    club_id: clubId,
    association_event_id: parent.id,
  }));
  const { error: childErr, data: children } = await supabase
    .from("events")
    .insert(childRows)
    .select("id, club_id");
  if (childErr) return json({ error: childErr.message, parent_event_id: parent.id }, 500);

  return json({
    ok: true,
    parent_event_id: parent.id,
    invited_clubs: invitedClubIds.length,
    child_event_ids: (children ?? []).map((c) => c.id),
  });
});
