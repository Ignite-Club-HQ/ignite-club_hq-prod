# Copy DEV to PROD (simple path)

Goal: PROD services run exactly the code your DEV services run today. After that, PROD only changes through a normal merge.

## Steps
1. **Find DEV's exact code** (read-only). For each of the 18 services, match the DEV fingerprint to a commit in the code history. Services DEV updated after 27 Oct are matched individually. Anything that can't be matched is listed for you before going further.
2. **Build that code** from those commits and check every built fingerprint equals DEV's. Stop if any differ.
3. **Show you the list**: service, current PROD fingerprint, new fingerprint (= DEV). You approve once.
4. **Upgrade PROD**, one service at a time, upgrade-only (keeps data, wipes nothing). Groups stay closed. Stop on the first error.
5. **Read back** all 18 PROD fingerprints and confirm each equals DEV.
6. **Open PROD groups** the same way DEV's were opened — separate approval.
7. **First real sign-in** on igniteclubhq.app and onboard the first club.

## Not doing
- No signing-key, safeguard-service or member-access switch-on steps. Those PROD-only items stay in place, unused.
- No DEV changes, no data copying, no deletion.
- Club deletion: built and tested on DEV later, then merged.

## Technical details
- Fingerprints via `canister_status` module hash (read-only).
- Builds reproduced with the pinned toolchain; mismatch = hard stop.
- Upgrade uses existing `promote-icp-prod.yml` upgrade-only mode with per-canister resume.
- Afterwards `deploy/prod/backend-release.json` records the DEV-matched hashes so future merges compare against them.
