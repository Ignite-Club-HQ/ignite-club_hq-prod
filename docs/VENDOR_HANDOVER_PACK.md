# Vendor Handover Pack — Ignite Club HQ

> Companion to `docs/VENDOR_HANDOVER.md` (full technical reference).
> This pack is the short, action-oriented brief a new vendor needs on Day 0.
>
> **Status:** Supporting onboarding checklist, reviewed 2026-08-13. `docs/ARCHITECTURE.md` and `docs/PROMOTION.md` are authoritative. External service state must be verified in its console.

---

## 1. Executive Summary

Ignite Club HQ is a multi-tenant SaaS platform for sports clubs. It provides team and competition management, RSVPs, chat, notifications, Pro upgrades, rostering, vault/file storage, game-day tools, and external integrations.

- **Stack:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui; Supabase (Postgres, Auth, Storage, Edge Functions); Capacitor 8 for iOS/Android.
- **Hosting:** Netlify (web PWA), Codemagic (iOS/Android native builds), Supabase Cloud (backend).
- **Environments:** `dev` (Lovable preview + dev Supabase) and `prod` (Netlify + prod Supabase). Promotion is git-driven (`main` → `prod`) via GitHub Actions.
- **Repository scale at review:** 1,023 migration files, 118 deployable Edge Function entry points, 109 non-test page modules, and 521 non-test component modules. Hosted runtime counts require external verification.
- **Users:** Club admins, committee members, coaches, players, parents, and a global `app_admin` role.
- **Business model:** Freemium with Pro subscription (Stripe web + native IAP).

**Repository health at review:** automated coverage and release automation exist. This does not prove production health, universal RLS, backup restorability, or external configuration. Main risks are surface area and concentrated ownership.

---

## 2. Technical Architecture Diagram

```
                       ┌────────────────────────────────────────────┐
                       │                 END USERS                  │
                       │  Web PWA  |  iOS app  |  Android app       │
                       └───────────────┬────────────────────────────┘
                                       │ HTTPS / WSS
             ┌─────────────────────────┼──────────────────────────────┐
             │                         │                              │
     ┌───────▼────────┐        ┌───────▼────────┐             ┌───────▼────────┐
     │  Netlify CDN   │        │  Capacitor App │             │ Firebase FCM   │
     │  (React SPA)   │        │ (iOS/Android)  │◀────push────│ (notifications)│
     └───────┬────────┘        └───────┬────────┘             └────────────────┘
             │                         │
             └───────────┬─────────────┘
                         │ supabase-js
             ┌───────────▼──────────────────────────────────────┐
             │              SUPABASE (per env: dev/prod)         │
             │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
             │  │ Postgres │ │ Auth/JWT │ │ Storage buckets  │  │
             │  │  + RLS   │ │  (email, │ │ (media, vault,   │  │
             │  │ ~170 tbl │ │   OAuth) │ │  chat, avatars)  │  │
             │  └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
             │       │            │                │            │
             │  ┌────▼────────────▼────────────────▼─────────┐  │
             │  │        Edge Functions (Deno, 118)          │  │
             │  │  playhq-sync • send-email • push-fanout •  │  │
             │  │  stripe-webhook • iap-verify • ai-recap …  │  │
             │  └────┬───────────┬───────────┬───────────┬───┘  │
             └───────┼───────────┼───────────┼───────────┼──────┘
                     │           │           │           │
              ┌──────▼──┐   ┌────▼────┐  ┌───▼────┐  ┌───▼──────┐
              │ Resend  │   │ PlayHQ  │  │ Stripe │  │ Google   │
              │ (email) │   │  API    │  │ + IAP  │  │ Places/  │
              │         │   │         │  │        │  │ Drive    │
              └─────────┘   └─────────┘  └────────┘  └──────────┘

                     ┌─────────────────────────────────────┐
   CI/CD & OPS:      │  GitHub  →  Actions  →  Supabase    │
                     │           (promote-to-prod.yml)     │
                     │           (nightly-backup.yml)      │
                     │  GitHub  →  Netlify (web deploy)    │
                     │  GitHub  →  Codemagic (iOS/Android) │
                     └─────────────────────────────────────┘
```

---

## 3. Vendor Access Checklist

Grant in this order. Do NOT share credentials; add the vendor as a member on each service.

**Source control & CI**
- [ ] GitHub organisation — repo `write` access (or `admin` if managing branch rules)
- [ ] GitHub Actions secrets — reviewer only, do not export
- [ ] Codemagic — Developer role on the `ignite-club_hq-prod` app
- [ ] Netlify — Collaborator on the site (Owner if managing DNS)

**Backend**
- [ ] Supabase DEV project — Developer role
- [ ] Supabase PROD project — Developer role (Owner reserved for client)
- [ ] Lovable workspace — Editor role (for AI-assisted iteration on dev)

**Third-party services**
- [ ] Resend — Member on the sending domain
- [ ] Stripe — Developer role (test + live)
- [ ] Apple Developer — App Manager on the team
- [ ] Google Play Console — Admin (release-manager scope minimum)
- [ ] Firebase — Editor on the FCM project
- [ ] PlayHQ — API credentials confirmed and rotated
- [ ] Google Cloud (Places API, Drive backups) — Editor on the project
- [ ] Giphy / AdMob — API keys shared via a password manager, not chat

**Domains & DNS**
- [ ] Registrar access for `igniteclubhq.app` (Universal Links depend on it)
- [ ] DNS provider — read minimum, write if managing records

**Docs & communication**
- [ ] Password manager vault
- [ ] Shared Slack/Teams channel with the client
- [ ] Access to this repo's `/docs` folder

---

## 4. Production Support Runbook

### 4.1 Severity levels
| Level | Definition | Response |
|---|---|---|
| **SEV-1** | App down, auth broken, data loss risk | Acknowledge <15 min, fix in progress <1 h |
| **SEV-2** | Major feature broken for many users (chat, RSVP, push) | Ack <1 h, fix same business day |
| **SEV-3** | Minor bug, single-club impact | Ack next business day |
| **SEV-4** | Cosmetic / enhancement | Backlog |

### 4.2 First-response checklist
1. Check Supabase dashboard → **Project health** (CPU, connections, error rate).
2. Check **Supabase → Logs → Edge Functions** for 5xx spikes.
3. Check **Netlify → Deploys** for failed builds.
4. Check **GitHub Actions** for failed promotion or backup runs.
5. Check the browser console and configured monitoring. **[External verification required: do not assume Sentry is active.]**
6. Reproduce in DEV before touching PROD.

### 4.3 Common incidents

**Users cannot sign in**
- Verify Supabase Auth is up. Check `auth.users` growth. Check redirect URLs and Site URL in Auth settings.
- Recent migration touching `profiles`, `user_roles`, or triggers? Roll back via nightly backup.

**Push notifications not delivered**
- Confirm FCM credentials valid in **PROD** Supabase secrets (`FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT`). These must NOT be present in DEV — see R9a.
- Check `push-fanout` edge function logs.
- Verify device tokens in `device_tokens` table are fresh (<30 days).
- One Firebase project serves both envs; the DEV/PROD split lives in Supabase secrets, not in Firebase.

**Emails not sending**
- Check Resend dashboard: bounces, domain verification.
- Check `send-email` edge function logs.
- Confirm `RESEND_API_KEY` in Supabase secrets.

**Native build failing in Codemagic**
- Confirm `supabase_prod` env group is attached to the workflow.
- Check signing certificates haven't expired.
- Verify `LOVABLE_ENV` variable is set correctly (`dev` vs `prod`).

**Migration blew up prod**
1. Do NOT re-run.
2. Prefer a reviewed forward repair. Restore only through the authorized database recovery procedure with a confirmed recovery point.
3. Post-mortem in `/docs`.

### 4.4 Rollback procedures
- **Web:** Netlify → Deploys → click the previous good deploy → *Publish deploy*.
- **Backend schema/data:** follow `docs/PROMOTION.md`; storage restore is not database restore. Do not run ad-hoc `psql` restoration during triage.
- **Native app:** Google Play → halt rollout. App Store → *Reject this build* (if unreleased) or expedited review with fix.

### 4.5 Escalation
- Client product owner → (fill in)
- Original technical owner → (fill in)
- Supabase support (Pro tier) → dashboard "Support"
- Lovable support → in-app chat

---

## 5. Risk Register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|------|------------|--------|------------|-------|
| R1 | Single-owner knowledge (bus factor = 1) | High | High | This handover + shadow period + documented runbooks | Client |
| R2 | Large surface area (118 Edge entry points, 1,023 migrations at review) drifts from docs | High | Medium | Use the PR template and update authoritative docs | Vendor |
| R3 | RLS policy regression exposes cross-club data | Medium | Critical | Automated `supabase--linter` check in CI; quarterly review | Vendor |
| R4 | Destructive migration reaches prod | Low | Critical | Existing guard in `promote-to-prod.yml`; nightly backup before risky merges | Vendor |
| R5 | Push token drift → silent notification failure | Medium | Medium | Monitoring of `push-fanout` success rate; token refresh on login | Vendor |
| R6 | PlayHQ API changes break sync | Medium | High | Contract tests around `playhq-sync`; alerting on 4xx spikes | Vendor |
| R7 | Apple/Google signing certs expire | Low | High | Calendar reminders 60 days out; store in vault | Client |
| R8 | Supabase project hits Free-tier / Pro-tier limits under growth | Medium | High | Monitor DB size, egress, MAU; upgrade before 80% | Vendor |
| R9 | Backup/PITR/restore objectives not proven from Git | Medium | High | Verify dashboard configuration and run a controlled restore exercise | Client + Vendor |
| R9a | Shared Firebase (FCM) project across dev & prod | Accepted | Low | **Target state (option 2):** FCM secrets (`FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT`) present in PROD Supabase only; removed from DEV Supabase so dev `push-fanout` cannot send. Single Firebase project retained (one Android package ID, one console). See §8. | Client |
| R10 | Chat scale (virtualization, presence) under growth | Medium | High | Re-run capacity tests and monitor current Realtime/query behaviour before thresholds are reached | Vendor |
| R11 | Third-party credential leak via chat/screenshots | Medium | Critical | Password manager only; rotate on any suspicion | Vendor |
| R12 | Native app store rejection on next release | Low | Medium | Test flight/internal track before production track | Vendor |

---

## 6. 30-Day Onboarding Plan

**Week 1 — Read & observe (no production operation)**
- Day 1: Access provisioning (§3). Read `README.md`, `docs/ARCHITECTURE.md`, `docs/PROMOTION.md`, `VENDOR_HANDOVER.md`, and this pack.
- Day 2: Clone repo, run locally (see `VENDOR_HANDOVER.md` §14). Log in as test user.
- Day 3: Walk every top-level route. Note anything unclear in a *Questions* doc.
- Day 4: Read `supabase/migrations` last 30 days. Understand RLS via `has_role` pattern.
- Day 5: Shadow a production deploy with current owner. Watch a promote-to-prod run end-to-end.

**Week 2 — Small, safe changes**
- Ship 2–3 cosmetic/copy fixes to dev, promote to prod under supervision.
- Trigger a manual nightly backup. Verify artifact.
- Review edge function logs for a full day; identify noisy errors.
- Complete the vendor questions doc (§7) with the client.

**Week 3 — Own a feature area**
- Take ownership of one domain (suggested: notifications OR chat OR PlayHQ sync).
- Add or improve one automated check (linter rule, RLS test, edge fn test).
- Run a tabletop incident exercise (simulate SEV-2, walk the runbook).

**Week 4 — Full operational ownership**
- Vendor leads a production release without shadow.
- Vendor handles on-call rotation for the week.
- Retrospective with client: what's missing, what's risky, agreed backlog for month 2.
- Sign-off on handover.

---

## 7. Questions the Vendor Must Answer Before Taking Responsibility

If any answer is *"not yet"*, do not accept operational ownership.

**Architecture & code**
1. Can you describe the request path for a chat message from tap to delivery, including RLS and realtime?
2. Can you identify which edge functions run on schedule vs on-demand?
3. Where are user roles stored and why NOT on `profiles`?
4. How does the app switch between DEV and PROD Supabase at runtime and at build?

**Deployment**
5. Walk me through promoting a change from Lovable → dev → prod, including web + native.
6. What triggers `promote-to-prod.yml`, and which steps are skipped on PR vs push?
7. How do you roll back a bad web deploy? A bad migration? A bad native release?

**Data & security**
8. Where are backups stored, what is the retention, and what is our RPO/RTO?
9. How do you audit which app admins accessed which club's data?
10. What is the process to add a new RLS policy safely?

**Third-party**
11. Which vendor owns rotation of: Resend, Stripe, FCM, PlayHQ, Apple, Google Play keys?
12. What happens if PlayHQ changes their API without notice?

**Operational**
13. Who is paged for SEV-1 outside business hours?
14. How do you verify the nightly backup actually ran and is restorable?
15. What is the plan when the app crosses 500 DAU? 1,000 DAU?

**Business & compliance**
16. Where is the data residency requirement documented (AU users)?
17. What PII do we hold and where is the deletion/export process for GDPR/APP requests?
18. Who signs off on a production release?

---

*Companion documents:* `docs/VENDOR_HANDOVER.md` (full technical reference), `docs/PROMOTION.md` (release process), `docs/PROMOTION_CHECKLIST.md` (env var checklist), `docs/REFACTORING_AUTOMATED_CLOSEOUT_2026-08-15.md` (current cumulative checkpoint), and `docs/testing/REFACTORING_MANUAL_ACCEPTANCE.md` (delegated acceptance evidence).

---

## Appendix A — Outstanding manual actions

- [ ] **Apply Firebase option 2 (R9a).** In DEV Supabase → Edge Function Secrets, delete: `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT`. Confirm the same four are present in PROD Supabase. Result: dev `push-fanout` cannot deliver to devices; prod unchanged. Optional follow-up: patch `push-fanout` to early-return when FCM env vars are absent so dev logs stay clean.
