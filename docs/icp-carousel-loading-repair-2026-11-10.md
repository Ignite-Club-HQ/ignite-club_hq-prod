# DEV carousel loading repair

- Team inventory now visits verified member groups only, independently of complete player-league discovery across all groups.
- First-login reveal waits for both inventories, club display metadata, next events, competition entries, unread counts and trial badges. Deferred badges remain separate from entitlement authorization. Only features available in ICP mode are included.
- Same-account snapshots can hydrate past the previous 24-hour display expiry; ordinary email-mode expiry remains unchanged. Opening any saved card still uses existing server authorization.
- Transient failures do not erase ICP snapshots. Successful inventories, including empty results, replace old rows. Deleted-team tombstones still apply.
- Automatic ICP inventory retries are disabled; observers have a 30-second deadline matching the existing group coordination window rather than a shorter 12-second deadline. Outstanding per-account/target/inventory requests are rejoined rather than duplicated on resume. This does not claim cancellation of a submitted canister request.
- Snapshot captures competition entries and resolved trial flags as well as existing event and unread data.

No backend permission changes, Supabase migrations, canister upgrades or PROD deployment. Physical-phone timings and authenticated ICP end-to-end checks remain unverified; mounted tests exercise the loading and saved-card flows with controlled authorized responses, not a real II session. Logo image bytes still decrypt/load through the existing image component.