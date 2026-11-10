# ICP shared settings: forward-only review

Scope: settings for features available in ICP mode. Historical files, data transfers, unavailable integrations, deployment and production configuration writes are excluded.

## Already on ICP

| Settings | ICP authority / reader |
| --- | --- |
| Club creation lock | `club_domain.app_config`; CreateClubPage and ICP App Settings |
| Chat virtualisation, basic chunk size, recap switch, free polling switch | `club_domain.app_config`; dedicated runtime hooks |
| Notification prefetch | `club_domain.app_config`; notificationPrefetchFlag |
| Welcome direct-message text | `club_domain.app_config`; welcomeMessage |
| Legal reacceptance | `club_domain.app_config`; acceptance on identity_access |
| GIPHY public client key | `club_domain.app_config`; Placement Settings and GifGrid |
| Canister IDs / optional WebSocket gateway address | `club_domain.app_config.icp_canister_config`; ICP loader and Placement Settings |
| Backend / country / retained-email eligibility | `club_domain.app_config.backend_routing_config`; ICP admin saves and restored ICP startup |
| Chat photo reminders | Messaging scheduler-owned settings, not Supabase app_settings |

The Supabase references in these files are mostly separate email branches, not residual ICP dependencies. AI provider selection in useChatCatchUp/GlobalChatRecapSheet belongs to the email branch; ICP recap bypasses it.

## Repairs in DEV

1. Mounted ICP startup now chooses the on-chain configuration reader even when the local session hint is absent. It cannot read the Supabase routing row in that state. The canister override loader shares this startup selection.
2. Virtualisation, chunk size, recap, free polling and legal-policy query caches now distinguish email from ICP and distinguish ICP config authorities by host + club canister ID. Switching modes no longer reuses a still-fresh email setting. Email realtime subscriptions are cleaned up on source changes.
3. ICP App Settings reads explicitly use the shared app scope; writes use the existing one-attempt app scope. This preserves the canister's own admin checks and prevents uncertain writes being replayed by group dispatch.

Before repair, five new regressions failed: four mode-switch readers never fetched their on-chain value, and mounted ICP startup read Supabase. After repair those checks pass alongside existing routing, override, legal and sign-in checks.

## Gaps to assess next

- **Signed-out hybrid discovery still has a public Supabase fallback.** On a canister-hosted visit with no on-chain routing copy, it reads only the public backend_routing_config row. This is intentional compatibility for existing sign-in choices; removing it requires establishing the environment's own on-chain configuration first. No copies were written in this task.
- **Email admins and ICP admins save separate copies.** Email startup retains its existing timestamp-based dual-copy choice. This task does not mirror or reconcile saves between datasets.
- **TEST deployed-value inventory completed at 06:57 UTC.** Eleven bounded anonymous `get_app_config` reads against TEST shared club authority `mzzzv-taaaa-aaaal-qxlrq-cai` succeeded. Only `chat_recap_enabled` was populated (`false`); the other ten requested keys were unset. This is the shared authority, not an inventory of independent groups or PROD. No values were copied or written; credential-like values and routing contents were not emitted.
- **Notification-prefetch's one-shot module cache is not a persistent settings subscription.** It already reads ICP on ICP initialization, but its initializer has no discovered call site. Treat activation/refresh lifecycle as a separate follow-up, not an established remaining Supabase requirement.
- **ICP runtime switches are query-refreshed, not Supabase realtime.** Missing keys use their existing defaults; no new background timers were introduced.

## Verification limits

Focused mounted-reader tests exercise real React Query cache switching with mocked transport; they are not authenticated deployed-canister acceptance. Production was untouched. Real Internet Identity administrator save/readback and native app switching remain unverified without a delegated session/device.

## TEST follow-up inventory and implications

| Public setting | Readback |
| --- | --- |
| backend_routing_config | Unset |
| icp_canister_config | Unset |
| club_creation_locked | Unset |
| chat_virtualization_enabled | Unset |
| chat_basic_chunk_size | Unset |
| chat_recap_enabled | Present: false |
| free_club_polling_enabled | Unset |
| notification_prefetch_enabled | Unset |
| legal_reacceptance | Unset |
| welcome_dm_message | Unset |
| giphy_api_key | Unset |

Missing optional switches do not by themselves mean a feature is broken: runtime readers retain their existing defaults. Missing canister overrides may use generated/build configuration. The missing routing copy is the important remaining signed-out hybrid boundary: without an established environment-specific on-chain copy, the public Supabase discovery fallback cannot safely be removed. The missing GIPHY key also means this authority cannot supply that key to the ICP GIF picker.

All 54 focused routing/settings/legal/sign-in checks passed again on this follow-up. This is not an authenticated admin save/readback: external unmanaged browser auth supplies no delegated II administrator identity. No write was attempted with anonymous or operator credentials, and no PROD read/deployment/settings mutation occurred.

Next: owner-reviewed TEST routing initialization using TEST-only targets and intended sign-in eligibility; separately verify an existing ICP administrator can save and read back through the app. Do not blindly mirror email settings, overwrite the existing recap switch, or move private credentials into public app_config.

## TEST initialization preparation

A fresh public TEST `/auth` browser check confirmed the DEV routing row retains email for Bridgewater Soccer Club and Basket Range Cricket Club, with default `supabase` and empty country rules, targets, pins and overrides. Both sign-in tabs rendered. The exact proposed on-chain value and acceptance steps are in `docs/test-on-chain-routing-initialization-2026-11-10.md`; no targets were invented and no write was made. Applying and verifying it requires an existing TEST II administrator session, which is unavailable in this remote sandbox. The public Supabase fallback remains until deployed on-chain readback and fresh signed-out acceptance succeed.

## Approved PROD initialization and verification

Paul explicitly approved initializing PROD's on-chain routing key and running the protected action. GitHub run `42773454286`, source `3093fc3baaad429f5958e97a50245812c4148156`, completed successfully on 10 November at 07:10:56 UTC. Independent anonymous readback from PROD shared club authority `tbeh7-5qaaa-aaaai-ayenq-cai` matches the prepared routing exactly: default Supabase, two retained email clubs, no targets/rules/pins/overrides. The previous value was unset. Only this public configuration key was initialized; no canister upgrade, deployment, other settings copy or business-data mutation occurred.

Fresh browser contexts verified both sign-in tabs and zero page errors at both live addresses. The frontend canister `u3mrq-uiaaa-aaaac-bgioq-cai.icp0.io/auth` made zero Supabase routing-row requests, resolving that canister-hosted discovery boundary. However, `igniteclubhq.app/auth` still made one Supabase routing-row request. Therefore the gap is not globally closed for the branded site; existing email authentication was not exercised. No further frontend, hosting or sign-in changes were made under this single-key authorization.

## Final shared-settings scope and remaining acceptance

Correction: the branded-site check above was signed out in hybrid/email discovery, not authenticated ICP mode. Supabase routing reads there and email-mode settings are expected; they are not evidence of an ICP-mode dependency. No branded hostname or sign-in policy change is required by this audit.

Bounded anonymous TEST/PROD inventories on this continuation confirmed PROD has only the routing key populated among the eleven reviewed keys; TEST retains only its existing recap switch. Values other than routing were not printed, mirrored or changed. Optional absent settings use existing code defaults, not a Supabase fallback. Generated canister IDs remain the configured source when overrides are absent. GIPHY's missing public client key is a configuration gap requiring the owner's intended key, not a reason to read email settings or move private credentials onto ICP.

Confirmed source boundaries: ICP runtime chat switches, club-creation lock, legal policy, welcome message, canister overrides and GIPHY settings use on-chain readers; ICP App Settings and Placement Settings use shared-app scoped authorized writers. Email paths remain separate. Notification prefetch's dormant initializer has no call site, and its sync consumer belongs to legacy email native push; it is not an active ICP settings dependency and was not activated or changed.

DEV now confirms each shared ICP settings save by reading the same key from the same actor after one acknowledged write. Three failing regressions reproduced false success/missing confirmation before the change; a missing, stale or failed confirmation now reports an uncertain outcome and never repeats the write. The generic helper covers both App Settings and Placement Settings. Server-side governor/app-admin checks remain authoritative.

Closure is **code-path complete, not authenticated acceptance complete**. A real TEST Internet Identity administrator must save an intended non-secret setting, refresh and confirm it through the app; the sandbox has no delegated II administrator session. PROD configuration defaults have not been copied or arbitrarily populated, this DEV confirmation change has not been deployed, and TEST routing remains uninitialized. Do not claim all settings are live-verified or change the existing recap switch just to produce a successful test.