# PROD group discovery — 23 November 2026

## Finding

**The reported refusal is a target-name mismatch, not a missing PROD approval.**
The router uses the exact on-chain target `mainnet`. `ic` is a network label and
`prod` is an environment/deployment label; neither is a registered routing target.
The approval lookup is keyed by the supplied target text and does not translate
those labels. No governor action or canister upgrade is needed for this blocker.

## Results

| Requested check | Verified result |
|---|---|
| Exact root cause | Calls used `ic` and `prod` instead of the approved `mainnet` target. Both incorrect calls reproduce the reported error. |
| Changes made | Investigation and corrected connector instructions only; no application/backend code, live settings, approvals, assignments or records changed. |
| Production approval | Complete for `mainnet`, configuration revision **10**, covering `base` and `g2`. Read directly from the router. |
| Group 1 accepting | **Yes:** live registry says `base.accepting = true`, 0 assigned clubs, maximum 100. Group 2 is registered but closed. |
| Public discovery | **Succeeds** with `("mainnet", null, null, 64 : nat32)`; returns both registered groups at configuration revision 10. The exact requested `ic` call still refuses, correctly. |
| Correct production IDs | All 26 returned domain entries match the PROD saved approval snapshot; all 13 base entries also match committed PROD mappings. Base club destination: `tbeh7-5qaaa-aaaai-ayenq-cai`. |
| Deployed configuration | Router software version **9**; registry revision **9**; configuration revision **10**. These are distinct numbers. The saved application approval has the same target/router/configuration revision. |
| Placement enforcement | Source `create_club` calls `creatorPlacementAllowed` before creating records. Fully configured bindings require a router receipt for the original creator, assigned group and actual destination canister; partial settings refuse. The PROD approval workflow verified accepting-group router/group/target bindings. Base club's certified module hash still matches that governor-verified snapshot. A fresh governor-only settings read was not performed here. |
| ChatGPT creation | The discovery prerequisite works. Full authenticated official-connector placement/create/setup/protected-read acceptance is **not verified**: Paul's delegated Internet Identity is not available here, and placement/creation would write PROD state, which this request forbids. Do not claim a completed creation. |
| Remaining action for this blocker | Use `mainnet` consistently in placement and discovery; no repeat opening or approval run required. |

Approval workflow evidence: [run 45117917277](https://github.com/Ignite-Club-HQ/ignite-club_hq-prod/actions/runs/45117917277), completed successfully
at 05:30 UTC. Its **Verify, record approval and write snapshot** step succeeded.
Fresh router reads around 07:18 UTC confirm that approval remains current.

## Health and capacity

Fresh public readings from every Group 1 capacity receiver and its photo store
were readable. Minimum fuel was approximately **1.163T**, above the configured
**1T** floor; maximum heap approximately **91.1 MB**, below the configured
**3 GiB** budget. The shared workload identity is approximately **0.463T**; the
existing router health policy deliberately excludes that shared service from
group capacity. This report does not authorize a payment or alter that policy.

The stored group health fields are currently uninitialised (zero fuel and
observation time). They are not evidence that the canisters are empty or out of
fuel. Deployed router source refreshes stale accepting-group health inside
`place_my_new_club`, using every group's own capacity receiver plus its photo
store. If any read fails, placement still fails closed. That refresh was **not
invoked** here because placement changes live state. Thus healthy direct readings
are not proof that a real placement has completed successfully.

The unchanged selector fills the most-utilised eligible group first, uses a
70% preparation warning, and accepts only groups strictly below 80% for club
count and heap utilisation. With only `base` open, it is the initial destination
while eligible. No existing assignment moves and Group 2 never opens itself.

## Correct official-connector instructions

Use the existing Ignite production app origin and the connector's returned
Internet Identity origin; do not sign in to a test app or mix canister sets.

**Safe read-only call to retry now**, on router `tgfbl-qiaaa-aaaai-ayena-cai`:

```candid
("mainnet", null, null, 64 : nat32)
```

Method: `read_public_group_targets`.

For a future **explicitly authorised real club creation**, not this audit:

1. Authenticate with the existing Internet Identity and verify the existing
   linked account via `identity_access.whoami()`; do not create another account.
2. Obtain confirmation for the intended club and generate one fresh UUID.
   Call `place_my_new_club(UUID, "mainnet")`. Stop on any refusal. Reuse the UUID
   for retries; never request another placement to work around an error.
3. Call `read_public_group_targets("mainnet", null, null, 64)` and locate the
   **returned placement's group ID**, not the first discovery row. If paginated,
   pin subsequent pages to the returned configuration revision. Closed groups
   can appear in discovery; that is not permission to place into them.
4. Call `create_club` only on that group's returned `club_domain`. Never call
   another group's destination or a shared legacy destination after refusal.
5. Complete country/general settings and the ordinary setup; use Ignite for
   any protected profile/logo/setup step the connector cannot complete.
6. Verify exact club/team IDs using protected account-scoped OQL entities on
   the assigned canister. Directory reads are not proof of account ownership.

Do not substitute `ic`, `prod`, a gateway URL or a runtime frontend alias for
`mainnet`. Do not add alias approvals: the existing application already uses
the correct canonical target.

## Tests and limits

- Router library: **58 passed**, including governor-only approval, revision
  checks, authenticated/capped/idempotent placement, 70%/80% thresholds,
  immutable assignments and closed/unhealthy-group refusal.
- Existing frontend discovery/approval/new-club dispatch suites: **14 passed**.
- Actual PROD public discovery reproduced for all three target names; signed
  registry/approval reads used a temporary, unregistered metadata-only identity,
  never Paul's identity, a governor key or an application account.
- No merges, deployments, upgrades, workflow dispatches, settings/approval
  writes, placements, account registrations, test clubs or business reads.
- Full official ChatGPT connector sign-in/create/setup/readback remains an
  acceptance limit, not a completed test. No PROD-write permission is inferred.

If a later **correct `mainnet` call** reports approval/revision failure, the exact
existing governor action is `record_routing_approval` with fresh complete verified
configuration/removal evidence and the current configuration revision. The
existing `[PROD] Save opening approval and republish live site` workflow performs
that verification and readback, but also commits a snapshot and dispatches
publication; running it would require separate explicit approval. It is not
needed for the current target-name mismatch.