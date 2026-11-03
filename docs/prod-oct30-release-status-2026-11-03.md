# 30 October PROD release — held before live changes

Owner approval: Paul, 3 November 2026 10:52 UTC, copy the exact verified 30 October source and upgrade 18 PROD service types in place. No permission to reinstall, copy DEV data, open groups or publish.

## Prepared
- Exact original source: `d321e85bbcdfbdd7045d5c8fcb57d937df4ac482`.
- Added exact-commit source-only mode to `scripts/promote-icp-layer.mjs` and its existing manual workflow. It copies only backend source and Cargo/Mops build inputs, not deployment configuration, IDs, receipts, website, database files or generated Wasm. Existing production-only files are retained.
- All 15 focused promotion tests pass; latest preview build log is OK.
- Compared GitHub historical and PROD trees read-only. PROD head observed: `723ec01a6c7c96148a03b49ead4c49fe43df54c6`. No GitHub writes or live deployments performed.

## Execution blockers
1. GitHub `main` still exposes the old copy workflow, without `source_commit`, after local tool edits. Dispatching it would copy newer main, not the approved historical source. Do not dispatch with unsupported inputs or use the old default copy.
2. The current PROD deployment workflow rebuilds `identity_access` with its acknowledged safeguard pins and checks that the built artifact contains the witness address before installing. The exact historical identity source does not include the production-account modules or their compile-time witness/approver references (`git show d321e85b:backend/identity_access/src/lib.rs` and historical tree comparison). Thus ordinary deployment cannot satisfy the current pin contract with the historical artifact. Do not skip or delete that contract silently. An explicitly reviewed historical rollback path is needed, not a new safeguard layer.
3. The existing PROD promotion upgrades only its 18 base IDs, not the second group's independent domain IDs; it uses changed-code selection. Do not claim two-group parity from that run. Clarify the exact target inventory in the release execution path before upgrading.

## Compatibility observations
- Protection modes in compared Motoko actor sources are transient; persistent removal maps already exist in historical source. This inspection does **not** prove a Motoko stable-state incompatibility.
- Historical identity does not reference newer stable partitions 33–38. Source inspection alone does not establish whether live records there are populated, and is not permission to erase them.
- DEV's exact identity fingerprint came from the private-name direct Cargo build, not the ordinary recipe build. Preserve that artifact distinction; a regular recipe build cannot be reported as matching the tested DEV account service.

Next action: make the source-only copy action available on GitHub, then resolve the exact historical account-service rollback and bounded target inventory without reinstall, key/controller changes, data copying, opening or publication. All PROD services remain untouched by this request.