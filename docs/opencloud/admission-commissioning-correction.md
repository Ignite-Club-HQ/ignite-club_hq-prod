# OpenCloud admission commissioning correction

## Scope and evidence

Prepared only in the isolated draft based on `main` commit `baf54816f5de254a02ba5a017566a1e8455b403f`. Existing PROD runner, policy, tests and workflow were reviewed at `9e70beb4f9130529b2fc2723ae6df2876ec44b3b`. The coordinated PR targets **main**, not prod. Normal main → prod promotion remains the release path. Nothing here accepts the draft, merges, deploys, dispatches commissioning, changes controllers or writes to a live canister.

Historical failure: [run 46128709457](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/46128709457), job `140928942261`. The log records four successful `set_account_removal_authority` calls before `review_production_account_inventory: Configured identity authority required`. It does **not** identify which receiver returned that error. Therefore no exact failed-canister diagnosis is claimed from that historical log. No production signing credentials were available here; current live settings were not queried or changed. Successful prior writes are historical evidence, not proof of their present state.

## Exact causes and corrections

1. **24 installed Motoko guards captured old environment values.** Every member receiver includes `AccountProtectionEndpoints.mo`, which permits only its configured identity, not the governor. `accountProtectionMode` and `accountAdmissionAuthority` are transient initialization/upgrade values. Management `update_settings` alone does not refresh them. The isolated stager previously pinned these only for fresh DEV. It now pins admission-only mode and that environment's exact trusted identity for both DEV and PROD, with rehearsal off. Ordinary mainnet sources remain untransformed. PROD's existing encryption, private-name and placement flags are not overwritten by this correction.
2. **Four infrastructure receivers were not equivalent.** Both Rust timer services and the Rust router previously disabled removal only with the legacy DEV compile flag; the PROD manifest supplied no such flag. The shared Rust gate now honors `IGNITE_OPENCLOUD_ADMISSION_ONLY=1` and retains legacy DEV compatibility. The PROD and DEV manifests compile the common flag. The staged Motoko secret-workload gate now also remains removal-off for both environments. Write-once governor authority setters and retained tombstones are unchanged.
3. **Bootstrap check could falsely pass; final readback used the wrong caller.** The old PROD check exited before actual identity-authenticated inventory review when no receipt existed. Final readback called identity-only receivers directly as governor. The corrected runner calls governor → identity → all 28 receivers through the existing bounded consensus review, before commissioning and again after the receipt. Missing settings/authority state is a blocked check, never a readiness success. Receivers still refuse governors and foreign identities; no authorization exception was introduced.
4. **Post-receipt review and completion were incomplete.** The identity review now requires immutable environment pins and exact saved receipt commitments; only the current local history watermark is normalized. Engine-only review requires entirely absent management-history rows, never fabricated history or the mainnet witness. All 28 configurations must have the correct identity, protocol and exact member/infrastructure classification. Collector callbacks recheck receipt/configuration state. Directory readback recomputes the exact live inventory commitment after two complete registry reads. Mainnet lifecycle/witness requirements remain intact.
5. **Resume blindly repeated configuration and release operations.** The production SDK runner/policy are brought back from PROD rather than retaining main's obsolete CLI. The real runner is adapter-injected for tests. It reads infrastructure authorities and the router deletion binding first, refuses foreign bindings, skips matching settings/setters, reads every change back, and resumes receipt-only/member-only/directory-only progress. Fully completed retries perform no mutations. Unknown callbacks stop immediately; a fresh invocation must independently read back state. Account/PII presence diagnostics are compared before/after, never rewritten or used to invent missing names.
6. **Failure diagnostics lost the target.** Identity review errors now identify the public receiver and operation. Runner failure artifacts retain safe `failedTarget`/`failedMethod` fields, source commit and explicit false removal/recovery/opening grants; raw transport errors and unrelated settings are not exported. Receipt-only status never claims 24 completed readers.

The existing PROD commissioning workflow is reconciled exactly from PROD, preserving its routing recovery choices, protected production environment, credentials, source-artifact binding and manual dispatch. Existing CI jobs now run the commissioning and Rust receiver regressions. No new workflow or deployment trigger is introduced. PROD routing recovery scripts already present on prod are not copied wholesale into main.

## Receiver audit

- **24 member receivers:** 12 services in each of base/g2 — club, events, messaging, vault, competition, points, mini-league, metadata, insights, notifications, PII and blob storage. All use the shared identity-only configuration endpoint and receive immutable environment-specific admission guards in staged builds.
- **4 infrastructure receivers:** shard router, base timer jobs, g2 timer jobs and shared secret-workload identity. None receive member alias-reading authority; all report `admission_required=false`, `removal_enabled=false`, `rehearsal=false` in admission-only builds.
- **29 reviewed authority modules:** those 28 receivers plus identity. Authenticated deployment module/controller verification still covers all 31 backends; placement and migration coordinators are not manufactured into member receivers.
- The existing club media-inventory exception already pins the two DEV clubs to DEV identity and the two PROD clubs to PROD identity. It is preserved, not replaced with a broad governor or arbitrary identity exception. Staged guard correctness fixes its captured authority/mode prerequisite.
- Directory transport uses exactly the registered base/g2 club authorities and immutable admission receipt. Mainnet legacy-source exceptions remain mainnet-only. `app_enabled=false` remains mandatory; configuration does not release public directory reads, certify current membership freshness or authorize opening.

### Exact PROD receiver inventory

Application: `ignite_prod_v2`; engine: `ignite-prod`; API host: `https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net`. All receivers trust only PROD identity `fyeax-jqaaa-aaac5-aaeaq-cai` for the configuration read; DEV builds instead pin DEV identity `h5lly-yyaaa-aaac5-aadqq-cai` from their separate inventory. Internal governor authorization stays separate from these service-caller identities.

| Receiver | Classification | Canister |
|---|---|---|
| `shard_router` | infrastructure | `fwgn7-saaaa-aaac5-aaebq-cai` |
| `secret_workload_identity` | infrastructure | `fea2g-6qaaa-aaac5-aaecq-cai` |
| `g1_club_domain` | member | `fndr2-iyaaa-aaac5-aaeda-cai` |
| `g1_events_domain` | member | `eanvu-hqaaa-aaac5-aaeeq-cai` |
| `g1_messaging_domain` | member | `e4jpf-qqaaa-aaac5-aaegq-cai` |
| `g1_vault_domain` | member | `gbubn-dyaaa-aaac5-aaeja-cai` |
| `g1_competition_domain` | member | `ehmta-kiaaa-aaac5-aaeea-cai` |
| `g1_club_points_domain` | member | `fkcxo-faaaa-aaac5-aaedq-cai` |
| `g1_mini_league_domain` | member | `evkez-gyaaa-aaac5-aaeha-cai` |
| `g1_media_metadata` | member | `e3ijr-5iaaa-aaac5-aaega-cai` |
| `g1_insights_domain` | member | `ejo6i-ryaaa-aaac5-aaefa-cai` |
| `g1_notification_queue` | member | `eslcn-laaaa-aaac5-aaehq-cai` |
| `g1_pii_access_control` | member | `gpwmf-yiaaa-aaac5-aaeia-cai` |
| `g1_timer_jobs` | infrastructure | `gixkr-vqaaa-aaac5-aaeiq-cai` |
| `g1_media_blob_store` | member | `eopy4-4aaaa-aaac5-aaefq-cai` |
| `g2_club_domain` | member | `ggvhz-oaaaa-aaac5-aaejq-cai` |
| `g2_events_domain` | member | `g5q34-uyaaa-aaac5-aaela-cai` |
| `g2_messaging_domain` | member | `hz5uo-nyaaa-aaac5-aaena-cai` |
| `g2_vault_domain` | member | `hcyil-xaaaa-aaac5-aaepq-cai` |
| `g2_competition_domain` | member | `gutqa-cqaaa-aaac5-aaekq-cai` |
| `g2_club_points_domain` | member | `gtswu-piaaa-aaac5-aaeka-cai` |
| `g2_mini_league_domain` | member | `h64s2-aaaaa-aaac5-aaenq-cai` |
| `g2_media_metadata` | member | `hq67s-3qaaa-aaac5-aaemq-cai` |
| `g2_insights_domain` | member | `g2r5i-zaaaa-aaac5-aaelq-cai` |
| `g2_notification_queue` | member | `hl3dx-biaaa-aaac5-aaeoa-cai` |
| `g2_pii_access_control` | member | `hm2fd-mqaaa-aaac5-aaeoq-cai` |
| `g2_timer_jobs` | infrastructure | `hfzo7-2yaaa-aaac5-aaepa-cai` |
| `g2_media_blob_store` | member | `hx7zg-wiaaa-aaac5-aaema-cai` |

## Validation

- All OpenCloud Node regressions: **61 passed**, including the actual adapter-injected runner's full commissioning path, pre-receipt check, all 28 refusal/mode/identity cases, missing reader, wrong store/group, stale inventory/receipt, unknown callbacks and no-mutation completed retry.
- Offline database/workflow policy regressions: **40 passed**, after installing the existing pinned `pglast==7.22` dependency. No SQL/migration/database files changed and no database was contacted.
- Rust regressions: **369 passed** (269 identity, 80 router/unit/integration, 20 timer/unit/integration), plus **4 compiled admission-flag tests** across common and legacy DEV modes. Exported identity Candid still matches the checked-in contract.
- Pinned Motoko shared admission/protection/removal suites: **3 passed**. **All 14 staged Motoko implementations compiled to WASM** with moc 1.16.1 and their existing per-service dependencies. **All 14 original → staged stable-layout compatibility checks passed**. Existing compiler warnings were not suppressed.
- Offline tests are not live acceptance. No claim is made that production commissioning or name unlocking is now complete.

## PR and CI status

Exactly one `gitremote_pr--create_pull_request` request was issued for branch `thr_4y08kp8u4tfq` targeting **main**. The tool returned **“Pull request creation initiated”**, not a PR URL. Read-only GitHub checks did not yet list that PR or any Actions runs for the branch. URL and remote CI confirmation therefore remain pending the platform completing this request; no second PR request, merge, dispatch or direct main commit was made. Existing CI jobs include the new regression commands and will run on PR creation. Local validation above is complete, but is not described as successful remote CI.

## Exact later deployment and commissioning procedure — NOT executed

1. Review the single PR to **main** and its CI results. Do not accept/merge this draft until Paul authorizes. Keep the existing DEV → PROD promotion order; never land this patch directly on prod to bypass DEV validation.
2. After approved main/DEV validation and separately approved main → prod promotion, use the existing `opencloud-prod-source-build.yml` workflow for the **exact resulting prod commit**. It stages `deploy/opencloud/prod.json`, compiles `IGNITE_OPENCLOUD_PROD_ADMISSION` plus the common removal-off flag, and publishes `opencloud-prod-backend-source-build`. No old artifact qualifies.
3. Use the existing upgrade-only PROD deployment path with that exact reviewed artifact set. A staging-rule change already selects all 31 backend targets for review; matching module hashes are skipped. All 24 member receiver guards, the shared workload gate and Rust infrastructure gates must reflect the corrected staged build before commissioning can succeed. Keep Motoko memory persistence, all controller/settings lists, original PII proxy/key identity and existing account state. Never install, reinstall or reset. No group opening, routing approval, frontend/Netlify switch, Supabase/email change or recovery/witness commissioning is part of this procedure.
4. On **prod only**, run the existing `opencloud-prod-commission.yml` in **check** mode, with `source_run_id` equal to that successful exact-commit source build. It verifies 31 live module/controller proofs, registry revision **4**, closed base/g2, all stores and authority bindings. If partial settings/authorities are missing, it reports blocked without writing. If configuration is present, it performs the real identity-authenticated 28-receiver review even before the receipt. Stop on foreign bindings, unexpected modules/settings/inventory or receiver refusal.
5. Only after separate explicit authorization, use the **same workflow**, **commission** mode, **same source_run_id**, and exact confirmation **`COMMISSION OPENCLOUD PROD ADMISSION`**. Matching previously applied settings and immutable setters are read back and skipped. The runner performs the bounded identity review, writes the existing additive receipt only if absent, completes exact 24 member readers and base/g2 transport only if needed, and repeats final authenticated review/directory/account-presence/module proofs. Global removal, recovery and rehearsal remain off.
6. Run **check** again. Require status `commissioned`, 24 completed readers, 28 verified identity-authenticated receivers, exact directory binding/source commitment, `app_enabled=false`, unchanged account/PII presence and all grant booleans false. A receipt alone is not completion.
7. Any uncertain mutation stops without automatic retry. Review the sanitized failed target/method, then begin a new check/readback. Never change a foreign authority, reset a receipt, fabricate history, overwrite a name or use recovery/rehearsal as a shortcut. Stop on any unexpected state. Functional name/member acceptance remains a separately authorized signed-in activity after successful commissioning.
