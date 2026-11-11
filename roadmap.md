# Roadmap — launch the live (PROD) system

## Referee chat stalled document upload — 11 November
- [x] Follow-up: latest preview logs show 57 stuck requests on visibility recovery. Reproduced missing POST storage-list deadline with failing test; listings now join the read timeout/resume registry, including auth retries. Preparation has a separate 60-second bound covering SDK auth/body waits; late reads cannot advance to writes, and the upload queue is released on failure. 52 focused checks pass; preview build OK.
- [ ] Browser reproduction reaches sign-in because email sessions are external/unmanaged; the actual signed-in referee upload remains unverified. No permission changes, automatic uncertain-write retries or PROD deployment made.
- [x] Preview telemetry shows 17 physical-storage listing requests and no file write; reproduced serial whole-club scan in a failing regression. Count independent pages in bounded six-request batches, retaining fresh exact capacity accounting, same-device upload serialization and Storage permissions.
- [x] 38 focused accounting/transport/competition attachment checks pass in default and ICP test configurations; preview build OK. Email attachment test confirms host-scoped transfer and registration before token creation.
- [ ] Authenticated referee-chat upload/message/readback and phone acceptance remain unverified: external unmanaged email session/device unavailable locally. This removes the confirmed scan bottleneck, not proof of the phone's complete upload; no PROD deployment made.

## Melanie — live email Women’s Masters Vault access — 11 November
- [x] Confirmed affected account uses live email sign-in; connected database is DEV, not PROD. DEV Women’s Masters is Pro and has no Melanie role record, so it cannot reproduce her live denial. Inspected DEV Vault policies/access functions without changes.
- [ ] Verify Melanie’s exact live competition role, access response and host entitlement before repairing: user-managed PROD diagnostics unavailable; no PROD credentials accessible. Need her exact warning and competition-role evidence, or authorized read-only PROD access. No permissions, roles, data or code changed.

## Competition chat file uploads — 11 November
- [x] Restored Upload File in competition group chats without requiring a club ID. Documents use the competition host/access lookup, competition grants and metadata; no chat membership or backend permission changes. Paul approved the phone document chooser exception; photo picker unchanged.
- [x] Five upload/access regressions failed before repair; 42 focused checks pass in default mode and 39 in ICP mode (backend-specific skips). Preview build OK. Existing competition Vault upload permissions still apply.
- [ ] Authenticated on-chain upload/message/readback and physical-phone acceptance require a delegated II session/device unavailable in the sandbox. No PROD deployment performed.

## All-user native ICP push rollout — 11 November
- [x] Paul requested progressing beyond his successful open/closed-app self-test; preserve email/Supabase push and native-only scope.
- [x] Identified current PROD recipient allowlist, base-queue-only transport, ten-send invocation cap, missing old-alert cutoff and lifetime 10,000-attempt stop.
- [x] Rollout plan approved; added worker-bound, governor-only activation with persisted new-alert boundary, thirty-minute freshness, safe successful-receipt compaction and bounded multi-batch sender draining. Code upgrades do not lift the pilot restriction.
- [x] Policy/receipt tests and canister compilation pass; 89 focused sender/foreground/lifecycle/tap/isolation checks and four contract-syntax checks pass; both generated contract trees match. Preparation and blockers recorded in docs/icp-native-all-member-rollout-2026-11-11.md.
- [ ] Execute expanded real-canister rehearsal in the existing TEST GitHub workflow: sandbox host fault-metadata preflight refuses PocketIC here. Ordinary chat/event preference/revocation acceptance and iPhone delivery remain unverified.
- [ ] Verify every active group has supported queue delivery; unknown/missing group authority must not fall back to the base queue.
- [ ] Protected runner/release execution requires GitHub/governor access unavailable in this sandbox; PROD mapping is absent, group fast-native delivery remains unimplemented pending verified inventory. No all-member activation or PROD changes made.

## Push statistics warning — 11 November
- [x] Paul confirmed phone test alerts work with the app open and closed; keep delivery and email push unchanged.
- [x] Reproduced false statistics denial from an unavailable protected administrator reader; align lookup selection with protection mode, retaining fail-closed protected reads and distinct transport errors.
- [x] Canister administrator/access regressions and compiler check pass; delivery code and email paths unchanged.
- [ ] Actual installed-app statistics readback requires promotion and Paul's II phone session, unavailable locally; no PROD deployment performed.

## ICP team carousel latency audit — 10 November 18:35 UTC
- [x] Read-only PROD comparison confirms all-team/all-league/all-group barrier, club-metadata wait, sequential league visibility checks, mismatched deadlines/retries and fragile saved-card fallback; findings in docs/icp-team-carousel-latency-audit-2026-11-10.md.
- [x] Reproduced two withheld-card waits and 24-hour snapshot expiry; 26 focused default-mode checks pass. Audit only: no runtime, canister, push, permission or PROD changes.
- [ ] Actual installed-phone ICP request timing awaits the affected device/delegated session; supplied preview telemetry is email-mode, not that session.

## Codemagic Android foreground adapter compilation — 10 November 09:23 UTC
- [x] Uploaded log identifies missing Firebase RemoteMessage on the app Java compile classpath. Regression reproduced missing compile dependency; setup now exposes the existing PushNotifications Firebase version with compileOnly, preserving runtime dependencies and email push.
- [x] Nine Android adapter/status-bar/Codemagic setup checks pass; preview build OK. Runtime Firebase dependencies and email notification code are unchanged.
- [ ] Full release compilation requires a new Codemagic build after source sync/promotion; Android SDK unavailable locally. No PROD deployment or phone alert confirmation.

## Approved consolidated production promotion — 10 November 08:35 UTC
- [x] Paul approved starting main→prod promotion of the prepared fixes; preserve production data and email-mode notifications, with no settings copy or wider push rollout.
- [x] Opened GitHub release PR #1453. Reproduced the failed workflow inventory check and corrected stale source types/profile DTO mappings; 165 focused frontend checks, 49 release-control checks, lint and two Android setup checks pass. Preview build OK.
- [ ] Merge PR #1453 only after Lovable sync publishes these repairs and GitHub exact-source checks pass; current main a0093c87 still has failed frontend/release-policy checks. Confirm database/backend/frontend jobs for the merge commit. No production changes yet.
- [ ] Redeploy the ICP purchase verifier after merge and prepare PROD-only native builds; device acceptance remains Paul's phone step, not a completed sandbox check.

## Optional off-chain media and purchase assessment — 10 November
- [x] Investigated source and official provider guidance: GIPHY prohibits partner media caching/proxying under standard rules; permitted thumbnails/owned GIFs are technically possible with audience/size/rights constraints. Apple signed JWS verification could move partly to ICP; Google current-state API verification should retain external credential-bearing transport.
- [x] Findings and recommended order recorded in docs/icp-remote-media-purchase-feasibility-2026-11-10.md. Source ICP verifier is Apple-only and lacks matched-product/app/account checks; no hosted purchase failure claimed. Research only; billing/push/email/live behavior unchanged. Hosting and optional chat-relay assessment postponed.

## ICP-only link-preview generation — 10 November
- [x] Removed the external preview endpoint from ICP-mode requests; reused messaging_domain's existing on-chain HTTPS helper, preserved email-mode behavior, separated metadata/in-flight caches by sign-in mode and lazy-loaded messaging helpers.
- [x] Three regressions reproduced before repair; 16 focused routing/preview checks pass in default mode and all 5 preview checks pass in ICP configuration; preview build OK. Boundaries documented in docs/icp-link-previews-on-chain-2026-11-10.md. Root AGENTS note skipped because user-owned rules already exhaust its size budget.
- [ ] Authenticated II preview/real-website coverage, cold latency and phone acceptance require a delegated session/device unavailable in the sandbox. Source websites/images remain external; no PROD deployment made.

## Club/team logo membership visibility — 10 November 07:26 UTC
- [x] Four regressions reproduced missing logo scope/member-key enforcement. New ICP club/team/request logos now canonicalize to clubs/<club>/logos and require the existing live-membership club key; old URLs, private files and email fallback remain unchanged. Monogram saves reuse the authorized context.
- [x] 53 focused logo/upload/decryption tests pass (7 email/ICP-specific skips); preview build OK. Phone-sized public login renders without page errors/overflow; this is not member-logo acceptance.
- [ ] Physical-phone signed-in upload and second-member viewing require an updated installed app and device access unavailable in the sandbox; do not claim phone confirmation.

## Forward-only ICP upload review — 10 November 07:22 UTC
- [x] Inventoried available new-upload paths; excluded older files, email-only competition uploads and production data changes. Platform creatives are stored inline on-chain; other active uploads use encrypted stores.
- [x] Reproduced three failures; repaired central ICP storage/session fallback and chat-document authority consistency. Default suites: 57 passed/11 mode skips; ICP suites: 30 passed/18 mode skips; preview build OK. Email fallback retained.
- [x] Recorded boundaries in docs/icp-new-uploads-audit-2026-11-10.md. Creation logo paths using club-logos/ lack automatic club grants; best-effort creation can hide logo failure. These are on-chain visibility gaps, not an off-chain byte migration.
- [ ] Authenticated new-upload/readback/decryption on II/native phone remains unverified: sandbox lacks the user's delegated II session and physical device. No PROD deployment or older-file transfer performed.

## Approved settings production release — 10 November 07:19 UTC
- [x] Paul approved moving prepared code to PROD without a manual TEST settings-save step; no arbitrary settings copies or business-data writes authorized.
- [x] Reproduced GitHub's frontend failure locally; replaced the control-character regex with equivalent character-code validation. Lint, all 72 focused notification/settings/routing checks and preview build pass.
- [ ] Consolidated into approved release PR #1453 above; merge after corrected source sync and successful exact-source checks. No merge or PROD deployment made; manual TEST acceptance was waived, not claimed completed.

## Player invite field visibility — 10 November
- [x] Stop auto-scrolling to roles while typing; focus/confirmation now scroll only the sheet, never the window. Name row/input can shrink within available width. Eight invite/search checks pass; preview build OK. Frontend only.
- [ ] Confirm real Android keyboard visibility after an updated app build; authenticated native invite flow unavailable in sandbox.

## ICP foreground phone alerts — 10 November
- [x] Added Android ICP-only system presentation for Firebase-owned foreground receipts, reusing the existing PushNotifications presenter; validates account/backend/ID, checks foreground focus and suppresses duplicate IDs. Both Codemagic Android builds install the adapter. Sender, Firebase service ownership, email paths and shared presentation configuration unchanged.
- [x] Three regressions reproduced missing Firebase foreground events on Android/iOS. DEV ICP now consumes both plugin receive sources, checking current account/mode/lifecycle and suppressing duplicate notification IDs; existing in-app toast receives the event. Email listeners and native/plugin configuration unchanged.
- [x] 36 focused ICP lifecycle/receive/tap/manager and email push checks pass; preview build OK. No PROD deployment.
- [x] 37 focused frontend checks and 5 Android scaffold/configuration checks pass; preview build OK. No PROD deployment.
- [ ] Confirm Android native compilation and foreground/background system pushes plus email non-regression on Paul's phone after promotion and a new Codemagic build; Android SDK/device unavailable in sandbox. iOS system presentation is unchanged, not claimed fixed by this Android adapter.

## Email sign-out login warnings — 10 November
- [x] Reproduced protected email observers surviving explicit sign-out; DEV now retires pages and cancels queries before native push unregister/session removal, ignores late refresh callbacks during logout, and clears user-scoped caches/channels synchronously.
- [x] Regression fails before/passes after; 14 focused logout/routing/diagnostic checks pass. Public ICP login has no blocked reads/runtime errors after 18 seconds; preview build OK. No production changes.
- [ ] Paul's real email logout → ICP login phone acceptance: hosted authenticated checks unavailable (external unmanaged auth), and physical Android session unavailable. The screenshot's exact live request stacks remain unverified.

## Remaining shared settings in ICP mode — 10 November
- [x] Approved PROD routing initialization completed in GitHub run 42773454286 (source 3093fc3baaad429f5958e97a50245812c4148156): protected action succeeded; independent public readback matches the exact two-club routing value. Only the shared routing key was initialized; no deployment or other settings/data writes.
- [x] Fresh PROD canister /auth displays both sign-in tabs with zero Supabase routing-row requests and no page errors. The canister-hosted signed-out routing boundary is resolved.
- [x] Corrected branded-site finding: signed-out hybrid/email discovery may read Supabase; that is expected, not an authenticated ICP settings gap. No branded-host or email-policy changes needed.
- [x] Final shared-settings audit: all active ICP settings readers/writers are on-chain; absent optional values use existing defaults. TEST/PROD public presence inventory complete without copying values. Added same-actor save confirmation after reproducing three failures; no write retry or email-path changes.
- [ ] Final authenticated TEST admin save/refresh/readback needs an II administrator session unavailable in the sandbox; DEV save-confirmation change remains undeployed. Missing GIPHY public key requires the owner's intended value, not a settings copy. No arbitrary PROD settings writes approved or made.
- [x] Audited available ICP settings only; historical media and unavailable external features excluded. Most runtime/admin settings already use on-chain authorities; gaps recorded in docs/icp-shared-settings-audit-2026-11-10.md.
- [x] Reproduced five failures and repaired mounted ICP startup isolation, source-bound runtime settings caches and explicit shared-app admin read/one-attempt write dispatch; email sign-in discovery/behaviour retained.
- [x] 54 focused isolation/routing/legal/sign-in checks pass in default configuration; preview build OK. No PROD deployment or settings writes.
- [x] Follow-up public TEST shared-authority inventory: all 11 reads succeeded; chat recap is false, ten other requested settings are unset. Re-ran 54 focused checks successfully. No PROD reads/writes or configuration copies; details in the audit.
- [x] Read TEST's public routing row through a fresh signed-out browser visit; confirmed both sign-in tabs and the two retained email clubs. Prepared the exact unchanged on-chain routing value and acceptance instructions in docs/test-on-chain-routing-initialization-2026-11-10.md; no invented targets or settings writes.
- [ ] Authenticated ICP settings save/readback requires a delegated II admin session; owner-reviewed TEST routing initialization is needed before removing signed-out hybrid public Supabase discovery. Phone switching requires a physical device.

## Team carousel resume audit — 10 November
- [x] Four regressions reproduced cached suspended refresh, suspended recovery, trial-blocked inventory and redundant league lookup defects. DEV repairs retain cached cards, restart only suspended observed inventory reads after long backgrounding, defer trial badges, reuse authorized full league rows, save canonical snapshots and limit enrichment to visible clubs. Permissions/live services unchanged.
- [x] 42 carousel/Home/Next Up checks pass in default configuration and 41 carousel/native-return checks pass in ICP configuration; mounted carousel and native event flows covered. Preview build OK; public desktop/phone sign-in has no runtime errors or overflow. Audit: docs/team-carousel-resume-audit-2026-11-10.md.
- [ ] Measure Paul's signed-in physical Android resume: unavailable TEST Internet Identity session/device; the reported 20-second delay and actual speedup remain unverified. No PROD deployment.

## Personal-data download on ICP phones — 10 November
- [x] Reproduced the native export using a blob anchor instead of a phone file; reused the existing native cache/share path for JSON, preserving caller authorization and email exports. Browser URLs now remain alive for 30 seconds; failed starts release them immediately.
- [x] 51 focused account/file tests pass across both modes; actual browser helper downloads valid nonempty JSON without page errors; preview build OK.
- [ ] Signed-in real ICP export and physical Android/iOS saving remain unverified; need a promoted new app build and Paul's phone. No PROD data or service changes.

## Native push wake reliability — 10 November 02:14 UTC
- [x] Added one content-free retry after 5 seconds and an ICP-owned 60-second backup check with rotating scans capped at 200 rows; idle/unconfigured queues do not call the sender. Paul-only LIVE allowlist, sender reservation authority and Supabase-mode delivery unchanged.
- [x] Wake policy and receipt Motoko tests pass; complete notification_queue source check passes; 30 isolation/PROD recipient/self-test checks pass. No interface or persisted-state changes.
- [ ] Activate on LIVE through main→prod code promotion and deploy the previously prepared immediate-reply sender; verify failed-wake recovery and receipt on Paul's phone. This turn made no deployment or live configuration changes.

## Chat access message — 9 November 22:35 UTC
- [x] Group chats now say "You don't have access to this chat" instead of "No messages yet" when the server refuses the messages: Supabase answer taken from `can_access_chat_group` (the same rule that hides the rows), on-chain answer from the canister's own refusal. Six access tests pass, preview build OK. All 104 live chats use a membership mode the rule understands, so only people who genuinely cannot read the messages see it. No permission, data or PROD changes.
- [ ] Confirm on Paul's phone after the next build/deploy: needs his signed-in session; email and Internet Identity chats both need a look.

## Competition admin leaving — 9 November 22:28 UTC
- [x] Additive missing-action repair applied on TEST; 6 disposable SQL permission tests and 6 frontend tests pass, preview build OK. Exact-role removal, owner protection and other roles preserved; existing chat triggers untouched. Anonymous execution refused; signed-in execution allowed without elevated identity. No live role/data changes.
- [ ] Live deployment and authenticated phone acceptance require approved PROD promotion; screenshot reports PGRST202, while TEST already has the final action.

## Native push continuation — 9 November 20:43 UTC
- [x] TEST notification-only check 42696315737 and update 42696751410 succeeded on synced main a9e2cad6a69ae3dd6ddf07e8e6e3e6c0239837b2. Both selected TEST modules, photo-key preservation, g2 routing snapshot and published fingerprints verified. 33 deployment tests and 36 sender tests pass. No PROD changes or manual alerts sent.
- [ ] Continue separately approved Paul-only PROD sender setup after main→prod promotion includes the verified notification changes; deploy and commission the isolated live sender, then obtain Paul's phone receipt/latency confirmation. No app deployment or phone acceptance occurred during the TEST update.

- [ ] All-users native push (Paul "start" 10:20 UTC 9 Nov): (1) live alerts all sit in the base group since g2 is closed, so no extra group coverage is needed yet; (2) a phone token now moves to the newest account that signs in on it (compiles; needs TEST update); (3) alert settings are already re-checked right before each send. Next: TEST update, faster Supabase sender, iPhone setup, staged rollout.

## Live Android sign-in routing report — 9 November 08:42 UTC
- [ ] Investigated Paul's installed LIVE Android /auth screenshots: reproduced restored II session selecting email under the default placement rule (two regressions fail before repair). DEV candidate retains restored II routing without a URL choice while keeping active email sessions and explicit email choice unchanged. All 58 focused auth/routing tests pass; preview build OK. Live phone reproduction/release acceptance still requires Paul's device and a separately approved new Android build. No live changes; push work remains separate.

## Minimal Supabase transport, ICP-owned notifications — 9 November 05:35 UTC
- [ ] Proceed 08:30 UTC: workflow is synced on main a9743489, but GitHub dispatch rejected job-level runner.temp (HTTP 422) before any job ran. Moved the temporary tool path into the preparation step using RUNNER_TEMP; retry the corrected synced workflow and inspect disposable evidence. Installation lineage/receipt erasure, private endpoint/wake commissioning and native TEST phone acceptance still block activation. No send or live changes.
- [ ] Proceed 07:46 UTC: added manual main-only disposable native-queue lifecycle workflow using existing compiler prefetch/PocketIC tooling; 15 tooling and 36 isolated push tests pass. Sandbox host probe correctly refuses incompatible memory tracking; GitHub source read still lacks the new workflow, so replica execution awaits sync. No commission, endpoint, alert or PROD/Supabase delivery changes. Remaining: replica run, installation lineage/receipt erasure, private endpoint/wake commissioning and native TEST phone acceptance.
- [x] Proceed 07:23 UTC: corrected main 02c32fca484f26b7001004d397f7351193d2a5fd synced. Read-only messaging check 42579262944 and notification_queue-only check 42579285519 both passed, proving authenticated download/unpacking repair in CI. Scoped upgrades 42579852019 (messaging) and 42580696979 (notification_queue via existing browser_push_test scope, no browser activation) both succeeded; all four selected TEST modules, original photo-key preservation, routing snapshot and published fingerprint readbacks verified. 74 focused deployment tests pass. No hosted endpoint, worker commissioning, alert or PROD changes; native sending remains unconfigured. Finish existing protocol/lifecycle/endpoint prerequisites and obtain a native TEST device before activation or phone acceptance.
- [ ] Proceed request 06:15 UTC: both new read-only checks on 432419476e6b206489a01c906dd53e0843055c22 (42571994904 notification_queue, 42571997281 messaging) failed at artifact build before live checks/install. Notification log proves authenticated downloads/checksums now pass, but tar selected moc while archive uses ./moc. Fixed extraction to accept exactly one root moc or ./moc, extract bytes without archive paths, write regular executable; regression reproduces old failure and passes corrected extraction, 46 focused tests pass. Revised code awaits automatic sync/new check dispatch; do not rerun old source. No upgrade, activation, alert or PROD changes. Endpoint/authority lifecycle and native TEST-device acceptance remain prerequisites.
- [ ] Proceed request 05:54 UTC: both TEST checks and their one retry failed before live checks/install due GitHub release downloads returning 504 (notification compiler 1.14.0, motoko-v5.1.0 and rust-v3.3.0 recipes). Added TEST-main-only authenticated API asset prefetch with checksum validation into verified ICP CLI 1.7.0/Mops cache layouts, preserving all versions; 32 unit/release tests pass and JS syntax passes. Public API asset verification here hit rate limit; actual authenticated CI prefetch remains unverified and requires synced revised source/new check runs. No upgrade, sender activation or alert, PROD unchanged.
- [ ] Paul approved TEST deployment at 05:50 UTC. Verified main source 58efedb595ec31e9b0b973efd60377721e30fcaf in Ignite-Club-HQ/ignite-club_hq-prod (main is DEV; repo name is not environment). Dispatched READ-ONLY notification_queue check 42569694727 and messaging check 42569696898; first running, second serialized pending. 24 focused transport/authority tests pass. No upgrade, endpoint, worker commissioning or send performed; inspect completed reports and exact hashes before upgrading disabled candidates. Remaining activation and TEST phone blockers above still apply.
- [ ] Paul requested TEST activation and phone alert at 05:48 UTC. Read-only live TEST query confirms native_push_configuration is not deployed (IC0536); no endpoint exists and source commissioning/receipt lifecycle tests remain unfinished. Installed phone app was last confirmed PROD, not TEST; do not adopt PROD tokens or change PROD routing to produce a TEST result. No activation/send performed.
- [x] Added initial isolated transport/ICP authority adapter, default-unconfigured TEST-base native reservation/settlement receipts, legacy handover refusal and fresh chat mute/access method. Firebase credential path verified without sending; both services compile, receipt policy assertions and 17-contract drift check pass. Dedicated app-owned TEST signing secret saved; existing TEST seed absent from repository/environment inventories. No public endpoint or activation. Details in docs/dev-icp-supabase-native-sender-2026-11-09.md.
- [x] Final focused batch: 59 tests pass across seven transport/authority/native notification files; Deno module checks and Motoko receipt assertions pass. No hosted endpoint, native TEST send or real-device latency measurement.
- [ ] Complete installation-generation lineage, receipt erasure/snapshot integration, real replica concurrency/upgrade tests and private hosted endpoint before commissioning; candidate is TEST base only and does not authorize deployment/phone-success claims.
- [ ] Wire non-blocking ICP wake and bounded ICP-owned recovery; verify exact TEST worker authority and exclusive handover before activation.
- [ ] Verify native TEST queued alert/inbox/tap and measured latency before any live-delivery changes; device acceptance and authorized commissioning required.

## Fast native ICP push scope — 9 November 2026
- [x] Prepared pinned upstream warning-redaction patch (Paul requested 05:17 UTC); original extracted queue-full block reproduces unsafe Debug formatting, patched block passes two credential-free Rust cases and preserves metrics. Evidence in docs/icp-warning-redaction/README.md; no full replica build/upstream submission/deployment or Firebase use.
- [ ] Verify that patch on protected `re2t4`: blocked on upstream acceptance and NNS infrastructure rollout plus supported runtime attestation. Fresh public telemetry still reports original GuestOS revision on all seven TEE-active nodes; Ignite canister controllers cannot upgrade public subnet replica/GuestOS. No TEST alert sent; live delivery unchanged.
- [x] Compared warning-log workarounds (Paul requested 05:14 UTC): newer upstream retains sink; source redaction is best ICP-only route, provider-enforced `error` logging suppresses this warning before formatting but public-subnet availability is unverified. Full-send external relay keeps Google credentials off ICP if separately approved. Encryption/throttling/WIF/outcall mode alone do not resolve it. Findings in docs/icp-native-push-options-2026-11-09.md; no runtime/live changes.
- [x] Investigated credential protection during use (Paul requested 05:10 UTC): refreshed all seven TEE-active nodes; exact reported GuestOS source places TLS inside GuestOS, but independently checked queue-full warning path can serialize request headers/body into replica logs. Node challenge-response attestation exists; no working public report retrieval/verified membership route obtained. Findings and pinned source in docs/icp-protected-hosting-verification-2026-11-09.md. Research complete, security acceptance NOT granted; no keys/deployment/send or Supabase/PROD changes.
- [ ] Obtain upstream credential-safe logging/release evidence and supported fresh runtime attestation before TEST sender provisioning. Blocker belongs to ICP infrastructure, not Ignite's canister; encrypted stored keys do not remove warning-log exposure.
- [ ] Build an isolated sender on the protected subnet and run one native TEST alert end to end (Paul requested 05:06 UTC). Implementation checkpoint completed: public target/deployment guidance and official memory/disk/upgrade protection confirmed, but provider-supported exact attestation, secure credential provisioning and outgoing TLS protection remain unavailable/unverified; recovery exceptions require more than measurement-only approval. Blocked before keys/deployment/send, not completed. Details in docs/icp-protected-hosting-verification-2026-11-09.md. No live delivery, existing-service moves, Supabase changes or recurring activation.
- [x] Protected-hosting inventory verification (requested 04:59 UTC): public API identifies `re2t4` as public/confidential/SEV-enabled; all seven listed nodes report TEE-active and UP. `x4jtx` is authorized-only; current TEST queue's `e66qm` subnet reports SEV disabled. Findings in docs/icp-protected-hosting-verification-2026-11-09.md. Inventory is not independent attestation; exact runtime/outcall/recovery guarantees and credential-safe authorization remain held. No deployment, keys, data moves or Supabase/PROD changes.
- [x] Investigated all material authorization/hosting categories after Paul's 04:56 UTC request: protected ICP/engines/private networks, vetKeys/threshold/WIF, isolated existing-host adapter, keyless Google adapter, serverless/always-on hosts, confidential external workload, gateway/token broker, GitHub OIDC and native alternatives. Findings saved in docs/icp-native-push-options-2026-11-09.md. Old payment-handler push-kick is not safe to activate unchanged; no services, credentials or Supabase/PROD behavior changed.
- [ ] Paul requested ICP-only native push implementation at 04:51 UTC, explicitly preserving the Supabase-only push method. Existing implementation/feasibility audit confirms the direct ICP sender still lacks verified protected Firebase authorization. Held on the approved plan's credential-protection prerequisite; no keys uploaded, external hosting provisioned, services deployed, queue mutations or sending activated.
- [ ] Build Firebase authorization protection on ICP (requested 04:54 UTC): official documentation and workload-registry audit confirm software-only encryption, threshold signing and federation do not establish secrecy of usable Firebase credentials from replicas. Blocked on an independently verifiable provider-supported confidential ICP target, including outgoing TLS and lifecycle protection; no such target is verified or provisionable through current project tools. Detailed finding saved in the existing feasibility note; no credential/runtime/Supabase/PROD changes.
- [x] Paul prefers no Render; prioritize ICP-hosted feasibility and keep external hosting an unapproved fallback, not the recommended implementation. Firebase phone delivery remains necessary.
- [x] Approved-plan read-only feasibility: Google federation supports ES256 and ICP's interface includes P-256, but bearer-token protection and an enabled deployment key remain unverified; findings recorded in docs/icp-native-push-feasibility-2026-11-09.md. No service or credential changes.
- [ ] ICP-only implementation held on verified protected-subnet/credential handling and an approved isolated TEST Google authorization route; do not upload live keys or activate sending to bypass these dependencies.
- [x] Scoped an ICP-hosted sender alternative without Render/GitHub delivery; single-request HTTPS is supported, but secure Firebase authorization remains unresolved. Plan requires protected/keyless TEST feasibility before implementation, measured latency/cycles and exclusive handover; no live activation or credential changes.
- [x] Explain the recommendation in plain English: a small continuously running sender replaces GitHub's scheduled wait; paid hosting required, seconds-scale target unmeasured.
- [x] Scoped one paid always-on worker with a cheap protected ready-work query, existing ICP authorization/Firebase delivery and exclusive handover. Target 3–8 seconds, not measured; TEST native evidence and hosting cost approval required. Supabase unchanged; no activation.

## Empty ICP team carousel — 9 November 2026
- [x] Reproduced serial role→player-league discovery; started the independent caller-authorized reads together. Thirteen carousel tests pass, including confirmed-empty, league-only and failed-inventory cases; preview build OK. No PROD changes; real Android delay remains unmeasured.
- [ ] Verify Paul's authenticated Android empty-team startup after a tested release; physical device/session required.

## Club-service fuel investigation (DEV only, 9 November 2026)
- [x] Prepared and dispatched disposable local TEST experiment 42551549182 on main 4799770b; probe compiled and 14 focused tests pass. Sandbox IC memory-tracking compatibility fails, so replica measurements use the native Linux GitHub worker. Verified compiler helper immediately reinserts failed timer dispatch; historical PROD causation remains unproven.
- [x] First GitHub experiment compiled successfully but stopped at missing subnet-state configuration before any measurement. Corrected and verified against the installed library; 15 tests pass. Idle sampling now respects 30-second recurring expirations. No fuel result or service-fix claim.
- [x] Corrected isolated run 42552280176 succeeded on main 993d364a at 02:42 UTC. Low-balance probes show cost amplification with zero completed callbacks in three cases; this is a candidate, not historical PROD causation. No deployed balance/settings changed.
- [x] Twenty-minute idle measurement: unchanged empty club consumed 1,253,040,541 cycles, matched timers 1,247,957,161, no-timer control 1,976,200. Callback counts 40/20 verified; evidence and interpretation saved in docs/dev-club-fuel-investigation-2026-11-09.md. Fifteen setup tests pass.
- [ ] Paul confirmed proceeding at 02:39 UTC. Safe service repair remains blocked on representative deployed balance/request/timer-failure evidence or equivalent disposable state/settings reproduction; local idle results alone do not establish the historical cause. No live deployment or production changes authorized.

## ICP email notification availability (DEV only)
- [x] Removed ICP email controls from member settings and admin report; blocked email preference handlers in ICP, including mode changes. Supabase save/report branches unchanged. Twelve tests pass in each backend test mode; preview build OK. No service/settings/PROD changes.
- [ ] Confirm on Paul's signed-in TEST account after frontend deployment; delegated Internet Identity session/device and canister deployment are unverified.

## Live native ICP push — Paul only (8 November 2026)
- [x] Added manual Paul-only native self-test using the existing protected sender; 39 focused tests pass, including one-device/native-only selection, unexpected-owner refusal, no-device, and uncertain-send no-retry checks. No queue writes, pruning, canister upgrades, Supabase changes or recurring activation.
- [x] Verified merged PROD 9e3c458f and dispatched manual Paul-only self-test 42558548142 on 9 November at 03:50 UTC; completed successfully, log confirms `accepted_by_firebase; Firebase accepted 1`. Selected one registered native device; no ordinary queue processing or recurring activation.
- [x] Paul confirmed the single native test alert reached his Android phone. This direct transport probe intentionally created no in-app notification row; ordinary queued delivery and iOS receipt remain unverified.
- [ ] Repair and verify the reported error when tapping the native test alert. The screenshot has no expanded error details or native stack trace; the exact failure remains unconfirmed. No device/session available for reproduction.
- [x] Manual run 42557719358 on 9 November completed with no pending notifications; recurring delivery disabled again. No notification sent.
- [x] Paul chose native-only push, live app limited to his account. Live sender now requires a recipient list (Paul only), unlocks the stored encrypted key, skips alerts older than 30 minutes. Recipient, queue and Firebase project settings saved in GitHub. 27 sender tests pass.
- [x] Firebase secret confirmed saved; merged PROD sender verified on 548149f0. Account-only manual run 42457013641 completed: claimed 1, delivered 0, failed 0, no-device/skipped 1. Recurring delivery disabled again after dispatch; Supabase push unchanged.
- [ ] Confirm a fresh eligible notification for Paul and native phone registration, then run another approved account-only send and confirm phone receipt. The first run's combined no-device/skipped count cannot distinguish an old/non-listed alert from missing device registration; no delivery is confirmed.

## ICP native push isolation (DEV only, 7 November 2026)
- [x] Added receive-only Enable test alerts in TEST ICP browser Settings; address stays in mounted memory and can be copied for one manual Firebase alert, without hosted sender/queue registration. Twenty-three focused tests pass; preview build OK and isolated worker HTTP 200. Supabase/mobile controls and PROD unchanged.
- [x] Phone screenshot confirms published TEST button but missing build-time web settings; added a TEST-card-only fallback containing the four saved public Firebase web fields, never server credentials. Published update and phone registration still need confirmation.
- [ ] Publish the updated TEST website and verify Paul's Internet Identity phone registration and manual alert receipt; no delegated phone session available and no alert sent yet. This tests browser reception only, not automatic ICP delivery.
- [ ] Paul approved a new securely generated TEST-only sender key on 8 November; finish single-alert authorisation/publication and phone acceptance without recurring delivery or Supabase/PROD changes.
- [x] New dedicated TEST browser signing secret generated and confirmed saved; isolated sender accepts the opaque secret with in-memory signing derivation. Twenty-two focused tests pass and preview build OK. No legacy/PROD keys used.
- [ ] New sender still needs secure governor authorisation limited to the browser test and successful hosted publication. Publication retry on 8 November again returned an internal error with no function deployed; no alert sent. Do not grant the general worker role as a shortcut: it also permits ordinary queue/device access. Existing key-transfer workflow cannot authorise the new hosted identity.
- [ ] Set up isolated DEV ICP phone-browser registration and a single self-test alert after Firebase web setup; verify deployed device/worker authority first, then require Paul's phone permission and delivery readback. No Supabase or PROD changes or recurring activation.
- [x] Minimal one-shot implementation prepared: separate expiring caller-owned ICP record, existing-worker atomic claim/settle, dedicated hosted function and Settings controls. No normal queue recovery/claim, device-token adoption, scheduler or legacy handover needed for this isolated test. Twenty frontend tests, thirty-five upgrade/handover tests, Motoko policy checks and 17-contract drift check pass; preview build OK.
- [ ] Activate the one-shot TEST path using the newly approved dedicated hosted key, not the failed legacy transfer (run 42436537667). Hosted publication continues to fail with an internal error and nothing deployed. TEST canister/frontend deployment and real phone registration/send remain unverified; TEST frontend GitHub Firebase public variables also need setup.
- [x] Prepared dedicated Firebase browser registration adapter and messaging worker, with no startup registration or legacy Firebase changes; 24 frontend and 8 handover tests pass, worker serves JavaScript and Firebase imports return 200. Adapter deliberately remains unwired: missing durable account/device authority and exclusive TEST sender handover block safe activation. No phone registration, TEST send or canister deployment occurred.
- [x] Firebase web setup saved through reconnect; all four public web configuration variables are present. Sending credentials remain server-only. This verifies configuration presence, not registration or delivery.
- [x] Paul selected TEST phone-browser testing on 8 November, not native builds or a PROD trial. Firebase connection is linked and accessible in this session and targets ignite-club-hq; this does not verify access from Paul's other Lovable login or delivery.
- [ ] Resolve reported Lovable project access under paul@igniteclubhq.app: Paul confirmed that login cannot open the project. Current-session Firebase link/access is valid; other-login project/workspace permissions and exact error remain unverified. Invite the account through project Share; if an explicit connection-access block appears, grant Can use in the connection's Sharing. No credential changes.
- [x] Rechecked setup at 22:57 UTC: Firebase gateway connection is linked/access-approved; hosted secret names confirm no TEST queue signing key. Two focused audits identify atomic device attempts, exclusive installation ownership, fresh chat mute checks and legacy TEST recovery fencing as missing. No registration/endpoint/send/deployment enabled.
- [x] Paul approved TEST-only handover. Prepared direct existing-key provisioning workflow with no overwrite/no activation, TEST legacy execution gate (variable not set), and isolated atomic begin/conditional-settle delivery contract with concurrency and lost-settlement regressions. No hosted key transfer, runner stop or send occurred. Details: docs/dev-icp-push-handover-2026-11-07.md.
- [ ] Complete integrated durable ICP installation/device generations, source attempt/epoch fences, fresh mute authorization, native registration and hosted orchestration; not implemented. Keep activation held until these contracts, authorized key/grant readback and exclusive runner handover are verified. Real Android/iOS dual-mode acceptance requires DEV builds/devices.
- [x] Prepared isolated Supabase Firebase transport without an endpoint/scheduler: DEV host/account/mode validation, generic payloads, single bounded request, provider-status preservation and ambiguous-acceptance hold. Six new transport tests plus six existing per-device tests pass; no real send/deployment or email/PROD change.
- [ ] Secure TEST worker handover: project secret list lacks its signing key and GitHub cannot return stored plaintext; needs authorized server-to-server handover or reviewed new-worker commissioning, never a key printed in chat/logs. Queue/device fencing and runner handover remain prerequisites.
- [x] Paul selected a separate Supabase-hosted sender for DEV ICP push on 7 November. Linked his saved Firebase connection and verified the generated app credential path (HTTP 200, verified), without sending anything or changing existing FCM secrets/email handlers. Assessment: docs/dev-icp-supabase-sender-2026-11-07.md.
- [ ] Implement/activate isolated Supabase sender: blocked on securely provisioned granted TEST worker identity, durable per-device attempt journal/ownership/current mute authorization and exclusive runner handover; no sender or schedule deployed. Retain ICP registrations/queue/authorization and do not overlap GitHub recovery.
- [x] Audited email/Supabase push, shared native ownership, ICP queues/producers and both delivery runners before runtime changes. Assessment: docs/dev-icp-push-isolation-2026-11-07.md. Existing 45 push/launch tests pass; no runtime, canister, hosted, credential or native changes.
- [x] Prepared commissioning-disabled DEV ICP native lifecycle/taps and guarded shared entry points with Paul's approval; legacy email/PROD paths remain intact. Added offline per-device delivery core with generic payloads, bounded retries and uncertain-send holds. 77 focused tests pass in both backend test modes; preview build OK. No canister/native/Supabase/PROD deployment or configuration change.
- [ ] Finish server-side installation ownership/permission status/revocation, current mute/device/category policy and fenced per-device queue recovery with live gateway adapters as one integrated commissioning batch; external hosting/credentials and DEV native acceptance are unavailable. Native registration stays disabled; no delivery claim.
- [ ] Verify current DEV queue inventory and worker grants after secure provisioning. Firebase is now connected and Supabase hosting selected; draft transport is tested but not deployed. Do not enable the stale Supabase push-kick or concurrent recovery workers. DEV messaging no longer invokes the stale Supabase drain.
- [ ] Demonstrate Android/iOS ICP delivery plus unchanged email/Supabase delivery across foreground/background/closed, taps, multiple devices, rotation/revocation/mutes/preferences and account switching. Physical DEV native devices/builds and authenticated sessions unavailable; Codemagic remains PROD-only. Not complete; no PROD deployment.

## Gallery notification refusal (DEV only, 7 November 2026)
- [x] Screenshot confirms saved photo with a refused announcement. Traced media_metadata → club_domain → notification_queue: backend verifies uploader membership, owned team, reciprocal gallery authorities and eligible audience; no browser-selected recipients. Refusal text is collapsed to `refused`, so the screenshot cannot identify which check failed. No permission, wiring, data or production changes.
- [x] Found and repaired a concrete TEST upgrade omission: only media_metadata.set_gallery_authorities ran, while the club's new reverse galleryMediaAuthority migration defaults to null. Upgrade runner now assigns the exact owning-group reverse link too; both calls are journaled and stop on refusal/unknown replies. Forty-two policy/regression tests pass. No backend permissions, photo data or PROD changes.
- [ ] Apply the prepared repair to DEV through authorized governor execution and verify a new upload's notification readback. Existing photos/uncertain announcements must not be replayed. Source sync/release and delegated upload acceptance remain unverified; screenshot cause is consistent with the omission but exact deployed refusal remains unconfirmed.

## Cold first-open chat repair (DEV only, 7 November 2026)
- [x] Source-traced all four chat paths; reproduced duplicate page calls and redundant mount invalidation. Identified sequential DM profile/reaction waits and the team's additional 1.5s banner gate. Real slowest ICP operation remains unmeasured.
- [x] Focused repairs: account/full-target/page-bound in-flight reads, active mount-read reuse, DM progressive text/parallel enrichment, 25-message DM limit shared with warming, remove team banner message gate, keep authorized messages visible during profile settling; operation-only actor/dispatch timing ledger. Existing destination permissions/routing checks unchanged. 153 tests pass; preview build OK.
- [x] Thirty deterministic uncached DM benchmark samples: first-text median/P95 2600/2600→600/600ms under fixed synthetic delays, not real network evidence. Public desktop/mobile sign-in checks: no runtime errors/overflow. Details in docs/dev-cold-chat-opening-2026-11-07.md.
- [ ] Authenticated startup/never-cached and cached UI flows across all four types, real ICP operation rankings, Android cold median/P95 and deployed DEV acceptance: blocked on delegated DEV Internet Identity session/physical device. No performance-target or deployment claim; PROD untouched.

## Next Up RSVP repair (TEST only, 7 November 2026)
- [x] Selected adult RSVP appears immediately while saving in the background; acknowledged row updates before supplementary refresh, failed saves reveal the previous answer, and no automatic retry. All 10 mounted card tests pass (four new regressions failed before the repair); preview build OK. No backend or PROD changes. TEST canister deployment and Paul's phone acceptance remain unverified.
- [x] Reproduced prefixed-account save rejection in the mounted card; normalized and verified the signer for self/child saves, added one-attempt routing and private diagnostic logs. Mounted save/readback, denied-save/no-fallback and account-switch regressions pass; permission checks unchanged. Preview build OK. This reproduction does not establish that Paul's phone failure has the same cause.
- [x] Deploy audited RSVP backend repair on TEST: read-only check 42397361622 passed for source a919237931c28eceb71702fca0a03a77244a9ad5; events_pitch upgrade 42397706521 completed successfully at 17:50 UTC, verified all six selected modules across both TEST groups and published/read back fingerprints. No frontend deployment or PROD changes.
- [ ] Verify signed-in TEST save and readback on Paul's phone: blocked on his delegated Internet Identity session/device; exact phone refusal and real save timing remain unverified. PROD untouched.

## Reverted TEST carousel crash — 7 November 2026
- [x] Reproduced the exact initialization crash in three component regressions; fixed only the timing callback's skeleton/empty-return inputs, retaining Paul's reverted loading behavior. Nine carousel/recovery tests pass; preview build OK. PROD untouched.
- [x] TEST deployment 42362790648 succeeded for repair commit fb44c0df on main at 10:13 UTC. Public TEST serves live-index-DJEskhsI and MyTeamsPremiumCarousel-CzISABkV; inspected callback uses initialized skeleton/display inputs rather than later card arrays. Reverted loading behavior retained; PROD untouched. Paul's signed-in phone acceptance remains interactive.

## Cold thread opening investigation (DEV only, 7 November 2026)
- [x] Instrument query attempts, failure categories and fallback durations including stale-sequence/write-fence paths; late enrichment reports independently and first-message logging waits for paint. Cold/cache classification uses actual read path, not prior visits.
- [x] Four ICP thread loaders return core pages without enrichment; skip duplicate mount invalidation during active fetches, remove duplicate team manual refresh and banner wait. Account/target-bound in-flight reads and bundles; account-change/refusal retirement preserves transient-error caches. Mount freshness and permissions unchanged.
- [x] Investigated backend scans and membership query dependency; public DEV base messaging/club dashboard metadata reports the same subnet. Group placement and per-query load remain unverified; no backend/PROD changes. Details: docs/chat-cold-opening-dev-2026-11-07.md.
- [x] 108 targeted tests pass in ICP mode; public preview reaches sign-in with zero runtime errors and preview build OK.
- [ ] Authenticated four-thread UI acceptance and at least 30 genuinely cold Android opens: blocked on physical Android device and delegated Internet Identity session. No cold before/after performance result or TEST canister deployment is claimed.

## Event editing routing warnings (TEST only)
- [x] Reproduced all four edit-form reads reaching Supabase under Internet Identity; routed duties, club subscriptions, member roles and saved event locations through their existing authorized scoped ICP readers. No mutation, permission or PROD changes.
- [x] Routing regressions fail before and pass after; added denied-roster/no-fallback and club-scoped profile-enrichment checks. Seven related test files pass in both modes; preview build OK.
- [ ] Confirm the four warnings no longer recur on Paul's TEST phone after frontend deployment; requires his Internet Identity session/device. These screenshots show routing warnings, not the cancellation member-count failure, which remains unverified.

## Paul's production app-admin access — 6 November 2026
- [x] Paul supplied his exact production website sign-in ID. Prepared production-only check/grant workflow for that login with encrypted existing governor key, bounded existing-account lookup and identity/insights readback; five permission tests passed and workflow YAML validated. No club memberships or identities are changed.
- [x] Production read-only check succeeded (run 42174631808); owner-approved grant run 42174718425 completed successfully on prod with exact-account identity admin and both insights admin readbacks enforced. Only Paul's confirmed existing login was granted; no identity links, club memberships or other users changed. Website/assistant session refresh remains Paul's interactive confirmation.

## TEST alternative-address assistant identity — 6 November 2026
- [x] Paul accepted ICP MCP App Operator Terms v1.1 as authorised operator for TEST discovery publication.
- [x] Prepared DEV-only discovery for ignite-club-launchpad.lovable.app, declaring existing DEV canister identity and exact DEV services; 3 isolation tests passed, local HTTP files verified, preview build OK. No PROD/sign-in changes; public URL still requires TEST publication.
- [ ] Publish TEST website and compare a fresh ChatGPT/Claude connection against Paul's existing TEST account; external publication and interactive Internet Identity required.

## ICP home carousel — 6 November 2026
- [x] Removed serial team→league discovery and club→trial waits; shared in-flight club reads. All three delay regressions failed before and passed after; 24 home/carousel tests passed in each backend mode. Preview build OK; no PROD changes.
- [ ] Verify signed-in ICP carousel on a real device after merge; requires an Internet Identity session/device.

## PROD settings promotion — 5 November 2026
- [ ] Live repair (run 42141334879) stopped before any write: g2 record read from wrong branch. Fixed and rehearsed; waiting on next main→prod merge, then confirm Events and Media load on igniteclubhq.app.
- [x] Real replica settings test passed on GitHub after ordering fix. Earlier: run 42139076566 installed all four real services and reproduced the exact protection conflict, then failed only on settings-array ordering during repaired readback. Test now uses the production order-independent commitment, with a regression rejecting changed/missing/duplicate settings; rerun awaits synchronized source. No PROD access; full replica acceptance remains unconfirmed.
- [x] Executable offline rehearsal complete: 26 tests passed; reproduced and fixed blob-store upgrade arguments and final unchanged-service drift detection. Workflow YAML valid; no PROD calls. This is not replica/live events acceptance.
- [x] Built and tested allowlisted PROD settings compatibility across base and g2; preserves data, keys and separately approved feature switches. No PROD execution; exact running artifact required before repair.
- [ ] Verify authenticated events loading on igniteclubhq.app after the tested promotion reaches prod; requires merged source and an Internet Identity session.

## Current pre-merge verdict — 5 November 2026 triple-check
- [x] Phone-app compatibility audit of the 8 planned PROD DB changes: 7 safe for current iOS/Android apps; email-signup check risk LOW (invited members sign up via website first; login unaffected). Paul accepted 5 Nov — all 8 ride the merge. Saved: docs/release-review/phone-app-compat-audit-2026-11-05.md. No PROD changes.
- [x] Paul approved the currently missing club plans, small and growing, at 04:10 UTC on 5 November. Exact structural SQL/hash recorded in docs/release-review/club-plans-owner-approval-2026-11-05.md; no PROD execution.
- [x] Plan additions confirmed on PROD: Paul ran the ALTER TYPE and the readback on 5 Nov ~04:30 UTC shows all five values — starter, standard, unlimited, small, growing. Existing six-migration automated approval remains unchanged.
- [ ] Consolidated batch complete where possible: policy/profile/publication fixes tested; final GitHub source check waits on synchronized commit; public PROD routing read returned zero rows and needs owner-approved access repair; competition-news function/policy bodies need bounded read-only target evidence. See docs/release-review/merge-unblock-five-steps-2026-11-05.md. No production changes.
- [x] Rechecked exact six approved database migrations: 39 safety tests, 2 signup rehearsals, 24 competition and 12 invitation/welcome rehearsal tests passed; 45 original hashes/inventory valid. No PROD execution.
- [x] Repaired the source of the 68 website diagnostics: renamed only TypeScript principal parameter labels in both generated trees (20 files); syntax regression now passes, topology/drift/lint/runtime checks pass. Release rerun: 96/97 tests pass (existing workflow-env-names failure); 24 competition + 12 invitation/welcome rehearsals pass. No PROD changes. Evidence: docs/release-review/website-source-errors-fix-2026-11-05.md.
- [x] Product TypeScript and lint: fixed locally (0 type diagnostics, lint clean; secure-sign-in routing tests 1,294 passed). The group-result combine step is now typed through a shared `mergeListsById` helper instead of loose typing. GitHub confirmed on commit 41aabbde (5 Nov 04:02 UTC): frontend, rust-canisters, deploy and auth-release-policy all success.
- [x] Resolved both signing-key workflow branch assertions; replaced obsolete unconditional PROD PR hold with complete offline six-approved-source validation. Actual target ledger/promotion/publication gates untouched; 108 focused release tests pass.
- [x] Supabase profile compatibility: legacy fields save without country; optional country is probed independently and only exact missing-column rejection permits one fallback. Country cache not updated on fallback. 9 helper tests + existing auth/news tests pass; authenticated hosted save remains unverified (external unmanaged Supabase session).
- [x] PROD signed-out routing: Paul confirmed applying the scoped visitor policy on 5 November. Repeated the same anonymous live read: HTTP 200 with exactly one backend_routing_config row; unrelated keys return HTTP 200 with zero rows. Settings retain Supabase default and the two retained email clubs. Agent made no PROD writes.
- [ ] Practice merge built 5 Nov: branch `merge-rehearsal-2026-11-05`, commit bc4232da, draft PR #1412 into prod. 25 overlapping files resolved to main (prod copies were older), routingGates.ts kept from prod, prod mappings/release.json kept, netlify.toml from main, old root migrations removed as on main (no DB effect; safe-apply reads main's 46-file inventory). PR #1412 results: website + canister checks passed; two release checks failed because the small/growing plans migration was missing from the release list. Fixed on main (held, already live). Next: rebuild practice merge on the new main commit and rerun checks. See docs/release-review/merge-rehearsal-2026-11-05.md.
- [ ] Final merge inventory review performed against exact main/prod/common-ancestor trees: 22 paths changed differently on both branches, including routingGates.ts; 1,135 ancestor migration files absent main need disposition before certifying a merged tree. PROD mappings/release.json are PROD additions and normally retained. No open main→prod PR exists; actual resolved merge checks remain unavailable. Preserve PROD routingGates/mappings and main Netlify settings. No merge performed.
- [x] Separated publication decisions: PROD push still upgrades backend code; frontend publication defaults off, manual dispatch pins its SHA, requires existing mapping before governor setup and uses upgrade-only. Store builds run when started manually from prod (no extra approval variable). No publication dispatched. PROD frontend mapping still absent; native bridge/phone acceptance remain separate release prerequisites.

This verdict supersedes stale readiness/blocker descriptions below. No main-to-prod merge is recommended until the confirmed source/CI/profile blockers are resolved; live permissions/acceptance remain evidence limitations, not proven failures.

Direction: move both environments **forward** onto the same current code. No rollbacks, no
reinstalls, no safeguard work below. Groups stay closed until Paul says "open groups".

## Done
- [x] DEV upgraded forward to the tested code and verified by Paul on his phone (clubs and chat working).
- [x] Account service upgraded in place on PROD to the same tested code; other 17 live services already had identical code. Data kept.
- [x] Live branch restored after the over-broad copy (all 3,477 files back, service address table intact).
- [x] Member-access tool (8 files) copied to the live branch; live branch now at `b4fb2c8b`.

## In progress
- [x] Repair reproduced notification/inbox/photo test failures and verify all four reported areas: 40 Supabase/34 ICP tests passed; 43 related files per mode passed (450/425 tests). Event-group failures not reproduced; no source change needed there. Full-suite rerun not included; no PROD changes. See docs/release-review/test-failure-repairs-2026-11-04.md.
- [x] Calendar export frontend repair: native cache→FileOpener→Share→visible error, Google option, club-zone UTC, public links and byte folding; 25 calendar/menu tests and 21 related read tests passed (5 mode skips), helper tests also pass in Los Angeles/Tokyo. See docs/release-review/calendar-export-verification-2026-11-04.md.
- [ ] Calendar physical acceptance before promotion: single event and whole schedule on real iPhone/Android, correct saved times and working links; blocked on physical devices/local synced DEV build and authenticated access. After approved release repeat on both phones. No database, notification, RSVP or PROD-data changes authorized.
- [x] Build invitation-default/welcome-DM PROD candidate: 12 exact-SQL tests and 24 frontend tests passed (1 mode skip). See docs/release-review/invitation-welcome-build-2026-11-04.md; existing invitation lifecycle unchanged, no hosted writes.
- [ ] Deploy defaults/welcome and test a real club invitation end-to-end: blocked on PROD deployment/session access, exact schema/policy review, approved-only migration registration and fixed Ignite sender readiness. Candidate not yet executable or included in merge approval.
- [x] Build standalone PROD fixture/Vault/email-official SQL; 24 exact-SQL isolated tests and 14 frontend tests passed (15 mode skips). See docs/release-review/competition-functions-build-2026-11-04.md. Scores, old links and role/chat triggers untouched; candidate not deployed.
- [ ] Deploy/test competition functions live: blocked on authorized PROD connection/session, exact manager/policy review, three structural expression approvals and candidate registration in approved-only migration inventory. Existing signup-only release approval unchanged. Competition Vault uploads remain separately blocked.
- [x] Fix photo/file destination: restored authenticated environment-bound Storage callbacks, removed purchase-service redirect; 58 tests passed, 13 mode-specific skips. See docs/release-review/photo-file-upload-fix-2026-11-04.md. No hosted writes or permission changes.
- [ ] Verify authenticated PROD upload/readback; competition-vault remains blocked by bucket/access dependencies and DEV service-only policy. Workspace has no PROD authenticated session; transport tests are not hosted acceptance.
- [x] Deep full-app pre-promotion regression audit saved: docs/release-review/full-app-prod-regression-audit-2026-11-04.md. Verdict: do not promote whole frontend yet.
- [ ] Resolve full-app release blockers before main→prod: authenticated media acceptance (destination repaired); missing fixture visibility, competition Vault, official email invites, invite defaults and admin tables; routing-row and edge-function evidence; red full/publication suites; authenticated email-club acceptance. Requires implementation decisions and PROD-authorized verification.
- [x] Supabase promotion source assurance: 41 release/publication tests, 42 email-policy tests and exact-approved-SQL isolated PostgreSQL regression passed; regression added before deployment in workflow. See docs/release-review/supabase-promotion-safety-2026-11-04.md.
- [ ] Full-app promotion assurance remains blocked on current PROD routing-row verification and authenticated retained-email-club flows; resolve missing fixture visibility/Vault/invitation dependencies before claiming a break-free frontend release. Catalog exports do not prove the signup guard is dormant. No PROD writes made.
- [x] Compare remaining Supabase feature migrations against PROD evidence (Paul uploaded the expanded PROD catalog 4 Nov ~05:58 UTC; 1,515 rows). Results saved in docs/release-review/remaining-feature-compatibility-2026-11-04.md: real gaps = welcome DM + profile country, invitation message defaults, competition news admin helpers, competition vault access functions, official email invites, memory reports; competition events present but version uncertain; role removal present; scores/AI/free-media stay held. No deployment or data writes.
- [ ] Prepare DEV-tested, safe-only releases for the confirmed PROD gaps (welcome DM + profile country first), each with owner approval before merge. Consolidated checklist: docs/release-review/prod-follow-up-checklist-2026-11-04.md (gaps, held items, pending decisions).
- [x] Held items path forward written: docs/release-review/held-items-path-forward-2026-11-04.md.
- [ ] Paul runs the 5-function fingerprint check on PROD (closes competition events + role removal if matching DEV).
- [ ] After live site rebuild: PROD-only email-club settings row with PROD club IDs, then one invited sign-up test.
- [ ] Decide: create Ignite team sender account on PROD (welcome message stays silent without it).
- [ ] Post-launch, separate approvals: hidden scores (structure, then archived copy), free-media cleanup + job, reminder/welcome-email activation, competition document storage area, AI review.
- [ ] Six-candidate fresh PROD compatibility check requested: source effects documented and catalog-only query prepared. Blocked on PROD SQL Editor export; workspace Supabase access is DEV-only, and live workflow has no read-only catalog mode. GitHub inspection only; no workflow dispatch or database writes. See docs/release-review/six-candidate-compatibility-2026-11-04.md.
- [x] Added exact safe-only staging to the existing database workflow: complete original hashes, separate candidates/holds, read-only manual safe-plan default and offline source checks. 34 focused tests passed, including a fixture end-to-end runner check proving no write command runs; workflow YAML validated. Originals and full push-release gates remain unchanged; no history repair or live deployment.
- [ ] Safe-only execution remains held: obtain fresh exact PROD target definitions/dependency evidence, rehearse target-specific SQL, and approve the exact application mechanism before enabling an executor. Current safe-plan reports six initial candidates and never deploys.
- [x] Fixed protected-source mismatch using six exact non-executable held sources; archive
      never substitutes for applied/mismatched executable SQL or suppresses pending source.
      Run 41765096598 automatically completed successfully: 0 migrations, 0 edge functions.
      43 focused tests passed. Current prod had no pending changes; no data or schema changed.
- [x] Rebuilt structural-only Supabase promotion on main/prod; 42 focused tests passed.
      Automatic push run 41764557107 passed source tests and read the live migration ledger,
      then stopped before ALL writes: prod lacks six fingerprint-protected 30 October
      migration source files named in main's release policy. No schema/functions/data changed.
      An initial attempt failed GitHub context validation before any job; corrected locally/prod.
- [ ] Before releasing main's changes, review its complete pending migration plan; successful
      no-change PROD run does not approve main's blocked migrations. Do not execute held DEV SQL,
      fabricate applied history, or relax fingerprints to force a green run.
- [x] Read-only Supabase merge check: both branches trigger on prod pushes without path filters.
      PROD run 41761473545 completed real migration/function deployment steps successfully.
      Main carries a different workflow: tests followed by an unconditional release-hold exit 1.
      Existing release-safety tests: 15 passed. No database commands or deploys performed by this check.
- [x] Replaced divergent Supabase workflows with the same structural-only runner; legacy
      history/credential/cron repairs removed. Release remains held by source/evidence issues above.
      Promotion covers committed migrations/functions, not arbitrary DEV dashboard changes,
      secrets, authentication settings or DEV data.
      Paul reaffirmed: schema, edge-function code, RLS and grants only; no DEV data copying
      or business-row changes, and existing PROD data must remain intact.
- [x] Refreshed PROD's approval and read back snapshot revision 6 for both groups; run 41758472686 succeeded without dispatching publication.
- [x] Existing PROD Netlify config builds the legacy root app with `npm run build`; provider auto-deploy settings remain unverified.

## Next
- [ ] Follow the ordered PROD migration plan: docs/release-review/prod-migration-master-plan-2026-11-04.md (Phase 0 read-only checks → DB batches → website build → merge → live tests → held switches).
- [x] Funding account topped up and ordinary member access commissioned.
- [x] Both PROD groups opened with Paul's approval and live readback.
- [ ] **Merge `main` into `prod` so the live site connects to the canisters.** igniteclubhq.app
      still serves the legacy build (Supabase-only, no Internet Identity, no opening approval).
      The canister-connected frontend lives on `main`; merging it to `prod` is what makes the
      live site use the canisters. The prod Netlify build currently runs `npm run build` on the
      legacy root app, so the merge must also leave the prod build producing the canister app.
      Verify after merge: the served bundle contains Internet Identity and the PROD routing
      approval, then sign in at igniteclubhq.app and create a club.
- [x] Removed promotion's path filter on main and prod with Paul's approval. Exact one-line
      PROD workflow change read back; commit 765ce195 automatically started push-event run
      41762901542 (no manual dispatch). Focused isolation/trigger tests: 14 passed.
- [ ] At the first main→prod merge, confirm promotion succeeds for that exact merge commit;
      upgrades remain code-only and DEV/PROD data separate.
- [ ] Onboard the first clubs.

## Parked (post-launch)
- [ ] Club deletion: build and test on DEV first, then promote.
- [ ] Safe live database release: scope approved; read-only staging implemented for all 39 originals, with six initial candidates and 33 holds. Blocked on fresh PROD target definitions/dependency evidence, exact SQL acceptance and an approved application mechanism; staging is not a selective deployment executor. Scores, country backfills, reminder activation and AI remain excluded; private storage creation has no separate approval yet. See docs/release-review/safe-release-staging.md.
- [ ] Hidden-score change (20261021003048 + 20261021003143) cannot reach the live database through a merge in any form: the structural checker rejects both files (57 + 1 findings) because copying scores and emptying the old columns are data writes. Releasing it later needs structure first, then a separately approved data run that copies scores and keeps an archive. Verified the copy is lossless and the app already reads scores from the protected table.

- [ ] Release hybrid welcome message + profile country (DEV applied 4 Nov) to PROD via main→prod merge; needs PROD Ignite team account (system profile) for welcome message to send.
- [ ] Merge main→prod to send the approved email sign-up check live (approved-only release; blocked on Paul running the merge). Live check only refuses sign-ups once the live email-club settings entry exists.

## ICP home performance (2026-11-06)
- [x] DEV carousel repair: complete first-login reveal; instant same-account saved cards; independent member-team and complete league discovery; no overlapping read retries.
- [ ] Carousel real-phone timing and ICP authenticated readback — needs an Internet Identity session/device; no PROD release performed.
- [x] Carousel: trial status + club profile read alongside team rows (batched calls); 6-team simulated cold median 2134→1430ms, warm 608→421ms
- [x] Home feed events already coalesce into list_events_multi per routed target — no change
- [x] Home/carousel load ICP feature code on demand
- [x] Canister caching headers no longer contradictory (takes effect next frontend deploy)
- [x] Startup stage marks (sign-in click → carousel loaded) via window.__igniteStages
- [ ] Real-device cold/warm median/p95 on TEST — needs Paul signing in with Internet Identity

## Chat open speed (TEST only)
- [x] Quick-read first page (open_conversation_query) with consensus fallback, write fence and no-regress guard; tests pass.
- [x] Per-open timing: tap anchor, JS load, auth wait, connect, refused-quick-read, canister, render, enrichment; honest cold_open vs cached_open labels (chat_open_v2 / chat_open_stage:*).
- [x] Removed DM notification-open double fetch (invalidate no longer aborts the in-flight load).
- [x] TEST messaging service upgraded (both groups); quick read live on TEST and refuses signed-out callers.
- [ ] Collect Android before/after samples (waiting on Paul's phone chat opens).
- [x] Cold chat open fix (2026-11-07): Paul's Speed card showed 13.1s "chat sign-in wait" — screens asked for the identity before the auth client existed and got instant "signed out", stacking fail-and-retry delays. Now getCurrentInternetIdentity waits (bounded 20s) for the shared warm-up when a stored sign-in exists, and App.tsx starts the warm-up alongside the settings load. Deployed to TEST canister 2026-11-07 (bundle live-index-B8dnmdbi.js, fix marker verified in served assets). Awaiting Paul's re-test on Android.

## Event edit sign-in safety (TEST only)
- [x] Trace reauth on edit/save; only a really-ended session returns to sign-in
- [x] Keep unsaved edit form through sign-in; no auto-retry of uncertain saves; block duplicate series
- [x] Timings: form open, details load, save start, main save, duties/series (Speed card)
- [ ] Real-phone check with a valid and an expired session (needs Paul on TEST after next TEST update)

- 2026-11-07: Paul reverted to d667609 (home/chat perf changes made loading worse); TEST must serve reverted state.

- [ ] DEV asset 404 + one-time chunk reload: deploy to TEST and confirm Home/Messages/Events after II sign-in on phone (needs Paul).

- [ ] TEST fast native sender: code ready (ICP wake-up, sender endpoint, commission/backup workflow); blocked on Supabase function publishing internal error; then update TEST notification service, commission, TEST Android build.

- [x] DEV: ICP purchase verifier now checks product, app identity, refunds and expiry; Android purchases fail clearly (Google check still external, not built).
- [x] DEV: Apple purchases in II mode carry an account link; verifier rejects unlinked/other-account receipts (needs PROD merge, verifier redeploy, iOS build; real purchase untested).
