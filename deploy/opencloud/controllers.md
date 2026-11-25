# OpenCloud DEV controller update (ignite_dev_v2 on ignite-prod)

Offline tool: `scripts/opencloud/controllers.mjs` (official `@icp-sdk/core` Candid + Principal only).
GitHub workflow: **[TEST] OpenCloud DEV controller requests** (manual, no secrets, never sends anything).
ChatGPT submits every request through the authenticated ICP connector via the OpenCloud management proxy.

## Target controller sets (existing controllers are always kept)

| Canisters | Must keep | Add | Must never have |
|---|---|---|---|
| Frontend `h2knm-vaaaa-aaac5-aadqa-cai` | `s53an-5aaaa-aaac5-aaaaa-cai`, `tuhjl-zg657-opcmu-4fct6-uxbzv-4j725-r6k7s-yxj4h-4el4q-og5ow-jqe` | owner `4sf7q-…-sae`, publisher `jfagr-…-oqe` | governor |
| 31 backends | same | owner `4sf7q-…-sae`, governor `vk34m-…-pae` | publisher |

## Per canister (frontend first, then the other 31)

1. `canister_status` with `(record { canister_id = principal "<ID>" })` (or the `hex` from workflow mode `status`, target `all`).
2. Decode the reply: workflow mode `decode`, `reply` = raw reply hex/base64. If the connector already shows controllers as text, use mode `update-from-list` with a comma list instead.
3. Workflow mode `update`, target `<ID>`, `reply` = the status reply. Submit the returned `candid` (or `hex`) to `update_settings`. Only `controllers` is set; every other setting is null, which the management canister treats as unchanged. The tool refuses if a retained controller is missing, the forbidden identity is present, or the result exceeds 10 controllers. `unchanged: true` means skip.
4. `canister_status` again; workflow mode `verify` with `reply` = before, `after_reply` = after. It must report `ok: true` (nothing removed, required present, module hash/status/allocations/freezing threshold unchanged).
5. Stop at the first failure and report; never retry an `update_settings` whose result is unknown without first reading status.

## After all 32

Run **[TEST] OpenCloud DEV publisher and governor access**: publisher reads the frontend, governor reads the 31 backends, all through `--proxy s53an-5aaaa-aaac5-aaaaa-cai`. 0/32 failures resumes the v4 deployment steps in `chatgpt-steps.md`.

## Engine Developer registration

Canister control and engine-proxy access are separate. If the access check fails for the governor or publisher with a proxy authorization refusal (not a "not a controller" error) after the controllers show correctly in `canister_status`, add that principal as a Developer of `ignite_dev_v2` in the OpenCloud dashboard, then rerun the check. This could not be confirmed offline.
