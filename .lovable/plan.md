# Phase 1 — Default Training RSVP

Ship the foundational "set & forget" RSVP for training, scoped per child per team. Coaches see who has actually confirmed vs who is just on the default. No holidays, no nudges, no match support yet — those come in later phases.

---

## What parents experience

1. On any team's training event, parents see a one-time prompt under the RSVP buttons:
   > **"Teddy goes to most trainings?"** [Yes, default to Going] [No thanks]
   - Shown once per child per team, after they've answered 2+ trainings the same way.
   - Dismissible; reappears only if behaviour pattern resets.

2. In each child's profile (and the team's RSVP screen), a new control:
   > **Default training RSVP**: Going / Not going / Ask me each time
   - Editable any time. Changing it does NOT touch existing RSVPs.

3. When a new training event is created (or the default is set), the child's RSVP is **pre-filled** as `going` with a `source = 'default'` flag. Parent can override with one tap — override is sticky.

4. Event card shows two states for own children:
   - **Confirmed Going** (parent tapped explicitly) — solid green dot
   - **Default Going** (auto from default) — hollow green dot + small "Auto" chip
   - Tapping "Auto" chip opens a tooltip: "Teddy is set to default Going. Tap Going to confirm or change."

## What coaches experience

Roster on the event page splits "Going" into two visual buckets but counts them together for the headline number:

```
Going  14
  └ Confirmed  9    (solid)
  └ Default    5    (hollow + "Auto" chip)
Maybe   2
Out     3
No reply 4
```

Coach tap on "Auto" chip beside a name → "Set by household default. Not yet confirmed for this session."

The headline "14 Going" stays unchanged so we don't break planning at a glance — the breakdown is for triage.

## Microcopy

- Setting label: **"Default training RSVP"**
- Setting helper: **"We'll auto-mark Teddy as Going for new trainings. You can change any one before kickoff."**
- Default-applied chip: **"Auto"** (uppercase, muted)
- Override toast: **"Confirmed for Tuesday training."**
- Switch-off toast: **"We'll ask you each time from now on."**

## Edge cases handled in Phase 1

- **Child added to team after default exists** → default applies forward only, never backfills past events.
- **Event date changes** → existing default-applied RSVP keeps the same status; flag stays `source = 'default'` until parent confirms.
- **Multiple children on same team** → each child has their own independent default.
- **Parent leaves team / child unrostered** → defaults soft-deleted (kept 30d for restoration via `deleted_at`).
- **Event created before default exists** → no backfill; default only applies to events created after the toggle.
- **Coach manually RSVPs a child** → marked `source = 'coach'`, treated as Confirmed in the UI.

## What's explicitly out of Phase 1

- Match/game support (training only)
- Holiday pause / school break detection
- 18h-before confirmation push nudge
- Soft-pause on prolonged inactivity
- Season rollover prompt

These arrive in Phases 2–4.

---

## Technical section

### Data model

New table `child_training_defaults`:
```
id uuid pk
team_id uuid fk teams
child_id uuid fk children      -- nullable when default belongs to an adult member
user_id uuid fk profiles       -- nullable when default belongs to a child
default_status text check in ('going','not_going')   -- 'ask' = no row
created_by uuid
created_at, updated_at, deleted_at
unique(team_id, coalesce(child_id, '...'), coalesce(user_id, '...'))
```

Add columns to `rsvps`:
- `source text not null default 'user'` — values: `user | default | coach`
- index on `(event_id, source)` for the coach roster split

### Auto-apply logic

A Postgres trigger on `events` (after insert, when `event_type = 'training'`) calls a SECURITY DEFINER function that:
1. Loads team's `child_training_defaults` (status='going' only — `not_going` does NOT auto-RSVP, it just suppresses the nudge in later phases).
2. Bulk-inserts `rsvps` rows with `status='going', source='default'` for each child/user that doesn't already have a row for this event.
3. Skips if event was created with explicit RSVPs (e.g. ported from another system).

A second trigger on `child_training_defaults` (after insert/update to `going`):
- Forward-applies to all *future* training events for that team where no RSVP row exists for the child/user yet.

### "Set as default?" prompt detection

A small client-side hook reads the parent's last 3 RSVPs for trainings on this team for this child. If the last 2+ are the same explicit status AND no default row exists AND the prompt hasn't been dismissed in localStorage — render the inline suggestion under the RSVP buttons.

### RLS

- `child_training_defaults` SELECT: parent of child OR user themselves OR team coach/admin OR club admin.
- INSERT/UPDATE/DELETE: parent of child OR user themselves only.
- Coaches cannot set defaults on behalf of households (avoids accountability blur).

### UI surfaces touched

- `EventDetailPage` — RSVP block shows hollow vs solid dot, "Auto" chip, optional "set as default?" suggestion, coach-side bucket split.
- `ChildProfilePage` (and team member sheet) — new "Default training RSVP" segmented control.
- `useEventGoingAttendees` — extend to return `source` per RSVP so cards can render the dot variant.

### Migration order

1. Create table + add `source` column + triggers + RLS (single migration).
2. Frontend: child-profile control + event-page chips + suggestion prompt + coach bucket split.
3. QA: create training event → verify auto-RSVPs appear with hollow dot → confirm → dot solidifies.

### Out of scope for this PR

- No changes to push notification cadence yet (that's Phase 2's 18h confirmation nudge).
- No changes to match/game RSVP behaviour.
- No analytics dashboard for default vs confirmed (later).

---

Approve to start with the migration, or tell me what to tweak first.
