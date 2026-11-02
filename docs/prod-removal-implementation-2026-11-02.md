# Remaining PROD protection — consolidated engineering status

## Scope and current evidence

The owner's 2 November report shows configuration revision 5, base and g2,
zero execution-fuel shortfall, and zero additive lifecycle calls left. Previous
closed wiring readback verified the photo quota registry and worker grants.
No additional payment or repeat wiring is required by that evidence.

This source batch changes no live canister, account, database, routing approval,
push schedule or opening state. PROD remains closed; DEV keeps its own canisters.

## Fixed in source

1. The routing reviewer no longer recommends `IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL=1`
   on PROD. Disabled is the correct diagnostic expectation. Enabling it cannot
   pass the production gate, even with a matching recorded routing approval.
2. Existing g2 eligibility inventory validation accepts the independently pinned
   `prod` deployment as well as existing `mainnet`. Every placement must still
   match the exact binding, host, network and revision. Mixed/foreign deployments
   fail; base is still excluded from this narrow new-group authorization.
3. Approval draft readiness is distinct from matching recorded approval, removing
   the first-approval circularity without authorizing a write. Unreleased service
   protection still suppresses all drafts.
4. The additive wiring planner no longer advertises an unaudited competition
   setter that the executor refuses. Every ready call remains in its reviewed
   execution allowlist; differing authorities are never overwritten.

## Required engineering before release — not settings-only fixes

| Work | Required behavior | Existing implementation / gap |
|---|---|---|
| Base acceptance | Independently validate original/shared and supplemental authorities, not just allow `base` as a group name | `identity_access/src/admission.rs` only releases new-group readers |
| Production guards | Authenticate exact readers, preserve resource permissions and fences before/after awaits, reject outages | `shared/AccountAdmission.mo` and service initializers remain rehearsal-only |
| Account ownership | Return only current, nonpending account aliases to approved production services | `lib.rs::service_account` remains rehearsal-only |
| Complete removal | Freeze exact inventory; drain every receiver; persist immutable terminal outcome without discarding fences | Existing begin/advance/seal preparation has no terminal completion bridge |
| Infrastructure and delivery | Classify every frozen target and preserve uncertain provider/worker obligations | Twelve human receivers are not complete infrastructure acceptance |
| Recovery | Preserve full denial/fence/history ledgers with authenticated external fencing and independent anti-rollback evidence | Existing adapter core is offline, not a production transport |
| Acceptance | Positive real encrypted-data controls, all-group held callbacks/outages/retries/upgrades without rehearsal | Existing local suites are partial, not all-path production evidence |
| Approval recording | Protected PROD-only reviewed evidence, revision CAS, durable intent/readback, unknown-reply reconciliation | Current snapshot writer is DEV-bound and must not be used |

Bound deletion is independently released timing protection; it does not prove
full service draining or account-removal completion. Identity eligibility is not
club membership, and repeated checks are not atomic global revocation.

## Rollout boundary

Finish the above code and consolidated local acceptance before preparing any
closed-only production upgrade/release plan. The owner reviews exact modules,
inventory, settings, migration compatibility and key preservation before a signed
GitHub execution. Recheck live results afterwards. Approval recording and opening
remain distinct, separately reviewed actions. Do not use an older green fixture,
a flag-only fix or the DEV deployment workflow to bypass these prerequisites.