# External and physical-device acceptance — 18 August 2026

**Candidate application tree:** `bca406b0c`
**Status:** Automated safety passed; physical/provider acceptance not run.

## Evidence completed in the isolated Codespace

- Android OS harness safety script: passed.
- iOS OS harness safety script: passed.
- Android/iOS harness, notification promotion, push deployment and event
  isolation guards: 89/89 passed.
- WebView-like Playwright journeys: 139/139 passed in the complete baseline.
- Hosted Supabase credentials, signing keys, store credentials and Firebase
  production configuration were absent from the isolated harnesses.

These checks prove harness isolation and browser-level contracts. They do not
prove behaviour on physical devices or delivery by external providers.

## Required external acceptance

| Check | Required environment | Status |
| --- | --- | --- |
| Android lock/resume, notification tap, keyboard and PitchBoard restoration | Designated Android test device/build | NOT RUN |
| iOS lock/resume, notification tap, keyboard and PitchBoard restoration | Designated iOS device or simulator/build | NOT RUN |
| Push delivery and large-recipient fan-out | Designated non-production users/devices | NOT RUN |
| Transactional email and invite deep links | Designated non-production inboxes | NOT RUN |
| Stripe checkout/webhook and entitlement transition | Provider sandbox | NOT RUN |
| Apple/Google IAP verification | Store sandbox/TestFlight/internal track | NOT RUN |
| PlayHQ/Drive/Giphy/Places integrations | Designated sandbox/test configuration | NOT RUN |
| Hosted Edge Function secrets and cron enablement | Target project dashboard, read-only review | NOT RUN |
| Backup restore drill and recovery timing | Approved recovery environment | NOT RUN |

## Acceptance record

For each check record exact candidate/build, device/OS or provider environment,
test identity, timestamp, evidence link, result, reviewer and rollback decision.
Do not enter real credentials, tokens, personal data or production payloads in
this repository.
