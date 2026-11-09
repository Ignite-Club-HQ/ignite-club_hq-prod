# ICP-hosted native push — feasibility checkpoint

## Scope
Read-only investigation of the approved ICP-first plan. No Render provisioning, Google IAM mutation, key upload, canister deployment, queue mutation or live send. Supabase delivery remains untouched.

## Established from official documentation
- ICP supports single-request HTTPS outcalls (`is_replicated = false`), appropriate for non-idempotent Firebase sends. Default replicated requests are unsuitable because each replica submits a request.
- Firebase HTTP v1 accepts short-lived OAuth authorization. The existing service-account exchange uses RS256 and a private RSA key; ICP threshold ECDSA cannot replace that exchange directly.
- Google Workload Identity Federation accepts OIDC assertions signed with **RS256 or ES256**. Thus an ICP P-256-backed OIDC issuer is a plausible *different* authorization route; Google's audience, issuer, JWKS and IAM binding requirements still apply.
- ICP's current management interface includes `secp256r1` / P-256. Interface support alone does not establish a usable enabled mainnet key for this deployment.
- Keyless federation removes the long-lived RSA secret, **not** the confidentiality requirement for issued Google bearer tokens and signed assertions while usable. Ordinary replicas can read canister state; keeping tokens transient or short-lived reduces exposure duration but does not eliminate it.
- Official ICP node-infrastructure documentation describes SEV-SNP memory protection, attestation and sealing, with a rollout in progress. It does not by itself prove all nodes in a selected subnet are protected, or guarantee credential protection through backup, upgrade, recovery and outgoing HTTPS handling.

## Held before implementation
1. Verify the exact selected protected subnet, membership/attestation and runtime/storage/outcall/recovery protection; public forum claims of available confidential subnets are leads, not deployment authorization or proof.
2. For keyless federation, verify an enabled P-256 signing key and a private caller-gated issuer that signs only fixed issuer/subject/audience claims. Public JWKS is permitted; public token-minting is not. Google IAM/provider provisioning requires separate approval.
3. Alternatively, assess narrowly scoped TEST RSA authorization only within a verified protected deployment, with a reviewed maintained Wasm signer. Never place the existing live key in ordinary canister storage.
4. Prove authorization on isolated TEST before building the event wake/sender integration. No temporary external token server may be labelled ICP-only.
5. Only then measure actual queued native delivery speed, cycles, denied audiences, account/device changes, uncertain acceptance and upgrade recovery. No automatic resend after uncertain Firebase acceptance.

## Decision
**Direct ICP transport is supported; safe app-specific authorization is not yet established.** The safe next checkpoint is verification of protected execution and an approved isolated TEST authorization route, not activation of a key-holding sender. No claim of 3–8-second measured delivery or complete implementation.

## Sources checked
- https://docs.internetcomputer.org/concepts/https-outcalls/
- https://docs.internetcomputer.org/guides/security/https-outcalls/
- https://docs.internetcomputer.org/references/management-canister/
- https://docs.internetcomputer.org/references/ic-interface-spec/management-canister/
- https://docs.internetcomputer.org/concepts/node-infrastructure/
- https://cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
- https://firebase.google.com/docs/cloud-messaging/auth-server
- https://developers.google.com/identity/protocols/oauth2/service-account