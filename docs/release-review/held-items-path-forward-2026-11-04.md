# Held items — verified path forward (2026-11-04)

Items that cannot ride the next main→prod merge, what was verified, and the exact route for each.
No deployment or data writes were made preparing this.

| Item | Verified | Why it can't ride along | Path forward |
|---|---|---|---|
| Email-club list (Bridgewater, Basket Range) | `app_settings` exists on PROD; held SQL uses DEV club IDs | It is a settings row (data), and it switches the sign-up guard on | After the canister-connected live site is up: look up PROD club IDs, write one PROD-only settings row (the one permitted config row), test one invited sign-up, then leave on. Do not copy DEV IDs. |
| Welcome message sender | `send_welcome_dm` skips quietly if sender account `00000000-…-0001` is absent | Creating that account on PROD is a data row | Function can ride along (harmless without sender). Decide separately whether to create the Ignite team account on PROD; until then no welcome is sent. |
| Club country "Australia" fill-in | `clubs.country` absent on PROD and DEV | Fill-in rewrites every live club | Ship the optional column only (structure); no fill-in. App keeps using connection-based country. |
| Competition events (newer version) | DEV and PROD both run the legacy `create_competition_event(p_competition_id,…,p_end_time)`; newer tables exist only in the hybrid database | Replacing a working live function with an untested one | Treat like other hybrid features: rebuild on DEV, test, then release. Until then, keep the current version — it works. Fingerprint check below confirms DEV = PROD. |
| Competition role removal | Owner guard + both chat-sync triggers present on PROD | Already present; only parity unconfirmed | Run fingerprint check below; if hashes match DEV, close it. If not, compare on DEV before any change. |
| Hidden competition scores | `get_my_viewable_competition_match_ids` absent on PROD | Copying/clearing scores is a data write | Stage 1 (structure): read restrictions + protected results table, scores untouched. Stage 2: separately approved one-off copy with archive. Not before launch. |
| AI score review | Deferred by owner | Needs provider activation | Stays deferred. |
| Free-media cleanup | `list_expired_free_media`, `purge_expired_free_media_rows` absent | Deletes records when called | Install only together with its scheduled job decision; separate approval. Not before launch. |
| Reminder / welcome-email jobs | Tables absent on PROD | Activation + secrets are post-merge work | Structures may ship; activation (schedule, secrets) is a separate approval after merge. |
| Competition document storage | Vault columns present; access functions missing | Private storage area creation needs approval | Ship access functions with the batch; create the private storage area via the storage tool only after approval. |

## Fingerprint check (read-only, run in PROD SQL Editor)

```sql
BEGIN READ ONLY;
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, md5(p.prosrc) AS h
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
 'create_competition_event','can_create_competition_event',
 'tg_competition_roles_enforce_owner','tg_competition_role_sync_chat','tg_competition_role_sync_contact_chats')
ORDER BY 1, 2;
ROLLBACK;
```

DEV fingerprints (4 Nov):

| Function | DEV md5 |
|---|---|
| can_create_competition_event | c3531f7d36a1ca2ae888e44e3cfe154b |
| create_competition_event | d26c6db29b816ac744d64abcd8a752ff |
| tg_competition_role_sync_chat | 6e1ade4ae6d293f7c45aadebf43fb5df |
| tg_competition_role_sync_contact_chats | c3a358aea113daaa4abc8fcd0e26b76e |
| tg_competition_roles_enforce_owner | 23b7258d305af34b3109090fe1834b81 |

Matching hashes close the events and role-removal items with no change.
