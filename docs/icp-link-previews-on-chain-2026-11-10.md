# ICP link-preview generation — 10 November 2026

## Scope and implementation

DEV frontend changes only; no PROD deployment, provider credentials, chat permissions, stored messages, push delivery or historical-media changes.

`LinkPreview` previously called `/api/fetch-link-preview` first in ICP mode, and only used `messaging_domain.fetch_link_preview` when the external helper failed. It now goes directly through the existing signed-in, shared-app messaging dispatcher to that canister method. There is no external-helper fallback in ICP mode. Unavailable metadata leaves the same clickable host card; chat loading, fixed preview dimensions and scroll-idle rendering are retained.

The canister already performs HTTPS GET, parses metadata and caches results on-chain (transient cache, lost on upgrades; 24-hour TTL, maximum 2,000 entries). No canister/interface changes were needed for this routing stage. Frontend metadata and in-flight requests are separated by sign-in mode, so an email-produced cache hit cannot skip the ICP fetch. Messaging helpers are imported only when needed.

Email mode retains its existing anonymous-canister attempt followed by the external endpoint. Its push and preview implementation are otherwise unchanged.

## What remains external

- Source websites necessarily remain external; ICP HTTPS outcalls contact them directly.
- Preview image URLs still load from the source website/CDN. This stage moves preview **generation**, not remote image bytes, onto ICP.
- The external endpoint remains available for email mode, not ICP mode.

## Existing limitations, not silently fixed

- ICP helper accepts HTTPS only; HTTP-only links remain clickable without metadata.
- The existing 64,000-byte response limit counts headers and body, not just metadata. Larger HTML pages may fail rather than return a partial preview.
- Replicated outcalls can fail consensus on varying page bodies. The existing lightweight parser also misses some attribute ordering, single-quoted tags and relative images. Those failures leave plain links; this stage does not claim equivalent metadata coverage for every website.
- Cold ICP previews can take longer than the old external helper; repeated links use caches. No real-phone latency improvement is claimed.
- The existing public method caps anonymous cache-miss requests but not authenticated cache misses; broader outcall abuse/URL-policy changes need a scoped canister review, not an untested change bundled into this frontend move.

## Verification

Before the repair, three mounted regressions failed: ICP success/failure took the external path, and email metadata cached under a raw URL bypassed the ICP request after switching modes. Email success/fallback checks already passed.

Focused tests cover canister-only ICP metadata, no external fallback after failure, unchanged email success/fallback, and cache isolation on mode switching. These are deterministic tests, not a deployed authenticated II outcall or physical-phone acceptance. The sandbox has no delegated II member session or phone; those checks remain unverified. Production has not been changed.