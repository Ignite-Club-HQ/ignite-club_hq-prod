## Goal
Make parent-invite child provisioning authoritative, transactional, secure, idempotent, and repair accepted invites that were consumed before children were created.

## Implementation
1. **Live-schema contract**
   - Use the confirmed `pending_invites`, `children`, `child_guardians`, `child_team_assignments`, `user_roles`, `team_memberships`, and `profiles` columns, constraints, RLS, and deployed trigger definitions.
   - Preserve current role, membership, mini-league, theme, and invite-claim behavior.

2. **Database migration**
   - Add the requested two-argument `public.provision_invite_children(_invite_id uuid, _guardian_id uuid)` as `SECURITY DEFINER` with explicit `search_path`.
   - Restrict execution to authenticated/service roles, revoke `PUBLIC`/`anon`, and enforce invite ownership inside the function so authenticated callers can only provision themselves; permit trusted trigger/migration execution.
   - Safely parse `metadata.children`, conservatively reuse only guardian-owned/linked children (or an explicitly referenced, verified in-scope roster child), create missing children, and idempotently ensure guardian/team links.
   - Return created counts and resulting child IDs.
   - Update both auto-accept trigger functions to provision pending and already-accepted parent invites in the same transaction, before acceptance when pending.
   - Backfill eligible accepted invites through the same function.

3. **Frontend idempotency**
   - Replace standard parent-invite direct child inserts with the provisioning RPC after auth/profile setup, including when the invite is already accepted for the signed-in user.
   - Keep mini-league/existing-child special flows intact and surface actionable provisioning failures.

4. **Verification**
   - Query the deployed function and both trigger definitions after migration approval/execution.
   - Verify repaired Chicken/Cat and Donkey/Dingo records if present.
   - Verify two calls produce no duplicate children/links/assignments and roles/memberships remain unchanged.
   - Verify cross-user invocation is rejected using database-level authorization checks.
   - Run focused frontend guard tests and report IDs from a safe fresh test invite; remove test-only records after verification where safe.

## Technical notes
- No new tables and no generated Supabase type edits.
- RLS remains enabled and unchanged; the function narrowly bypasses it only after its own ownership checks.
- UUID comparisons/string handling will use explicit text casts where string operations are needed.
