# DEV Group 2 PII — owner-child-name performance release

**Release scope:** `dev_g2_pii_owner_fastpath` on [the protected existing TEST backend upgrade workflow](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/workflows/upgrade-all-groups.yml).

**Target:** exactly one existing DEV Group 2 canister: `pii_access_control` = `zt5a6-yiaaa-aaaal-qxp5q-cai`. Do **not** substitute the old `upgrade-group2.yml` workflow: its upgrade mode touches all thirteen Group 2 services. Do **not** use `dev_club_name_coverage_reader` either: it upgrades G1 and G2 PII together. Do not choose `full_backend`.

This release installs the already merged PR #1612's Motoko performance change. It omits redundant external Club, Competition and same-team authorization queries **only** when the signed caller is the recorded owner of **every** exact `name` record in the batch. Everyone else keeps the existing verified guardian/team/club/competition authorization and revocation checks. It does not change adult club-wide name-key enforcement, permissions, canister controllers, routing or on-chain encrypted records.

## Required preflight — read only

1. Require PR #1612 and the new release-scope PR merged to **main**. Confirm the exact source HEAD and that post-merge source checks and Motoko compile are green.
2. In the [TEST backend upgrade workflow](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/workflows/upgrade-all-groups.yml), choose **Run workflow**, branch **main**, action **check**, scope **dev_g2_pii_owner_fastpath**. Leave `checked_plan` and `confirmation` blank.
3. Inspect workflow artifacts named `all-group-upgrade-report`; `check.json` must show **exactly one** target with `groupId: g2`, `name: pii_access_control` and `canisterId: zt5a6-yiaaa-aaaal-qxp5q-cai`. Capture the 64-character `planHash`, verified original PII key receipts, current Wasm module fingerprint, settings hash, cycle safety checks and existing journal state. Any discrepancy **stops** the rollout.
4. Record a baseline of signed Test 3 Group 2 `read_account_list_my_children` and exact `get_encrypted_pii_batch(child_ids,"name",...)` operations via the official DFINITY connector. Verify no plaintext names or ciphertexts are logged. Existing sample measured about 9.2 s inventory and 10.8 s for one ciphertext read; these are connector wall times, **not** reliable pure canister latencies.
5. Before a change to the backend, review that source checks, pinned Motoko `--enhanced-migration` compilation, signed membership/PII boundary tests, and live check all succeeded. The checked plan must remain bound to the same main SHA and exact module bits.

## Protected upgrade — only after independently approved preflight

Use the **same** workflow, branch **main**:
- action: `upgrade`
- scope: `dev_g2_pii_owner_fastpath`
- checked_plan: **copy the actual 64-character `planHash` from this exact revision's successful check** (never invent it)
- confirmation: `UPGRADE DEV GROUP 2 PII ONLY`

The workflow requires the pinned original DEV governor under `group-2-admin-controls` approval and shared governor-deployment concurrency. It builds only the PII Wasm, verifies placement and service wiring, original encryption-key continuity across the full inventory, registered group identities, status/settings/cycles, past journals and exact module hash. It journals the intent before installation, runs the memory-preserving upgrade of the one target, verifies module and settings hashes, reads back the original key and publishes fingerprints through the existing reviewed mechanism.

**Do not rerun an unknown or partial upgrade as a fresh install.** An unresolved upgrade retains its pending release journal and requires explicit recovery/reconciliation, not a new plan.

## Post-upgrade acceptance

- Confirm only `zt5a6-yiaaa-aaaal-qxp5q-cai` changed Wasm hash; original Group 1 PII, Group 2 Club, Identity, Events, Messaging and other canisters remain unchanged. Controllers, cycles and all PII settings remain under existing protections.
- Repeat authenticated child inventory and encrypted-name reads for the same signed Test 3 account. Report cold and warm timings separately, across several samples; distinguish connector/tool wall time from direct canister time. No claim of speed-up without evidence.
- With separately connected legitimate Test identities, verify an actual owner, second guardian and same-team reader can access only their permitted names, while an outsider and removed user are denied. Explicit owner records and shared club names must remain encrypted.
- Confirm no changed child/guardian records, plaintext key leakage, new permissions or unapproved notifications. No PROD or Cloud Engine action.

The new release scope itself is only policy/workflow tooling. Creating and merging that source does **not** upgrade any canister or automatically turn on a PII/name release flag.
