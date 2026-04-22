# Pitch Board — Training Mode

## Guiding principles

1. **Match Mode is frozen.** All existing `PitchBoard.tsx` match logic (timer, subs, scoreboard, auto-subs, spectator sync, mini-league teams, executed events) stays exactly as-is. No regression risk.
2. **Mode lives at the top of the board.** A `<ModeSwitch value="match|training" />` segmented control in the pitch board header flips between two sibling components. Match Mode renders the existing `PitchBoard` body; Training Mode renders a new `TrainingBoard` body. Shared chrome (header, close button, fullscreen container, fabric/canvas loader) is hoisted into a thin `PitchBoardShell` wrapper so both modes inherit it.
3. **Reuse the engine, not the UI.** The drag/scale/coordinate system and the fabric.js drawing layer are extracted into reusable primitives. Player tokens, the SVG pitch background, and pen/arrow drawing tools are shared. Match-only widgets (GameTimer, ScoreTracker, AutoSub*, SubConfirm*, ManualSubConfirm*, PitchPlayerActionMenu, etc.) are *not* loaded in Training Mode.
4. **Storage in Supabase, scoped by RLS.** Drills and sessions persist server-side from day one so coaches can use them across devices and teams can share them.
5. **Ship in 4 phases.** Each phase is independently shippable and testable.

---

## Architecture

### File structure (new)

```
src/components/pitch/
  PitchBoardShell.tsx                  # NEW: header + mode switch + portal/fullscreen chrome
  ModeSwitch.tsx                       # NEW: segmented Match | Training control
  training/
    TrainingBoard.tsx                  # NEW: top-level training mode container
    TrainingPitch.tsx                  # NEW: pitch surface (reuses pitch SVG + fabric layer)
    TrainingToolbar.tsx                # NEW: floating toolbar (objects/annotations/actions)
    TrainingObjectLayer.tsx            # NEW: renders/edits players, cones, goals, balls, zones, text, step markers
    FrameStrip.tsx                     # NEW: horizontal frame thumbnails + add/dup/delete/reorder
    FrameThumbnail.tsx                 # NEW: lightweight SVG snapshot of a frame
    PlaybackController.tsx             # NEW: play/pause/speed + frame interpolation engine
    DrillMetadataSheet.tsx             # NEW: bottom sheet for drill metadata
    DrillLibrarySheet.tsx              # NEW: My Drills / Team Drills / Recent + filters
    SaveDrillDialog.tsx                # NEW: name + tag + save
    PresentationMode.tsx               # NEW: fullscreen, tap-to-advance, optional notes
    types.ts                           # NEW: Drill, DrillFrame, DrillObject, TrainingSession types
    objectFactories.ts                 # NEW: helpers to create/clone objects
    interpolation.ts                   # NEW: frame-to-frame tween math for playback
    drillStorage.ts                    # NEW: Supabase CRUD for drills + sessions
  session/
    SessionBuilderPage.tsx             # NEW: page-level session editor
    SessionDrillCard.tsx               # NEW: draggable drill card
    AddDrillFromLibrarySheet.tsx       # NEW: pick drills to add to a session

src/pages/
  TrainingBoardPage.tsx                # NEW: standalone route /training-board
  TrainingSessionsPage.tsx             # NEW: /training-sessions list
  TrainingSessionDetailPage.tsx        # NEW: /training-sessions/:id

src/hooks/
  useDrillFrames.ts                    # NEW: frame CRUD + undo + autosave
  useDrillPlayback.ts                  # NEW: rAF playback loop
  useDrillLibrary.ts                   # NEW: react-query for drills + filters
  useTrainingSession.ts                # NEW: session CRUD + ordering

src/components/schedule/
  StartTrainingButton.tsx              # NEW: contextual CTA on training events
```

### Data model (Supabase)

```sql
create table public.drills (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  team_id uuid references public.teams(id) on delete set null,
  club_id uuid references public.clubs(id) on delete set null,
  name text not null,
  description text,
  age_group text,
  focus text[] default '{}',
  duration_minutes int,
  players_required int,
  equipment text[] default '{}',
  coaching_points text[] default '{}',
  progression text,
  regression text,
  tags text[] default '{}',
  visibility text not null default 'private',     -- 'private' | 'team' | 'club'
  pitch_size text default 'full',
  thumbnail_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.drill_frames (
  id uuid primary key default gen_random_uuid(),
  drill_id uuid not null references public.drills(id) on delete cascade,
  position int not null,
  duration_ms int default 1500,
  notes text,
  objects jsonb not null default '[]'::jsonb,
  annotations jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  unique (drill_id, position)
);

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null,
  scheduled_for timestamptz,
  duration_minutes int,
  notes text,
  event_id uuid references public.events(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.training_session_drills (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  drill_id uuid not null references public.drills(id) on delete restrict,
  position int not null,
  duration_override_minutes int,
  notes text,
  unique (session_id, position)
);

create table public.drill_recent_uses (
  user_id uuid not null,
  drill_id uuid not null references public.drills(id) on delete cascade,
  last_used_at timestamptz default now(),
  primary key (user_id, drill_id)
);
```

**RLS (plain English):**
- `drills` — Owner can do anything. Team members of `team_id` can view if `visibility='team'`; club members of `club_id` can view if `visibility='club'`. Coaches/admins of `team_id` can edit team-shared drills; club admins can edit club-shared drills.
- `drill_frames` — Inherit access from parent drill via SECURITY DEFINER helper `can_access_drill(_drill_id, _user_id)` (mirrors existing `has_role` pattern, avoids recursion).
- `training_sessions` — Owner and team coaches/admins can edit; team members can view.
- `training_session_drills` — Inherit from parent session.
- `drill_recent_uses` — User can only read/write their own rows.

### Playback engine
- `useDrillPlayback({ frames, speed })` runs a `requestAnimationFrame` loop interpolating each object's `(x, y, rotation)` from frame N to frame N+1 over `durationMs / speed`. Objects in only one frame fade in/out. Annotations cross-fade.
- Speeds: `0.5x | 1x | 2x`.
- Same renderer used in editor (static current frame) and presentation (animated).

### Sharing the engine without touching Match Mode
- Extract `PitchSurface` (SVG pitch + fabric.js canvas) from `PitchBoard.tsx` into `src/components/pitch/PitchSurface.tsx`. Match Mode imports it; Training Mode imports it. Pure no-op refactor verified by manual QA + existing pitch board tests.
- `PlayerToken.tsx` reused with optional `editableLabel` prop (defaults to existing match behaviour).
- Drag math from `PitchBoard.tsx` either extracted to `useBoardDrag.ts` or duplicated in Training Mode if extraction is risky — decided per file at implementation time.

---

## Phased delivery

### Phase 1 — Foundation + Training Board MVP
**Goal: a coach can draw a single-frame drill in-memory using the toolbar.**
1. `PitchBoardShell` + `ModeSwitch`; wrap existing `PitchBoard` body unchanged.
2. Extract `PitchSurface` (read-only refactor; verify Match Mode pixel-identical).
3. `TrainingBoard` + `TrainingPitch` + `TrainingObjectLayer` + `TrainingToolbar`.
4. Objects: player (editable label), cone, mini goal, full goal, ball (multi-ball OK).
5. Annotations: solid arrow, dashed arrow, resizable zone, text, numbered step marker.
6. Actions: select / move / duplicate / delete / clear board.
7. Free positioning, no formation snapping, overlapping zones allowed.

**Exit:** mode switch works; no Match Mode regression; coach builds single-frame drill in <30s.

### Phase 2 — Frames + Playback + Presentation
1. `FrameStrip` with inline SVG thumbnails (not html2canvas).
2. Frame ops: add, duplicate, delete, drag-reorder.
3. `useDrillPlayback` + `PlaybackController` with 0.5x/1x/2x.
4. `PresentationMode`: fullscreen, hide UI, tap/arrow advances frame, optional coaching notes overlay.
5. Quick actions: reset to frame 1, clear current frame.

**Exit:** multi-frame drill animates smoothly; presentation usable on mobile landscape.

### Phase 3 — Persistence + Drill Library
1. Supabase migration: `drills`, `drill_frames`, `drill_recent_uses` + RLS + `can_access_drill` helper.
2. `drillStorage.ts` + `useDrillLibrary` (react-query, optimistic updates).
3. `SaveDrillDialog` + `DrillMetadataSheet`.
4. `DrillLibrarySheet` with tabs (My / Team / Recent) and filters (age group, focus, duration, player count).
5. Open / duplicate / delete from library.
6. Auto-stamp `drill_recent_uses` on open.

**Exit:** drills round-trip to Supabase; team drills visible to teammates only.

### Phase 4 — Sessions + Schedule integration
1. Supabase migration: `training_sessions`, `training_session_drills` + RLS.
2. `SessionBuilderPage` with drag-reorder, add from library, create-new-inside-session.
3. `TrainingSessionsPage` list + `TrainingSessionDetailPage`.
4. `StartTrainingButton` on schedule training events → opens `TrainingBoardPage?sessionId=...`.
5. Optional link `training_sessions.event_id`.

**Exit:** coach builds 5-drill session in <3 min and runs it live from a training event.

---

## Risk register

| Risk | Mitigation |
|---|---|
| `PitchSurface` extraction regresses Match Mode | No-op refactor in its own commit + manual QA + pitch board tests before Phase 1 merge. |
| Frame thumbnails expensive | Inline SVG renderer, never html2canvas. |
| Playback jank on Android | rAF + transform-only animation; write to refs/DOM directly during playback. |
| RLS recursion on `drill_frames` | SECURITY DEFINER `can_access_drill` helper. |
| Bloating `PitchBoard.tsx` further | Training code lives under `src/components/pitch/training/`; zero new imports in `PitchBoard.tsx`. |
| Spectator sync confusion | Training Mode does **not** write to `active_games`. Documented in code + memory. |

---

## Open questions before starting Phase 1

1. **Gating** — Same Pro Football gating as Match Mode (current assumption), or open to all clubs/sports?
2. **Team Drills visibility** — All team members can view, only coaches/admins can edit (current assumption). Confirm?

If both defaults are fine, Phase 1 starts in the next message.
