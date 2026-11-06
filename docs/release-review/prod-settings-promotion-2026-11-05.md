# PROD settings compatibility promotion

## Built scope

The existing promotion workflow now checks 24 human-data receivers across the
PROD base and independent g2 inventories, even when no canister code changed.
The base addresses are pinned; g2 addresses come from the acknowledged original
registration receipt and must match current PROD registry placements.

For already-enabled production admission only, it sets the account authority to
the PROD identity service and clears the incompatible local-rehearsal switch.
It preserves all other settings, including keys, secure name saving, removal,
notifications, and existing group open/closed status. Dormant admission/removal
is not activated. Foreign authority, rehearsal-only protection, or removal
without admission stops for separate review.

All changed receivers must have an artifact matching their exact running module
before settings writes begin. Changes use durable hash-only intents, immediate
settings readback, identical-code upgrade with Wasm memory kept, and a second
readback. An interrupted intent stops subsequent runs; it is not blindly replayed.
No DEV values or business data are copied. The existing broader protection
activation hold is unchanged.

## Verification and remaining limits

### Executable offline rehearsal — 6 November 2026

The actual `check` and `apply` commands run in isolated child processes, using
real policy, Candid encoding/decoding, Wasm hashing, compressed artifacts and
report files. Only the routing/network and journal boundaries are substituted;
no credentials, live calls, paid actions or PROD writes occur.

The rehearsal reproduced two executable defects: the plain persistent photo
store received a governor argument instead of an empty argument list, and the
last verification accepted unrelated settings drift on an unchanged receiver.
Both now have regression tests and fixes. Prior acknowledged journal evidence
is retained rather than discarded; unresolved intents still stop without replay.

Coverage includes 24-target read-only checks, admission repair, preservation of
keys and separate switches, identical-module memory-preserving restart, gzip,
missing artifacts, registry drift, journal failure, pre-existing pending intent,
settings readback failure, lost restart reply and final unchanged-service drift.
Fixture records are checked for preservation, but this is not a replica upgrade
of the application or proof of live data preservation. Signed-in live events
acceptance remains separate, and is not certified by these rehearsals.

Result: 26/26 executable rehearsal and policy/preservation tests passed; executable
syntax and workflow YAML validation passed; preview reports build OK. No PROD
execution or authenticated events acceptance was performed. This evidence alone
does not certify a break-free live release under the standing production rule.

Focused policy tests cover PROD-only addresses, both groups, preservation,
dormant-release holds, drift, exact-code preflight and acknowledgments.

A read-only browser visit to `https://igniteclubhq.app/events` redirected to
`/auth`. No Internet Identity session is available in this sandbox, so the
authenticated events screen has not been verified. The new promotion step has
not run in PROD: it requires the tested source to reach the prod branch. If g2
runs older code than the available exact artifact, the step stops without
changing settings rather than silently upgrading or reinstalling that group.

After merge, inspect the filtered `prod-settings-check` artifact and promotion
result, then sign in with the affected Internet Identity account and confirm
teams and events load. A passing sign-in page is not events acceptance.