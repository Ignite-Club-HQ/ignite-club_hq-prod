# OpenCloud DEV recovery witness — install-only handover

The existing witness implementation was compiled with Paul's generated DEV approver public key. No private key was accessed. No canister call, controller change, deployment or activation was performed by Lovable.

## Exact target

- Host: `https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net`
- Witness: `c6dso-4iaaa-aaac5-aaeqa-cai`
- Expected sole effective controller: `4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae`
- Internal governor: `tuhlj-zg657-opcmu-4fct6-uxbzv-4j725-r6k7s-yxj4h-4el4q-og5ow-jqe`
- Identity service: `h5lly-yyaaa-aaac5-aadqq-cai`
- Raw installed module SHA-256: `6439de5416dac0dbd75da4c99ce4967572b7179686f8f6504687d8b5cb2029e2`

## ChatGPT / owner action

1. Use the existing authenticated OpenCloud owner session, not the developer/governor credential. Independently verify the effective controller set contains only the owner above, the canister is on the intended DEV subnet, and its module hash is empty. Stop on unavailable or conflicting evidence. Do not add controllers or substitute an operator proxy without verified supported management transport.
2. Upload `recovery_witness.wasm` from this package. Use management `install_code`, mode **install**, targeting only the witness above. Never reinstall or use a create/deploy-all operation.
3. Encode the following arguments using `recovery_witness.did`:

```candid
(record {
  governor = principal "tuhlj-zg657-opcmu-4fct6-uxbzv-4j725-r6k7s-yxj4h-4el4q-og5ow-jqe";
  identity = principal "h5lly-yyaaa-aaac5-aadqq-cai";
})
```

4. Record the intent durably before the installation call. If the result is uncertain, retain the pending intent and read back the module/controller state; do not automatically repeat installation.
5. Read back the exact installed module hash and unchanged sole effective controller. As the pinned internal governor, call `read_recovery_head()` and verify initial `revision = 0`, `epoch = 0`, and `accepted = null`. Record the installation receipt and verified effective controllers for the subsequent identity build/commissioning handover.

Installation leaves recovery acceptance and subject-progress arming closed. Do not invoke acceptance, authorize removal progress, open groups, upgrade the identity service, change controllers, run CI or touch mainnet/PROD/Supabase/email as part of this install.

## Checks completed

- Locked release build of the unchanged repository implementation.
- Supplied public key confirmed embedded in valid WASM bytes.
- 20 existing witness security tests passed.
- Every public endpoint matches the Candid interface; only the standard initializer, upgrade hook and Candid compiler export were excluded from endpoint comparison.
- `SHA256SUMS` covers all handover files except itself.

Lovable currently has no connected authenticated OpenCloud owner transport; GitHub and Firebase connections do not grant witness management authority. Controller independence and empty-module status remain live prerequisites, not inferred from this build.