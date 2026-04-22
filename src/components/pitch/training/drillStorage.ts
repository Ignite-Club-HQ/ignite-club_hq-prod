import { supabase } from "@/integrations/supabase/client";
import type { Drill, DrillFrame, DrillMetadata } from "@/components/pitch/training/types";

// ---------- Row shapes returned by Supabase ----------

interface DrillRow {
  id: string;
  owner_user_id: string;
  team_id: string | null;
  club_id: string | null;
  name: string;
  description: string | null;
  age_group: string | null;
  focus: string[];
  duration_minutes: number | null;
  players_required: number | null;
  equipment: string[];
  coaching_points: string[];
  progression: string | null;
  regression: string | null;
  tags: string[];
  visibility: "private" | "team" | "club";
  pitch_size: string;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

interface DrillFrameRow {
  id: string;
  drill_id: string;
  position: number;
  duration_ms: number;
  notes: string | null;
  objects: unknown;
  annotations: unknown;
}

export interface DrillSummary {
  id: string;
  name: string;
  ownerUserId: string;
  teamId: string | null;
  clubId: string | null;
  visibility: "private" | "team" | "club";
  ageGroup?: string;
  focus: string[];
  durationMinutes?: number;
  playersRequired?: number;
  thumbnailUrl?: string;
  updatedAt: string;
}

function rowToSummary(r: DrillRow): DrillSummary {
  return {
    id: r.id,
    name: r.name,
    ownerUserId: r.owner_user_id,
    teamId: r.team_id,
    clubId: r.club_id,
    visibility: r.visibility,
    ageGroup: r.age_group ?? undefined,
    focus: r.focus ?? [],
    durationMinutes: r.duration_minutes ?? undefined,
    playersRequired: r.players_required ?? undefined,
    thumbnailUrl: r.thumbnail_url ?? undefined,
    updatedAt: r.updated_at,
  };
}

function rowToDrill(r: DrillRow, frames: DrillFrame[]): Drill {
  const metadata: DrillMetadata = {
    ageGroup: r.age_group ?? undefined,
    focus: r.focus ?? [],
    durationMinutes: r.duration_minutes ?? undefined,
    playersRequired: r.players_required ?? undefined,
    equipment: r.equipment ?? [],
    coachingPoints: r.coaching_points ?? [],
    progression: r.progression ?? undefined,
    regression: r.regression ?? undefined,
  };
  return {
    id: r.id,
    name: r.name,
    metadata,
    frames,
    visibility: r.visibility,
    teamId: r.team_id ?? undefined,
    clubId: r.club_id ?? undefined,
  };
}

function frameRowToFrame(r: DrillFrameRow): DrillFrame {
  return {
    id: r.id,
    position: r.position,
    durationMs: r.duration_ms,
    notes: r.notes ?? undefined,
    objects: Array.isArray(r.objects) ? (r.objects as DrillFrame["objects"]) : [],
    annotations: Array.isArray(r.annotations) ? (r.annotations as DrillFrame["annotations"]) : [],
  };
}

// ---------- Library queries ----------

export type LibraryTab = "mine" | "team" | "recent";

export interface ListDrillsOptions {
  tab: LibraryTab;
  /** Restrict "team" tab to a specific team (optional) */
  teamId?: string;
  search?: string;
}

export async function listDrills(opts: ListDrillsOptions): Promise<DrillSummary[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];

  if (opts.tab === "recent") {
    const { data, error } = await supabase
      .from("drill_recent_uses")
      .select("drill_id, last_used_at, drills:drill_id(*)")
      .eq("user_id", userId)
      .order("last_used_at", { ascending: false })
      .limit(40);
    if (error) throw error;
    const drills = (data ?? [])
      .map((row: any) => row.drills as DrillRow | null)
      .filter((r): r is DrillRow => !!r);
    return filterAndSort(drills.map(rowToSummary), opts.search);
  }

  let query = supabase.from("drills").select("*").order("updated_at", { ascending: false }).limit(200);

  if (opts.tab === "mine") {
    query = query.eq("owner_user_id", userId);
  } else if (opts.tab === "team") {
    query = query.in("visibility", ["team", "club"]);
    if (opts.teamId) query = query.eq("team_id", opts.teamId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return filterAndSort((data ?? []).map((r) => rowToSummary(r as DrillRow)), opts.search);
}

function filterAndSort(items: DrillSummary[], search?: string): DrillSummary[] {
  if (!search) return items;
  const q = search.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (d) =>
      d.name.toLowerCase().includes(q) ||
      (d.ageGroup ?? "").toLowerCase().includes(q) ||
      d.focus.some((f) => f.toLowerCase().includes(q))
  );
}

// ---------- Single drill ----------

export async function loadDrill(drillId: string): Promise<Drill> {
  const [drillRes, framesRes] = await Promise.all([
    supabase.from("drills").select("*").eq("id", drillId).single(),
    supabase
      .from("drill_frames")
      .select("*")
      .eq("drill_id", drillId)
      .order("position", { ascending: true }),
  ]);
  if (drillRes.error) throw drillRes.error;
  if (framesRes.error) throw framesRes.error;

  const frames = ((framesRes.data ?? []) as DrillFrameRow[]).map(frameRowToFrame);
  return rowToDrill(drillRes.data as DrillRow, frames);
}

// ---------- Save / update ----------

export interface SaveDrillInput {
  id?: string; // omit to insert
  name: string;
  metadata: DrillMetadata;
  frames: DrillFrame[];
  visibility: "private" | "team" | "club";
  teamId?: string | null;
  clubId?: string | null;
}

export async function saveDrill(input: SaveDrillInput): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("You must be signed in to save drills");

  const drillPayload = {
    owner_user_id: userId,
    name: input.name.trim() || "Untitled drill",
    age_group: input.metadata.ageGroup ?? null,
    focus: input.metadata.focus ?? [],
    duration_minutes: input.metadata.durationMinutes ?? null,
    players_required: input.metadata.playersRequired ?? null,
    equipment: input.metadata.equipment ?? [],
    coaching_points: input.metadata.coachingPoints ?? [],
    progression: input.metadata.progression ?? null,
    regression: input.metadata.regression ?? null,
    visibility: input.visibility,
    team_id: input.visibility === "team" ? input.teamId ?? null : null,
    club_id: input.visibility === "club" ? input.clubId ?? null : null,
  };

  let drillId = input.id;
  if (drillId) {
    const { error } = await supabase.from("drills").update(drillPayload).eq("id", drillId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("drills")
      .insert(drillPayload)
      .select("id")
      .single();
    if (error) throw error;
    drillId = data.id as string;
  }

  // Replace frames atomically (simple approach: delete + insert).
  // Frames are small JSON; this avoids reconciling positions client-side.
  const { error: delErr } = await supabase.from("drill_frames").delete().eq("drill_id", drillId);
  if (delErr) throw delErr;

  if (input.frames.length > 0) {
    const framePayload = input.frames.map((f, i) => ({
      drill_id: drillId,
      position: i,
      duration_ms: f.durationMs ?? 1500,
      notes: f.notes ?? null,
      objects: f.objects,
      annotations: f.annotations,
    }));
    const { error: insErr } = await supabase.from("drill_frames").insert(framePayload);
    if (insErr) throw insErr;
  }

  return drillId;
}

export async function deleteDrill(drillId: string): Promise<void> {
  const { error } = await supabase.from("drills").delete().eq("id", drillId);
  if (error) throw error;
}

export async function stampRecentUse(drillId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;
  // Upsert (composite PK on user_id + drill_id)
  await supabase
    .from("drill_recent_uses")
    .upsert(
      { user_id: userId, drill_id: drillId, last_used_at: new Date().toISOString() },
      { onConflict: "user_id,drill_id" }
    );
}
