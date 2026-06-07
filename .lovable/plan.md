## What we're adding

Round-robin generation today asks for a single match day, kickoff time and pitch count, then drops every round on the same weekday. We're extending it so each division can have its own play days and daily time window, while all divisions share one pitch pool (so generation never books more simultaneous matches than the venue has pitches).

## Changes

### 1. Per-division settings (new schema)
Add three columns to `competition_divisions`:
- `play_weekdays int[]` — e.g. `{0,6}` for Sun + Sat. Empty/null = "any day".
- `day_start_time time` — earliest kickoff, default `09:00`.
- `day_end_time time` — latest kickoff, default `16:00`.

Edit/create division dialogs get fields for these. They become the *defaults* the fixture generator pre-fills when that division is selected.

### 2. Fixture generator (`CompetitionFixturesPanel`)
- Replace the single "Match day" picker with a weekday multi-select (chips for Sun…Sat). Defaults to `division.play_weekdays`.
- Replace the single "Kickoff time" with **Earliest** and **Latest kickoff** fields. Defaults to division's start/end.
- Pitch count is unchanged in input, but now treated as the **shared venue pool** for the whole competition on that date.
- New scheduling pass:
  1. Walk forward from the start date one day at a time, only stopping on allowed weekdays.
  2. For each candidate day, fetch existing `competition_matches` in the same comp scheduled that day and subtract their pitch usage from the pool (per timeslot).
  3. Fill the day from `day_start_time` toward `day_end_time` in `duration` minute slots, using all free pitches per slot, until the day's matches for that round are placed.
  4. If a round doesn't fit in a single day, overflow rolls to the next allowed weekday (still part of that round).
  5. End date still caps the season.

The preview table groups by date (not just round) and shows pitch + time per match.

### 3. Per-round date override (in preview)
`FixturePreviewEditor` gains a "Move round" date picker on each round header. Admins can shove a round to a different specific date before saving — useful for one-off conflicts (Easter, public holiday).

### 4. Shared-pool conflict checking
When the generator places a slot it queries existing matches for `competition_id` on that date and excludes pitches already taken in the same `[time, time+duration)` window. This handles the case where another division has already been scheduled into the same day.

### 5. Friendly capacity messaging
The existing "Round 1 needs X matches but only Y pitches" notice gets reworded to "This round needs N days — will run Sat + Sun" when overflow is in effect.

## Technical notes

- Schema migration adds the three columns with sane defaults; backfills `day_start_time=09:00`, `day_end_time=16:00`, `play_weekdays=NULL` (treated as "any day").
- No backend RPC — generator runs client-side as today; conflict check is a single `select scheduled_at, duration_minutes, pitch_number from competition_matches where competition_id=… and scheduled_at::date in (…)` before save and again in the preview pass.
- Database stays the source of truth; nothing about per-round overrides needs new columns — they're just edits to `scheduled_at` per row before insert.
- Out of scope for this round: cross-competition pitch sharing, lunch-break gaps, ref/duty allocation.

## File touchpoints
- `supabase/migrations/<new>.sql` — add columns + GRANT (already on the table)
- `src/components/CompetitionFixturesPanel.tsx` — generator UI + scheduling pass
- `src/components/FixturePreviewEditor.tsx` — per-round date override
- Division create/edit dialog (likely `CreateCompetitionPage` / a division form component) — new settings fields
