## Goal
Let a team admin pick which PlayHQ team in a linked PlayHQ competition is "their" team. Once linked, every fixture for that PlayHQ team becomes a match event on the team's schedule, and stays in sync as PlayHQ updates (times, venue, scores, cancellations).

## How it fits today
- PlayHQ comps already live in `competitions` (`source='playhq'`) and fixtures in `competition_matches` with `external_home_team_id` / `external_away_team_id` (PlayHQ team ids) plus `home_team_name` / `away_team_name`.
- `competition_matches` already has `home_team_id` / `away_team_id` (Ignite UUIDs) and `home_event_id` / `away_event_id` (links to a row in `events`). Nothing populates these for PlayHQ rows yet.
- `playhq-sync` cron is already running, so we just need to (a) capture the team↔PlayHQ link and (b) materialise events from matching `competition_matches` rows.

## Changes

### 1. Schema
Add to `teams`:
- `playhq_team_id text` — the PlayHQ team UUID this Ignite team is mirroring
- `playhq_competition_id uuid references competitions(id)` — the linked PlayHQ comp (so we know which grade to scope to)
- `playhq_auto_create_events boolean default true` — kill-switch per team

(No new tables. `competition_matches.home_event_id`/`away_event_id` already give us idempotency.)

### 2. Edge function: `playhq-materialise-team-events`
Inputs: `team_id`.
For the linked team:
1. Load team + `playhq_team_id` + `playhq_competition_id`.
2. Select all `competition_matches` where `competition_id = playhq_competition_id` AND (`external_home_team_id = playhq_team_id` OR `external_away_team_id = playhq_team_id`).
3. For each match:
   - Determine `isHome`; set `home_team_id` / `away_team_id` to the Ignite team id if not already.
   - If the corresponding `home_event_id` / `away_event_id` is null:
     - Insert into `events`: `team_id`, `club_id` (from team), `event_type='match'`, `title` = `"vs " + opponentName`, `start_at = scheduled_at`, `venue = match.venue`, `source='playhq'`, `external_id = match.external_id`, `created_by = team admin / system bot`.
     - Write the new event id back into the right `home_event_id` / `away_event_id`.
   - If the event exists, update its `start_at`, `venue`, `status` (cancel if match.status='cancelled') to keep it in sync.
4. Return counts: created / updated / cancelled.

### 3. Hook into the existing PlayHQ cron
After `playhq-sync` finishes a grade, look up any teams with `playhq_competition_id = <synced comp>` and call `playhq-materialise-team-events` for each (capped, sequential, ignore errors per team). Keeps future fixture changes flowing into events without a manual click.

### 4. UI

**Team Settings → "PlayHQ link" card** (visible to team admins):
- "Link to PlayHQ competition" — Select from PlayHQ comps the team's club / parent association organises (`competitions where source='playhq'`).
- After picking a comp, fetch its `competition_matches` and derive the unique PlayHQ teams (external_home_team_id + external_away_team_id, with the readable name). Show a second Select: "Which team is yours?"
- Auto-create events toggle (writes `playhq_auto_create_events`).
- "Import fixtures now" button → calls the edge function. Shows toast with created/updated counts.
- "Unlink" — clears all three columns. Existing events stay (they're just events at that point).

**TeamDetailPage**: small "PlayHQ" badge near header when linked, and the auto-created match events appear in the normal schedule like any other event (no special rendering needed).

### 5. Guardrails
- Only team admins (or club admins of the team's club, or admins of the association that organises the comp) can link/unlink.
- Auto-created events get `source='playhq'` so admins can tell them apart. Editing such an event locally sets `manually_overridden_at` (mirroring the pattern already used on `competition_matches`) so future syncs don't overwrite their changes.
- Cancellation in PlayHQ → event `status` flipped to `cancelled` (we don't hard-delete, in case people RSVP'd).
- Idempotent everywhere: re-running the import never creates duplicate events because we key off `competition_matches.home_event_id` / `away_event_id`.

## Out of scope this round
- Auto-RSVP / push when a new fixture lands (can layer on later; they'll flow through the existing new-event notification path anyway).
- Roster mapping (PlayHQ player → Ignite child).
- Reverse sync (Ignite changes pushed back to PlayHQ).

## Open question
Where do you want the link UI to live — **Team Settings** (admin-only, tucked away) or as a card on **Team Detail** under the header (more discoverable, but visible to all members)? My default is Team Settings.
