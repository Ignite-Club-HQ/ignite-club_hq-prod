---
name: Club-scoped guardian visibility
description: Guardians of a child must only surface/notify inside clubs they belong to; child reuse on "Add player" is club-limited
type: feature
---

A `children` row is one human and may be shared across clubs, but `child_guardians` has no club scope, so raw reads leak parents from other clubs.

Rules:
- Never read `child_guardians` directly for roster display or reminder/RSVP recipient resolution. Use `public.club_scoped_child_guardians(p_child_ids uuid[], p_club_id uuid)`, which filters via `public.is_guardian_visible_in_club` (a role in the club or one of its teams, or an unaccepted pending invite).
- `create_child_for_parent_on_team` only reuses an existing same-name child when that child already has a team assignment in the target club; otherwise it creates a new club-local child. Do not restore the global reuse branch.
- Cross-club guardian links stay in the DB (valid at the original club) — they just stop surfacing elsewhere.
