# Mixed mainnet / Cloud Engine membership

## Implemented in TEST source

- One Internet Identity principal can discover clubs across independent mainnet and engine deployment sessions. Each destination retains its own consensus registry, assignment revision, group inventory and membership authority; duplicate club claims refuse the entire discovery.
- The existing feature dispatcher has a mixed-membership branch for club and resource reads, combined member lists and single-destination writes. Authorized resource lookup must identify exactly one owner; unavailable or ambiguous discovery never falls back to another destination.
- Role reads filter each club's own authority. A mainnet club administrator can remain only a player in an engine club. App-wide roles come only from shared account services; engine mirrors cannot elevate them.
- Club chats remain on their own messaging services. Messages, reactions, pins, polls, sequence freshness and optional-method detection do not share state merely because two services use the same conversation ID.
- Writes use one attempt. A lost engine reply never redirects or replays on mainnet. Account changes, destination substitution, disposal and changed registry bindings refuse subsequent operations or late results.
- Sign-out retires the mixed session. No extra persisted membership cache, new accounts, copied roles, settings save, country pin, club relocation, engine connection or PROD operation was added.

## Connection and acceptance still required

`openLiveMixedMembership` is an explicit commissioning entry point using the existing real group-registry/membership transport. It remains refused while `CLOUD_ENGINE_RELEASED` is false; local session/dispatcher tests do not open real groups. The existing boot does not automatically install this runtime from country settings.

Before release: bind an operator-approved complete destination inventory to shared account/removal authority, configure engine groups with their own reciprocal club/messaging links, finish outstanding bounded cross-subnet calls and encryption, and commission the runtime through the signed-in boot lifecycle. Engine-specific invitation/admission handover and foreign-host competition access remain held rather than guessed. Shared DMs and app-wide services stay shared, not duplicated.

A real engine is required to verify one person's membership in both destinations through the actual UI: mainnet administrator / engine player, distinct inbox threads, send/readback, denied staff access, club removal, account switching and native phone checks. Existing local tests exercise session and feature-dispatch behavior using simulated transports, not deployed engine authorization or physical phones.

Cloud Engine group push coverage, engine encryption, complete account-erasure inventory and actual restore/rental acceptance remain separate prerequisites. Existing encrypted clubs stay on mainnet.