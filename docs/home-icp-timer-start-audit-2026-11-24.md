# Home secure-sign-in timer start

## Rule
Starting or resuming a match clock must affect that exact match, and a delayed refresh must never undo a confirmed change. While confirmation is pending, repeated taps must not send another command.

## Reproduction and repairs
- Two mounted Home regressions demonstrated an acknowledged resume reverting to paused: a delayed initial read and a later foreground read. A third demonstrated missing visible pending state. All three failed before the repair.
- Home now records the acknowledged server snapshot, binds it to team plus match, discards reads crossing a user command, and shows a disabled progress indicator while saving. It still waits for acknowledgement before claiming the clock is running.
- The shared board clock now excludes reads crossing an outstanding command and persists an acknowledged start immediately, even if its startup reads are unfinished.
- Three alternate toolbar timer instances omitted the linked fixture. All now pass it; mounted tests start the exact fixture in expanded/collapsed portrait and expanded landscape.
- Group-clock storage rejected stale paused snapshots, but its same-tab event still delivered them to mounted clocks. Events now carry a timer only when the storage guard accepts it.

## Source-read inventory
These are source checks, not deployed-service or physical-phone acceptance.

| User-facing place / owner | Code read | Result |
| --- | --- | --- |
| Home clock Start/Pause, initial load, browser/native foreground recovery | `GameTimerWidget.tsx` | Repaired command/read race, missing acknowledged baseline and pending presentation. |
| Home widget launch and restored/notification `open-pitch-board` launch | `HomePitchBoardRuntime.tsx`, `useHomePitchBoard.ts` | Pass exact fixture through to board; reuse shared clock repair. No changes to access checks. |
| Pitch board portrait and landscape primary clocks | `PitchBoardPortraitLayout.tsx`, `PitchBoardLandscapeLayout.tsx` | Both pass linked fixture to shared `GameTimer`; shared read/command and startup-save repair applies. |
| Alternate setup and expanded/collapsed toolbar clocks | `PitchToolbar.tsx` | Repaired all three missing fixture arguments. Compact landscape has no separate clock writer. |
| Shared board clock Start/Pause/reset/half transitions, mount, visible polling and native/browser resume | `GameTimer.tsx` | Commands are single-flight and validated; repaired reads crossing commands and delayed startup persistence. Existing authoritative snapshot guards retained. |
| Event-page board and its portal | `EventDetailPage.tsx` portal invocation, `EventPitchBoardPortal.tsx` | Pass event ID and retain operator/read-only decisions; shared clock repair applies. |
| Team-page board launch and render | `TeamDetailPage.tsx` launch/render | Pass linked fixture; shared clock repair applies. Optional match lookup remains separate from this fix. |
| Chat shared-board viewer | `BoardViewerDialog.tsx` | Pass exact saved fixture; remains read-only and uses repaired shared clock reads. |
| Mini-league/event-group board and group state refresh | `EventGroupPitchPage.tsx` render, `useEventGroupSync.ts`, `eventGroupTimerGuard.ts`, `GameTimer.tsx` group event handler | Separate revisioned owner; repaired delivery of rejected timer snapshots. Existing CAS and timer guards remain. |
| Shared pitch-board background writer | `useIcpSharedPitchBoard.ts` | Writes lineup/pitch state, not the event timer. Existing revision/unknown-outcome handling retained. |
| Auto-sub plan setup and time accounting | `useAutoSubs.ts` plan activation, `usePitchBoardTimer.ts` | Consume clock; do not issue a competing timer-start command. No changes. |
| Legacy background game mirror and substitution monitor | `useActiveGameSync.ts` sync entry/legacy write gate; `GlobalSubMonitor.tsx` sync entry | ICP returns before legacy database timer writes. No changes. |
| ICP timer routing and service adapter | `serverTimer.ts`, `events.ts` timer read/write helpers | Exact event routing and caller-authorized ICP calls remain; no email fallback. |
| Secure event timer write and account timer read | `backend/events_domain/src/main.mo`: `set_event_timer`, `read_account_get_event_timer` | Fresh server authorization; timer mutation reads current state after authorization and updates without further awaits. No server changes needed for this client race. |
| Locked-phone sub-alert scheduler and due delivery | `backend/notification_queue/src/main.mo`: `schedule_pitch_sub_alerts`, `deliverDuePitchSubAlerts` | Schedule/queue notification records only, never change event clocks. No changes. |
| Email timer server functions | Not present in this checkout under `supabase/functions` | Not runtime-verified or claimed source-reviewed. Email forwarding and timer regression checks were exercised locally instead. |

## Verification
- 16 focused files per mode: **163 passed / 6 skipped** in email configuration; **152 passed / 17 skipped** in ICP configuration. Existing mode-specific skips retained.
- Includes Home launch/permission forwarding, mounted Home resume race, exact toolbar fixture starts, startup start persistence, group rejection propagation, clock drift/snapshot guards and legacy background sync.
- Preview reports build OK. Phone-sized 411×770 navigation redirects signed-out `/index` to `/auth`, with no page errors or horizontal overflow; screenshot inspected.
- Real-member Home → Start → server readback and installed-phone checks remain unverified: session minting refuses this user-managed backend, and no physical phone is available. Synthetic mounted tests are not live-service acceptance.
- No PROD deployment, settings/permissions changes, score/history changes or settled-record writes.