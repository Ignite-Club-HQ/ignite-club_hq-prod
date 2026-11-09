# Protected ICP hosting verification

## Source-fix checkpoint — requested 05:17 UTC

Prepared a pinned upstream warning-redaction patch and credential-free extracted-block regression in `docs/icp-warning-redaction/`. The original queue-full path invokes the request's Debug formatter; after patching, both local cases pass and metrics remain intact. This is not a full replica build or protected-subnet acceptance. Fresh inventory still reports the original GuestOS revision on all seven TEE-active nodes. Public subnet replica/GuestOS upgrades belong to the NNS infrastructure release process, not Ignite's canister-controller authority. No patch submitted upstream or deployed, credentials accessed, sender created, or TEST alert sent; live delivery unchanged. Full evidence and remaining verification are in the patch README.

Public read-only checks completed 9 November 2026, approximately 05:01 UTC. No secrets, management mutations, canister creation, deployment, placement changes or sending. Supabase push remains unchanged.

## New finding: an identifiable public confidential target exists
The public ICP inventory API returned two SEV-enabled subnets:

| Subnet | Inventory access classification | Observed state |
|---|---|---|
| `re2t4-faa75-v3vhk-kdmdr-uyrkl-aik2l-ixd6u-p3fyr-zlfkc-6c5af-zae` | `public`, specialization `confidential` | `sev_enabled: true`; seven nodes, all UP; 240 total canisters |
| `x4jtx-5dnbo-v3exa-vzamo-teufh-qsiit-txx4g-mi76n-ckrfl-oc5a6-nae` | `authorized_only` | `sev_enabled: true`; seven nodes, all UP |

This is stronger evidence than a general roadmap statement: there is a specific public candidate to evaluate. It does **not** prove successful creation capacity or permission for this project's operator, independently attest the hardware, or authorize credential handling.

## Current Ignite TEST is not on that target
The inventory identifies TEST notification queue `jfcdq-yiaaa-aaaal-qxloa-cai` on:
`e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe`.
That subnet returned `sev_enabled: false`, public application classification and thirteen nodes. Do not put Firebase credentials on the current queue or infer confidentiality from its API permissions.

## Complete candidate node listing checked
The node endpoint was requested without filtering for TEE-active nodes, including UP, DOWN, DEGRADED and DISABLED statuses. Seven rows were returned, matching the separately observed subnet total:

| Node | Status | `guestos_tee_active` |
|---|---|---|
| `65owm-iqsih-pdllo-5hh6y-oplj4-exf26-d3ep3-nuj7t-vscte-2i7hd-tqe` | UP | true |
| `apmj3-7pb2c-n22hc-gg74y-llwbh-ydeej-gktiw-wx5ye-n32xx-ogxcw-xae` | UP | true |
| `bcxo3-fdcxc-3oeqe-wuexk-fkyg3-jj76w-jxexv-v6nyt-fkly4-rx7m2-2ae` | UP | true |
| `fv7pn-jvb6l-vezr4-4rk5e-4fdr5-pgmhj-bssxs-44lla-qajcc-dcycg-3qe` | UP | true |
| `g75ol-eu444-h65jf-ddman-edmen-johle-s2bim-a3yn6-gkpat-5c32o-7ae` | UP | true |
| `m5mj2-rta3p-n4zze-flubl-liaay-3tffk-5nl6d-k5ckv-6mdrg-acnrh-rae` | UP | true |
| `tenun-rw6z7-bdcoj-l7lyb-jufsa-ewglz-dqvf4-infmt-krxim-5undw-gae` | UP | true |

All list Gen2 hardware and GuestOS version `83f29e0803496ba6aaea3d6b43f6c6bebea12dd9`; seven distinct node providers. These are API-reported inventory/telemetry, **not** independently verified SNP measurements. Calls are separate observations, not one certified registry-version snapshot. Node records provide no signed attestation blob in this response.

## What is and is not verified
- **Verified observation:** the public inventory exposes a public confidential candidate and reports hardware protection active on all its listed nodes.
- **Not verified:** fresh AMD-signed reports bound to every current node and approved GuestOS measurement; enforced peer attestation on state sharing/joining; credentials remaining protected through recovery and upgrades; outgoing TLS adapter remaining inside the protected boundary; canister controller/code-release trust; successful deployment admission and pricing for this workload.
- Official node-infrastructure documentation describes memory encryption, measurements, attestation and sealed storage, but the reviewed developer material does not provide a complete external report retrieval/verifier route for this deployment.
- The August developer-forum topic asking these exact questions currently returns one post and no answers in its public JSON response. Its questions are not evidence of either a guarantee or a vulnerability.
- The linked Learn Hub TEE article could not be inspected: direct fetch was blocked by a challenge (HTTP 403). No conclusion is inferred from inaccessible content.

## Next checkpoint
Use **only `re2t4` as the public candidate**, not the current TEST queue subnet or authorized-only `x4jtx`, for further protected-sender feasibility. Obtain the supported external attestation/measurement verification and published boundaries for state-sharing, recovery and HTTPS authorization. No canister with live credentials should be deployed until those protections are established.

A credential-free disposable creation/HTTPS probe could separately test deployment and Firebase network reachability after explicit commissioning/cost approval. It would not establish credential secrecy and must not be presented as security acceptance. No new safeguard module or local approval boolean is needed to answer the unresolved infrastructure questions.

Only the sender would need this target; no existing clubs, queues, registrations, encrypted photos or canisters should be moved. All-ICP delivery still requires a safe sender identity, exact approved queue authority and exclusive handover after TEST authorization proof.

## Reproducible sources
- Inventory schema: https://ic-api.internetcomputer.org/api/v3/openapi.json
- Candidate inventory: https://ic-api.internetcomputer.org/api/v3/subnets?sev_enabled=true
- Public candidate: https://ic-api.internetcomputer.org/api/v3/subnets/re2t4-faa75-v3vhk-kdmdr-uyrkl-aik2l-ixd6u-p3fyr-zlfkc-6c5af-zae
- Candidate nodes: https://ic-api.internetcomputer.org/api/v3/nodes?subnet=re2t4-faa75-v3vhk-kdmdr-uyrkl-aik2l-ixd6u-p3fyr-zlfkc-6c5af-zae&include_status=UP&include_status=DOWN&include_status=DEGRADED&include_status=DISABLED
- TEST queue inventory: https://ic-api.internetcomputer.org/api/v3/canisters/jfcdq-yiaaa-aaaal-qxloa-cai
- Current TEST subnet: https://ic-api.internetcomputer.org/api/v3/subnets/e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe
- Infrastructure guarantees: https://docs.internetcomputer.org/concepts/node-infrastructure/
- Confidential-subnet questions: https://forum.dfinity.org/t/questions-on-confidential-sev-snp-subnets/75232 (read via its `.json` representation)

## Observation fingerprints (not attestation or release evidence)
SHA-256 of the fetched response bytes:
- TEST queue: `0aab73dd2d9f4b388fb687548ee559788018684ef10d26a88adefd68dfecca32`
- SEV subnet list: `652cdc5d696e600b719d9b12d210b3d5c1875da07c76104418b1382c6467b867`
- Current TEST subnet: `3b0cc097ae778b09ddad6e9e5bdb58f349a4f15acd474abb93b63e50c24544ee`
- Public candidate: `4fd48d935f1d7f5381854dc13396788f6dc823444ba652b65a0a967fde6716c5`
- Candidate node list: `5dd863f47a292064ffa8d49bdd0c2b6bba597edd49e89d6321f027e1d776e6f3`

Hashes identify observations only; they neither establish provider provenance cryptographically nor authorize secrets, deployment or sending.

## Requested implementation checkpoint — 05:06 UTC
Paul requested building a separate protected-subnet sender and proving a native TEST alert end to end before changing live delivery. The current session re-read the existing implementation and official infrastructure/HTTPS-security guidance, and refreshed the public candidate subnet endpoint successfully (HTTP 200). Independent research found public subnet-targeted deployment guidance at https://forum.dfinity.org/t/question-about-sev-enabled-production-subnets/74683. Ordinary cycles costs still apply; that guidance is not security acceptance.

The official infrastructure documentation establishes real memory/disk protection and an external attestation architecture, not an absence of attestation support. The unresolved dependency is a supported, reproducible verification/provisioning route for this particular sender, including current membership, state transfer, ingress confidentiality and outbound HTTP/TLS credentials. No such route was established by this session's tools or reviewed documentation. The HTTPS security guide still warns against API keys and tokens in ordinary canister state.

The recovery documentation explicitly permits an NNS-approved Recovery-GuestOS to preserve the base launch measurement while replacing the root filesystem. Consequently a measurement-only check would be insufficient: the documented governance/recovery exceptions also belong to the accepted trust boundary. A local approval flag or passing mock must not stand in for this infrastructure evidence.

**Execution status:** blocked before credential provisioning. No sender created, private key accessed/uploaded, deployment or send performed, queue authority changed, service moved, or recurring worker enabled. No Supabase or PROD changes. The earlier GitHub-hosted phone alert does not verify this proposed ICP sender.

**Unblock requirement:** a provider-supported verification and secure credential-provisioning procedure for the selected confidential subnet, explicitly covering outgoing TLS and recovery/membership changes. Once established, build the isolated TEST sender and prove authorization, one non-replicated Firebase request, actual native phone receipt/tap, no uncertain-send replay, and measured end-to-end latency. A credential-free transport probe alone would not complete the user's request; no placeholder sender or extra approval framework was added.

## In-use protection verification — requested 05:10 UTC

### New verified source findings
Fresh public subnet/node reads returned HTTP 200: seven UP nodes, all reporting TEE-active GuestOS `83f29e0803496ba6aaea3d6b43f6c6bebea12dd9`. That revision resolves in `dfinity/ic` (source commit dated 30 October 2026). This links a telemetry version to inspectable source, not to independently attested deployed binaries.

At that exact revision, the HTTPS adapter is installed and launched inside GuestOS, with replica-to-adapter communication on a local Unix socket. The adapter constructs HTTPS-only `hyper-rustls` clients with native roots; its SOCKS path wraps the proxy connection in destination TLS rather than terminating TLS at the proxy. Thus source-level outbound protection is favorable: plaintext headers/body reside in processes within GuestOS, and the network proxy sees encrypted application traffic. The whole GuestOS boundary, native roots and release remain trusted.

**Concrete source-level blocker:** when the local adapter queue is full, `send` returns `SendError::Full(original_request)`. The error, request and context derive `Debug`; the context includes header values and body bytes. The pool manager formats that error with `warn!(..., "Failed to add canister http request to queue {:?}", err)`. Therefore that warning path can serialize authorization headers and JWT request bodies into replica logs. Independently re-fetched and checked all five linked source ranges; no real credential or running-node saturation test was used. This establishes a source-level disclosure path, not a claim that any key has leaked or that deployed logs are publicly readable. Log access/export/retention remains unverified. Encrypting stored keys does not address this sink.

Non-replicated HTTP controls which replica submits the external request; it does not make credential-bearing request state exclusive to that node. Requests come from replicated state, and responses are disseminated to peers. All participating replicas remain part of the credential boundary.

### Attestation: implementation exists, live proof not obtained
The node-side gRPC `remote_attestation.RemoteAttestationService/Attest` protocol accepts an optional 32-byte challenge and returns an SNP report/certificate package; its GuestOS service and official certificate/report verifier exist. The public inventory returns no such package. The documented boundary-mediated external verification route was not established as an executable public client procedure; a direct port reachability timeout cannot distinguish firewall rules from sandbox networking and is not a valid attestation exchange. No fresh challenge-bound report or certified membership/measurement verification was obtained. The boundary implementation inspected by the investigator was revision `aa0877ca930aa163815024d1ea9b600fe818c11a`, so its absence of an explicit route is not a claim about the exact deployed boundary release.

### Verdict and next dependency
**In-use confidentiality is not accepted.** Source demonstrates TLS inside GuestOS but also a credential-bearing warning-log path. Before provisioning Firebase credentials, establish a release that removes this sink (or independently verified log containment meeting the approved trust boundary), bind it to verified deployed nodes, and obtain the supported boundary attestation procedure. This is upstream infrastructure work, not a fix that Ignite can apply by changing its own canister. No sender, key, queue, Supabase or PROD changes; no TEST alert sent. No application mock can prove this infrastructure guarantee.

### Pinned public source references
All links below use the observed GuestOS source revision, unless noted:
- [GuestOS adapter service](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/ic-os/components/guestos/ic-https-outcalls-adapter/ic-https-outcalls-adapter.service#L10-L19)
- [TLS connectors](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/rs/https_outcalls/adapter/src/rpc_server.rs#L76-L127)
- [Queue-full original request](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/rs/https_outcalls/client/src/client.rs#L116-L136)
- [Error Debug/Full variant](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/rs/interfaces/adapter_client/src/lib.rs#L44-L52)
- [Warning sink](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/rs/https_outcalls/consensus/src/pool_manager.rs#L263-L282)
- [Credential-bearing context](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/rs/types/types/src/canister_http.rs#L149-L164) and [request Debug](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/rs/types/types/src/canister_http.rs#L986-L997)
- [Attestation server](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/rs/ic_os/remote_attestation/server/src/main.rs)
- [Verifier library guidance](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/rs/ic_os/sev/attestation/README.md)