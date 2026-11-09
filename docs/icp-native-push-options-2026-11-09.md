# Safe native ICP push: authorization and hosting options

## Result
Research only. No secrets read, IAM changes, hosting purchases, deployments, scheduler activation or notification sends. Existing Supabase push stays unchanged. Existing PROD permission remains Paul-only, not broad activation.

There are two different goals:
1. **All sender execution on ICP:** requires an independently verified confidential ICP deployment before handling Firebase credentials. Not established for this app.
2. **All notification decisions and records on ICP:** feasible with a small isolated external delivery adapter. Firebase authorization stays outside ICP; the adapter cannot invent recipients or messages. This is ICP-authorized delivery, not ICP-only execution.

The existing Android self-test proves Firebase can reach Paul's device. It does not prove normal queue authorization, in-app inbox persistence, tap correctness, iOS acceptance or seconds-scale delivery.

## Options comparison

| Option | Security boundary | Buildability and tradeoff |
|---|---|---|
| Ordinary public ICP sender storing RSA key or OAuth token | Replica operators can inspect usable credentials | Reject under the stated requirement. `private` fields, TLS, in-memory-only tokens and short expiry do not establish secrecy from the executing replica. |
| Verified SEV-SNP protected ICP subnet | Hardware-isolated GuestOS plus verified lifecycle/outcall boundary | Conditional closest match to all-ICP preference. Official docs describe protection and rollout, but no exact supported/attested target for this app is verified. Needs provider-supported attestation and protection through node replacement, upgrades, snapshots, recovery and outgoing TLS. |
| OpenCloud / Cloud Engine sender | Trust in selected engine operators unless additional attested protection exists | Deployable hosting category, not automatic confidentiality. Obtain specific engine/node evidence. Deploy only a sender; do not move Ignite clubs, media or data to solve transport. Chain-key features may require an engine proxy. |
| Private/self-operated ICP network | Trust in own infrastructure administrators | Can keep credentials away from unrelated public operators, but requires running another network and changes trust/availability. Far more operations than a relay; hardware attestation still required to protect against own host operators. Not minimal. |
| Keyless Google Workload Identity Federation from ICP | Threshold/private signing-key protection; issued Google credential still visible where used | Avoids an uploaded Google RSA key but does not by itself hide bearer tokens or usable federation assertions. ES256 support and an enabled compatible ICP signing key need proof. Trust/IAM provisioning is separately approved; no direct FCM acceptance of arbitrary ICP signatures is documented. |
| Dedicated ICP adapter on existing Supabase hosting + existing Firebase connector | Provider-controlled server execution and secret storage; no Google credentials on ICP | Smallest reuse candidate if external delivery is acceptable. Use a **new isolated ICP function**, not existing Supabase push handlers or the stale payment-handler push-kick. Existing transport-only module is reusable; queue identity, fencing, authorization and wake integration still need completion. No new host, but function invocations/ICP calls can cost and time out. Not all-ICP execution. |
| Dedicated Google Cloud Run/Functions send adapter with attached service account | Google runtime identity obtains OAuth internally; no downloadable RSA key required | Strong keyless operational option. ICP retains records/audiences, adapter performs final authorized send. New Google hosting and IAM configuration required; this project's current platform tooling does not provide an approved GCP app-deployment workflow. Request-driven wake allows scale-to-zero; cold starts affect latency, warm instances cost. |
| Dedicated Cloudflare Worker / other serverless send adapter | Host secret storage protects credentials from ICP, not necessarily host administrators | Small isolated adapter is feasible in principle. SDK/CPU/runtime compatibility, credential custody and queue journaling must be verified. Cloudflare advertised paid minimum is USD 5/month; free plan has tight CPU limits. Not a constant polling process. |
| Always-on background worker (existing scripts, Render/VM/container host) | Host stores worker and Firebase credentials | Reuses much of the current worker logic and can avoid invocation cold starts. Requires paid always-on hosting and explicit approval. Empty polling must be bounded and measured; existing recovery must not run every cycle. Render remains an unapproved alternative, not default. |
| Attested external send adapter (Google Confidential Space / suitable enclave) | Measured workload plus attestation-gated authorization/secrets | Protects against a stronger host-operator threat than ordinary hosting, with residual trust in hardware, attestation, policy/code approvers and authorized upgrades. More setup/cost than ordinary relay. Keep both OAuth acquisition and FCM request inside the attested workload; a token-only broker defeats the objective. Not all-ICP execution. |
| Firebase/Lovable gateway called directly by ICP | Gateway hides Google key, but requires its own usable gateway credential | Direct use merely replaces the secret that would be exposed on ICP. Existing gateway documents secret-header auth, not ICP-signature auth. An isolated adapter can use it safely; do not put gateway keys on ICP or claim unsupported signature support. |
| Token-only external broker returning Google OAuth to ICP | RSA stays external, bearer token returns to ICP | Reject for operator-secrecy requirement. A full send adapter is needed to keep Google credentials entirely outside ICP. |
| GitHub runner with OIDC instead of JSON key | Runner obtains temporary Google credentials | Useful deployments/manual tests; scheduled/dispatch runner latency is not near-immediate delivery. OIDC does not make a continuously running sender or remove startup waits. |
| Direct APNs for iOS, FCM alternatives for Android | Another provider credential/trusted server | APNs still needs provider authorization and does not solve Android. Alternative Android push services require app/device integration and may lack reach. Custom sockets/local notifications cannot reliably wake closed native apps and are not equivalent to OS push. |

## What encryption and signing can and cannot do
- vetKeys protects client-encrypted data when the decryption key is held outside replica execution. It cannot hide a credential that the same ordinary canister decrypts and uses autonomously.
- Threshold signatures can authenticate fixed, short-lived wake requests without storing a complete signing key in an ordinary canister. They authorize a relay protocol, not FCM directly. Existing signed ICP ingress with a private worker identity is another way for the adapter to claim work without a new issuer.
- Certified queue hints/public signatures prove specific facts only. An untrusted query or wake request cannot authorize delivery. Adapter must claim/recheck through the queue's protected consensus methods.
- No documented FCM HTTP v1 DPoP/mTLS/signed-capability authorization was established. Do not substitute unsupported token-binding features. Narrow IAM privileges limit damage, not credential visibility, and do not establish per-device recipient restrictions.

## Smallest practical design, if external delivery is accepted

```text
Authorized Ignite action
  -> ICP creates inbox/outbox record and owns audience/preferences
  -> non-blocking bounded wake for one isolated ICP adapter
  -> adapter claims from exact approved queue as protected worker
  -> ICP rechecks current device, audience/mute and attempt ownership
  -> adapter obtains/uses Firebase authorization privately
  -> Firebase -> Android/iOS
  -> adapter settles exact attempt on ICP
```

- Wake carries only an approved queue/work hint, never caller-selected devices or notification text. Authenticating/rate-bounding wake prevents abuse; final consensus authorization is required regardless of hint/signature validity.
- Enqueue/chat/event actions must not wait for Firebase. Server-side wake plus a bounded recovery mechanism handles scheduled alerts, offline senders and lost wakes; browser-only kicks are insufficient.
- Reuse existing queue records and device directory. Do not create another notification database. Actual notifications appear in the in-app screen because ICP stores them before delivery; the direct test alert intentionally did not.
- Retain durable per-device attempts and exclusive handover. Lost send/settlement replies hold instead of automatic resend. FCM acceptance is not exactly-once delivery or proof of phone display.
- Provider-hosted functions cannot be treated as permanent loops. No old GitHub/legacy worker overlap; no blanket `recover()` on each wake/start.
- A full relay is safer than a token broker: Firebase key, OAuth bearer and gateway keys never enter ICP messages or state.

## Important repository reuse finding
`supabase/functions/verify-iap-receipt-icp/index.ts` contains an older push-kick inside a payment handler. It uses stale hand-copied queue types, a queried device read where the current contract is worker-gated consensus, a per-instance running flag rather than exclusive durable ownership, and a default queue fallback. It must **not** be enabled unchanged or described as a ready safe solution.

Reusable pieces are the existing queue, native registration, shared wire contract, per-device delivery core and isolated `icp-dev-push-sender/fcm.ts` transport. The latter has no public endpoint/schedule today; it deliberately awaits integrated commissioning.

## Cost and timing
- Firebase lists FCM among no-cost products; sender compute, requests, logs, egress and ICP cycles can still cost.
- Cloud Run lists request-based free allowances of 2 million requests, 180,000 vCPU-seconds and 360,000 GiB-seconds/month (pricing conditions apply); regional rates, billing-account use, minimum instances and other Google services affect actual cost. No zero-cost promise.
- Cloudflare lists 100,000 requests/day on free with 10ms CPU/invocation and a USD 5/month paid minimum. IC signature verification/SDK work must fit or use paid capacity.
- Existing Supabase hosting avoids a new host, not necessarily extra usage charges. Edge Function lifetimes prevent always-on looping.
- Seconds-scale delivery is a TEST target, not measured for any new option. Measure enqueue-to-display median/P95 and idle/per-alert cost before choosing warm instances or polling intervals.

## Recommendation
1. **Strict all-ICP:** make the next checkpoint provider-supported confidential target verification. Only after actual attestation/lifecycle/outcall evidence should Firebase authorization be built on that target. No proof may be replaced by a caller-supplied boolean.
2. **Smallest safe route now:** separate ICP adapter on existing hosting using the linked Firebase connector, if Paul accepts external transport. Existing Supabase-mode notifications remain byte-for-byte outside its scope.
3. **Avoid a downloaded Google key:** keyless Google-hosted full send adapter with an attached minimal service account, if new hosting is acceptable.
4. **Protect against external host operators too:** attested full send adapter, accepting greater setup and operating complexity.

Research grants none of these hosting/IAM/credential/PROD changes. Build on TEST; verify real queued Android/iOS display and taps, inbox readback, account switching/revocation/mutes, ambiguous sends and unchanged Supabase delivery. Only then consider separately approved Paul-only PROD handover.

## Workarounds for credential-bearing replica warnings — 9 November, 05:14 UTC

Focused read-only investigation found the warning still present in upstream revision `aa0877ca930aa163815024d1ea9b600fe818c11a`, not only the candidate nodes' reported GuestOS source `83f29e0803496ba6aaea3d6b43f6c6bebea12dd9`. Upgrading to that newer source alone is not a fix. No credentials, deployments, sends or runtime changes.

| Workaround | Actual effect | Availability / tradeoff |
|---|---|---|
| Maintainer-supported source redaction | Replace Debug formatting of `SendError::Full(request)` with fixed error classification; removes this exact logging sink while keeping useful warnings | Best strict ICP-only route. Requires upstream release and verified deployment; Ignite cannot patch a public subnet's replica. No provider delivery date established. |
| Provider-enforced replica logger level `error` or stricter | Source macro checks severity before `format!`, so suppresses this exact warning before serialization | Genuine technical interim option, not downstream filtering. Availability on public `re2t4` unverified. Requires enforced settings across participating/replacement nodes and lifecycle transitions; loses warning diagnostics and does not establish other sinks are safe. |
| Independently verified protected log containment | Keeps any logged credential inside an explicitly accepted confidential boundary | Conditional, not redaction; requires log access/collector/export/retention/crash/recovery evidence. Not established. |
| Isolated full-send relay | Google credentials never enter ICP outcalls; relay claims authorized ICP work and performs OAuth plus FCM internally | Practical fallback if external transport is approved. Reuse existing hosting or attached Google runtime identity; neither provisioning nor Supabase-mode changes approved by research. Return sanitized attempt results, never tokens. |

**Not standalone solutions:** encrypting stored keys, shorter-lived tokens, lower concurrency, another SDK/canister, or non-replicated/flexible HTTP. Queue capacity is shared node-local capacity and app pacing cannot guarantee no enqueue failure. FCM expects OAuth plus its documented JSON, not a custom encrypted request; encrypting notification data leaves the bearer header exposed. A gateway secret merely replaces the sensitive credential. Threshold P-256 federation removes the RSA key but still sends usable assertions/bearer tokens through the same boundary. A custom encrypted envelope needs a full-send decrypting relay with replay controls, not FCM directly.

**Recommendation:** pursue source redaction first; provider-supported pre-format warning suppression is a possible interim ICP-only route. If neither is available, an isolated full-send adapter avoids this particular infrastructure sink. Do not add application approval flags or accept throttling as secrecy proof. Fresh deployed attestation/secure provisioning remains a separate dependency even after the warning is addressed.

Pinned references:
- [Warning remains upstream](https://github.com/dfinity/ic/blob/aa0877ca930aa163815024d1ea9b600fe818c11a/rs/https_outcalls/consensus/src/pool_manager.rs#L263-L282)
- [Pre-format severity check](https://github.com/dfinity/ic/blob/aa0877ca930aa163815024d1ea9b600fe818c11a/rs/monitoring/logger/src/context_logger/macros.rs#L244-L266)
- [Replica logger configuration](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/rs/config/src/logger.rs#L1-L60)
- [FCM request/auth contract](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send)

## Sources
- ICP node protection/attestation: https://docs.internetcomputer.org/concepts/node-infrastructure/
- ICP HTTPS modes: https://docs.internetcomputer.org/concepts/https-outcalls/
- ICP credential warning: https://docs.internetcomputer.org/guides/security/https-outcalls/
- Engine deployment/canister constraints: https://skills.internetcomputer.org/.well-known/skills/deploy-to-cloud-engine/SKILL.md and https://skills.internetcomputer.org/.well-known/skills/cloud-engine-canisters/SKILL.md
- vetKeys: https://docs.internetcomputer.org/concepts/vetkeys/
- FCM authorization: https://firebase.google.com/docs/cloud-messaging/auth-server
- Google federation: https://cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
- FCM IAM permissions: https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging
- Confidential Space: https://cloud.google.com/confidential-computing/confidential-space/docs/confidential-space-overview
- Cloud Run prices: https://cloud.google.com/run/pricing
- Cloudflare prices: https://developers.cloudflare.com/workers/platform/pricing/
- Firebase pricing: https://firebase.google.com/pricing
- Supabase function limits: https://supabase.com/docs/guides/functions/limits
- APNs: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns

Sources establish documented capabilities and limits, not app-specific deployed availability, security attestation or latency.