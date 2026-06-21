---
name: Clubs embed disambiguation
description: Always use explicit FK-qualified clubs embeds in PostgREST queries; never plain clubs(...) or clubs:column(...). Prevents ambiguous-embed outages when a second FK to clubs is added.
type: preference
---

**Rule:** Never use plain `clubs(...)` or `clubs:alias(...)` in any PostgREST `.select()` (frontend OR edge functions). Always qualify with the FK column name: `clubs!club_id(...)` (or `club:clubs!club_id(...)` when aliasing).

**Why:** The `clubs` table is a hot disambiguation target — multiple tables already have / will have a second FK to it (e.g. `host_club_id`, `parent_org_id`). The moment a second FK is added, every plain `clubs(...)` embed across the app + edge functions returns PostgREST error 300 ("Could not embed because more than one relationship was found"). This caused a prior outage; Phases 1–3 swept the entire codebase to `clubs!club_id(...)`.

**How to apply:**
- New query: write `clubs!club_id(...)` from the start. Same for nested: `teams(name, clubs!club_id(name))`.
- Reviewing a PR: reject any new `clubs(` or `clubs:` that isn't `clubs!<fk_column>(`.
- Same principle for any other table that may grow a second FK (teams, mini_leagues) — prefer FK-qualified embeds when in doubt.

**Grep to audit:** `rg "\bclubs\s*\(" src/ supabase/functions/ | grep -v "clubs!"` should return zero hits (comments excluded).
