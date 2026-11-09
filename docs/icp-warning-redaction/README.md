# ICP HTTPS warning redaction candidate

## Status

Prepared an upstream source patch, reproduced the unsafe formatting locally, and passed two regression cases after applying it. **Not submitted upstream, not a full replica build, not deployed, and not verified on the protected subnet.** No Firebase credentials were read or used. No canister, queue, Supabase, PROD delivery or recurring worker changed.

The affected code belongs to `dfinity/ic`, not Ignite's application. Ignite canister controllers cannot replace a public subnet's replica/GuestOS. Infrastructure release adoption and subnet rollout require the applicable NNS governance process; no such release was executed here.

## Patch

`credential-safe-warning.patch` targets `rs/https_outcalls/consensus/src/pool_manager.rs` at upstream revision `83f29e0803496ba6aaea3d6b43f6c6bebea12dd9`.

- Original source SHA-256: `ed2a0357756a7d2e1bec097bd778ef0f379a444bfd7b96745980ac0e4e44ea17`.
- Patch SHA-256: `7878d9b808af58dca6f4f4f0ad72d1255dad342db9e9353aa1535044f8dafde1`.
- Removes Debug formatting of the error and its embedded request entirely, rather than trying to redact known header names.
- Logs only static `adapter_queue_full` or `adapter_connection_broken` classifications.
- Preserves the existing metrics, queue handling, request caching and retry behavior. This does not change push-sender retry policy.
- Addresses this one sink; does not certify every upstream logging path or credential handling generally.

## Local regression evidence

`test_warning_redaction.py` extracts the actual upstream warning/metrics block and `SendError` enum into a dependency-free Rust harness. The request object's Debug formatter panics if called: the unpatched queue-full case fails, while the patched case passes without inspecting request data. The broken-connection case checks that its existing metric classification is retained.

The harness substitutes the logging macro with an immediate formatting capture. It tests the exact formatting arguments, not full ICP logger behavior, replica integration, a running queue, TEE protection or network delivery.

With the pinned source tree staged outside the project:

```sh
patch --batch --fuzz=0 -d /tmp/ic-source -p1 < docs/icp-warning-redaction/credential-safe-warning.patch
python3 docs/icp-warning-redaction/test_warning_redaction.py /tmp/ic-source
```

Result on 9 November 2026: **2 passed, 0 failed** after patch; unsafe request formatting reproduced before patch. No real credential fixture or public subnet saturation was used.

## Protected-subnet readback

Fresh public node inventory for `re2t4-faa75-v3vhk-kdmdr-uyrkl-aik2l-ixd6u-p3fyr-zlfkc-6c5af-zae` returned seven nodes, all reporting TEE active and the original `83f29e0803496ba6aaea3d6b43f6c6bebea12dd9` GuestOS revision. This is telemetry, not independent attestation. It does not show this new patch deployed.

## Remaining acceptance

1. Upstream maintainers review the patch and run the actual replica/consensus tests, including queue-full log capture with synthetic header/body sentinels.
2. Identify the accepted release, reproducible artifact and executed NNS subnet rollout; source acceptance alone is insufficient.
3. Bind all current participating nodes to that fixed release through supported runtime attestation and membership verification. Do not stress a shared public subnet to force queue overflow.
4. Resolve the previously documented secure provisioning and recovery trust boundary, then perform an isolated native TEST send and confirm phone receipt/tap and latency before changing live delivery.

Sources: [affected pinned source](https://github.com/dfinity/ic/blob/83f29e0803496ba6aaea3d6b43f6c6bebea12dd9/rs/https_outcalls/consensus/src/pool_manager.rs#L263-L282), [NNS governance](https://docs.internetcomputer.org/concepts/governance/), [node infrastructure](https://docs.internetcomputer.org/concepts/node-infrastructure/), and the public inventory URL recorded in the existing protected-hosting verification note.