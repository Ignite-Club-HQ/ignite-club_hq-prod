# DEV authentication and onboarding fixes — 21 November 2026

## Scope and result

PARTIAL: implemented the coordinated DEV source changes and applied the database protections on the verified DEV database only. Production configuration, accounts, memberships and deployment remain unchanged. No historical club migration, account linking, data cleanup, Google-provider change or store release was performed.

## Implemented

- New club creation requires an authenticated Internet Identity account at the club page, find/create wizard, Pro onboarding and new-club dispatcher. DEV database rejects authenticated new Supabase club inserts; trusted service/owner provisioning remains separate. Legacy team creation is unchanged.
- Club-domain role grants have an explicit role/scope allowlist. Only the governor can grant global platform administration; platform checks reject club/team-scoped app-admin grants. Club-admin checks retain effective-scope and exclusion checks.
- DEV role writes reject platform escalation and mismatched team/club pairs. Staff child/guardian creation is tied to the actual authorised family/team, preserving parent self-service.
- Legacy club token acceptance validates issuer, role, exclusion, expiry and remaining uses, serializes redemption and commits membership/usage together. The UI confirms only an exact receipt and never retries uncertain writes automatically.
- Pending team-only email previews return the authoritative team club. Existing Bridgewater/Basket Range signup tests remain unchanged.
- ICP pending tokens resolve anonymously even on email-default devices. Short links check ICP ownership first on email devices; unknown transport outcomes do not fall back. Explicit provider handoffs retain invite destinations.
- Legacy club invitations are accessible on web. Placeholder public/store destinations use the existing approved Ignite addresses.
- Stored/explicit ICP choice remains ICP without available targets. Stale native email callbacks do not exchange Supabase credentials during ICP sign-in; the user must switch explicitly and reopen the link.

## Evidence and limits

- DEV system identifier checked: `7581440907192989109`; generated migration `20261121225522_160f9101-5bfe-46cc-9f5d-f8de60ed0cac.sql` returns without executing on any other database.
- Hosted DEV trigger and policy readback confirmed. The socket-only disposable database rehearsal passed, covering escalation, foreign-team/family denial, valid parent/staff writes, atomic redemption and preserved legacy teams.
- Pinned Motoko 1.16.1 full club-domain check passed, with pre-existing compiler warnings. Independent role-policy assertions passed. No canister deployment performed.
- Final focused application tests: Supabase 134 passed / 3 skipped; ICP 131 passed / 6 skipped; zero failures across 10 files per mode. Full application runs were stopped after hundreds of files because concurrent CPU pressure invalidated timing-sensitive checks; no complete baseline pass is claimed.
- Desktop 1280×1800 and mobile 390×844 public sign-in inspected: both tabs rendered, no overflow and no page exceptions.
- Connected Supabase is external/unmanaged: authenticated end-to-end checks were unavailable; no real users were created or invited in the hosted database. Physical Android/iOS and Internet Identity account acceptance remain unverified.
- Seven new linter warnings describe intentionally callable security-definer entry points/helpers. Token previews must be public for signed-out invitation onboarding, authenticated redemption validates the caller/token server-side, and RLS helpers need definer privileges to avoid recursion. Public grants were removed where inappropriate. These are reviewed access design warnings, not permission to weaken the rules. The 779 earlier linter findings were not addressed in this scoped change.

## Held follow-up

1. Complete full baselines sequentially without concurrent test pressure.
2. Deploy and read back the exact DEV club canister through the existing governor-authorised workflow; the required governor credential is unavailable in this sandbox.
3. Obtain real DEV authenticated/physical-device acceptance, including existing legacy members and the complete ICP club/team/family invitation journey.
4. Before any production release, obtain privileged read-only PROD catalog/deployed-code evidence and owner decisions for historical clubs/Google-provider continuity. Nothing here authorizes a PROD change.