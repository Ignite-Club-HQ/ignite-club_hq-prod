# Safeguard rehearsal verification — 3 November 2026

## Verified GitHub result

- Run: https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/41581910929 (run 22, attempt 1).
- Tested source: `bb0a7b77e93427540fb8e16a80dde09f24d831d7`, branch `main`.
- Job `removal`: success, completed 05:27:18 UTC. All test steps succeeded; none skipped.
- Artifact: `two-group-removal-isolated`, ID `13207705334`, 9,771 bytes.
- Archive SHA-256: `1aa1de75baa61ff77355a8a308162a85e7a71b8eee64709646055a40467484fe`.

## Inspected evidence

All seven JSON reports were inspected from the downloaded archive:

| Report | Result |
| --- | --- |
| removal-install-report | Passed supported-host installation |
| account-recovery-witness | Passed journal, snapshot and upgrade checks |
| production-recovery-integration | Passed all ten signed transport/refusal/recovery checks |
| external-controller-fencing | Passed all eleven checks |
| two-group-removal-rehearsal | Passed, 28 complete seals, no unresolved infrastructure |
| two-group-removal-production-candidate | Passed, 28 complete seals, no unresolved infrastructure |
| two-group-removal-production | Passed signed-production identity mode, full inventory acceptance and production authorization, 28 complete seals, terminal fencing completion |

The signed-production report explicitly verifies all 24 effective reader configurations, both aliases' access denial, preserved survivor photo/chat/Vault access, upgrade drift refusal and fresh approval, retained infrastructure obligations, and immutable terminal progress.

### Memory check

The external fencing test passed the checks that contain per-refused-call memory assertions: settled baseline reads followed by exactly unchanged memory across each refused control mutation. Its stored before/after handover readings rose by 222 bytes per target (identity, witness, participant); that is the controller-handover change, not the refused-call comparison. The artifact does not separately enumerate every refusal's memory readings; its successful strict assertions establish that check passed.

## Boundary

These are isolated disposable test services, not live PROD services. Every report retains `releaseAuthorized: false`. The successful rehearsal does not itself activate protections, deliver live signatures, open groups, move data, authorize erasure, or prove the commissioning runner end to end. The held activation runner still requires review and controlled release before protected owner-approved execution and live service-by-service readback.