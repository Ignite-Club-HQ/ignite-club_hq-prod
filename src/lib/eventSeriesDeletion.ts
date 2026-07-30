/**
 * Event deletion outcomes for the six-second-undo delete workflow.
 *
 * The series delete is two database operations (children by `parent_event_id`,
 * then the root row). Each Supabase result must be inspected: if the children
 * delete is denied we must NOT attempt the root delete, and if the children
 * commit but the root fails the user must be told the series was only partially
 * deleted. Complete success is only reported when every write committed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DeleteType = "single" | "series";

export type EventDeletionOutcome =
  | { kind: "success" }
  | { kind: "failed"; message: string }
  | { kind: "partial-series"; message: string };

export interface DeletableEvent {
  id: string;
  is_recurring?: boolean | null;
  parent_event_id?: string | null;
}

/** The root id of the series the given event belongs to, for both shapes. */
export function resolveSeriesRootId(event: DeletableEvent): string {
  return event.parent_event_id ?? event.id;
}

export async function performEventDeletion(
  supabase: SupabaseClient<any, any, any>,
  event: DeletableEvent,
  deleteType: DeleteType,
): Promise<EventDeletionOutcome> {
  const isSeries =
    deleteType === "series" && (!!event.parent_event_id || !!event.is_recurring);

  if (!isSeries) {
    const { error } = await supabase.from("events").delete().eq("id", event.id);
    if (error) return { kind: "failed", message: error.message };
    return { kind: "success" };
  }

  const rootId = resolveSeriesRootId(event);

  const { error: childError } = await supabase
    .from("events")
    .delete()
    .eq("parent_event_id", rootId);
  // Children delete denied → stop immediately, never touch the root row.
  if (childError) return { kind: "failed", message: childError.message };

  const { error: rootError } = await supabase.from("events").delete().eq("id", rootId);
  if (rootError) {
    return { kind: "partial-series", message: rootError.message };
  }

  return { kind: "success" };
}
