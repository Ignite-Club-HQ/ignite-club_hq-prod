# Original release recovery source

Recovered from immutable repository commit `96642d0750e03d933b68957d61999de3ae983b9c`.

The 1,135 original SQL files are **non-executable recovery evidence**, not new migrations. `provenance.json` contains original paths, Git blob IDs and SHA-256 fingerprints; each source file was verified against the complete immutable GitHub tree. No migration files were copied into `supabase/migrations`, no SQL was executed and no production history was changed.

Original Codemagic, Netlify, database runner and package settings are preserved alongside the archive. The package's marketing version is `1.2.63`, also confirmed at the last verified PROD source commit `ea005b7178a6de9c207b744a2ea65cffde713b5f`; active mobile builds read the recovered version from `scripts/native-release-settings.json`, not a new hosted environment variable. This recovers source behavior, not App Store acceptance evidence.

The Android release helper path now resolves correctly from `frontend/android`. Existing ICP/native callback/bar/push wiring and production isolation remain intact.

The active DB runner remains a release hold: the original runner contains history deletion, credential/Vault/cron rewrites and unreviewed signup migrations. Restoring that runner unchanged would endanger production. Its complete original source is retained here for reconciliation with independently verified PROD state before approved activation. Hosted Netlify/Codemagic configuration and real phone delivery cannot be established from repository files alone.