# Ignite DEV plugin — one direct canister round trip for clubs and roles

## Scope

Source-only DEV performance candidate, **not deployed**. The official DFINITY ICP connector remains the only ChatGPT-to-ICP transport; there is no Ignite-hosted MCP server, OAuth exchange, HTTP proxy, Supabase bridge, new identity, or service-account impersonation.

New `club_domain.read_account_my_clubs_and_roles_indexed(after : ?Text, limit : Nat16)` returns:

- `#Ok({ clubs, next, acl_revision, roles })` with exactly the existing indexed caller-membership club IDs and existing caller-authorised role grants.
- `#Err(text)` for invalid pagination or app-wide-role cases, as the existing indexed membership method does.
- An explicit authentication rejection/empty authorised result for unlinked/outsider callers under the same current Identity, removal, ACL and club exclusion checks as the original endpoints.

The code invokes `admitAccountForFirstContent(caller)` **once** and makes no further cross-canister calls while collecting the live memberships and live role grants. It does not transfer, cache or decrypt PII, and never accepts a caller principal as a method argument. The existing `read_my_club_memberships_indexed` and `read_account_my_role_grants` methods stay unchanged.

## Connector usage once a separately approved DEV G2 upgrade is completed

1. Discover the exact DEV Group 2 Club Domain using the official ICP `open_app` manifest and use the returned DEV derivation origin; never use PROD or an unverified principal/canister ID.
2. Use the member's own current Internet Identity link. Read `get_canister_candid` for the new method, then call it with `(null, 50 : nat16)` once. Interpret Candid `#Err` as a rejection, not an empty club set.
3. Use `clubs` and `roles` from that single signed response. Follow `next` only if there are more authorised membership pages.
4. If a group has not been upgraded yet, use the existing two signed methods. Do not route through an Ignite server or create a substitute API.
5. The two ICP groups are **separate** canisters; this saves a same-group connector call, not a cross-group request. Separate Group 1 and Group 2 lookups still require at least one signed call to each group when both are needed.

## Security and proof

The new single-read endpoint uses the existing private-name writer and account-removal fences, current Identity admission, caller-authenticated roles, live membership index, club exclusion and active-club filters. It adds no principal input, token, private roster or authorization shortcut.

Focused source contract tests and the existing disposable two-group PocketIC linked-membership test cover the new endpoint's equivalence to the two original calls, outsider isolation, suspension, stopped Identity service, revoked linked identity, and membership removal.

This PR must not trigger live DEV canister installation, environment-setting changes, controller/PII changes, a PROD workflow or a new proxy. A future **separate exact DEV Group 2-only canister release** is needed before the official connector can use the method. Compare signed same-principal calls before and after to measure wall-clock savings. Keep the existing combined-admission flag **off** unless independently approved.
