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

## Ownership review required — Club Links

- `local-supabase-workspace/supabase/migrations/20260810010000_local_club_links_rls.sql`

The promotion dependency manifest does not explicitly assign this fixture to a remaining tranche. It supports Club/Home link behavior and must receive an explicit ownership review before inclusion. Do not silently bundle it into Tranche 06 or Tranche 07.

At tranche construction time, verify the owning production code and tests (including Club Links management, Home quick links, embed behavior, and `tests/local-supabase/club-links-rls.test.ts`) and record the ownership decision in the tranche review.

## Retrieval checklist

Before completing Tranche 06 or 07:

1. Read this file and confirm the listed paths are still untracked or intentionally deferred.
2. Restore/stage only the paths owned by that tranche.
3. Run the isolated local Supabase reset and cumulative backend suite.
4. Confirm the paths remain under `local-supabase-workspace` and are absent from production migrations/functions.
5. Record the Club Links ownership decision before the final promotion closeout.
