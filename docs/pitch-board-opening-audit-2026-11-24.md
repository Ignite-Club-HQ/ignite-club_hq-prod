# Pitch-board opening audit

## User rule
Opening a board must keep the selected match, avoid unnecessary serial/repeated loading, and never reopen it from a late reply after it has been closed. A stalled read must expose recovery rather than an endless spinner. Existing authorization, attendance filtering, clock state, settings and settled games stay unchanged.

## Source-read inventory

| Entrance or supporting path | Result |
| --- | --- |
| Home board cards, timer widget, `open-pitch-board` notification event (`useHomePitchBoard`, `HomePitchBoardRuntime`, `GameTimerWidget`) | Fixed: forward the widget's actual event; attendance overlaps roster loading; each failed read retries independently; repeated taps share an opening attempt; late attempts cannot publish. Board code downloads alongside data. |
| Home native/visibility restoration (`useHomePitchBoard`) | Fixed: reuse only the matching team's saved event; otherwise retain authorized event discovery. Shares the same request guard. |
| Team page button (`TeamDetailPage.launchPitchBoard`) | Fixed: attendance overlaps roster refresh; duplicate taps and late close/unmount replies are guarded. Background roster fetching no longer replaces an already-mounted board with a loading screen. |
| Team route / desktop navigation (`TeamDetailPage` restore effect, `DesktopNavRail`, `useDesktopNavAccess`) | Reviewed: navigation opens the team board directly, with a synchronous authorized-team fallback; no separate Home opening loop. Existing access checks retained. |
| Event page and Home Next Up (`EventDetailPage`, `EventPitchBoardPortal`, `NextUpCarousel`) | Fixed: selected event is explicit; individual secure role/name reads have separate deadlines; deep links show progress once access is known; failed roster loads expose retry and close. Existing attendee filtering retained. |
| Shared chat board (`BoardViewerDialog`, `boardReadRepository`) | Fixed: bounded individual board/role/name reads, explicit linked event passed to the read-only board, and cancellation prevents later opening/extra reads. Existing query sharing/account keys retained. |
| Mini-league widgets (`MiniLeagueGameWidgets`) | Reviewed: opens immediately from the selected match and already-loaded players; passes its exact event. No Home read/retry chain. |
| Event group manager (`EventGroupsManager`) | Reviewed: opens the selected group's already-loaded players; no asynchronous tap continuation to reopen a closed board. |
| Event group page (`EventGroupPitchPage`) | Reviewed: opens from current group/player state without the Home lookup sequence. |
| Native/route resume (`PitchBoardResumeRedirect`, `usePitchBoardLifecycle`, App mounting) | Reviewed: lease/debounce and explicit-route guards already suppress duplicate navigation. Home restoration now uses the corrected Home loader. |
| Notification entry points (`NotificationsPage`, `AppHeader`, `PushNotificationManager`) | Reviewed pitch-opening branches: navigate Home then dispatch the shared event; they inherit the corrected Home loader. Notification transport/delivery unchanged. |
| Nearby-event / attendance / team-roster reads (`useNearbyGameEvent`, `gameEventReads`, `pitchEntryRoster`, `sharedPitchBoard`) | Reviewed: retain team/event-scoped routing and original authoritative reads, with no Supabase fallback introduced. Normal new-board discovery remains unchanged; widget/restore callers avoid it when the selected event is already known. |
| Background sub monitor (`GlobalSubMonitor`) | Read its pitch-related branches: it handles alerts/sync, not user board-opening orchestration; no changes. |

There is no background job or database function that owns the Home opening attempt or its React timeout/retry state. Existing roster RPCs and secure-server readers remain untouched; this is a frontend read-coordination change, not a record migration or backend release.

## Verification boundary

Fourteen focused test files passed (89 passes, one existing mode-specific skip). They cover match forwarding, attendee filtering, permission denial, overlapping reads, legitimate sequential-read durations, retry/failure, repeated taps, late responses, shared-viewer cancellation, event retry/close and timer/resume invariants. Preview build OK and diff checks clean. Real signed-in widget opening and installed-phone timing remain unverified because no usable member session/device is available in this sandbox. No production deployment or settled-record change.