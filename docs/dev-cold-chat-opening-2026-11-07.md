# DEV cold chat opening — 7 November 2026

## Findings and changes

- Reproduced two unnecessary reads: simultaneous uncached first-page calls made two canister requests, and the mount freshness helper failed to join an already active first-page query. Both regressions failed before and passed after the repair.
- Shared in-flight page calls only when principal, full target inventory, conversation, cursor and page size match. Retire success/failure promises immediately; no new persistent message cache or broader prefetch.
- DM mapping previously waited sequentially for profiles then reactions. It now publishes authorized text immediately and runs those reads together; private names stay out of message snapshots. Existing final enrichment and pagination remain.
- Team message rendering additionally waited up to 1,500ms for banners after messages were ready. Removed that message gate while retaining banner behavior.
- Team/club/DM loading no longer hides an already returned nonempty message page while optional profile readiness settles. Metadata/Pro/permission gates remain unchanged.
- Team, club and group initial pages remain 30; DM is 25, shared with the existing bounded warming helper. No new pre-caching.
- Agent/actor reuse already exists, including refreshed delegation identity and failed-agent eviction. No root-key fetch occurs on real hosts; unchanged.
- Group route/session reuse and current destination membership checks remain unchanged. Registry opening/assignment checks and protected consensus operations were not bypassed.

## Operation instrumentation

`window.__igniteChatOperations` is a bounded in-memory tap-window ledger of each actor method, query/update mode, start offset, duration and success/failure. `dispatch:<feature>` spans cover dispatch authentication/routing/provider time. Existing chat-open breakdown retains tap-to-first-content tracing. No IDs, arguments, bodies, private names, credentials or replies are recorded. Dispatch spans overlap their nested operations; do not sum overlapping spans.

Typical existing team/club path: confirmed identity → routing approval/session reuse → entity owner discovery if needed → authorized open_conversation_query → protected consensus fallback when required → text mapping → independent enrichment. Group adds independently requested group metadata; DM independently requests conversation metadata and DM permission. These metadata/entitlement screens remain gated; their measured cost is still needed before further changes.

## Measurements and limits

30 deterministic, distinct uncached DM cases, fixed synthetic page=600ms, profile=1200ms, reactions=800ms:

| First text | Before | After |
|---|---:|---:|
| Median | 2600ms | 600ms |
| P95 | 2600ms | 600ms |

This isolates the removed sequential enrichment wait; it is **not** a measured ICP or Android speedup and does not certify the 1s/2s/3s targets. No reliable ranking of real slowest operations is available without a delegated DEV Internet Identity session and actual device samples. Protected query-to-update fallback, group ownership discovery, conversation metadata, and route approval remain potential real-network costs.

Browser check reaches public sign-in on desktop and 411×770 phone viewport, with no runtime errors or horizontal overflow. It does not verify signed-in chats. No production operations, origin changes, membership grants, deployments or backend code changes were made.

## Acceptance still required

On DEV with a real delegated identity: 30 cold samples across team/club/group/DM, including first after startup and never-before-cached threads; collect operation ledger plus actual first-visible-message timings and repeated cached opens. Repeat on physical Android. This evidence is required before claiming the reported 10-second first-open issue resolved or promoting the changes.