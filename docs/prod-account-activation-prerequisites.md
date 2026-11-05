# Closed production protection setup

The owner approved protection settings and signed control approval, then requested
removal of activation blockers. Nothing here authorizes opening groups, moving
business data, erasure, recovery, delivery or replacing existing signing keys.

## Implemented

The independent-key preparation workflow supports separate account and recovery
roles. It verifies non-bypassable owner review, encrypts new keys in CI,
records an acknowledged intent before generation and refuses unresolved retries.
Only ciphertext, public keys and principals leave the runner. It makes no canister
calls. Production build-pin validation rejects missing, colliding and shared pins.

## Owner/custodian setup required

Both `production-account-approval` and `production-recovery-approval` GitHub
environments were created and read back at 00:13 UTC on 3 November with Paul as
required reviewer, self-review allowed, administrator bypass disabled, prod-only
branch policies and `OWNER_REVIEWER_ID` set. Paul may initiate and approve the same run;
separate signing keys and jobs do not require a second person.
Do not place these decryption credentials in the governor deployment environment.

In each environment store a separately chosen secret `PROD_APPROVAL_PASSPHRASE`
(at least 32 characters). Passphrases must not be workflow form inputs or chat text.
No passphrase is currently stored in either environment; the workflow cannot
invent or reuse the governor's private credentials.

Run the key workflow once for each role, with its exact confirmation. Save its
encrypted handover in the same environment as `PROD_APPROVAL_SEED_ENC`, and its
public values as `PROD_APPROVAL_PUBLIC_KEY` / `PROD_APPROVAL_PRINCIPAL`. The role
prefixed public names in the summary are the public build/operational pins, not
alternate private credentials. Record the other role's public identity via
`OTHER_APPROVER_PUBLIC_KEY` / `OTHER_APPROVER_PRINCIPAL` before subsequent recovery.

## Remaining implementation and execution holds

- Provision a genuine independent witness under reviewed control; retain a durable
  exact-target provisioning intent and reconciliation, never blind creation retries.
- Bind actual identity/witness IDs, distinct account/recovery public keys, reviewed
  source and witness module hash in a reviewed public manifest. Build immutable pins
  from that manifest and upgrade the existing identity only; never reinstall.
- Implement a bounded closed-only settings/approval delivery runner using the existing
  typed identity/witness contracts and acknowledged intent receipts.
- Gather authenticated whole-inventory lifecycle/configuration evidence. Retain real
  reviewed runtime and recovery evidence, not hashes of invented explanatory strings.
- Sign inventory provisioning separately when missing; then sign fresh protection
  approval and matching witness acceptance. Subject-progress authorization is a
  separate protocol and must not be silently bundled.
- Read back all 28 effective receiver configurations, exact 24 human/media readers,
  signed approval and live witness checks, while base and g2 remain closed.

As of the 3 November inspection, GitHub's repository secret names include the
governor and push credentials, but neither independent approval passphrase/key;
the `production` environment has no environment-level secrets. Secret values were
not read. Live activation is not complete.