<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Preview runs frontend/ through lovable.toml and scripts/*-preview.mjs; map SUPABASE_URL/PUBLISHABLE_KEY to IGNITE_LIVE_SUPABASE_URL/ANON_KEY. Keep root dependency-free.
- Install only via scripts/ensure-frontend-deps.mjs; npm ci wipes preview dependencies. build-preview.mjs copies live-index.html for SPA hosting.
- Read nested AGENTS.md in scripts/, frontend/, backend/ and backend/media_blob_store/ before scoped changes.
- notification_queue authorizes schedule scopes/update_reminder admin/club audiences in enqueue/fan_out; polls use caller signals. Normalize roster principals; gate admin reads and report queued, not delivered, counts. Why: browsers cannot authorize writes.
- Schedule: omission keeps; empty image/zero end-date clears; monthly dates clamp in UTC. Why: Candid compatibility.
- Self/admin erasure retains inventory; router locks persist through commit. Gallery copies decrypt under club keys.
- ICP pitch alerts use livePitchRecipients for club scope/staff/match duties; omit child names. Why: avoid wrong audiences and plaintext PII.
- Competition welcome settings live on competition_domain behind refreshed manager access; club-role mirrors fail closed. Why: no Supabase fallback or stale access.
- Native II: use id.ai/authorize and its reply origin; register callbacks before Browser.open, nonce-scope cancellation. Why: legacy-host redirects drop replies.
- Android bars: apply StatusBarBackdrop after SystemBars; keep its remaining CSS inset, no forced floor. Both Codemagic workflows run scripts/configure-android-status-bar.py; preserve keyboard handling. Why: native padding already reserves space.
- ICP images wait for restored auth, share account-scoped unlocks and retry after cooldown/foreground recovery. Why: avoid false startup failures and duplicate unlocks.
- Documents use authorized/decrypted URLs, preserve extension/MIME, cache WebView blobs natively. Why: raw ICP URLs are ciphertext.
- ICP rewards verify roles via governor-configured club_domain; catalog/settings reads refresh caller role mirrors first. Why: club creation needs no manual points-service grant.
- ICP media uses uploader avatars; inbox previews use scope IDs; DM settings read/write ICP. Chat files encrypt/register before token creation. Why: silent no-ops lost device attachments.
- Club setup uses active membership backend; palettes/logo count separately from entitlement; sponsor/theme saves invalidate it. Why: ICP free setup has no Supabase rows.

<!-- ic-skills:managed:start -->
<!-- state: configured (on-demand) -->
Fetch the skills index once per session and keep each skill's name, description,
and SKILL.md URL:
https://skills.internetcomputer.org/.well-known/skills/index.json
Before writing ICP code for a task, fetch the matching skill's SKILL.md
(https://skills.internetcomputer.org/.well-known/skills/{name}/SKILL.md) and follow
it. Skills are authoritative — prefer them over general knowledge.
<!-- ic-skills:managed:end -->
- ICP frontend deploy: start mapped canisters; never reinstall on sync failure. Pin CLI; grant via `canister settings update --add-controller --force`, failing on error. Why: preserve assets/access.
- II paths enforce club scope; uploads verify membership to prevent revocation bypass.
- Scaling: separate cutover; reject partial batches; distinguish client/callback loss. Bind deployment/revision/HTTPS/network/subnets/account; gate extra subnets. Recovery: exact inventory, stop stores before authority, full restore, approved authority-first resume. Persist locked intent/acks; replay interruptions, retain locks on disk failure. Raw hashes cannot prove decoded ledgers. Why: prevent routing/data mismatch.
- messaging owns photo timers; notification owns audiences. Vault progress uses pending mutations; denied rosters throw; season placements use membership routing. Why: preserve errors/export authorization.

- OQL: bounded read-only, allowlisted fields; authorize before filtering/paging/counts; no self-calls.
- Media moves require operator-authenticated registries, journaled fences and bounded consensus pages. Policy 2026-10-19: encrypted-media clubs stay put; no re-encryption or reconciliation bypass. Place new clubs into groups. Why: photo keys belong to the creating group.
- Admission uses the general switch: governor-verified snapshot (revision, inventory, hashes, removal wiring) must match live registry, else fail closed; health never bumps revision. Snapshot revisions are decimal text before hashing/emission. Why: prevent drift and Nat64 precision loss.

- Keys: SDK derivation, signed controllers, receipts; engines offline. Fixtures never authorize release.
- G2 journal readback pins the acknowledged commit; unknown writes stop. Why: branch reads can lag.

- Router index rebuilds from stable rows; writes refresh, picks recheck gates. Never deploy scale-probe.
- History uses nullable DTOs/exact links and verified humans; PlayHQ keys are tenant-scoped, claims grant no ownership. Deploy history scope upgrades only competition/events, never creates or rewires others. Why: preserve data and isolate releases.
- Two ICP environments via scripts/icp-environments.mjs: DEV (deploy/mainnet, main, DEV Supabase) and PROD (deploy/prod + deploy/frontend-prod, prod branch, PROD Supabase, PROD_* keys). Pushes to prod auto-upgrade changed PROD canisters (upgrade-only, per-canister release.json resume) via promote-icp-prod.yml; Codemagic is prod-only and bakes PROD IDs. Builds/workflows refuse cross-environment IDs, keys or databases. Why: test on DEV, release on PROD, mirroring database promotion.
- Every GitHub workflow display name starts with exactly one tag — [TEST], [PROD], [DB] or [REPO] — and a renamed workflow keeps its file path so run history and dispatch links survive. Why: the Actions list must state which canister set a run can touch.
- Codemagic prod workflows keep pre-merge store identity: `android-workflow`/`ios-workflow`, appId `app.lovable.igniteteamhub`, groups `google_play_credentials`, App Store integration `Codemagic`; android helpers must discover the package dynamically. Why: changing identity breaks store updates.
- Group routing approval binds to the router's configuration revision plus approved configuration (live `read_routing_approval` when the build snapshot is behind), never the raw registry revision; keep `backend/shard_router` and its bindings in step with the live router. Why: health/placement bumps must not lock the app out.
