# DEV cold chat opening — 7 November 2026

## Implemented
- All four ICP thread loaders return authorised message rows before names, avatars and reactions finish. Late enrichment patches optional fields only on still-present rows; concurrent edits, delivered rows and reactions win. Logout/revocation retires pending work.
- Team message rendering no longer waits for supplementary banners. Existing Club Pro and membership gates remain unchanged.
- Concurrent identical page requests share one in-flight read, partitioned by principal, host, network, complete canister inventory, conversation and page cursor. Completion does not create a freshness exemption.
- `refetchOnMount: "always"` remains on team/club/group/DM queries. Mount invalidation joins an existing read instead of cancelling it; duplicate team manual refresh removed. Authorised empty ICP DMs do not trigger the legacy empty-result retry.
- Query attempts, refusal/error categories, stale/missing sequence, write fence, unavailable method and update fallback durations are reported without raw backend text, IDs or message content. Late enrichment has an independent completion sample; first-message logging waits for a paint boundary.
- Bundle caches and seen-sequence state are account/target-bound. Existing React Query keys remain compatible with realtime and pending sends; their entire client partition is retired synchronously on ICP account change. Device message keys include the ICP principal. Authoritative access refusals remove the affected query and navigate away; transient failures preserve authorised cached data.

## Backend investigation (no backend changes)
`open_conversation_query` retains its private-name/legacy query gate, account removal fence, club fence, club membership query and local message visibility checks. Club chats can call `club_domain.is_club_member`; direct and other exempt scopes do not automatically incur that club call.

The current query scans the entire message collection twice, then reactions and referenced polls. This scan and its enrichment remain server-side before the response. A separate message-only endpoint/index is a future backend change, not implemented or deployed here; no permission check was removed.

Public dashboard observations for DEV base canisters:
- messaging `mx3u5-iqaaa-aaaal-qxlqq-cai` and club `mzzzv-taaaa-aaaal-qxlrq-cai` both report subnet `e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe`.
- Thus the base membership dependency is co-located, not cross-subnet.
- Dashboard reported application subnet, 46,105 canisters, instruction rate 620,679,636 and message execution rate 423. These are aggregate observations, not per-query saturation or authenticated latency evidence. Group-shard placement and per-replica load are not verified.
- Sources: `https://ic-api.internetcomputer.org/api/v3/canisters/<DEV-id>` and `/api/v3/subnets/<subnet-id>`. Dashboard metadata is observational, not certified authorisation evidence.

## Verification and outstanding benchmark
Consolidated tests cover core page-before-enrichment, no stale overwrite, pending disclosure retirement, query fallback, mount coalescing, account/shard isolation, ordering/cache helpers and authoritative denial versus transport failure. The public localhost preview reaches `/auth` with zero browser runtime errors; authenticated UI checks are unavailable without an Internet Identity delegation.

Baseline supplied by Paul: legacy DEV `chat_open`, 266 samples, median 95 ms, p95 29,649 ms. Its old `cold_open` label includes cache hits and is not a genuine-cold benchmark.

**No 30-open physical Android benchmark has been completed.** This sandbox has neither a physical Android device nor Paul's delegated ICP session. Browser emulation, mock tests and anonymous RPC probes are not substituted for that requirement. Therefore no before/after cold median or p95 is claimed.

Acceptance protocol after the TEST frontend update: collect at least 30 genuinely uncached Android opens, covering team/club/group/DM (e.g. 8/8/7/7), and matched cached revisits. Use real authorised threads; preserve sign-in and never delete server data. Capture platform, chat kind, cache state, query/fallback reason, all durations and failures. A reload alone does not establish a cold open because device/persisted/inbox-prefetch caches may survive. Validate first visible rows on-device, then calculate median and p95 per kind/class and overall. All failures remain in the report, not just successes.

Production was not deployed or modified. DEV backend query contracts were not changed.