## Goal
Pull **ladders, fixtures, and results** from PlayHQ into Ignite so a club / team / competition page can show official PlayHQ data alongside (or instead of) our own competition module.

---

## 1. What PlayHQ actually exposes

PlayHQ has a public REST API at `https://api.playhq.com/v1`, documented at https://docs.playhq.com/tech.

**Auth headers on every request** (both required):
- `x-api-key: <API key>` — issued by PlayHQ per integrator
- `x-phq-tenant: <tenant>` — e.g. `ca` (Cricket Aus), `bv` (Basketball Vic), `afl`, `netball`, etc. One tenant per sport body.

**Key endpoints we'd use:**
| Need | Endpoint |
|---|---|
| Find a club's competitions | `GET /organisations/{orgId}/seasons` |
| List competitions in a tenant | `GET /competitions?...` |
| Seasons in a competition | `GET /competitions/{id}/seasons` |
| Grades/divisions in a season | `GET /seasons/{id}/grades` |
| **Ladder** | `GET /grades/{gradeId}/ladder` |
| **Fixtures** | `GET /grades/{gradeId}/fixture` (paged, cursor) |
| **Single game / results** | `GET /games/{gameId}` |
| Teams in a grade | `GET /grades/{gradeId}/teams` |
| A team's fixtures | `GET /teams/{teamId}/fixture` |

Rate limit: ~10 req/sec per key, paginated with `cursor`. Webhooks exist for `game.updated`, `ladder.updated` (nice-to-have, requires a public callback URL).

**Critical constraint — getting the API key**
- PlayHQ does **not** self-serve API keys. You apply via https://support.playhq.com → Developer Access. Approval needs the tenant (sport body) to bless your use case. This is the single biggest unknown — could be days or weeks.
- Until approved we can scaffold against fixture data, but **nothing real ships without that key + tenant pair**. You may need one key per sport (one tenant = one sport body).

---

## 2. How it slots into our app

We already have an internal competitions module (`competitions`, `competition_divisions`, `competition_matches`, `competition_ladder`). PlayHQ data should live **alongside** that, not overwrite it, because:
- Internal comps are admin-run by clubs in Ignite.
- PlayHQ comps are owned by the association — we're a read-only mirror.

So a team/club in Ignite can be **linked** to a PlayHQ grade + team, and we render PlayHQ ladder / fixture / results from a cached mirror.

### Linking model (new schema)
- `clubs.playhq_org_id text` — the club's PlayHQ organisation id
- `clubs.playhq_tenant text` — which tenant (sport body) it belongs to
- `teams.playhq_team_id text`, `teams.playhq_grade_id text`, `teams.playhq_season_id text`
- New table `playhq_grades` — mirrored grade metadata (id, season, sport, name, tenant)
- New table `playhq_fixtures` — one row per game (id, grade_id, scheduled_at, venue, home/away team id + name, scores, status, updated_at)
- New table `playhq_ladder` — one row per (grade_id, team_id): played/W/D/L/for/against/diff/points/position, snapshot_at
- All tables: `GRANT SELECT` to `authenticated`, RLS open-read for members of the linked club (we already gate club content this way).

### Sync architecture (edge functions + cron)
1. **`playhq-sync` edge function** — called per club, per grade. Pages through fixtures + pulls ladder, upserts into the mirror tables. Idempotent on PlayHQ ids.
2. **`pg_cron` schedule** every 15 min — invokes `playhq-sync-all` which fans out across linked grades. Match-day grades get a faster 2-min cadence; off-season grades fall back to daily.
3. **Manual "Refresh now" button** for club admins → calls `playhq-sync` for that team's grade. Rate-limited per user.
4. **Secrets** stored via `add_secret`: `PLAYHQ_API_KEY_<TENANT>` (one per tenant we onboard, e.g. `PLAYHQ_API_KEY_BV`). The function picks the right key from the team's tenant.

### Where it appears in the UI
- **TeamDetailPage** → new "Ladder & Fixtures" tab (only when `playhq_grade_id` set). Renders mirrored ladder table + upcoming/past fixtures with scores.
- **Schedule page** → optional "Show PlayHQ fixtures" toggle that overlays read-only fixture rows (not RSVPable, badge = "PlayHQ"). Behind a per-team flag so it doesn't double-up when admins are already creating matching events.
- **Club page** → "External competitions" section listing all linked grades with mini-ladders.
- **Admin settings** → "Connect to PlayHQ" wizard on team and club settings: paste a PlayHQ URL (e.g. `playhq.com/.../grade/abc123`), we parse the ids, hit the API to confirm, then store the link.

---

## 3. Phased delivery

**Phase 0 — Access (blocks everything real)**
- Submit PlayHQ developer access request. Capture tenants we need (likely BV / NetballVic / AFL / Cricket — depends on which sports our clubs use).
- Get one sandbox tenant + key first to unblock dev.

**Phase 1 — Read-only mirror, single grade (1–1.5 weeks)**
- Schema + GRANTs + RLS.
- `playhq-sync` edge function for one grade (fixtures + ladder).
- Settings UI to paste a PlayHQ grade URL and link it to an Ignite team.
- TeamDetailPage "Ladder & Fixtures" tab using the mirror.
- Manual refresh button.

**Phase 2 — Automation + multi-grade (3–5 days)**
- `pg_cron` fanout, match-day cadence, last-sync indicator, error surfacing.
- Club-level linking (auto-discover grades from `playhq_org_id`).
- Per-club tenant key selection.

**Phase 3 — Schedule overlay + polish (3–5 days)**
- Read-only PlayHQ fixtures on the Schedule page behind a toggle.
- Score updates push a chat-bot message in the team chat (reuse `team_messages` bot pattern).
- Optional webhooks (`game.updated`) if PlayHQ approves a callback URL — drops cron load and gives near-realtime score updates.

**Out of scope (call out now):**
- Two-way sync (creating fixtures *in* PlayHQ) — PlayHQ API is read-mostly for non-association integrators.
- Player registration data — separate API surface, separate approval, privacy-heavy.
- Auto-creating Ignite events from PlayHQ fixtures (we'd want admins to opt in per team).

---

## 4. Technical notes / gotchas
- **Cursor pagination**, not page numbers. Edge function must loop until `metadata.hasMore=false`.
- PlayHQ timestamps are UTC ISO strings; venue addresses come as separate fields — render via existing venue formatter.
- Ladder rows include `team.id` but the team may not yet be in our mirror — upsert teams lazily from fixture/ladder responses.
- Team ids change between seasons — store `playhq_season_id` alongside `playhq_team_id` and re-link at season rollover (we already have a season concept).
- 10 req/s rate limit → in the fanout cron, sleep between grades and back off on `429`.
- Sync writes go through `service_role` inside the edge function; never call the PlayHQ API from the browser (would leak the key).
- Use `x-phq-tenant` from the *team's* config, not a global default, so a multi-sport club works.
- Mirror tables should be in `public` schema with `GRANT SELECT ON ... TO authenticated` + RLS gating on `can_access_club(club_id)` (existing helper).

---

## 5. Open questions for you
1. Which sports / associations do your clubs primarily sit under? That decides which PlayHQ **tenants** we need keys for (each is a separate application).
2. Do you have a PlayHQ developer relationship yet, or do we need to start from the support form? (This sets the realistic start date for Phase 1.)
3. Should linked PlayHQ fixtures auto-create Ignite events (with RSVP), or stay read-only? My recommendation is **read-only first**, opt-in auto-create later — avoids duplicating events admins already made.
4. Scope: ladders + fixtures + results only this round, or also include team rosters / player stats?
