# Pitch board ICP repair and repeat audit — 22 November 2026

## Decision
**Core timer, saving and access repairs are implemented and tested in DEV source. Full ICP/release approval remains withheld.** No canister deployment, live data/configuration change, production operation or scheduler activation occurred.

The original audit remains unchanged at `docs/release-review/pitch-board-icp-audit-2026-11-22/audit.md`.

## Repeat audit results

| Check | Pass | Fail | Skip |
|---|---:|---:|---:|
| Final focused pitch suite, email mode — 82 files | 968 | 0 | 20 |
| Final focused pitch suite, ICP mode — 82 files | 941 | 0 | 47 |
| Generated-contract syntax checks | 4 | 0 | 0 |
| Candid drift across active contracts | 17 contracts checked | 0 | 0 |
| Scoped events-domain compiler check | Passed | 0 errors | Existing warnings retained |

The initial repeat suite identified one stale UUID-only eligibility expectation in ICP; it was corrected to assert backend-specific eligibility. The final results above supersede that earlier failed run. New regressions cover generated IDs, all six timer action dispatches, exact linkage changes, zero email calls on missing/refused ICP reads, failed and interrupted lineup saves, readback without replay, divergent peer lineups, account switches and retained shared drafts.

These are unit/mocked-adapter and compiler/source checks, **not deployed canister or signed-in match acceptance**. The configured exclusion of `timerSchemaMarker.guard.test.ts` remains unchanged. The targeted suite is not the entire application baseline.

## Findings after repair

| Original finding | Current disposition |
|---|---|
| F01 Generated ICP team ID eligibility | Repaired: backend-aware eligibility preserves email UUID rules and separate event-group clocks. Six actions reach the exact event adapter in regressions. |
| F02 Heuristic event selection/cache | Repaired: no nearest-event search or settled event cache. Board timers carry exact event identity; persisted state, snapshot history, callbacks and completion intervals are event-scoped. Widgets reject an old-match action after same-team relinking. Unlinked ICP team/personal timers are not supported; linking a fixture is required. |
| F03 Email fallback reads | Repaired in lineup repository, linked header and both selectors, including EventLinkSelector. Refusals propagate rather than falling into email reads; protected lineup/timer/active-game readers are used. |
| F04 Alternate active-game bypass | Repaired in source: legacy team writes/deactivation/getter refuse, protected reads check current authority, and new team deactivation authorizes plus compares revision and advances it. Null-team personal sessions remain caller-owned. |
| F05 Summary event/team mismatch | Repaired: require existing live event, current authority and exact team before replacement. |
| F06 Revoked mirrors | Repaired for timer, lineup/roster, settings and summary/stat writes: current authoritative checks and post-await event/configuration/fence checks replace stale mirrors. Explicit creator/governor event authority is retained; non-creator grants must be current. |
| F07 Automatic result overwrite | Preservation repaired with additive server-side conditional insertion: existing results, including 0–0, return unchanged; no await between absence check and insertion. Missing competition-linked automatic results **fail closed for manual review**, without writing the canonical match. This intentionally does not provide automatic competition-finish parity. |
| F08 Premature save acknowledgement | Repaired: serialized debounce commits signatures only after acknowledgement and flushes pending work on close. Interrupted work is retained. Check-save performs authorized readback, never replays a lost-acknowledgement write or overwrites a divergent peer lineup. Divergence stays held for review rather than an automatic retry. |
| F09 Lost shared drafts | Repaired for team-board recovery: retained account/team drafts survive remote adoption and later read failures; restore is explicit and CAS remains authoritative. Drafts use the account-cache sweep prefix. Event-group draft recovery was not expanded in this repair. |
| F10 Local success/durable failure | ICP play/pause/reset/minutes/automatic boundaries share pending guards and acknowledged snapshots; failures notify and reconcile without email fallback. Widget toggles await acknowledgement. Settings writes serialize to prevent completion-order races and report failure; local settings remain device-only until successfully saved. |
| F11–F14 Alerts/background/privacy/audiences | **Remain open from the original audit.** This request repaired timer/saving/access paths, not background generation or alert audience policy. |
| F15 Existing-club transfer snapshots | **Remains a separate transfer hold.** No OpenCloud migration or encrypted-club move was authorized. |

An independent source review first identified remaining scope, recovery and serialization defects in the initial batch. Those specific items were corrected before the final suite. This report does not mislabel that initial review as approval of the final revision.

## Permission acceptance still required

The disposable shared-board runner now includes legacy-writer denial, unchanged-row readback, stale deactivation, missing/foreign summary rejection, 0–0 preservation and non-creator revocation checks for timer/lineup/summary without an intervening mirror refresh. Its syntax passes, but its native-host prerequisite refuses this sandbox before installation: Linux 4.19.0-gvisor, faults=1, writeBit=0, recovered=true. **No real-canister scenario pass is claimed.** Run it on a compatible isolated native worker before deployment approval.

Also still required: reviewed DEV events upgrade and deployed-source parity; a real Internet Identity coach session to run linked match start → pause → resume → halftime → second half → finish and second-device readback; outsider/spectator/revoked-role checks; phone close/resume acceptance. No usable ICP coach delegation or physical device was supplied here. An empty/signed-out preview is not a substitute.

## Scope and safety

No Supabase migration, role grant, existing data cleanup, production release, new stable state, transfer, background job or notification policy change was made. Interfaces and both generated contract trees were updated for additive conditional-result and revision-checked deactivation methods. Root AGENTS.md already exceeds its budget; the concise architecture rule was recorded in frontend/AGENTS.md without rewriting user-owned rules.
