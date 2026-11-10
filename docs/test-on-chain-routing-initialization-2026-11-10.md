# TEST on-chain sign-in settings — prepared, not applied

## Verified source

A fresh signed-out visit to TEST `/auth` successfully read the public `backend_routing_config` row from DEV Supabase `ecsdwrarzfexssxtrymj`. The page displayed both email and secure sign-in choices. No production service was contacted for this inventory.

The source currently has no approved targets, country rules, country pins or club overrides. Do not invent targets or change the default backend while initializing the on-chain copy. TEST canister identities remain supplied by the existing generated/build configuration.

## Exact proposed value

Write only `backend_routing_config` on TEST shared club authority `mzzzv-taaaa-aaaal-qxlrq-cai` through the existing authenticated ICP admin settings save. Preserve these values:

```json
{
  "defaultBackend": "supabase",
  "countryRules": {},
  "targets": [],
  "countryTargets": {},
  "clubBackendOverrides": {},
  "emailAuthClubs": [
    {
      "id": "966bdaec-ebf1-46da-b2b3-cc53bf05c422",
      "name": "Bridgewater Soccer Club"
    },
    {
      "id": "493ee2e3-c834-487d-93be-d1c8a0dbc4a8",
      "name": "Basket Range Cricket Club"
    }
  ]
}
```

The existing save may stamp its normal `savedAtMs` timestamp. This proposed value contains public routing information only, not provider credentials. It is not an instruction to import other settings, change email signup policy, create targets or deploy code.

## Acceptance and current blocker

1. Sign into TEST with the existing Internet Identity app administrator and open Admin → Placement Settings.
2. Verify the two retained email clubs and unchanged routing fields above, then save through the existing ICP settings action once.
3. Read `backend_routing_config` back from the same TEST authority; compare all fields, not merely a success toast. If the outcome is uncertain, read before attempting another save.
4. Open a fresh signed-out TEST canister-hosted session: both sign-in choices must remain available and the routing load must succeed without the Supabase routing-row request. Verify existing email sign-in separately remains unchanged.
5. Leave the compatibility fallback in place until that acceptance is complete. Do not overwrite the populated `chat_recap_enabled=false` switch.

The sandbox has no delegated Internet Identity administrator session. The documented CLI web-identity flow requires the user's browser and CLI on the same machine and does not support this remote/headless sandbox; a Supabase session cannot replace II authorization. No anonymous/operator write, role grant, configuration copy, production access or deployment was attempted. Initialization and authenticated save/readback therefore remain blocked on the TEST administrator session.