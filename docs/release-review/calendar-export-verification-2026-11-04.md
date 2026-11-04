# Calendar export — frontend repair and release acceptance

## Release status

Implemented on DEV source only. **Not promoted. Physical iPhone and Android acceptance is pending.** No database, notification, RSVP, production-data or calendar-service writes were performed.

## Changes

- Single-event export and schedule export use `frontend/src/lib/icsExport.ts` and its shared `mapEventToCalendar` helper. The current checkout has one schedule export call, not the two mentioned in the brief; a repository-wide search confirmed no second export call remained.
- The single-event action currently lives in `EventOverviewSection`, rendered by `EventDetailPage`. Its calendar menu includes `.ics` export and “Add to Google Calendar”.
- Native `.ics`: write UTF-8 to `Directory.Cache`, open with FileOpener using bare `text/calendar`, then Share with `files: [uri]` only if opening fails. Write/share failures reject with actionable instructions; page/menu catches display a destructive toast. No silent console-only success or native-to-web fallback.
- Google single-event template uses AppLauncher on native. Unsuccessful launch results become visible errors. Web uses a separate tab with opener detached.
- Date-only/wall-time events convert using the supplied club `time_zone`/`timezone`, defaulting to Australia/Adelaide. Already zoned ISO timestamps from ICP remain exact instants, including ISO end timestamps. Existing read contracts currently do not expose club-zone fields; no missing database columns were added to queries. If club-zone settings are introduced elsewhere, pass them through the export mapping.
- Missing end time is exactly one hour. Overnight wall-time ends roll to the next club day; invalid dates fail visibly.
- UTC ICS and Google dates share conversion. All event links use `https://igniteclubhq.app/events/{id}` regardless of frontend hostname.
- UTF-8 line folding counts the continuation space within the 75-byte limit and never splits a Unicode code point.
- Web blob downloads and the existing `ics-preview-fallback` event/dialog contract remain unchanged.

## Native package and Android provider

Contrary to the brief's assumption, FileOpener was absent from this checkout's declared/installed dependencies; previous code loaded it optionally. Added pinned `@capacitor-community/file-opener` 8.0.1 (Capacitor peer >=8), with matching lockfile; used only the shared frontend dependency installer. Root remains dependency-free.

Inspected the actual installed Android library:

- `android/src/main/res/xml/file_opener_paths.xml` includes `<cache-path name="cache" path="." />`.
- Its provider manifest references that XML and has `android:grantUriPermissions="true"` with exported=false.
- Automated regression checks retain both facts.

No checked-in Android platform/merged manifest exists here. Library inspection proves the shipped dependency supports cache access; the built application's merged manifest and real recipient read access still require phone-build verification.

## Automated evidence

- Before the fix: 7 of the original 9 calendar tests failed (wrong UTC, oversized emoji lines, wrong links, no opener and swallowed failure).
- After the fix: **25 calendar/helper/menu tests passed**. Covers all requested rules (a–g), actual opener→share→visible-message flow, Google URL/native launch, UTC ICP timestamps, winter offset, non-default club zone, overnight duration, invalid dates, schedule multi-event output, web download and preview event preservation.
- The 23 helper tests also passed in separate processes with `TZ=America/Los_Angeles` and `TZ=Asia/Tokyo`.
- Related schedule/detail read regressions: **21 passed, 5 backend-mode skips**. No read repository changes.
- Preview's latest automatic build was OK. An intermediate install failed while the package lock was being completed; matching lock/package bytes and the shared installer resolved it, followed by build OK.
- Component interaction tests verify the destructive toast callback after real mocked native open/share failures; these are not physical-device evidence.

## Required before promotion — physical DEV acceptance

Update local code from the connected repository first. From `frontend/`, run `npm install` locally and **`npx cap sync`**; build/install a non-production local DEV test copy. Do not start DEV Codemagic store builds. Read Lovable's Capacitor/native-mobile blog guide before local phone setup.

Use an existing authorized DEV club/event. Do not create test records in PROD. For a 9 December 2026 game starting 18:30 Adelaide, the exported instant must be `20261209T080000Z`. With no end time the end is `20261209T090000Z`.

| Device/action | Required evidence | Current result |
| --- | --- | --- |
| Real iPhone, one game | Apple system import UI; saved title/time/end/location; working event link | Not run — no physical device access |
| Real iPhone, whole schedule | Every exported event imports into Apple Calendar; dates/count/links match | Not run — no physical device access |
| Real Android, one game | Calendar receiver can read cached file and save into Google Calendar; correct time/link | Not run — no physical device access |
| Real Android, whole schedule | Google Calendar-compatible receiver imports every event with correct times/links | Not run — no physical device access |
| Real phones, Google single-event option | System browser opens prefilled Google event with same UTC interval and link | Not run — no physical device access |
| Android without a calendar file handler | Share sheet opens; if sharing fails, actionable message appears | Automated mocks pass; physical check pending |

Android calendar file handling varies by installed apps. A successful share/open does **not** prove Google Calendar saved the schedule. If a receiver refuses a multi-event ICS, stop promotion and report it rather than claiming an import. Google template fallback intentionally covers one event only.

Record device model, OS/app build, phone/calendar zone, chosen recipient, exported count, imported count and screenshots of saved entries. Repeat once with the phone in another time zone to confirm the same instant. Report all results to Paul **before promotion**. Hosted authenticated UI acceptance is also unavailable in this sandbox (`external_unmanaged`); it was not falsely represented as completed.

## After approved release

On one iPhone and one Android, repeat a single existing game and the whole authorized schedule against the released app and inspect saved calendar entries/links. These are post-release smoke checks of already-proven behavior, not experimental PROD testing. Do not modify PROD app data. This future action cannot execute until the release and physical devices are available.