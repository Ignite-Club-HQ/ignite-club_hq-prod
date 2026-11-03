# Live control-record readback — 2 November 2026

Protected GitHub inspection: https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/41549046867

Inspection completed successfully at 23:57:52 UTC on prod source `c4068395177c67a68709daef550afdaebb24763a`. Success means the inspection ran, not that protection is active.

Governor-authenticated identity consensus read returned `generation: 0` and `approvalPresent: false`. Both registered groups (`base`, `g2`) returned `accepting: false`.

Every management setting read for the 28 receiver targets returned admission disabled, removal disabled and no matching account-service authority. No receiver can be confirmed to use the new signed control record; the required flags/binding are absent and identity has no signed approval.

| Service | Base/shared | Group 2 |
|---|---|---|
| club_domain | Protection not enabled | Protection not enabled |
| club_points_domain | Protection not enabled | Protection not enabled |
| competition_domain | Protection not enabled | Protection not enabled |
| events_domain | Protection not enabled | Protection not enabled |
| insights_domain | Protection not enabled | Protection not enabled |
| media_blob_store | Protection not enabled | Protection not enabled |
| media_metadata | Protection not enabled | Protection not enabled |
| messaging_domain | Protection not enabled | Protection not enabled |
| mini_league_domain | Protection not enabled | Protection not enabled |
| notification_queue | Protection not enabled | Protection not enabled |
| pii_access_control | Protection not enabled | Protection not enabled |
| timer_jobs | Protection not enabled | Protection not enabled |
| vault_domain | Protection not enabled | Protection not enabled |
| secret_workload_identity | Protection not enabled | Shared |
| shard_router | Protection not enabled | Shared |
| identity_access | No signed control record, generation 0 | Shared |
| placement_registry | Not a control receiver | Shared |
| migration_coordinator | Not a control receiver | Shared |

Scope: 18 exact base/shared IDs plus 13 independently registered group-2 services, 31 unique targets total. Additional group IDs were read from the live registry, not certified against independent setup receipts; this is a bounded configuration diagnostic, never release acceptance. Receiver effective-mode getters are identity-authorized, not operator-authorized; no permissions were widened to read them. Negative settings and absent approval are sufficient to withhold confirmation, not to certify behavior.

The workflow file alone was added on prod as a single `[skip ci]` blob commit, then registered on main. No canister upgrade, setter, approval recorder, witness request, permission change, funding, data write, routing activation or opening was performed. The job evidence remains available as artifact `prod-control-record`; safe decoded log results are saved alongside this report.