---
name: Recurring event scope inheritance
description: DB trigger `events_inherit_parent_scope` auto-copies mini_league_id/team_id/club_id/restricted_to_roles from parent_event_id when missing on child events; prevents recurring children from silently widening audience to whole club.
type: feature
---
`BEFORE INSERT OR UPDATE OF parent_event_id` trigger on `public.events` calls `inherit_parent_event_scope()` (SECURITY DEFINER). When a child row's scope field is NULL but the parent has a value, the parent's value is copied in. Covers mini_league_id, team_id, club_id, restricted_to_roles.

Why it exists: EditEventPage convert-to-recurring path previously dropped `mini_league_id` on children, making them club-wide (everyone got pushed). Trigger is the defence-in-depth so any client path (Edit/Create/scripts/edge fns) can't repeat the bug. Client code should still pass these fields explicitly; the trigger is the safety net.

Backfill applied 2026-06-13 across all recurring children with parent-set scope.
