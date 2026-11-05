# Isolated sign-in runtime preparation

## Prepared, not deployed

Implemented `scripts/assemble-smaller-runtime.mjs`, release templates and pure document-ownership rules. The assembler creates a temporary dual-entry DEV candidate from the exact fingerprinted production source and current secure source. It changes only three existing email files: sign-in tabs, signup invitation validation/token metadata, and the narrow administrator retained-email setting. Every other legacy email source—including App, main, scores and notification handlers—stays byte-identical.

The legacy service worker is preserved with SHA-256 `af2817ac3cd4d75517791830e3ff71d2125ed9d90c3dd0207e8817aae3df6fe5`; it has no navigation fetch handler that could serve an email shell under `/secure`. Current preview's replacement worker is not used. The refreshed GitHub tarball has different gzip bytes from the earlier fetch, but all extracted production source entries match the original source inventory exactly. Environment files and repository metadata were excluded.

The secure candidate uses `/secure`, its own entry, fixed ICP provider, full existing club application source and namespace-specific invite handoff storage. AI score-review routing is omitted. Public signup-denial wording is club-neutral in the candidate; bound DEV review sources and owner approval remain unchanged. Method changes use full document navigation and do not forward backend-specific invitation capabilities or callback credentials.

Separate dependency installation now runs through the shared installer and only targets temporary candidates; project/symlink targets are rejected. Missing legacy native plugins are included in the candidate manifest, without changing the running frontend dependencies. Dependency resolution creates a local candidate lock, not an accepted production dependency lock.

## Verified

- **56 release safeguards passed**, including invitation eligibility for both retained club IDs, rejection for other clubs/uninvited requests, malformed settings, preserved settings before-images, local runtime ownership, installer restrictions and all earlier staging/review checks.
- **55 existing frontend regressions passed; 3 skipped**, across seven discovered test files covering score privacy, notification launch/promotion safeguards and Internet Identity callback/derivation. This is not authenticated hosted acceptance.
- Browser on the separate local DEV candidate: styled email form at `/auth`, click secure tab → `/secure/auth` with the existing secure form, refresh secure page, click email tab → `/auth`. Zero page errors. Existing install/cookie prompts were dismissed normally. Secure startup needed more than nine seconds while DEV configuration loaded; performance is not accepted.
- Normal preview's latest observed build log: build OK.

## Explicit unfinished work

This is a source/serving rehearsal, not a complete approved release artifact. Candidate production bundling, import-closure acceptance, source package-lock acceptance and native multi-entry delivery are unfinished. Existing hosting/store workflows were deliberately not rewired to this candidate.

Native notification/deep-link namespace ownership, external callback/return destinations, all raw secure path checks and shared-origin cache/service-worker behavior need full authenticated acceptance. The narrow administrator UI's authorization and JSON compare-and-swap are implemented but not exercised against a real administrator session. No secure club/profile/invitation write flow was exercised end-to-end.

The checkout still lacks verified PROD backend/frontend canister mappings. Hosted credentials were not inspected, so their absence is not established. Fresh independently verified production database evidence and Netlify/Codemagic settings remain required. External unmanaged Supabase authenticated checks are unavailable here; real devices and Internet Identity user interaction are also required.

No SQL executed, migration altered, PROD canister provisioned, merge performed, workflow enabled, site published, credential changed or scheduler activated. Existing score/History reconciliation and AI activation remain deferred and do not block unrelated source preparation.

## Reproduce locally

Extract the exact production source at commit `ea005b7178a6de9c207b744a2ea65cffde713b5f`, excluding environment files and metadata; include its exact public service worker and package manifest. Run `node scripts/assemble-smaller-runtime.mjs <extracted-directory>`. Use `ensureRehearsalDeps` from the shared installer for that temporary candidate. Use DEV-only connection variables and DEV canister mappings to serve it. Never invoke this as a production publishing command.