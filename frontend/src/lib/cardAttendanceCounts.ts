export type CardRsvpState = "going" | "maybe" | "not_going" | string;
export interface CardRsvpRow {
  account_id: string;
  child_id: string | null;
  state: CardRsvpState;
}
export interface CardAttendanceCounts { going: number; maybe: number; not_going: number }

/**
 * Event-card attendance totals.
 * Social events count everyone. Games/training count players: every child
 * RSVP, plus adult self-RSVPs (senior teams like C Grade) — except an adult
 * who also answered for a child on this event, who is acting as a parent.
 */
export function countCardAttendance(rows: CardRsvpRow[], isSocial: boolean): CardAttendanceCounts {
  const parents = new Set(rows.filter((r) => r.child_id).map((r) => r.account_id));
  const counts = { going: 0, maybe: 0, not_going: 0 };
  for (const r of rows) {
    if (!isSocial && !r.child_id && parents.has(r.account_id)) continue;
    if (r.state === "going") counts.going++;
    else if (r.state === "maybe") counts.maybe++;
    else if (r.state === "not_going") counts.not_going++;
  }
  return counts;
}
