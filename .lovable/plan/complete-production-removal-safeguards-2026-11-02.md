# Complete production removal safeguards

## Goal
Finish and test the production removal path across both groups before proposing a live upgrade. Keep PROD closed, preserve existing data, and leave routing approval and opening as separate decisions.

## Build
1. **Production authorization:** add a separately reviewed, exact-inventory release for base and g2. Verify original services, photo stores, shared infrastructure, deployment bindings and current revisions; authorize only their required account reads. Keep resource membership checks intact and refuse missing, stale or mixed evidence. Do not reuse the rehearsal switch or the existing g2 eligibility grant as broader authority.
2. **Permanent removal completion:** record an immutable outcome only after fresh authenticated zero-work seals from every frozen target. Preserve all subject fences, inventory and recovery history. Interrupted or uncertain replies stay locked and resumable. Completion is not permission to erase shared records, release router locks or reopen access.
3. **Isolated production-mode acceptance:** extend the existing two-group test to exercise the real production path without the broad rehearsal switch. Cover both aliases, positive encrypted-data controls, held callbacks, outages, retained worker obligations, repeated completion, upgrades, changed inventories and other members' continuing access. Add original-schema and recovery checks where required; explicitly report any remaining unproven recovery boundary.
4. **Closed release review:** prepare a read-only plan binding the accepted test evidence to exact source, modules, inventory, settings, upgrade compatibility and original photo-key preservation. Refuse deployment or approval when any prerequisite is missing. No live upgrade, switch, routing approval, opening, payment, database change or notification activation occurs in this implementation batch.

## Technical details
- Reuse the existing identity removal coordinator and persistent receiver contracts; retain bounded consensus calls and post-await account/configuration checks.
- Use additive stable storage for terminal outcomes and reviewed production authority; never overwrite existing partitions or applied migrations.
- Keep eligibility, alias disclosure, removal coordination and resource permissions separate.
- Test concrete authorization and completion rules beside the existing Rust and isolated actor tests. The successful uploaded 28-target report is rehearsal evidence, not production release evidence.
- Update the roadmap to record the uploaded runtime success and replace obsolete startup blockers, while retaining unfinished production and recovery gates.

## Acceptance
- The production-mode two-group run passes without a rehearsal flag, with all frozen targets accounted for and no outstanding obligations at completion.
- Removal survives interruption and upgrades; replay cannot change the terminal outcome or restore denied aliases.
- Other members retain legitimate access; ordinary removal from one club preserves another club's access.
- Missing evidence prevents release. Any signed PROD execution remains an owner-reviewed protected workflow after engineering acceptance.