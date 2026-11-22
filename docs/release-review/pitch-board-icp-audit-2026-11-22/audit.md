# Ignite Club HQ — Pitch Board in ICP Mode

**Audit date:** 22 November 2026 (UTC)  
**Audited DEV source:** `1e3a46e83006806e06d997bd15c323f9577e13ee`  
**Overall assessment: NOT READY FOR FULL ICP APPROVAL.**

## Answer for Paul

The pitch board has substantial ICP support, but **it will not reliably provide the complete experience in its current form**. Lineups, formation tools, substitution planning, shared-board synchronisation and statistics have ICP implementations. However, normally generated ICP team IDs cannot reach the authoritative timer, several fixture/lineup reads still attempt email-mode services, and saving, alerts and server permissions contain important gaps.

**Do not treat the passing existing tests as clearance to promote the pitch board.** This is a source audit plus isolated frontend execution, not a live signed-in match acceptance test. No application code, live canister, database, scheduler or production configuration was changed. Only audit documentation/evidence was added.

## What was checked

- Team and event entry points, app-wide reopening and native resume restoration.
- Players, bench placement, formation, fill-ins, drawing, settings and substitution planning.
- Timer start/pause/resume/halftime/finish, server projections and stale-snapshot guards.
- Team sharing, spectator access, event-group/mini-league synchronisation and revision conflicts.
- Fixture selection, per-event lineups, result saving, player statistics and competition score propagation.
- Automatic substitution monitoring, notification recipients, preference failures and child-name privacy.
- Server authorization, revoked role mirrors, alternate legacy methods, transfer snapshots and upgrade persistence.
- Existing tests in both email and ICP modes, plus six isolated reproductions of current defects.

## Verification results

| Check | Passed | Failed | Skipped | Files |
|---|---:|---:|---:|---:|
| Main pitch-related suite — email | 919 | 0 | 11 | 75 |
| Main pitch-related suite — ICP | 904 | 0 | 26 | 75 |
| Results/stats/read barrier suite — email | 27 | 0 | 9 | 4 |
| Results/stats/read barrier suite — ICP | 15 | 0 | 21 | 4 |
| **Combined existing suite — email** | **946** | **0** | **20** | **79** |
| **Combined existing suite — ICP** | **919** | **0** | **47** | **79** |
| Separate audit defect reproductions — ICP | 6 | 0 | 0 | 1 temporary file |

The six reproductions deliberately verify that the current defects occur; their passing status does **not** mean those behaviors are correct. The first temporary runner failed dependency resolution before collecting tests; after linking the existing test dependencies into the temporary workspace, all six executed successfully. No dependency install or application edit was required.

The configured suite excludes `frontend/src/components/pitch/timerSchemaMarker.guard.test.ts`; the counts above do not include it. Some ICP runs also skip email-only scenarios. Unit/mocked-adapter tests do not prove live canister authorization or phone delivery.

The preview's latest available build signal was **build OK**. No new application changes required a build.

### Execution limits

- **No live Internet Identity match flow was exercised.** There is no injected ICP delegation for a coach/member available here. The browser auth status is `external_unmanaged`; it is not a usable Internet Identity session. No credentials were requested or used, and a signed-out page was not substituted for match acceptance.
- **No disposable canister runtime proof was claimed.** The existing native-host prerequisite reports Linux `4.19.0-gvisor`, `faults=1`, `writeBit=0`, `recovered=true`, so it refuses before canister installation. The local multi-canister shared-board harness was therefore not run.
- **No deployed-version parity was established.** Backend findings refer to checked-in source, not a verified live module hash/Candid revision.
- No phone lock/kill/resume delivery test, old-to-new populated upgrade rehearsal, club transfer or OpenCloud activation was performed.

## Capability assessment

| Capability | Assessment |
|---|---|
| Formation, bench, drawing and auto-sub planning | Implemented; many local behavior tests pass. Durable acknowledgements still need repair. |
| Team board sharing | ICP revision/CAS path exists and is tested with mocked adapters; legacy methods undermine the server boundary. |
| Spectator sharing | Protected shared-board path supports authenticated read-only users. Anonymous/public sharing is not established. |
| Event-group / mini-league board synchronisation | Separate ICP revisioned path exists; spectator/conflict/revocation tests pass. Closed-board alerts have a gap. |
| Authoritative team timer | **Blocked for normally generated ICP team IDs.** |
| Linked fixture display/selection and lineup restoration | **Not fully ICP-routed.** Remaining email-service attempts are normally blocked by strict transport. |
| Results/history and statistics | ICP saving exists; manual-score preservation, cross-event summary authorization and partial failure need attention. |
| Substitution/full-time alerts while app is suspended or closed | **Not proven reliable:** current monitor depends on executing browser code. |
| Native reopening | Route restoration is tested; it does not prove background alert delivery or durable timer recovery. |
| Ordinary upgrade persistence | Persistent stores and migrations exist; actual old/new compatibility rehearsal remains unverified. |
| Moving existing boards to OpenCloud | **Not cleared:** pitch-state snapshot coverage is incomplete in the events transfer contract. |

## Findings requiring fixes

### F01 — High: generated ICP team IDs cannot use the authoritative timer

**Evidence:** `frontend/src/lib/serverTimer.ts:157-160,179-185,203-209`; generated team shape at `backend/club_domain/src/main.mo:5134` and documented in `frontend/src/live/features/events.ts:12-14`.

The UUID-only eligibility test runs before ICP dispatch. ICP IDs such as `team-club-a-1-1795340400000` fail it. Timer writes throw `server-timer-not-applicable`; reads return `found:false` without asking ICP. The same eligibility helper is used by timer call sites.

**Observed in isolated execution:** the generated ID was rejected, the write threw, the read reported missing, and neither ICP event lookup nor timer write ran.

**Impact:** the coach can see a locally running clock without a durable shared timer. Do not mistake local elapsed-time tests for cross-device timer support.

**Fix direction:** make eligibility backend-aware, keeping event-group boards on their separate path and preserving email UUID rules. Test an actual generated team ID through start, pause, resume, halftime, finish and remount/readback.

### F02 — Medium: timer event selection is heuristic rather than explicitly linked

**Evidence:** `frontend/src/lib/serverTimer.ts:364-398,440-489`.

Timer lookup selects the nearest team game within ±12 hours, instead of accepting the board's explicitly linked event. It caches the answer, including no event, for five minutes and flattens read errors to missing. The module cache is keyed only by team ID, not account/target, and has no clearing function in this module.

**Impact:** a newly linked fixture may not be used promptly; two nearby fixtures can direct the timer to the wrong event. No-linked/personal boards have no resolvable ICP event. Account/target-bound cache handling needs review.

**Fix direction:** carry the exact authorized event ID, separate absence from refusal, and scope/clear cache entries across account/target changes. This remains relevant after F01 is fixed.

### F03 — High: lineup and fixture reads still attempt Supabase in ICP

**Evidence:** `frontend/src/components/pitch/eventLineupRepository.ts:98-152`; `LinkedEventHeader.tsx:57-96`; `LandscapeEventSelector.tsx:46-66` in the same directory.

An absent, empty or refused ICP lineup is converted to `null`, after which the repository reads `event_lineups` through Supabase. Linked fixture details and both selectors directly query Supabase `events` without selecting the ICP transport.

**Observed in isolated execution:** absent, empty and rejected ICP snapshots each attempted `supabase.from('event_lineups')`; the simulated strict barrier rejected the call and the repository returned null.

**Important distinction:** strict enforcement in `frontend/src/live/strictIcpTransport.ts:69-93` and `frontend/src/integrations/supabase/liveClient.ts` normally blocks these operations before network dispatch. This is **an attempted forbidden fallback / broken dependency**, not evidence that data actually escaped to Supabase.

**Fix direction:** keep each operation inside one selected transport; preserve true absence separately from permission/network errors. Add actual selector/restore flow tests in ICP, including missing snapshots and restoration.

### F04 — High: alternate active-game methods bypass shared-board permissions

**Evidence:** `backend/events_domain/src/main.mo:3482-3507,3550-3568`; frontend adapter `frontend/src/live/features/events.ts:2110-2118,2143-2153`.

`sync_active_game` replaces a team row using the supplied ID after account admission/authentication, without checking club/team staff authority, transfer fences or expected revision. `deactivate_active_game` similarly deactivates team rows without a relationship check or revision update. Both affect the same storage as the protected shared-board methods.

The old `get_active_game` is either unavailable when legacy-query protection is enforced, or lacks team membership authorization when that gate permits it. A protected `read_account_get_active_game` exists at `main.mo:6138-6150`, but the inspected `getLiveActiveGame` adapter still calls the legacy getter.

**Impact:** an eligible authenticated account knowing another team's ID can invoke the write/deactivate methods without the relationship required by the protected shared-board interface. A revision increment alone is not compare-and-swap. Legacy reads also create refusal or exposure risk depending on protection mode.

**Confidence:** source-confirmed; not exploited against live canisters.

**Fix direction:** secure every equivalent entry point, not just the new shared method; route reads through the current authorized reader. Prove outsider, spectator, revoked-user and transfer-fence denial with unchanged row/activity/revision.

### F05 — High: summary saving does not bind the event to the authorized team

**Evidence:** `backend/events_domain/src/main.mo:2936-2954`; contrasting player-stat relationship check at `:2985-2988`.

`save_game_summary` checks authority for the supplied team but does not verify that the event exists and belongs to that team. Replacement uses event ID alone.

**Impact:** a coach of team A can supply an unfenced team-B event ID and replace its summary under A, or store a summary for a nonexistent event. This is a server scope issue independent of the normal UI.

**Fix direction:** require an existing event with the exact supplied team/club relationship, refreshed authority and relevant fences before replacing any summary. Add foreign-team and missing-event negative controls.

### F06 — High: revoked mirrored roles can still authorize timers/lineups

**Evidence:** `backend/events_domain/src/main.mo:446-460,576-581,1316-1335,1471-1478,2590-2605`.

Lineup and event-timer writes use local `requireManage` role mirrors without refreshing current club authority. Mirrors are replaced only on certain other operations; refresh errors can leave old grants present. The stronger shared-board path performs current membership/role reads at `:3399-3419`.

**Impact:** a revoked **non-creator** coach/team administrator may retain write authority until another operation refreshes the mirror. Event-creator authority is separately intentional and must not be confused with this finding.

**Fix direction:** current authoritative authorization on these writes, failing closed when it cannot be established. Test direct writes after role removal without an intervening refresh.

### F07 — High: automatic ICP finishing ignores manual-score preservation

**Evidence:** `frontend/src/components/pitch/GameFinishedDialog.tsx:159-162,185-199`; `frontend/src/hooks/useSaveGameResult.ts:61-97,129-155`; `backend/events_domain/src/main.mo:3129-3153`.

Finishing requests `onlyIfMissing:true`, but the ICP hook neither checks nor forwards it; it calls the unconditional result adapter. The preservation check exists only on the email branch. The backend upserts by event ID and may also update a linked canonical competition match subject to manager authorization.

**Observed in isolated execution:** `onlyIfMissing:true` still called the adapter, with no preservation option. No live existing result was overwritten in this audit.

**Coverage trap:** `frontend/src/hooks/useSaveGameResult.test.tsx:289-311` currently expects that unconditional ICP call, so it passes while failing to protect the intended rule.

**Fix direction:** enforce preservation atomically server-side. Seed a manual result and different local goal totals; automatic finish must preserve both History and any canonical match. A missing result should still be inserted.

### F08 — High: lineup saves are marked complete before acknowledgement

**Evidence:** `frontend/src/components/pitch/hooks/usePitchBoardPersistence.ts:161-168`; `frontend/src/components/pitch/eventLineupRepository.ts:171-214`.

The signature is recorded before a fire-and-forget save. A false return or rejected ICP save is not handled, and identical subsequent state is skipped. Closing the board cancels the 1.2-second debounce.

**Impact:** an unsaved lineup can look saved, get no same-state retry, or cause an unhandled rejection. Local storage does not provide the promised cross-device durability.

**Fix direction:** acknowledge before committing the saved signature, retain failed work and handle closing/foreground retry without replaying an unknown write blindly. Test false, rejected, interrupted and successful readback cases.

### F09 — Medium: shared recovery can replace unacknowledged coach edits

**Evidence:** `frontend/src/components/pitch/hooks/useIcpSharedPitchBoard.ts:33-54,66-72`; application of remote state at `frontend/src/components/pitch/PitchBoard.tsx:1119-1132`.

After a read/write error, the next successful read adopts remote state. First hydration and changed remote revisions also replace local players, formation, rotations, goals and linkage; local storage copies are replaced too. Errors are console warnings rather than a retained-draft/conflict state.

**Impact:** CAS correctly prevents stale server overwrites, but an uncommitted local edit can disappear. Authoritative peer-wins behavior is deliberate; loss without a retained draft or clear status is the reliability concern.

**Fix direction:** preserve displaced drafts and distinguish a known failed write from an unknown committed outcome. Keep CAS; do not solve this by blindly replaying stale edits.

### F10 — Medium: timer/settings failures can leave local success without durable success

**Evidence:** `frontend/src/components/pitch/GameTimer.tsx:540-570`; `frontend/src/hooks/usePitchSettings.ts:91-127,208-273`; `frontend/src/lib/serverTimer.ts:440-489`.

Manual play/pause updates local running state while asynchronously persisting and only logging rejection. Some individual settings saves similarly log failures; explicit Save settings has better success/failure messages.

**Impact:** the clock/settings may look changed without durable acceptance. This is local/server divergence, not an allowed Supabase fallback.

**Fix direction:** expose pending/failed saves and reconcile from acknowledged state on recovery. Keep clock rendering responsive without representing a rejected action as durably confirmed.

### F11 — High limitation: closed/suspended-app monitoring is not reliable background automation

**Evidence:** `frontend/src/components/pitch/GlobalSubMonitor.tsx:168-175,258-264,1210-1222`.

ICP skips the monitor's database sync and has no equivalent to the email `check-pending-subs` service in this path. Due/full-time checks run on a five-second browser interval.

**Impact:** navigating away while the app keeps executing is different from locking, suspending or killing it. A push worker cannot deliver a reminder that was never generated. Route restoration tests do not prove ongoing background scheduling.

**Fix direction:** establish ICP-side due-event generation/deduplication and the authorized native push path, then verify lock/terminate/resume on a real phone. If that work is deferred, explicitly constrain the supported behavior instead of claiming background parity.

### F12 — High: closed-board event-group substitution alerts can silently do nothing

**Evidence:** `frontend/src/components/pitch/GlobalSubMonitor.tsx:40-47,178-234,1042-1050`; working group-specific route at `frontend/src/lib/pitchBoardRepository.ts:65-67` and `backend/events_domain/src/main.mo:3455-3476`.

The monitor's immediate ICP fan-out derives a club only from a `team-...` ID. An `event-group-...` ID cannot enter that branch, yet execution returns from the ICP path. The due-substitution branch relies on it rather than sending an alternative notification.

**Impact:** group alerts are implemented elsewhere, but this particular closed-board due-alert path is a no-op.

**Fix direction:** use the authorized group notification operation for group boards and exercise due alerts with the board open and closed, including only the exact assigned match duties.

### F13 — High privacy: one ICP notification path includes player names

**Evidence:** `frontend/src/components/pitch/GlobalSubMonitor.tsx:1030-1032,1048-1050,220-225`.

The single-substitution message interpolates outgoing/incoming player names and sends that message as the ICP notification body. This violates the standing requirement to omit child names from ICP pitch alerts. The open-board repository uses the generic “A planned substitution is due” instead.

**Impact:** plaintext names can leave the protected board context through notification payloads.

**Fix direction:** generic notification bodies across all producers; resolve any detail only inside the authorized board. Test bodies using named child fixtures without logging their real data.

### F14 — Medium: recipients/preferences differ between open and closed board paths

**Evidence:** `frontend/src/lib/pitchBoardRepository.ts:57-78`; `frontend/src/components/pitch/GlobalSubMonitor.tsx:183-224,628-648`; shared scope helper `frontend/src/components/pitch/hooks/livePitchNotifications.ts:12-55`.

The open-board team reminder is self-only; closed-board logic independently selects runner/staff/event duties. Preference read failure defaults role switches to enabled. Another helper is again self-only. The monitor duplicates rather than uses the shared, validated recipient helper.

**Impact:** opening/closing a board changes who may get alerts, and failed preference lookup may broaden intended recipients. The existing shared-helper tests do not validate the separate monitor branch.

**Fix direction:** one server-authorized, club/match-scoped recipient contract, preserve saved role switches, and fail closed on unknown preference/scope. Confirm the intended self-versus-staff audience before changing the user-facing policy.

### F15 — Medium, transfer review: pitch stores are omitted from club snapshots

**Evidence:** `backend/events_domain/src/main.mo:339-360`; separate stores at `:131-132,155,201-203` and their migrations.

The events snapshot includes groups/results/summaries/statistics, but not `lineupSnapshots`, `eventTimers`, `activeGames` or `pitchBoardSettings`.

**Impact:** that snapshot alone cannot reproduce those stores on a destination canister. This matters if moving existing clubs to OpenCloud. It is **not** evidence that ordinary code upgrades erase them, nor a proven end-to-end transfer loss: any supplemental transfer payload needs checking.

**Fix direction:** identify the complete transfer payload, add missing authorized state if required, and rehearse populated export/import/readback offline before any cutover. Existing encrypted-media restrictions remain unchanged.

## Additional review items, not overstated as proven failures

- **Lineup concurrency:** `backend/events_domain/src/main.mo:1316-1335` increments a revision but accepts no expected revision. Two authorized saves are last-writer-wins. Decide whether that policy is acceptable; do not confuse it with CAS protection.
- **Partial match completion:** `frontend/src/hooks/useGameStats.ts:270-296` and `GameFinishedDialog.tsx:138-157,185-211` save summary, player stats and result in separate steps. Primary stats failure preserves the session; secondary score failure warns and can allow completion. This is intentional partial success, not atomic completion. Test interrupted/unknown outcomes and retries explicitly.
- **Plain-English errors:** `frontend/src/hooks/useSaveGameResult.ts:86-93` shows raw caught error text in a failure message. Map server refusals to plain English while retaining raw details in appropriate diagnostics.
- **Subscriptions/entitlements:** this audit does not authorize plan changes or certify live purchase settings. UI edit controls are not a substitute for the server permissions in F04–F06.

## Safeguards that already exist

- Protected shared-board writes authorize before re-reading/checking the expected revision and preserve existing timer JSON (`backend/events_domain/src/main.mo:3430-3450`).
- Group writes recheck authorization, fences and exact state revision after asynchronous checks (`:2488-2505`).
- Strict ICP transport rejects legacy application calls rather than granting email fallback.
- Team/group spectator and conflict handling has focused tests; normal shared-loop work pauses while hidden/offline and uses five-second polling.
- Server-anchored projections, no-regress snapshot guards, clock drift, persistence and resume behavior have extensive tests.
- Primary stats-save failures are not reported as successfully finished; competition score writes retain manager/relationship/revision checks (`backend/competition_domain/src/main.mo:3306-3316`).
- Persistent actor stores and migrations exist for ordinary upgrades. Preservation compatibility still requires the proper old/new rehearsal.

## Recommended coordinated DEV-only repair order

1. **Close server security/privacy gaps:** all active-game entry points, exact event/team summary binding, current timer/lineup permissions, child-free notification bodies, atomic manual-score preservation.
2. **Restore core functionality:** generated ICP team timer IDs, explicit event selection, ICP-only fixture/lineup reads and acknowledged/retryable saves.
3. **Unify alerts/recovery:** shared recipient rules, closed-board group alerts, retained uncertain drafts and actual background due-event generation.
4. **Validate without production:** add failing regressions for each concrete issue, rerun the focused two-mode suites, run disposable real-canister outsider/revocation/CAS cases on a compatible native worker, and complete signed-in DEV two-device/phone acceptance.
5. **OpenCloud separately:** verify complete state-transfer/upgrade coverage and existing club/media constraints before redirecting DEV. This audit grants no deployment, data move, scheduler activation or production release.

### Minimum acceptance matrix before calling it fully working

- Generated ICP team + exactly linked fixture: start → pause → resume → halftime → second half → finish; read back on another authorized device.
- Same sequence for group/mini-league boards through their separate timer/state path.
- Coach edits players/formation/bench/rotations; acknowledged state survives close, refresh, account change, offline/reconnect and cold resume.
- Missing/empty/refused lineup and selector reads make **zero** Supabase application calls.
- Coach, spectator, outsider and revoked role exercise **all** corresponding server methods, not only the new protected interface.
- Two coaches conflict: stale state does not overwrite acknowledged state; displaced drafts remain recoverable.
- Pre-existing manual score survives automatic finish; zero scores and missing scores remain distinguishable; competition orientation remains exact.
- Substitution alerts: open board, closed board, group board, failed preference lookup, locked phone, killed app; exact recipients, deduplication, no child names.
- Populated ordinary upgrade preserves all pitch state. Existing-club transfer requires separate full payload readback.

## Reproduction commands and evidence

From `frontend/`, the main suite was run using the existing two-mode runner with these focused filters:

```text
node scripts/run-tests-all-backend-modes.mjs
  src/components/pitch src/lib/serverTimer src/lib/pitchBoardRepository
  src/lib/sharedPitch src/lib/eventGroupTimer src/lib/teamPitchSettingsPayload
  src/hooks/usePitchBoardNotifications src/hooks/useEventGroupSync
  src/hooks/useActiveGameSync src/live/eventsActiveGame
  src/features/events/pitchBoardActionPolicy src/components/home/useHomePitchBoard
  src/components/home/HomePitchBoardRuntime src/test/pitchBoard --maxWorkers=2
```

Additional collected test files were `useSaveGameResult.test.tsx`, `useGameStats.test.tsx`, `boardReadRepository.test.ts`, and `liveClient.strict.test.ts`. Filters for settings/strict transport without matching files did not add test coverage.

The temporary reproductions were stored outside the checkout and tested:

1. Generated ICP team ID fails the timer eligibility gate and cannot dispatch a write.
2. Its timer read returns missing without an ICP read.
3. No saved ICP lineup attempts a Supabase read.
4. Empty saved ICP lineup attempts a Supabase read.
5. Refused ICP lineup read attempts a Supabase read after being flattened to null.
6. `onlyIfMissing:true` calls the unconditional ICP result adapter without forwarding preservation.

A durable machine-readable evidence summary and the temporary reproduction source accompany this report in `docs/release-review/pitch-board-icp-audit-2026-11-22/`. Backend security issues are source findings, not live exploitation evidence. All fixes remain recommendations; none were implemented in this read-only audit.
