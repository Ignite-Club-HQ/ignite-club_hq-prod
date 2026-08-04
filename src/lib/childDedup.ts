import { supabase } from "@/integrations/supabase/client";

/**
 * The database dedupes same-name children on a team: when a newly created child
 * row is assigned to a team that already has a child with the same name, the
 * server links the creating parent as a guardian of the canonical child and
 * removes the freshly created duplicate row.
 *
 * Any client flow that keeps using the created child id after assigning it to a
 * team must re-resolve the id through this helper, otherwise follow-up writes
 * (guardian links, mini-league assignments, roster updates) target a row that no
 * longer exists.
 *
 * Returns the surviving child id, or null when nothing could be resolved.
 */
export async function resolveCanonicalChildId(
  childId: string,
  teamId: string | null | undefined,
  childName: string | null | undefined
): Promise<string | null> {
  const { data: stillExists } = await supabase
    .from("children")
    .select("id")
    .eq("id", childId)
    .maybeSingle();

  if (stillExists?.id) return stillExists.id;
  if (!teamId || !childName) return null;

  const { data: rosterRows } = await supabase
    .from("child_team_assignments")
    .select("child_id, children:child_id(name)")
    .eq("team_id", teamId);

  const target = childName.toLowerCase().trim();
  const match = (rosterRows as any[] | null)?.find(
    (row) => row?.children?.name?.toLowerCase().trim() === target
  );

  return match?.child_id ?? null;
}
