# Event Card Refinement — Next Up + Schedule

A focused refinement of the existing Ignite card system. Not a redesign — the dark, rounded, premium feel stays. We strengthen team identity and event-type differentiation without touching the prominence of date/time, location, or RSVP controls.

## Audit Summary

**Where the current cards fall short**
- Team identity lives inside a small chip that competes with metadata text. Two cards from the same club look near-identical at a glance.
- The event-type icon (Trophy/Dumbbell) is muted-foreground sized 3.5 — visually invisible.
- All cards share the same flat surface: same border, same radius, same left edge. Stacked on the Schedule page they form a "wall of cards".
- Big primary RSVP buttons (Going/Maybe/Can't) on Next Up cards out-shout the event itself.
- Empty state ("Tap to RSVP") is a thin dashed ghost — feels broken next to populated cards.
- Title duplication: chip says "U8 Blue", line below says "U8 Blue Training".

## New Hierarchy (applies to both surfaces)

```
[Color rail]  TEAM NAME ............................ [Date pill]
              ──────────────────────────────────────
              [Type icon] vs Opponent  ·  match badge
              ──────────────────────────────────────
              🕒 5:30 PM – 6:30 PM      📍 Pitch 4, Bridgewater
              ──────────────────────────────────────
              [RSVP row — full width, lower contrast]
```

- **Color rail**: 4px left border tinted by `detectTeamColor(team.name)`. Falls back to `--primary` when no color detected. Single strongest recognition cue, costs almost no vertical space.
- **Team name**: promoted to title weight (`text-base font-semibold`) with the team color dot inline. Replaces the current chip-as-title pattern.
- **Type row**: icon scaled up to `h-4 w-4`, tinted with type accent (game = amber, training = sky, social = violet). Removes redundant "U8 Blue Training" string via `getEventDisplay` (already wired).
- **Logistics row**: time + location stay at `text-sm`, foreground color, with the existing icons. **No size or contrast reduction here.** Location truncates with `max-w-[55%]` so time never gets pushed off.
- **RSVP row**: keeps full tap targets (h-9, full-width split) but switches from filled primary to **outline + tinted-when-selected**. Selected state uses success/warning/destructive at 15% bg + 100% text. Empty state replaces "Tap to RSVP" ghost with the same 3-button row pre-rendered, just unselected — consistent silhouette.

## Type Differentiation

Subtle, premium, not childish:
- **Game**: amber color rail blend on the date pill, Trophy icon tinted amber.
- **Training**: team color rail only, Dumbbell icon in muted-foreground.
- **Social**: violet rail accent, PartyPopper icon violet.
- **Match Day / Mini-League**: adds a small "MATCH DAY" uppercase eyebrow above the team name in amber; only badge that earns extra vertical space.

## Schedule Page Rhythm

Stacked-card monotony fix:
- Group header per date (already exists via `ScheduleDateStrip`) gets a slightly heavier divider.
- Cards within the same day get a tighter `space-y-2` (was `space-y-3`) and **alternate** subtle background tint between `bg-card` and `bg-card/60` — a barely-perceptible zebra that breaks the wall-of-cards effect without looking striped.
- Today's events get a left rail brightness boost (`opacity-100` vs `opacity-70` for future days) so "what's today" pops while scrolling.

## Next Up Carousel Specifics

- Card min-height stays (prevents jolt) but internal padding tightens from `p-4` to `p-3.5`.
- Big "Going / Maybe / Can't" buttons drop from `h-10 default` to `h-9 outline`. Selected fills with status tint.
- Children RSVP accordion chevron moves inline with the row label so it stops creating a fourth visual block.
- Carousel dots remain.

## Files Changed

- `src/components/events/TeamChip.tsx` — add `asTitle` variant (larger, no chip background, just dot + name).
- `src/components/events/EventCard.tsx` — restructure header, add color rail, alternate-bg prop, lower-contrast RSVP buttons, unified empty state.
- `src/components/NextUpCarousel.tsx` — same hierarchy applied to the carousel card body; RSVP button restyle; remove title duplication.
- `src/pages/EventsPage.tsx` — pass index to `EventCard` for zebra tint, tighten `space-y`.
- `src/lib/eventTypeIcon.tsx` — add `getEventTypeAccent(type)` returning a semantic token class for tinting.
- `src/index.css` — add `--event-game`, `--event-training`, `--event-social` semantic tokens (HSL) so accents are theme-aware.

## What is NOT changing
- Date/time text size and color — unchanged.
- Location text size and color — unchanged.
- RSVP tap-target height stays ≥ 36px and full row width.
- No removal of any data shown today.
- No new fonts, no new radii, no layout framework swap.

## Out of Scope
- Team avatars/logos (no asset pipeline today — the color rail + dot covers recognition without requiring uploads). Can be added later by swapping the dot for an `<Avatar>` in `TeamChip`.
- Event detail page.
- Team detail "Next Event" card (`TeamNextEventCard`) — already uses a similar pattern; left as-is unless you want it aligned in a follow-up.
