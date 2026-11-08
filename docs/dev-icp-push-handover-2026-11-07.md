# Approved TEST ICP push handover

Paul approved the TEST-only handover at 22:59 UTC on 7 November 2026.
Existing email/Supabase notification behavior and PROD delivery remain unchanged.

## Prepared source

- Manual `[TEST] Provision isolated ICP push worker` job transfers the existing
  GitHub-held worker directly into DEV Supabase `ecsdwrarzfexssxtrymj`, under
  `IGNITE_DEV_ICP_PUSH_WORKER_SEED`. It requires main, the exact confirmation,
  and the `icp-dev-push-commissioning` environment. It neither mints a worker
  nor overwrites a hosted key, publishes credentials, grants access or sends.
- TEST legacy workflow and executable recognize `ICP_DEV_PUSH_HANDOVER=true`.
  The variable has NOT been changed. This is operational gating only, not
  authoritative fencing; separately validated PROD execution is unaffected.
- Isolated delivery core now requires atomic `journal.begin` and conditional
  `journal.settle` receipts. Concurrent invocations cannot share a reservation;
  uncertain sends and failed settlement remain held. Empty/malformed directory
  input cannot be reported as completed delivery. Token invalidation carries
  the original generation-bound reservation receipt.

## Remaining integrated commissioning work

1. Implement durable ICP installation ownership, token generations, atomic
   attempt reservations and settlement, worker epochs and legacy API fences.
   Preserve existing rows; do not adopt legacy tokens as verified installations.
2. Add current chat mute authorization, not merely conversation read access,
   and bind every post-await check to the same lease/device/worker epoch.
3. Connect native registration and the separate hosted orchestration to those
   contracts. Keep the current registration flag off and no sender index until
   these prerequisites are verified. No in-memory production journal.
4. Run the protected key transfer once synchronized; verify exact grants through
   governor execution. No new key, manual credential disclosure or Firebase reset.
5. Drain/reconcile the old TEST runner, establish an authoritative epoch fence,
   and only then activate one sender. Never reset uncertain provider sends.
6. Verify real TEST Android/iOS delivery and unchanged email-mode behavior,
   including account switch, revoked access, mute, token rotation, background,
   notification taps and partial-device outcomes.

These are source/unit results, not deployed authority or physical delivery
evidence. No secrets, queue configuration, workflow variable or scheduler were
changed; no worker transfer or push was executed.