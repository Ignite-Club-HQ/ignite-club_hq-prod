# Roadmap

## Competition scores hard-hiding (DEV only) — DONE

## DEV compatibility remediation — DONE (migrations applied 2026-10-29)

## Classify remaining blockers: DEV-real vs prod-only (current)
- [x] Answered: edge functions/RLS are per-project; verified DEV 404s, realtime gaps, VAPID misconfig
- [x] Read-only check done: 3 functions 404 on DEV, 4 tables unpublished, VAPID keys invalid
- [ ] Await user scope decision on: welcome-email/upload SQL, code-side fixes, realtime gaps, RLS/storage review
