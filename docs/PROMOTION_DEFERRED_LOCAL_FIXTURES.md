# Deferred local fixtures for promotion tranches

Last reviewed: 2026-08-18

These files were intentionally excluded from Tranche 05 (`promotion/05-messaging-notifications`, commit `7dd621233`). They are synthetic infrastructure for the isolated local Supabase test workspace.

## Safety constraint

All paths below are local-test-only. They must not be copied into the production migration tree, deployed as hosted Edge Functions, or applied to development or production Supabase projects.

## Tranche 06 — Vault and Media

- `local-supabase-workspace/supabase/migrations/20260727040000_local_vault_prerequisites.sql`
- `local-supabase-workspace/supabase/migrations/20260727042355_local_vault_mutation_safety.sql`
- `local-supabase-workspace/supabase/migrations/20260727055726_local_media_photo_deletion.sql`
- `local-supabase-workspace/supabase/migrations/20260809091000_local_scoped_photo_uploads.sql`

Include these only when constructing and verifying the cumulative Vault/Media tranche. Keep them under `local-supabase-workspace`.

## Tranche 07 — PitchBoard, timer and AutoSub

- `local-supabase-workspace/supabase/functions/pitch-timer-event/`
- `local-supabase-workspace/supabase/migrations/20260801040000_local_pitch_timer_concurrency.sql`

Include these only when constructing and verifying the cumulative PitchBoard/timer/AutoSub tranche. The function is a local test fixture, not a deployable hosted function.

## Tranche 08 — Club Links local RLS verification

- `local-supabase-workspace/supabase/migrations/20260810010000_local_club_links_rls.sql`

The promotion dependency manifest did not explicitly assign this fixture to a domain tranche. Its ownership was reviewed during Tranche 08 after the application tranches were complete. The production Club Links management, Home quick-link, and embed behavior already existed on the cumulative base; the remaining delta is local release-governance coverage only.

Tranche 08 therefore owns this synthetic migration together with `tests/local-supabase/club-links-rls.test.ts`. Both must stay local-only. This decision does not authorize a production migration or a hosted schema change.

## Retrieval checklist

Before completing Tranche 06 or 07:

1. Read this file and confirm the listed paths are still untracked or intentionally deferred.
2. Restore/stage only the paths owned by that tranche.
3. Run the isolated local Supabase reset and cumulative backend suite.
4. Confirm the paths remain under `local-supabase-workspace` and are absent from production migrations/functions.
5. Confirm the Tranche 08 Club Links fixture and test remain local-only during final promotion closeout.
