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