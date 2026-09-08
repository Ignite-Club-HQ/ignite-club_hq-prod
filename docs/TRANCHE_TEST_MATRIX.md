# Tranche test matrix

Last updated against `main` at `38ccb7910` on 2026-09-04.

The historical promotion branches are not merged by this runner. They predate
hundreds of `main` commits and currently conflict with `main`. Run the focused
gate on a tranche candidate only after bringing that candidate onto updated
`main` and resolving its production changes by reviewed behavioural ownership.

## Commands

Run a focused tranche gate from the candidate worktree:

```bash
npm run baseline:tranche -- 00
npm run baseline:tranche -- 01
npm run baseline:tranche -- 02
npm run baseline:tranche -- 03
npm run baseline:tranche -- 04
npm run baseline:tranche -- 05
npm run baseline:tranche -- 06
npm run baseline:tranche -- 07
npm run baseline:tranche -- 08
npm run baseline:tranche -- 09a
npm run baseline:tranche -- 09b
```

Preview the exact selected files without running tests:

```bash
npm run baseline:tranche:list -- 05 --list
```

Add the complete isolated database lifecycle when the tranche owns backend,
RLS, Realtime, Storage, invitation, event, notification, or timer contracts:

```bash
npm run baseline:tranche -- 05 --include-local
```

Before approving a PR, append the complete cross-codebase gate:

```bash
npm run baseline:tranche -- 05 --include-local --full-gate
```

Both `--include-local` and `--full-gate` invoke the same `npm run baseline`
command used for the complete 5,000+ test baseline. If both flags are supplied,
it runs once. Local integration always uses the complete lifecycle; the runner
intentionally does not start a partial schema or bypass cleanup.

## Ownership

| Tranche | Focused boundary | Browser journey | Local integration represented |
| --- | --- | --- | --- |
| 00 | Test and release governance | None | Runner and safety units |
| 01 | Shared auth, entitlement, cache and lifecycle foundations | Auth safety | None |
| 02 | Membership, roles, invitations, children and guardians | Mobile invite signup | Invitations, guardians, roles and season rollover |
| 03 | Events and Home | Club-wide RSVP and recurring series | Event lifecycle and club-wide RSVP |
| 04 | Competitions | None | Competition lifecycle and event groups |
| 05 | Messaging and notifications | Cross-surface messaging and navigation/lifecycle | Messaging security and Realtime isolation |
| 06 | Vault and Media | Vault upload safety | Vault, Media, Storage and edge cases |
| 07 | PitchBoard, timer and AutoSub | Mobile lifecycle journeys | Timer concurrency |
| 08 | Telemetry and release closeout | None | Covered by final full baseline |
| 09a | Dependency reconciliation | None | Covered by final full baseline |
| 09b | Telemetry and recipient reconciliation | None | Notification, role-surface and messaging contracts |

The executable selection rules live in `scripts/tranche-test-manifest.mjs`.
Every tranche must have at least one matched Vitest file or the command fails
closed. A green focused gate is necessary but does not replace the full baseline
or the manual acceptance required by the promotion runbook.
