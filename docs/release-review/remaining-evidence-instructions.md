# Remaining production evidence — one export

## What Paul needs to do

In the **production Supabase dashboard**, open SQL Editor and run the entire block in `remaining-evidence.sql`. Export the single result table as CSV and upload it here. Confirm the dashboard is the intended production project before execution; no Lovable connection switch is needed.

This packet is read-only and ends with ROLLBACK. It combines the previously prepared helper/policy/trigger catalog checks with effective function execution checks, scoped default privileges, four bucket privacy flags and the three exact named reminder schedules. It does not return accounts, club records, invitation tokens, stored objects, routing values, scheduler commands or credentials.

Function bodies, policy expressions and column defaults can themselves contain embedded secrets. Inspect those fields before sharing and redact any credentials. Report any redaction so a missing detail is not mistaken for an absent object.

## Scope and interpretation

- 73 source-derived requested public names plus associated trigger functions and existing auth-user trigger definitions. Function names include the legacy event/invite contracts and public official-link status/acceptance contracts.
- Bucket metadata only for `competition-vault`, `competition-documents`, `photos`, `chat-attachments`. The legacy document bucket appears in the recovered source; do not replace/move those objects.
- Scheduler metadata only for `process-scheduled-event-reminders`, `auto-rsvp-push-cron`, `chat-photo-gallery-reminders-hourly`. These are exact migration/evidence job names, not endpoint-derived guesses. No command is read into the result, hashed or executed; no scheduler functions are invoked.
- Effective EXECUTE checks are restricted to anon/authenticated/service_role and matched functions. They include inherited/default access but do not establish authorization inside function bodies or successful application flows.
- Default ACLs are scoped to relevant owners and public/global table/function defaults. They govern future objects only; they do not replace the current-object grants report or prove the migration execution owner's defaults.
- A missing row can reflect object absence or SQL Editor role visibility. Bucket privacy alone is not proof of byte-access correctness. Existing cron is known from the owner's earlier production export; if this query fails for visibility or a missing catalog, share the error rather than granting access or creating objects.
- This query does not refresh the entire production migration ledger or independently certify connection identity. Final release checks still need an exact fresh target inventory and acceptance.

## What is prepared but not authorized

`transition-dispositions-2026-10-30.json` accounts for all 37 originals, retaining original hashes and both evidence fingerprints. Its dispositions are review notes, not executable exclusions. All entries remain held; nine originals are proposed for exclusion/adaptation, never marked as executed. The runner, publication holds and applied SQL files remain unchanged.

28 offline evidence/release safeguards pass. No SQL was executed against DEV or PROD. Actual adaptation SQL and representative-database acceptance depend on the remaining definitions; hosted Netlify/Codemagic settings and physical Android/iOS delivery remain external checks. Do not merge, deploy, change permissions, rewrite jobs or repair the ledger based on this packet.