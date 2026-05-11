import { supabase } from "@/integrations/supabase/client";

export type QueuedRsvpStatus = "going" | "maybe" | "not_going";

export interface QueuedRsvp {
  id: string;
  eventId: string;
  userId: string;
  childId?: string | null;
  miniLeaguePlayerId?: string | null;
  status: QueuedRsvpStatus;
  notes?: string | null;
  // Existing rsvp row id if we're updating one we already had cached
  existingRsvpId?: string | null;
  queuedAt: string;
  retryCount: number;
}

const QUEUE_KEY = "ignite_rsvp_queue";
const MAX_RETRIES = 3;

export function getQueuedRsvps(): QueuedRsvp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedRsvp[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    console.error("Failed to save rsvp queue");
  }
}

export function queueRsvp(rsvp: Omit<QueuedRsvp, "id" | "queuedAt" | "retryCount">): QueuedRsvp {
  const queue = getQueuedRsvps();
  // De-dupe: replace any pending rsvp for the same (event, child/player or self)
  const filtered = queue.filter(
    (r) =>
      !(
        r.eventId === rsvp.eventId &&
        r.userId === rsvp.userId &&
        (r.childId || null) === (rsvp.childId || null) &&
        (r.miniLeaguePlayerId || null) === (rsvp.miniLeaguePlayerId || null)
      )
  );
  const queued: QueuedRsvp = {
    ...rsvp,
    id: `qrsvp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    queuedAt: new Date().toISOString(),
    retryCount: 0,
  };
  filtered.push(queued);
  saveQueue(filtered);
  return queued;
}

export function getQueuedRsvpsForEvent(eventId: string): QueuedRsvp[] {
  return getQueuedRsvps().filter((r) => r.eventId === eventId);
}

async function sendQueuedRsvp(r: QueuedRsvp): Promise<boolean> {
  try {
    if (r.existingRsvpId) {
      const { error } = await supabase
        .from("rsvps")
        .update({ status: r.status, notes: r.notes ?? null, source: "user" })
        .eq("id", r.existingRsvpId);
      if (error) {
        // If row no longer exists, fall through to insert
        if ((error as any).code !== "PGRST116") {
          console.error("rsvp update failed", error);
          return false;
        }
      } else {
        return true;
      }
    }

    const { error } = await supabase.from("rsvps").insert({
      event_id: r.eventId,
      user_id: r.userId,
      child_id: r.childId ?? null,
      mini_league_player_id: r.miniLeaguePlayerId ?? null,
      status: r.status,
      notes: r.notes ?? null,
      source: "user",
    });
    if (error) {
      console.error("rsvp insert failed", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("rsvp send error", e);
    return false;
  }
}

export async function syncQueuedRsvps(): Promise<{ synced: number; failed: number }> {
  const queue = getQueuedRsvps();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const remaining: QueuedRsvp[] = [];

  for (const r of queue) {
    const ok = await sendQueuedRsvp(r);
    if (ok) {
      synced++;
    } else {
      r.retryCount += 1;
      if (r.retryCount < MAX_RETRIES) {
        remaining.push(r);
      } else {
        failed++;
      }
    }
  }
  saveQueue(remaining);
  return { synced, failed };
}

export function getQueuedRsvpCount(): number {
  return getQueuedRsvps().length;
}
