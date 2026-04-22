

## Finish populating the remaining 15 official drills

15 official drills still have **0 frames**. I'll generate one migration that inserts 5 frames (positions 0–4) for each, so every targeted official drill ends up with exactly 5 animated frames.

### Drills to populate (15)

| # | Drill | Focus |
|---|-------|-------|
| 1 | Outside-foot slalom | Outside-foot touch through cones |
| 2 | Passing squares | 4-corner pass-and-follow square |
| 3 | Pressure and cover | 2nd defender cover angles |
| 4 | Rebound finishing | Server feeds, striker finishes 2nd ball |
| 5 | Receive on the half-turn | Open body, play forward 1st touch |
| 6 | Receive under pressure | Shielding under back-pressure |
| 7 | Rondo 4v1 | Keep-ball, switch points |
| 8 | Shooting circuit | 3-station rotating finishing |
| 9 | Side-channel finishing | Wide attack → cutback → finish |
| 10 | Strike from a moving ball U9–U12 | Push touch + driven strike |
| 11 | Through-ball pattern | Pass–set–through-ball runner |
| 12 | Triangle passing | 3-player triangle, pass + move |
| 13 | Two-cone shooting gates | Strike between mini-gates |
| 14 | Volley finish from cross | Cross → first-time volley |
| 15 | Wall-pass and finish | 1-2 with wall player → strike |

### Frame structure per drill

Each drill gets 5 `drill_frames` rows (`position` 0–4, `duration_ms` 1500) with:

- **`objects`** – players (`A1/A2/D1/GK1` etc.), ball, cones, mini-goals — coordinates evolve frame to frame so the play moves toward the attacking goal (low y).
- **`annotations`** – `arrow-solid` (ball travel), `arrow-dashed` (player runs), `step-marker` (numbered cue), and a `text` coaching cue (e.g. "Open body", "Drive across the keeper").
- **`notes`** – short coaching note per frame using the squad-substitutable tokens (A1, A2, D1, GK1…) so the contextual name substitution already in `teamPlayerSubstitution.ts` renders real player names in the UI.

All JSON is dollar-quoted (`$JSON$ … $JSON$::jsonb`) to match the previous migration style and validated against `drillValidator.ts` (in-bounds, attacking direction = high→low y, no zero-length arrows, ball continuity, no overlap at frame start).

### Delivery

1. Generate one migration file `supabase/migrations/<ts>_finish_official_drill_frames.sql` containing **75 inserts** (15 drills × 5 frames).
2. Run it via the migration tool.
3. Re-query `drill_frames` grouped by `drill_id` to confirm every one of the 15 drills returns `frame_count = 5` and report a summary table back.

### Out of scope

- No changes to `drills` metadata, drill logic, or rendering.
- The two drills already at 6 frames (`Cone slalom dribble`, `Dribble gates`) and all 5-frame drills are left untouched.

