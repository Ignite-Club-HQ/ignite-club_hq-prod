# Website type check repair — 2026-11-05

Result: `npm run typecheck:product` → 0 diagnostics (was 499 new). Full tests: Supabase mode 7,405 passed / 1 timing flake (passes alone); ICP mode 7,027 passed / 0 failed.

## Real bugs fixed (found by the type errors)
- News composer: leftover duplicate pickers referenced undefined variables (would crash when choosing Mini league / Competition audience).
- Role lists read `grant.user` but service returns `account_id`: board viewer, mini-league admins, join-team admin notify, club growth count, add-team-member search.
- Photo reaction removal passed a non-existent id; now passes the photo id the service expects.
- Game stats team lookup called a non-existent `get_event`; now uses listed/loaded events.
- Club invite message default (ICP) never displayed (optional value unwrapped).
- Club rewards Pro check called without scope (TypeError in ICP mode).
- Association page used `writeOnce` without importing it.
- Inbox own-send bump never matched (rows lacked `key`).
- Public competition: canister optionals not flattened, so hidden divisions still counted in the ladder.
- Event-group pitch board sport and team-admin avatars read optional arrays as strings.
- Admin active games team id was an optional array; memory trend/forecast cards received wrong field name.
- Photo comment delete routed with an invalid scope; now routes by the photo's club.

## Type-only repairs
- Frontend Supabase types refreshed from the Lovable-managed DEV types file.
- Event detail query typed explicitly; multi-group merge parts typed `any[]`; a few mixed-backend reads typed `<any>`.
- Test fixtures narrower than generated service types marked with `@ts-expect-error` (fails if the mismatch disappears).

## Follow-ups (not fixed)
- DEV database lacks `notify_mini_league_news` / `notify_competition_news`; posting still succeeds, notification step logs a warning.
- Club upgrade plan values `small`/`growing` are not in the database plan enum.
- Canister teams have no class schedule fields, so the ICP upcoming-classes widget stays empty.
