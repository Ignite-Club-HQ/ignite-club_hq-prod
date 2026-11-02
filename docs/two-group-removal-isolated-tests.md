# Isolated two-group removal tests

Run `[TEST] Check complete two-group removal (isolated)` on `main`.
This manual workflow uses disposable PocketIC actors on a native Linux worker;
it has read-only repository permission, no governor secrets, deployed mappings,
mainnet calls, payment, delivery schedule, database changes or release action.

## What the new integration run checks

The workflow now runs the same complete scenario twice: rehearsal receivers and
non-rehearsal production-candidate receivers. Both use the real identity
coordinator in rehearsal mode; the latter is explicitly labelled
`production-receivers-rehearsal-coordinator`, not production authorization.
Authenticated effective-mode readbacks cover all 24 human services and four
infrastructure receivers; outsiders must be refused. No alias-reader authority
is inferred from a receiver's production-mode configuration.

- One real identity coordinator, one router and one shared workload service.
- Independent base/g2 copies of all twelve human-data receivers, including each
  group's photo store, plus two actual timers: exactly 28 frozen remote targets.
- Two aliases of one account, with actual club roles, chat history, competition,
  league, seven points, metadata, Vault and real encrypted photo round trips.
- Ordinary membership removal from one club preserves access in the other group.
- Real coordinator prepare/drain calls, an unavailable receiver, retained exact
  intent retry, and denial at the unreached receiver before its local fence.
- A claimed notification in each group remains an outstanding obligation across
  upgrade; only authenticated settlement drains it, and delivery is refused.
- An ungranted worker must trap with `Worker capability required`; an unrelated
  failure is not accepted. The coordinator must still report one outstanding
  lease after that refusal, before the original governor/lease owner settles it.
- Exact zero-work human seals for all 24 receivers; both aliases denied before
  and after every receiver upgrade; survivor photo/Vault/chat access preserved.
- Identity upgrade preserves the frozen intent, alias denial and survivor account.
- Timers, shared workload and router are now real removal receivers
  (`backend/shared/account_removal_receiver.rs`, and `RemovalReceiver` in
  secret_workload_identity). Each is configured once with the identity
  coordinator, denies fenced subjects at every caller-identified entry point,
  and reports retained obligations: timer capabilities/callback jobs, active
  workloads and accepting owner openings. The run seeds a real timer worker and
  workload for the account, proves seals refuse them, settles them through
  governor-only calls, upgrades all four, and then requires fresh complete
  seals for all 28 targets.

The report records `completeSeals: 28` on success but still sets
`releaseAuthorized: false` and `fullInventoryAcceptance: false`. Green means the
listed positive controls, denial/drain checks and expected safety holds passed;
it does not mean terminal erasure or production admission is ready.

## Evidence and remaining boundaries

The owner-uploaded 2 November artifact has been inspected: installation and all
ten two-group runtime checks passed, including fresh complete 28-target seals.
That artifact predates terminal-completion checks added in the next source batch.
The expanded runner also requires immutable completion to survive replay and
identity upgrade, bounded history export to include it, and survivor data/access
and authority locks to remain intact. Success records
`terminalFencingCompletion: true`, without changing either release flag.
Completion is persistent fencing/drain evidence, not destructive erasure.

Download `two-group-removal-isolated`: it includes the installation/host report
and incremental `two-group-removal-rehearsal.json` and
`two-group-removal-production-candidate.json`, with module hashes, checks and
unresolved infrastructure. A failure retains completed checks and the failed
stage. Transport errors are not accepted as generic denial evidence.

The broader rehearsal gate is still required by the real coordinator, so this
suite cannot claim complete non-rehearsal production acceptance. Existing
seven-receiver tests independently exercise observed held-admission callbacks
in rehearsal and production-candidate modes; the new run adds shared real
two-group inventory/identity/data integration rather than relabeling those tests.
Complete non-rehearsal identity authorization, callback-path coverage,
original-schema upgrades, coordinated history rollback and terminal erasure
remain unproven. Infrastructure sealing passed in the uploaded older rehearsal
artifact; new terminal completion and production receiver runtime checks still
require a fresh supported-worker run.
Previously downloaded plaintext or cached keys are not revocable by this test.

Local validation runs inventory/seal rule tests and exact generated-contract
checks. This sandbox rejects real PocketIC execution at the measured native
write-fault prerequisite; run the workflow to obtain runtime evidence. No
successful two-group runtime result is claimed until its artifact is inspected.