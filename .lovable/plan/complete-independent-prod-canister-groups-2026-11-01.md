# Complete independent PROD canister groups

## What is missing

The earlier statement that canister setup was done was too broad. The existing check verifies selected connections, not DEV-equivalent group readiness.

- **Four zero-link rows:** insights, media metadata, timer jobs and the router have no expected service-link comparisons in this checker. This does not mean they require no setup. Timer and router settings need separate validation; the router also needs registered groups and approval.
- **Identity access:** “Deletion registry not pinned” means its trusted group-registry binding is missing. An expected freshly-installed state is still incomplete for the requested group setup.
- **Router:** no registered groups and no recorded approval mean group routing is not prepared. These are not transport failures, but they are readiness gaps.
- **DEV:** committed setup records a base group and g2, with 13 dedicated g2 services. Current live DEV admission state must be read back rather than inferred from files.
- **PROD:** the public live repository records 18 base services. Their IDs have zero overlap with DEV. The provisioning workflow did not complete group registration, identity binding or signed routing evidence.

## Intended result

PROD uses the same group-based architecture as DEV with its own base group and independent g2. Existing PROD canisters are retained. No DEV clubs, accounts, media, keys or IDs are copied.

This project's preview and published Lovable site continue using DEV. Only the production app uses PROD after an approved release to prod. No database work, app publication or DNS changes are included.

## Implementation batch

1. **Establish current inventories.** Extend protected read-only checks to capture bounded group inventories, configuration revision, identity binding/admission state and available wiring evidence in each environment. Treat missing pins/groups/approval as incomplete readiness, even when individual service links pass. Clearly separate connection success from group readiness.
2. **Prepare PROD-only setup tooling.** Add a manual protected workflow using the existing encrypted PROD signing key. Enforce the live repository, prod branch, exact independent inventory and governor. Never reuse TEST workflows, DEV approval files or DEV runtime settings against PROD.
3. **Complete the existing base group.** Validate its whole inventory and required service settings, establish the supported PROD identity/registry binding and required removal wiring, and register it closed. Do not turn on rehearsal flags or bypass lifecycle gates. Review any separately gated lifecycle release before applying it.
4. **Prepare independent PROD g2.** Reuse a verified existing PROD g2 if present; otherwise create its 13 dedicated services only after the owner sees and approves current funding requirements. Configure intra-group links, dedicated media key handling and the PROD delivery identity where required. Verify and register closed.
5. **Produce PROD routing evidence.** Bind a fresh PROD-specific approval/snapshot to the live configuration revision, full inventory, module hashes and required removal wiring. Keep admission closed until exact-bound opening approval and successful checks.
6. **Verify and hand off.** Run signed full-inventory readback; test closed-to-open admission in the approved scope when opening is authorized. Verify final effective app IDs, including runtime overrides and alternate targets, preserve DEV/PROD separation. Prepare the production app connection for the later release without publishing it now.

## Technical safeguards and tests

- Use pinned official SDK/CLI interfaces and reviewed Candid types, not parsed CLI text.
- Journal and read back external intents with an exclusive PROD deployment lock; unknown writes stop, never replay automatically.
- Preserve existing canister data and encryption derivation; never reinstall or move encrypted DEV media.
- Add concrete tests rejecting DEV IDs/keys/paths in PROD, missing or partial group inventories, missing identity pin, missing/stale approval and unapproved opening. Keep connection health and group readiness separate.
- Signed mutations/readback run in GitHub because the governor key is held there. This sandbox can prepare and test tooling, not perform that authenticated setup itself.

## Approval boundaries

Approving this plan authorizes preparing the complete setup tooling, not an unseen card charge or live admission change. Exact inventory, funding and opening confirmations are presented before their protected GitHub runs. No new payment is requested until the existing account balance and required shortfall are checked.