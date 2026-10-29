# Roadmap

## Competition scores hard-hiding (DEV only) — DONE

## DEV compatibility remediation — DONE (migrations applied 2026-10-29)

## Close all DEV gaps (current)
- [x] Realtime: published active_games, chat_pinned_vault, club_subscriptions (member_payments reclassified — external website project)
- [x] Welcome-email delivery SQL applied (server-only tables + claim/finish RPCs, linter-clean)
- [x] VAPID: fresh DEV pair stored; pushNotifications.ts picks key by project id (PROD key untouched)
- [x] create-member-checkout reclassified: lives on separate website project frkzyniekamxudaumeaf, not a DEV gap
- [ ] BLOCKED (platform): deploy send-welcome-email, send-welcome-email-icp, verify-iap-receipt-icp — deploy pipeline returns "internal error" even for unchanged functions; retry when it recovers
- [ ] Needs Paul: RESEND_API_KEY + WELCOME_EMAIL_FROM secrets (welcome emails 503 without them); IAP_ATTESTATION_HMAC_SECRET + APPLE_SHARED_SECRET for verify-iap-receipt-icp
- [ ] Not authorised: hosted Auth config, wider RLS/Storage review, 780 pre-existing linter findings
