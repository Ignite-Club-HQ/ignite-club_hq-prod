# Ignite Club HQ — Vendor Technical Handover

**Audience:** External software vendor / development agency / technical support partner.
**Purpose:** Enough detail to take over development, support, deployment, and scaling of the platform without prior exposure to it.
**Status:** Supporting technical reference, reviewed 2026-08-18. The current
cumulative refactoring evidence is recorded in
[`RELEASE_CANDIDATE_2026-08-17.md`](RELEASE_CANDIDATE_2026-08-17.md), with its
review and rollback sequence in
[`PROMOTION_TRANCHES_2026-08-17.md`](PROMOTION_TRANCHES_2026-08-17.md). It is
not promotion-ready until the delegated manual checklist is recorded.
**Authority:** Start with [`README.md`](../README.md), [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), and [`docs/PROMOTION.md`](PROMOTION.md). Those documents override this reference for architecture boundaries, testing, promotion, and rollback. Counts and external dashboard state below are point-in-time observations. Items not verifiable from Git require external confirmation.

> ⚠️ **No secrets or real data in this document.** Never copy hosted credentials or data into local tests. Key names below are inventory labels only.

## Vendor first day

1. Read the canonical architecture, promotion runbook, and [documentation index](README.md).
2. Confirm the branch/commit and whether it is cumulative or promotion-ready.
3. Install with Node 22 using `npm ci`; run TypeScript, build, and focused tests.
4. Read the [local Supabase safety guide](testing/local-supabase.md); never test against a hosted database.
5. Obtain least-privilege service access through invitations, not shared secrets.
6. Verify hosting, backup, monitoring, stores, and Supabase settings in their consoles.
7. Shadow a release and rollback exercise before operating production.
8. For the current refactoring candidate, complete the [manual acceptance
   checklist](testing/REFACTORING_MANUAL_ACCEPTANCE.md) against the exact
   recorded commit before constructing a promotion branch.

---

## 1. Executive Technical Summary

### 1.1 What the app does
Ignite Club HQ ("Ignite") is a multi-tenant club/team management platform used by grassroots sporting clubs. It combines:
- Club and team administration (rosters, roles, invites, seasons)
- Event scheduling (fixtures, training, one-off events, recurring events)
- RSVP + duty rostering
- Real-time chat (team chats, club chats, broadcast, group chats, DMs, committee chats)
- Media gallery with reactions, comments, and moderation
- Competition management (mini-leagues, ladders, fixtures, PlayHQ sync)
- Push notifications (web + native iOS/Android via FCM)
- In-app purchases + Stripe subscriptions (Pro tiers, per-club billing, member payments)
- Live in-game pitch board / auto-sub engine (basketball + soccer/football)
- EOI (Expression of Interest) forms + class enrolments
- Sponsor management + club rewards / points gamification

### 1.2 User types and roles
Roles are enumerated in the `app_role` enum and stored in `public.user_roles` (never on `profiles`). Primary roles (verify enum values in `supabase/migrations/*` for the exact set):
- **app_admin** — platform-wide superuser (Ignite team)
- **club_admin** — full control of a single club
- **committee_member** — subset of club admin (finance, media, comms)
- **team_admin / coach** — team-level admin
- **player**
- **parent / guardian** — via `child_guardians`
- **media_admin** — moderation of `photos` + `photo_comments`
- **competition_admin** — competition + mini-league admin
- **association_admin** — parent-of-many-clubs (Associations feature)

Access is enforced in three layers: RLS policies, `public.has_role(uuid, app_role)` SECURITY DEFINER function, and per-club/team membership tables (`club_players`, `team_memberships`, `mini_league_admins`, etc.).

### 1.3 Major functional modules
| Module | Owning tables (indicative) | Primary pages |
|---|---|---|
| Auth & Profile | `profiles`, `user_roles`, `user_passkeys` | `AuthPage`, `CompleteProfilePage`, `ResetPasswordPage`, `EditProfilePage` |
| Clubs & Teams | `clubs`, `teams`, `club_players`, `team_memberships` | `ClubsPage`, `TeamDetailPage`, `EditClubPage` |
| Children/Guardians | `children`, `child_guardians`, `child_team_assignments` | `ChildrenPage` |
| Events & RSVPs | `events`, `rsvps`, `event_groups`, `duties` | `EventsPage`, `EventDetailPage`, `CreateEventPage` |
| Chat / Messaging | `chat_groups`, `group_messages`, `direct_conversations`, `direct_messages`, `broadcast_messages`, `club_messages`, `team_messages`, `club_admin_messages` | `MessagesPage`, `TeamChatPage`, `ClubChatPage`, `GroupChatPage`, `DirectMessagePage`, `BroadcastChatPage`, `ClubAdminChatPage` |
| Media | `photos`, `photo_albums`, `photo_reactions`, `photo_comments` | `MediaPage` |
| Competitions | `competitions`, `competition_divisions`, `competition_matches`, `competition_entries`, `playhq_*` | `CompetitionsPage`, `CompetitionDetailPage` |
| Mini-leagues | `mini_leagues`, `mini_league_sessions`, `mini_league_groups` | `MiniLeaguesPage` |
| Pitch Board / Live Game | `active_games`, `pitch_formations`, `match_captains`, `match_goalkeepers`, `game_player_stats` | `EventGroupPitchPage`, `WatchLiveTeamPage` |
| Subscriptions | `club_subscriptions`, `team_subscriptions`, `member_subscription_payments`, `iap_transactions`, `app_stripe_config`, `club_stripe_configs` | `UpgradeProPage`, `ClubUpgradePage`, `SignupProPage`, `PayFeesPage` |
| Sponsors & Rewards | `sponsors`, `sponsorship_packages`, `club_rewards`, `points_history`, `reward_redemptions` | `ClubRewardsPage`, `SponsorAnalyticsPage` |
| EOI + Enrolments | `eoi_submissions`, `class_enrolments`, `class_attendance` | `EmbeddedEoiFormPage`, `EoiAdminPage`, `ClassEnrolmentPage` |
| Ads (AdMob + custom) | `app_ads`, `app_ad_analytics`, `admob_config` | `ManageAdsPage` |
| Notifications | `notifications`, `push_subscriptions`, `fcm_tokens`, `notification_preferences`, `push_notification_logs` | `NotificationsPage`, `NotificationPreferencesPage`, `PushAnalyticsPage` |

### 1.4 Core technologies
- **Frontend:** React 18, Vite 7, TypeScript, TailwindCSS, shadcn-ui (Radix primitives), react-router-dom, TanStack Query, Zod, react-hook-form.
- **Mobile:** Capacitor 8 (iOS + Android), Firebase Messaging (FCM), Firebase Crashlytics, Capacitor push, AdMob, in-app purchases (`@capgo/native-purchases`), biometrics, camera, filesystem.
- **Backend:** Supabase — Postgres, Auth, Storage, Edge Functions (Deno), Realtime.
- **Email:** Resend via `npm:resend@2.0.0` (see `supabase/functions/deno.json`).
- **Payments:** Stripe (subscriptions + checkout) + Apple/Google IAP.
- **Web hosting:** Netlify (SPA + one edge function `/share`). **[Needs confirmation — repo also references Lovable hosting; production web is currently served from Netlify per `netlify.toml`.]**
- **Mobile CI/CD:** Codemagic (`codemagic.yaml`, mac_mini_m2 runners).
- **DB CI/CD:** GitHub Actions (`promote-to-prod.yml`, `nightly-backup.yml`, `backup-storage.yml`, `restore-storage.yml`).
- **External APIs:** PlayHQ (fixtures/ladders), Google Places (autocomplete), Google Drive (import), Giphy (chat), Firebase, AdMob.

### 1.5 How it hangs together (plain English)
A user opens the mobile app (Capacitor wrapping the built React SPA in `dist/`) or the web app (Netlify). The React app authenticates against Supabase Auth using the `VITE_SUPABASE_PUBLISHABLE_KEY` (anon key). Row Level Security governs what they can read/write. Chat, RSVPs, notifications, pitch board etc. use Supabase Realtime channels. Heavy or privileged operations (payments, push send, PlayHQ sync, backups, email) run in Supabase Edge Functions (Deno). Emails go out via Resend. Push notifications go via Firebase Cloud Messaging (FCM); web push uses VAPID. Nightly database and storage backups run in GitHub Actions and upload artifacts. iOS/Android release builds run in Codemagic and are uploaded to App Store Connect and Google Play Console.

---

## 2. System Architecture Overview

```
                                    ┌──────────────────────────┐
   ┌──────────────┐                 │   GitHub (source of      │
   │  Developer   │─── git push ───▶│   truth, PRs, Actions)   │
   └──────────────┘                 └────────┬─────────────────┘
                                             │
                     ┌───────────────────────┼──────────────────────────┐
                     │                       │                          │
                     ▼                       ▼                          ▼
              ┌──────────────┐        ┌────────────────┐        ┌────────────────┐
              │   Netlify    │        │   Codemagic    │        │ GitHub Actions │
              │  (web SPA +  │        │ (iOS + Android │        │ (DB migrate,   │
              │  /share edge)│        │  release build)│        │  backups)      │
              └──────┬───────┘        └───────┬────────┘        └───────┬────────┘
                     │                        │                         │
                     │                        ▼                         │
                     │             App Store / Play Store               │
                     │                        │                         │
                     ▼                        ▼                         ▼
              ┌───────────────────────────────────────────────┐   ┌─────────────┐
              │             End users (Web / iOS / Android)   │   │   Supabase  │
              └───────────────────────┬───────────────────────┘   │  (PROD DB)  │
                                      │                           └──────┬──────┘
                                      ▼                                  │
              ┌─────────────────────────────────────────────────────────┐│
              │                Supabase (per-env project)               ││
              │  Auth │ Postgres │ Storage │ Edge Functions │ Realtime  ││
              └───┬────────────┬────────────────┬──────────────┬────────┘│
                  │            │                │              │         │
                  ▼            ▼                ▼              ▼         ▼
             Resend (email)   FCM/APNs      Stripe        PlayHQ     Nightly
                              (push)                      Google      backup
                                                          Places      artifacts
                                                          Google
                                                          Drive
                                                          Giphy
                                                          AdMob
```

### 2.1 Frontend
- Vite + React 18 SPA. Entry: `src/main.tsx` → `src/App.tsx` (top-level `<BrowserRouter>` with ~114 `<Route>` entries, most `React.lazy`-loaded).
- Providers: `AuthProvider`, `QueryClientProvider` (TanStack Query), `ThemeProvider` (next-themes), `ClubThemeProvider`, `AccessibilityPrefsProvider`, `TooltipProvider`, `AppLayout` shell.
- Shadcn/Radix component library in `src/components/ui/` (56 primitives).

### 2.2 Backend
- Privileged HTTP/integration logic primarily lives in **Supabase Edge Functions**; database functions, triggers, policies, and scheduled SQL are also backend logic. At review there are 118 deployable function entry points.
- Long-running / scheduled work runs via `pg_cron` scheduled RPCs that hit these edge functions (see the many `*-cron` functions: `auto-rsvp-push-cron`, `playhq-sync-cron`, `auto-default-rsvp-confirm-cron`, `auto-purge-trash`, `chat-photo-gallery-reminders`, `check-pending-subs`, `check-push-failure-rate`, `cleanup-*`, `scheduled-backup`, `process-scheduled-messages`, `expire-subscriptions`, `retry-missed-push-notifications`, `process-weekly-engagement-*`).

### 2.3 Database
- Postgres via Supabase. At review there are 1,029 SQL migration files. Hosted table counts require verification against the target environment.
- All new tables must follow the four-step order: `CREATE TABLE` → `GRANT` → `ENABLE RLS` → `CREATE POLICY`. Historic tables all use this pattern.
- Roles enum: `public.app_role`. Role check: `public.has_role(uuid, app_role)` SECURITY DEFINER.

### 2.4 Authentication
- Supabase Auth (email/password, magic link, Google OAuth, passkeys via `passkey-register` / `passkey-authenticate` edge functions).
- Auth email templates handled by `auth-email-hook` edge function.
- Native auth uses `@capacitor/browser` for OAuth redirect and Universal / App Links (see §6.4).
- Passwords resettable via `ResetPasswordPage` + `VerifyResetCodePage` + `admin-set-temp-password`.

### 2.5 File / media storage
Supabase Storage buckets in use (grep of code):
| Bucket | Purpose |
|---|---|
| `photos` | User-uploaded gallery photos, chat images |
| `avatars` | Profile / child avatars |
| `club-logos` | Club logo assets |
| `chat-attachments` | Files sent inside chats |
| `app-ads` | Custom in-app ad creatives |
| `backups` | Vault + storage backups |
| `message_digests` | Weekly digest artefacts **[Needs confirmation this is a bucket vs table]** |
| `web_vitals` | Client perf metrics artefacts **[Needs confirmation]** |

Signed URLs are issued by `get-signed-photo-url` edge function; permanent delete uses `permanent-delete-photos` / `permanent-delete-entity`.

### 2.6 Email / notifications
- **Transactional email:** Resend. All `send-*-email` edge functions call `Resend.emails.send(...)`. `RESEND_API_KEY` is a Supabase Edge Function secret.
- **Push (native):** Firebase Cloud Messaging via `@capacitor/push-notifications` and `@capacitor-firebase/messaging`. Server dispatch through `send-fcm-notification` / `send-push-notification`. Tokens in `fcm_tokens`.
- **Push (web):** VAPID web push. Subscriptions in `push_subscriptions`. Diagnostic function `check-vapid-key`.
- **In-app notifications:** `notifications` table + the page-owned Realtime lifecycle in
  `src/features/notifications/useNotificationRealtime.ts`, composed by `NotificationsPage`.

### 2.7 Hosting & deployment
- **Web:** Netlify. `netlify.toml` sets SPA fallback (`/* → /index.html 200`) and an edge function `share` at `/share` (`netlify/edge-functions/share.ts`). **[Needs confirmation]** which Netlify site/team owns the domain.
- **Mobile:** Codemagic builds signed `.aab` (Android) and `.ipa` (iOS). Uploads to Play Console and App Store Connect.

### 2.8 Backup & recovery
- **Database:** GitHub Action `nightly-backup.yml` at 02:00 UTC runs `supabase db dump` (schema + roles + data) → tarball artifact (30-day retention). On-demand via `workflow_dispatch`.
- **Storage:** `backup-storage.yml` + `restore-storage.yml` (Node 22, uses `scripts/backup-storage.js` + `scripts/restore-storage.js`).
- **Repo:** `backup-repo.yml` / `restore-repo.yml`.
- **Vault:** `vault-backup`, `vault-backup-list`, `vault-backup-restore` edge functions (per-club vault content).
- **Pre-promotion:** `promote-to-prod.yml` takes a fast schema+roles dump before applying migrations.

### 2.9 Third-party services
Stripe, Apple IAP, Google IAP, Firebase (FCM + Crashlytics), AdMob, PlayHQ, Google Places, Google Drive (`google-drive-import`, `drive-folder-sync`, `resolve-drive-titles`), Giphy, Resend.

---

## 3. Codebase Structure

Top-level layout:
```
/                       Root: package.json, config, docs, this file
├── src/                React app source
│   ├── App.tsx         Router + providers
│   ├── main.tsx        Bootstrap, OAuth callback capture
│   ├── index.css       Global theme tokens (HSL semantic)
│   ├── pages/          108 route components (see §4)
│   ├── components/     204 shared components + 56 shadcn UI primitives
│   │   ├── ui/         shadcn primitives — DO NOT edit unless updating shadcn
│   │   ├── layout/     AppLayout, AppHeader, BottomNav
│   │   ├── chat/       Chat feature set (message list, composer, virtualization)
│   │   ├── pitch/      Live pitch board / auto-sub feature
│   │   └── ...
│   ├── hooks/          125 custom hooks (useAuth, useClubTheme, chat perf, etc.)
│   ├── lib/            154 utilities (formatting, caches, deep links, engagement)
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts   Supabase JS client (reads VITE_SUPABASE_*)
│   │       └── types.ts    AUTO-GENERATED — never edit
│   ├── assets/         Images / static
│   └── test/           Vitest setup
├── supabase/
│   ├── config.toml         verify_jwt overrides per function
│   ├── functions/          118 deployable entry points + _shared/
│   └── migrations/         1,029 SQL migrations at review (append-only)
├── android/                Generated Capacitor Android project (in Codemagic)
├── ios/                    Capacitor iOS project (committed)
├── firebase/               GoogleService-Info.plist + google-services.json
├── netlify/
│   └── edge-functions/     share.ts (link-preview / OG page)
├── scripts/                Node/bash helpers (bump-ios-version, backup, restore)
├── .github/workflows/      GitHub Actions (see §8, §10)
├── codemagic.yaml          4 workflows: android-debug, ios-debug, ios-workflow, android-workflow
├── capacitor.config.ts     Native config (see §8)
├── netlify.toml            SPA fallback + edge function
├── docs/                   PROMOTION_CHECKLIST, edge-secrets, qa, this file
├── e2e/                    Playwright specs
└── PROMOTION.md            Dev→Prod release process
```

### 3.1 Folders that need special care
| Folder / file | Why |
|---|---|
| `src/integrations/supabase/types.ts` | Auto-generated from DB schema. **Never hand-edit.** |
| `supabase/migrations/` | Append-only. Never edit or rename historic migration files. Managed by the Lovable migration tool. |
| `ios/` | Committed native project. `Info.plist` version is bumped by `scripts/bump-ios-version.cjs`. Manual Xcode changes must be duplicated in Codemagic scripts. |
| `android-assets/` | Source-of-truth mipmap/splash sources copied by `codemagic.yaml`. |
| `firebase/GoogleService-Info.plist` + `google-services.json` | Production Firebase project. Both DEV and PROD builds share the same Firebase project (see `capacitor.config.ts` note about single package name). |
| `capacitor.config.ts` | `appId` is fixed to prod bundle for both DEV and PROD builds — release tracks separate them. Do not change `appId` without reissuing signing certs. |
| `src/index.css` + `tailwind.config.ts` | All theme tokens live here (HSL semantic). Never hardcode colours in components. |
| `.env` | Committed for Vite (contains only public anon key + URL). Prod credentials are injected in Codemagic via the `supabase_prod` env group. |

---

## 4. Frontend Documentation

### 4.1 Framework & libraries
- React 18, TypeScript, Vite 7.
- Router: `react-router-dom` (BrowserRouter, ~114 routes, most lazy).
- Data: `@tanstack/react-query` (all server state — never `useState` for server data).
- Forms: `react-hook-form` + `zod` + `@hookform/resolvers`.
- UI: shadcn-ui (Radix under the hood) — see `src/components/ui/`. Custom design system in `src/index.css` (HSL tokens) and `tailwind.config.ts`.
- Drag & drop: `@dnd-kit/*`.
- Icons: `lucide-react`.
- Theming: `next-themes` (dark/light) + `useClubTheme` (per-club custom colours).
- Native bridges: `@capacitor/*`.

### 4.2 Routing
Defined in `src/App.tsx`. High-level:
- Public: `/`, `/auth`, `/reset-password`, `/verify-reset-code`, `/terms`, `/privacy`, `/join/:code`, `/short/:code`, `/eoi/:slug`, `/embed/eoi/:slug`.
- Authenticated (via `AppLayout` wrapper): all `/*` routes below.
- Admin (via role check in the page + RLS): `/admin`, `/admin/*`, `/manage/*`.

### 4.3 Data fetching
- All Supabase queries via `import { supabase } from "@/integrations/supabase/client";`.
- Wrapped in TanStack Query with per-feature cache keys.
- Chat pages use `refetchOnMount: "always"` (see core memory — `"always"` not `true`, otherwise the 5-min staleTime hides new reactions on remount).
- Realtime subscriptions **must** be created inside `useEffect` and cleaned up with `supabase.removeChannel(channel)` — see core memory. Bare component-scope subscribe leaks bills.
- Native resume/reconnect refetch: `src/lib/reactQueryNativeAdapter.ts` **[Needs confirmation of exact filename — mentioned in memory]**.

### 4.4 Loading / errors / forms
- Global `Suspense` fallback in `App.tsx` (Loader2 spinner).
- `RouteErrorBoundary` around routes.
- Form validation: Zod schemas + react-hook-form.
- Toasts: shadcn `useToast` + Sonner.

### 4.5 Mobile responsiveness
- Tailwind breakpoints. Bottom nav (`src/components/layout/BottomNav.tsx`) for mobile.
- `use-mobile.tsx` hook for programmatic branching.
- Chat viewport uses 100dvh (see core memory: enforce 100dvh, avoid `scrollIntoView` on Android).
- StatusBar handled centrally by `src/lib/statusBarControl.ts` — never call `StatusBar.setStyle` directly (core memory).
- iOS/Android WebView specifics: no `backdrop-blur` on scrollers (core memory), keyboard resize `none`.

### 4.6 UI state
- Local: `useState` / `useReducer`.
- Server state: TanStack Query.
- Cross-component ephemeral: React Context (`useAuth`, `useClubTheme`, `useAccessibilityPrefs`).
- Persistent per-user: `localStorage` **must** use `ignite_` prefix and be swept by `clearUserScopedCaches()` on sign-out (core memory).

### 4.7 Key UX flows
| Flow | Files |
|---|---|
| Sign up / login | `AuthPage.tsx`, `useAuth.tsx`, edge fn `auth-email-hook` |
| Complete profile | `CompleteProfilePage.tsx` |
| Join club via invite | `JoinClubPage.tsx`, `ShortInviteRedirect.tsx`, table `club_invites` / `pending_invites` |
| Join team | `JoinTeamPage.tsx`, `team_invites`, `pending_invites` |
| Send message | `TeamChatPage` / `GroupChatPage` / `DirectMessagePage`, tables `group_messages` / `direct_messages`, edge fn `process-message-notifications` → `send-fcm-notification` |
| Broadcast | `BroadcastChatPage`, edge fn `send-club-announcement` / `send-association-broadcast` / `send-competition-broadcast` |
| Create event | `CreateEventPage.tsx`, `events` table, triggers auto-post to chat (`auto-post-event-to-chat`) |
| RSVP | RSVP components on `EventDetailPage`, `rsvps` table, `rsvp_audit_log`, cron `auto-default-rsvp-confirm-cron` |
| Live pitch | `EventGroupPitchPage`, `active_games`, realtime channel |
| Upload photo | `MediaPage`, bucket `photos`, edge fn `get-signed-photo-url` |
| Notifications | `NotificationsPage`, `NotificationPreferencesPage` |

For each major page: purpose, main components, and tables are best derived by reading the top of the page file — every page starts with its Supabase queries.

---

## 5. Backend / Supabase Documentation

### 5.1 Supabase project
- **Project ref (dev shown in .env):** `ecsdwrarzfexssxtrymj`
- **Prod project ref:** injected via `SUPABASE_PROD_PROJECT_REF` GitHub secret and `supabase_prod` Codemagic env group.
- **Auth:** email/password + Google OAuth + passkeys. Custom email flow via `auth-email-hook` (uses Resend).
- **Two environments:** DEV and PROD are separate Supabase projects. Dev is a cloned-and-neutered copy of prod.

### 5.2 Database schema
Full table list is in the system context; ~170 tables. They fall into these clusters (name-based grouping):
- **Identity / roles:** `profiles`, `user_roles`, `user_passkeys`, `user_activity_logs`, `user_presence`, `blocked_users`.
- **Clubs / teams / children:** `clubs`, `teams`, `club_players`, `team_memberships`, `children`, `child_guardians`, `child_team_assignments`, `child_training_defaults`, `child_mini_league_assignments`, `child_club_points`, `club_join_requests`, `club_invites`, `team_invites`, `pending_invites`, `team_creation_requests`, `team_folders`, `team_training_pauses`.
- **Events / RSVPs / duties:** `events`, `rsvps`, `rsvp_audit_log`, `event_groups`, `event_group_players`, `event_group_duties`, `event_guests`, `event_sponsors`, `event_views`, `event_payments`, `event_session_drills`, `event_auto_dm_log`, `event_auto_push_log`, `event_default_confirm_log`, `event_reminder_log`, `duties`, `favorite_event_titles`, `favorite_opponents`, `saved_locations`.
- **Chat / DM:** `chat_groups`, `group_messages`, `group_members`, `direct_conversations`, `direct_messages`, `broadcast_messages`, `club_messages`, `team_messages`, `club_admin_conversations`, `club_admin_messages`, `chat_group_join_requests`, `chat_group_unread`, `chat_mute_preferences`, `chat_notification_log`, `chat_open_perf`, `chat_photo_gallery_reminders`, `chat_pinned_vault`, `chat_summaries`, `message_reads`, `message_reactions`, `message_deletions`, `message_reports`, `message_digests`, `pinned_messages`, `scheduled_messages`, `match_messages`, `match_message_reads`, `hidden_chat_groups`, `hidden_dm_conversations`, `dm_attachment_restrictions`.
- **Media:** `photos`, `photo_albums`, `photo_reactions`, `photo_comments`, `photo_comment_reactions`, `photo_reports`, `photo_views`, `photo_deletion_logs`, `comment_reports`, `gallery_chat_cards`.
- **Competitions:** `competitions`, `competition_divisions`, `competition_matches`, `competition_entries`, `competition_broadcasts`, `competition_roles`, `playhq_fixtures`, `playhq_grades`, `playhq_ladder`, `playhq_player_links`, `playhq_player_stats`, `playhq_sync_log`, `game_results`, `game_player_stats`, `game_summaries`, `match_captains`, `match_goalkeepers`, `player_of_match`.
- **Mini-leagues:** `mini_leagues`, `mini_league_admins`, `mini_league_groups`, `mini_league_group_players`, `mini_league_group_duties`, `mini_league_players`, `mini_league_sessions`, `mini_league_session_availability`.
- **Associations:** `association_broadcasts`.
- **Pitch board:** `active_games`, `active_games_write_log`, `pitch_formations`.
- **Drills:** `drills`, `drill_frames`, `drill_recent_uses`, `training_session_drills`.
- **Notifications / push:** `notifications`, `push_subscriptions`, `fcm_tokens`, `notification_preferences`, `push_alert_settings`, `push_notification_logs`.
- **Subscriptions / billing:** `club_subscriptions`, `team_subscriptions`, `member_subscription_payments`, `iap_transactions`, `app_stripe_config`, `club_stripe_configs`, `promo_codes`, `member_referrals`.
- **Sponsors / rewards / points:** `sponsors`, `sponsor_analytics`, `sponsorship_packages`, `team_sponsors`, `team_sponsor_allocations`, `club_rewards`, `reward_redemptions`, `points_history`, `points_cooldowns`, `user_club_points`, `child_club_points`.
- **EOI / classes:** `eoi_submissions`, `eoi_form_views`, `class_enrolments`, `class_attendance`.
- **Ads:** `app_ads`, `app_ad_settings`, `app_ad_analytics`, `admob_config`.
- **Ops / admin:** `admin_alerts`, `audit_logs`, `feedback`, `file_deletion_logs`, `role_requests`, `system_messages`, `terms`, `pending_invites`, `cron_locks`, `default_rollover_log`, `engagement_reminder_log`, `realtime_perf_samples`, `client_perf_log`, `web_vitals`, `inbox_open_perf`, `app_settings`, `rate_limits`, `schedule_broadcasts`, `poll_options`, `poll_votes`, `polls`.
- **Business match (associations feature):** `business_matches`, `business_profiles`, `business_shortlist`.
- **Vault:** `vault_drive_links`, `vault_files`, `vault_folders`.

For exact columns, policies, and foreign keys, review generated types and migrations first. Authorized operators may verify the relevant environment in the Supabase dashboard. Never connect local tests to a hosted database merely to discover schema.

### 5.3 RLS
Tenant-scoped tables are expected to have RLS and appropriate grants. Do not assume universal coverage: verify every changed table and test allowed plus cross-tenant denial paths. Row visibility commonly uses:
1. `public.has_role(auth.uid(), '<role>')` for role-based access.
2. Membership joins to `team_memberships` / `club_players` / `child_guardians` / `mini_league_admins` / `competition_roles`.
3. Chat access uses `can_access_chat_group(chat_group_id, user_id)` (see core memory).
4. Vault files gate on `can_access_chat_group` when `chat_group_id IS NOT NULL` (core memory).

### 5.4 Edge functions (118 deployable entry points at review)
See `supabase/functions/*/index.ts`. Categorised:

| Category | Functions |
|---|---|
| **Auth** | `auth-email-hook`, `passkey-authenticate`, `passkey-register`, `admin-delete-account`, `admin-set-temp-password`, `admin-update-email`, `delete-account`, `recover-account`, `secret-delete-user`, `cleanup-deleted-accounts`, `export-user-data` |
| **Chat / notify** | `process-message-notifications`, `send-message-notification-email`, `send-fcm-notification`, `send-push-notification`, `test-push-notification`, `retry-missed-push-notifications`, `check-push-failure-rate`, `check-vapid-key`, `cleanup-push-subscriptions`, `chat-photo-gallery-reminders`, `digest-messages`, `assemble-catchup`, `summarize-chat`, `summarize-chat-icp`, `icp-llm-test`, `send-welcome-dm`, `send-message-report-email`, `send-comment-report-email` |
| **Events** | `auto-post-event-to-chat`, `auto-default-rsvp-confirm-cron`, `auto-default-rsvp-maintenance-cron`, `auto-rsvp-dm-cron`, `auto-rsvp-push-cron`, `process-event-notifications`, `send-event-reminders`, `send-event-view-reminder`, `notify-event-note`, `notify-game-kickoff`, `notify-new-member-events`, `send-invite-reminders`, `send-update-reminder`, `notify-join-request-decision` |
| **Media** | `get-signed-photo-url`, `permanent-delete-photos`, `permanent-delete-entity`, `post-game-photo-prompts`, `send-photo-notification-email`, `send-photo-prompt-followup`, `send-photo-report-email` |
| **Payments** | `stripe-webhook`, `create-event-checkout`, `create-member-payment-checkout`, `create-storage-checkout`, `create-subscription-checkout`, `confirm-event-payment`, `manage-stripe-config`, `cancel-subscription`, `check-pending-subs`, `expire-subscriptions`, `reconcile-legacy-subscriptions`, `verify-iap-receipt`, `check-iap-authorization`, `send-renewal-reminders` |
| **PlayHQ** | `playhq-sync`, `playhq-sync-club`, `playhq-sync-cron`, `playhq-materialise-team-events` |
| **Ads / IAP** | `verify-iap-receipt`, `check-iap-authorization` |
| **EOI / classes** | `eoi-webhook`, `send-eoi-invite`, `send-enrolment-notification-email` |
| **Sponsors / rewards / duties** | `process-duty-points`, `send-duty-notification-email`, `send-points-notification-email`, `send-reward-redeemed-email`, `process-weekly-engagement-bonus`, `process-weekly-engagement-digest`, `send-engagement-reminders` |
| **Google / integrations** | `google-drive-import`, `drive-folder-sync`, `resolve-drive-titles`, `google-places-search`, `giphy-search`, `fetch-link-preview` |
| **Vault / storage** | `vault-backup`, `vault-backup-list`, `vault-backup-restore`, `wipe-club-vault`, `scheduled-backup`, `send-storage-warnings`, `backfill-chat-vault-groups` |
| **Public (no JWT)** | `public-club-events`, `public-club-teams`, `public-minimum-app-version`, `share-page` |
| **Pitch board** | `pitch-timer-event`, `pitch-timer-read`, `send-pitch-board-notification-email` |
| **Ops** | `realtime-stats`, `prefetch-user-data`, `auto-purge-trash`, `cleanup-old-notifications`, `export-write-audit`, `process-scheduled-messages`, `scheduled-messages-write`, `generate-demo-data`, `send-feedback-email`, `send-email`, `send-game-stats-email`, `send-block-alert-email` |

`supabase/config.toml` opts specific functions out of JWT verification (`verify_jwt = false`) — every public / webhook / cron function must be listed there.

### 5.5 Triggers & scheduled jobs
- Numerous DB triggers for updated_at, cascade cleanup, and message audit. Core memory: messages are hard-deleted with audited trigger logic; never soft-deleted.
- `pg_cron` schedules invoke the `-cron` and `process-*` edge functions. Full schedule list is in Supabase Dashboard → Database → Cron.
- UUID-to-text casting is required in triggers (core memory).

### 5.6 Realtime
Enabled tables (verify via `pg_publication_tables where pubname='supabase_realtime'`) include chat/message tables, `notifications`, `active_games`, `pitch_formations`, RSVPs. Subscribers must respect RLS.

### 5.7 Storage buckets
See §2.5. Access controls are per-bucket policies; signed URLs are used for private reads via `get-signed-photo-url`.

### 5.8 Environment variables (Supabase side)
Edge Function secrets (managed via `add_secret` / Supabase Dashboard → Edge Function Secrets). Inventory in `docs/edge-secrets.md` — treat that file as the source of truth. Typical ones:
`RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `GOOGLE_PLACES_API_KEY`, `GIPHY_API_KEY`, `PLAYHQ_API_KEY`, `LOVABLE_API_KEY` (AI gateway), `GOOGLE_SERVICE_ACCOUNT_JSON` (Drive), `SUPABASE_SERVICE_ROLE_KEY` (auto-provisioned).

---

## 6. Authentication and Permissions

### 6.1 Sign-up / login
- Email/password via Supabase Auth.
- Google OAuth (requires Universal / App Links per §2.4).
- Passkeys via WebAuthn (`user_passkeys` + two edge functions).
- Password reset: forgotten-password → 6-digit code by email (`VerifyResetCodePage`) → set new password.
- Admins can issue temporary passwords via `admin-set-temp-password` (`AdminTempPasswordPage`).

### 6.2 Role model
- Roles live in `public.user_roles` (`user_id`, `role app_role`).
- `has_role(uuid, app_role)` SECURITY DEFINER checks role.
- Club/team/competition scoping is via membership tables, not roles.
- **Do not** store role on `profiles` — this would be a privilege-escalation vulnerability.

### 6.3 Permissions matrix (indicative — verify against RLS)

| Capability | app_admin | club_admin | committee | team_admin/coach | player | parent | media_admin | competition_admin |
|---|---|---|---|---|---|---|---|---|
| Create club | ✅ | via request | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Edit any club | ✅ | own club | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create team | ✅ | ✅ | ❌ | request | ❌ | ❌ | ❌ | ❌ |
| Edit team | ✅ | ✅ | ❌ | own team | ❌ | ❌ | ❌ | ❌ |
| RSVP for self / child | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (children) | ✅ | ✅ |
| Send team chat msg | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Broadcast club-wide | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Upload photo | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Moderate/delete photo | ✅ | ✅ | ❌ | own team | ❌ | ❌ | ✅ | ❌ |
| Manage subscriptions | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage competition | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Manage users platform-wide | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Access Admin pages | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**[Needs confirmation — the exact permission matrix must be reviewed against RLS policies; this table is indicative based on route/component gating.]**

### 6.4 Deep-link / Universal Link setup
- iOS Associated Domains: `applinks:igniteclubhq.app` (see core memory).
- Android `assetlinks.json`: served from custom domain.
- Bundle ID for both DEV and PROD: `app.lovable.igniteteamhub`.
- URL scheme: `igniteclubhq://`.

### 6.5 Known gaps / risks
- Historic tables that omitted the required `GRANT` in the same migration may throw PostgREST permission errors — check on any "permission denied" complaint.
- `service_role` key must never be exposed to client. Verify no `import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY` in the client bundle.

---

## 7. Integrations and External Services

| Service | Purpose | Config location | Secrets | Failure mode |
|---|---|---|---|---|
| **Supabase** | DB, Auth, Storage, Edge Functions, Realtime | `.env` (client), Codemagic env group (native), Supabase Dashboard | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (edge only) | RLS misconfig → 401/403; cold-start slow queries |
| **Netlify** | Web SPA hosting + `/share` edge function | `netlify.toml`, `netlify/edge-functions/share.ts`, Netlify dashboard | Netlify build env vars **[Needs confirmation]** | 404 on refresh → SPA fallback missing |
| **GitHub** | Source control + Actions | `.github/workflows/*` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, storage backup creds | Failed migration blocks release |
| **Codemagic** | iOS + Android CI/CD | `codemagic.yaml`, Codemagic env groups: `supabase_prod`, `android_signing`, iOS signing (App Store Connect API) | Signing keys, App Store Connect API key, Google Play service account, `LOVABLE_ENV` | Build failure blocks store release |
| **Resend** | All transactional email | edge function `send-*-email` | `RESEND_API_KEY` | Silent send failure → check Resend dashboard |
| **Firebase (FCM + Crashlytics)** | Native push + crash reporting | `firebase/google-services.json`, `firebase/GoogleService-Info.plist` | `FCM_SERVICE_ACCOUNT_JSON` (edge fn) | Token expiry → `cleanup-push-subscriptions` |
| **VAPID / Web Push** | PWA push | edge fn env | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Subscription refused / expired |
| **Stripe** | Subscriptions + checkout | `stripe-webhook`, `create-*-checkout`, `app_stripe_config`, `club_stripe_configs` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, per-club Stripe Connect creds | Webhook signature failure |
| **Apple IAP** | Native subscriptions on iOS | `verify-iap-receipt`, `check-iap-authorization`, App Store Connect | shared secret / notification URL | Receipt verification fails |
| **Google Play IAP** | Native subscriptions on Android | Same edge fns | Google Play service account JSON | Receipt verification fails |
| **AdMob** | In-app ads | `admob_config`, `capacitor.config.ts` `AdMob App ID` injected by codemagic script | AdMob App ID (public), ad unit IDs | Ads don't fill |
| **PlayHQ** | Australian sports fixture provider | `playhq-*` edge fns, tables `playhq_*` | `PLAYHQ_API_KEY` | Sync stalls → check `playhq_sync_log` |
| **Google Places** | Address autocomplete | `google-places-search` edge fn | `GOOGLE_PLACES_API_KEY` | Quota exhaustion |
| **Google Drive** | Vault import | `google-drive-import`, `drive-folder-sync`, `resolve-drive-titles` | `GOOGLE_SERVICE_ACCOUNT_JSON` or per-user OAuth **[Needs confirmation]** | Token expiry, permissions |
| **Giphy** | Chat GIF picker | `giphy-search` | `GIPHY_API_KEY` | Search returns empty |
| **Lovable AI Gateway** | AI catchup / drill assistant | `assemble-catchup`, `summarize-chat`, `icp-llm-test` | `LOVABLE_API_KEY` | Rate limit → surfaced to user |

Who needs access during vendor handover: see §17.

---

## 8. Deployment Documentation

[`docs/PROMOTION.md`](PROMOTION.md) is authoritative. This section is supporting context only.

### 8.1 Branches
- `main` — DEV branch. Lovable auto-commits here.
- `codespaces-review` — isolated complete-baseline validation branch.
- `prod` — PROD branch. Merged into via PR from `main`.
- `verify/*`, `refactor/*`, `integrate/*` — temporary work; never promote a cumulative branch directly.

### 8.2 Web deployment (Netlify)
- **[Needs confirmation]** Netlify site is set to build from `prod` for production and `main` for a preview deploy.
- Build command: `npm run build` (Vite).
- Publish directory: `dist/`.
- SPA fallback: handled by `netlify.toml`.
- Edge function `/share`: automatic from `netlify/edge-functions/share.ts`.
- Rollback: Netlify dashboard → Deploys → click prior deploy → "Publish deploy".
- Required Netlify env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` (must match the environment the build is for; if unset, published site breaks silently — the classic client has no missing-variable guard).

### 8.3 Backend deployment (Supabase)
`.github/workflows/promote-to-prod.yml` has isolated event paths:
- `push` or authorized manual dispatch on `prod` runs the privileged production job;
- a PR targeting `prod` runs file-only migration/change analysis with no production secrets, CLI, database connection, or deployment.

Steps in the workflow:
1. Install Supabase CLI.
2. Verify required secrets.
3. Link to prod project.
4. **List pending migrations.**
5. **Preview pending SQL** (posted in run log).
6. **Guard against destructive migrations** (blocks anything that would drop media/user tables).
7. Backup prod (schema + roles only — fast).
8. `supabase db push` (apply migrations).
9. Deploy functions selected by the workflow's change-detection and shared-function rules.

### 8.4 Mobile deployment (Codemagic)
`codemagic.yaml` defines 4 workflows:

| Workflow | Purpose | Env | Track |
|---|---|---|---|
| `android-debug-workflow` | DEV Android build (debuggable) | `LOVABLE_ENV=dev`, dev `.env` baked in | Internal / side-load |
| `ios-debug-workflow` | DEV iOS build | `LOVABLE_ENV=dev` | TestFlight internal |
| `ios-workflow` | **PROD** iOS build + publish | `LOVABLE_ENV=prod`, `supabase_prod` env group | App Store / TestFlight external |
| `android-workflow` | **PROD** Android build + publish | `LOVABLE_ENV=prod`, `supabase_prod` env group | Play Console Production |

Both PROD workflows produce the **same** `appId` (`app.lovable.igniteteamhub`). DEV and PROD are separated only by release track and by the display name (`Ignite` vs `Ignite DEV`) — never by bundle ID.

Codemagic env groups required:
- `supabase_prod` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY` (prod values). Scope: `ignite-club_hq-prod` app only.
- `android_signing` — Android keystore (upload + password + key alias + key password).
- iOS signing — App Store Connect API key configured on the workflow.

Post-build:
- Codemagic auto-uploads to App Store Connect (iOS) and Play Console (Android).
- iOS `versionCode` is epoch-seconds (always increasing).
- Version bump: `npm run ios:bump[:patch|minor|major]` (script `scripts/bump-ios-version.cjs`).

Common failures:
- Missing keystore / API key → set env group.
- FCM token registration fails → verify `google-services.json` / `GoogleService-Info.plist` match Firebase project.
- Deep links broken → `assetlinks.json` / AASA not served from prod domain.

### 8.5 Confirming a deploy worked
- Web: hit published URL, check Network tab for correct Supabase URL.
- Backend: GitHub Actions → "Promote to Prod" run → all steps ✅.
- Mobile: App Store Connect / Play Console → new build appears → install on test device.

---

## 9. Environment Variables and Secrets Inventory

### 9.1 Web (Vite) — client-side (public)
| Name | Purpose | Where set | Format |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL | `.env` (dev), Netlify env (prod), Codemagic `supabase_prod` (mobile prod) | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key | Same | `sb_publishable_...` |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ref | Same | `<ref>` |

### 9.2 Supabase Edge Function secrets (server-side)
See `docs/edge-secrets.md` for the authoritative list. Includes:
`RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `GOOGLE_PLACES_API_KEY`, `GIPHY_API_KEY`, `PLAYHQ_API_KEY`, `LOVABLE_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `APPLE_IAP_SHARED_SECRET`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.

### 9.3 GitHub Actions secrets
| Name | Used by |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | `promote-to-prod.yml`, `nightly-backup.yml` |
| `SUPABASE_PROD_PROJECT_REF` | Same |
| `SUPABASE_DB_PASSWORD` | Same |
| Storage backup creds (S3/GCS **[Needs confirmation]**) | `backup-storage.yml`, `restore-storage.yml` |

### 9.4 Codemagic env groups
| Group | Contents |
|---|---|
| `supabase_prod` | Prod `VITE_SUPABASE_*` |
| `android_signing` | Keystore + passwords + alias |
| iOS (workflow-level) | App Store Connect API key |
| **[Needs confirmation]** Google Play Service Account JSON | For Play Console upload |

Sensitivity: All Supabase publishable keys are OK to ship in bundles. Service role key, Stripe secret key, Resend API key, FCM service account, IAP secrets are **highly sensitive** — never in client bundle, never in logs.

---

## 10. Backup, Recovery and Data Protection

### 10.1 Database
- **Nightly:** `.github/workflows/nightly-backup.yml` at 02:00 UTC. Runs `supabase db dump` for schema, roles, and data. Tarball uploaded as GitHub Actions artifact (30-day retention).
- **Pre-migration:** `promote-to-prod.yml` dumps schema + roles before applying migrations (~15s, no row data).
- **On-demand:** `workflow_dispatch` on either workflow.
- **Supabase daily automatic backups:** enabled on the Pro plan (7-day retention). **[Needs confirmation of plan tier.]**
- **PITR:** NOT enabled (Point-in-time recovery costs ~$100/mo — deliberately deferred per user decision).

### 10.2 Storage
- `.github/workflows/backup-storage.yml` + `scripts/backup-storage.js` — copies bucket contents to backup destination (Node 22).
- `.github/workflows/restore-storage.yml` + `scripts/restore-storage.js` — restore path.
- **[Needs confirmation]** — destination (Backblaze B2 / S3 / another Supabase bucket).

### 10.3 Vault (per-club)
Edge functions: `vault-backup`, `vault-backup-list`, `vault-backup-restore`.

### 10.4 Repo
`backup-repo.yml` / `restore-repo.yml` — mirrors repo state.

### 10.5 Restore
- **DB:** `scripts/restore-prod-backup.sh` runs `psql` restore from the tarball artifact.
- **Storage:** `restore-storage.yml`.

### 10.6 What is NOT backed up
- Realtime channel state (transient).
- Auth session cookies (regenerable).
- Auth users are inside the DB dump, but auth-schema restore is Supabase-specific — verify with Supabase support before doing a full auth restore.
- Local device data (drafts, unsent messages saved to `localStorage`).

### 10.7 Recommended improvements
- Enable PITR on prod if budget allows.
- Push backup artifacts off GitHub to long-term storage (S3 / B2) with 12-month retention.
- Automated restore-verification job (spin up ephemeral Supabase project, restore, run smoke tests).

---

## 11. Core Feature Documentation

For brevity, each feature is documented as: **Files → Tables → External deps → Risks**. Read the linked page/component for full detail.

### 11.1 Registration & login
Files: `AuthPage.tsx`, `useAuth.tsx`, `main.tsx` (OAuth capture), `CompleteProfilePage.tsx`. Tables: `profiles`, `user_roles`, `terms`. External: Supabase Auth, Google OAuth, Resend (via `auth-email-hook`). Risks: OAuth deep-link config drift per environment.

### 11.2 Club creation
Files: `CreateClubPage.tsx`, `StartPage.tsx`. Tables: `clubs`, `user_roles` (grants creator `club_admin`). External: none. Risks: 83 columns on `clubs` — schema is wide; validate all defaults on insert.

### 11.3 Teams & invites
Files: `CreateTeamPage.tsx`, `TeamDetailPage.tsx`, `JoinTeamPage.tsx`, `AddTeamMemberSheet.tsx`, `ShortInviteRedirect.tsx`. Tables: `teams`, `team_memberships`, `team_invites`, `pending_invites`, `team_creation_requests`. External: Resend (invite email). Risks: invite links are single-use and must be idempotent on re-click.

### 11.4 Competition invites & mini-leagues
Files: `CompetitionsPage.tsx`, `CompetitionDetailPage.tsx`, `CompetitionJoinPage.tsx`, `MiniLeaguesPage.tsx`, `MiniLeagueDetailPage.tsx`. Tables: `competitions`, `competition_entries`, `competition_matches`, `mini_leagues`, `mini_league_*`, `playhq_*`. External: PlayHQ.

### 11.5 Fixtures, ladders, match scores
Files: `CompetitionFixturesPanel.tsx`, `SeasonDetailPage.tsx`, `ImportFixturesPage.tsx`. Tables: `competition_matches`, `game_results`, `game_player_stats`, `playhq_fixtures`, `playhq_ladder`. External: PlayHQ (`playhq-sync-cron`).

### 11.6 Messaging
Files: `TeamChatPage`, `ClubChatPage`, `GroupChatPage`, `DirectMessagePage`, `BroadcastChatPage`, `ClubAdminChatPage`, `components/chat/*`. Tables: `chat_groups`, `group_messages`, `direct_conversations`, `direct_messages`, `message_reads`, `message_reactions`, `chat_group_unread`. External: FCM, Resend. Risks: virtualisation flicker (see core memories — Virtuoso identity stability); realtime channel leaks; per-user cache prefix.

### 11.7 Broadcast / announcements
Files: `BroadcastChatPage`, `ClubAnnouncementDialog`. Tables: `broadcast_messages`, `association_broadcasts`, `competition_broadcasts`. Edge: `send-club-announcement`, `send-association-broadcast`, `send-competition-broadcast`.

### 11.8 Notifications
Files: `NotificationsPage`, `NotificationPreferencesPage`, `PushNotificationManager`. Tables: `notifications`, `notification_preferences`, `push_subscriptions`, `fcm_tokens`, `push_notification_logs`. Edge: `process-message-notifications` → `send-fcm-notification` / web push. Risks: token expiry, silent send failures — see `check-push-failure-rate`.

### 11.9 Media gallery
Files: `MediaPage.tsx`, `PublishChatPhotosPage.tsx`, `AlbumCarousel.tsx`. Tables: `photos`, `photo_albums`, `photo_reactions`, `photo_comments`, `photo_reports`, `photo_deletion_logs`. Bucket: `photos`. Edge: `get-signed-photo-url`, `permanent-delete-photos`.

### 11.10 Admin tools
Files: `AdminPage.tsx`, `Admin*Page.tsx`, `Manage*Page.tsx`. Access gated by `has_role('app_admin', ...)`.

### 11.11 Password reset
Files: `ResetPasswordPage.tsx`, `VerifyResetCodePage.tsx`, `AdminTempPasswordPage.tsx`. Edge: `auth-email-hook`, `admin-set-temp-password`.

### 11.12 Email sending
All emails go through Resend via edge functions named `send-*-email`. Any email issue → check Resend dashboard first.

### 11.13 Mobile-only
Push (FCM), IAP (`@capgo/native-purchases`), Camera (`@capacitor/camera`), Biometrics (`@capgo/capacitor-native-biometric`), Crashlytics, AdMob, File opener/pickers, Universal Links.

---

## 12. Data Flow Documentation

Each flow described as **Trigger → Frontend → Backend → DB → External → Errors**.

### 12.1 New user signs up
`AuthPage` → `supabase.auth.signUp` → Supabase Auth creates user → `auth-email-hook` (verify email) → user confirms → `profiles` row inserted (via trigger). Errors surfaced via toast.

### 12.2 User joins a club
`JoinClubPage` → validates invite in `club_invites` → RPC / edge fn → inserts into `club_players` → grants `player` role in `user_roles` (via trigger). Realtime → other admins see the new player.

### 12.3 User invited to team
Admin adds member → row in `team_invites` / `pending_invites` → `send-invite-reminders` emails via Resend → user clicks → `ShortInviteRedirect` → `JoinTeamPage`.

### 12.4 Sending a message
Composer submits → insert into `group_messages` (or `direct_messages` etc.) → trigger fires → `process-message-notifications` edge fn queued → per recipient: check `notification_preferences` + mute state → `send-fcm-notification` / web push / `chat-notification-log`. Realtime pushes message to all subscribers.

### 12.5 Admin broadcasts
Admin composes → `send-club-announcement` edge fn → writes to `broadcast_messages`, enqueues per-member notifications, sends bulk FCM + email.

### 12.6 Upload media
File input → PWA/native → direct upload to `photos` bucket with signed URL → insert into `photos` table → trigger creates thumbnail refs → notifications enqueued.

### 12.7 Create fixture
`CreateEventPage` → insert into `events` (with `event_type='match'`) → trigger `auto-post-event-to-chat` → RSVP defaults populated → notifications scheduled.

### 12.8 Enter score
Live game (`EventGroupPitchPage`) writes to `active_games`, on finalise writes to `game_results` / `game_player_stats`. If PlayHQ-linked, `playhq-sync-cron` pushes upstream.

### 12.9 Ladder update
`playhq-sync-cron` pulls fixtures + results → updates `playhq_ladder` and `playhq_fixtures`.

### 12.10 Password reset requested
`ResetPasswordPage` → `supabase.auth.resetPasswordForEmail` → `auth-email-hook` uses Resend to send 6-digit code → `VerifyResetCodePage` validates → new password saved.

### 12.11 Email notification sent
Trigger event → edge fn `send-*-email` → `Resend.emails.send(...)`. Log check: Resend dashboard.

### 12.12 Mobile build deployed
Push to `prod` branch → Codemagic webhook → `android-workflow` / `ios-workflow` → build signed → upload to Play Console / App Store Connect → manual promote to Production track.

---

## 13. Security Documentation

- **Authentication:** Supabase Auth + Google OAuth + passkeys. JWT-based. Passkeys enforced via `user_passkeys`.
- **Authorization:** RLS on every `public` table. `has_role()` SECURITY DEFINER function prevents recursive RLS. Membership tables enforce club/team scoping.
- **Secrets:** Client bundle only contains `VITE_SUPABASE_URL` + anon key. All other secrets are Supabase Edge Function secrets (Deno `Deno.env.get(...)`).
- **Service role key:** used ONLY inside edge functions. Verify no `service_role` reference in `src/`.
- **Storage:** `photos` served via signed URLs from `get-signed-photo-url`. Bucket policies must be reviewed periodically.
- **Email:** Resend outbound. Sender domain **[Needs confirmation]** must be verified in Resend.
- **API exposure:** All privileged writes go through edge functions. No `service_role` from client.
- **Client-side risks:** Any `localStorage` cache must use `ignite_` prefix and be cleared on sign-out — see core memory.
- **Admin privileges:** app_admin has unrestricted access; keep this role list minimal (audit `user_roles` where role='app_admin' regularly).
- **Handover risks:** legacy migrations without `GRANT` may fail after re-import; audit and dependency scan before any restore.

### 13.1 Sensitive data
- Child data: `children`, `child_guardians`, `child_team_assignments`.
- Private messages: `direct_messages`, `group_messages`.
- Photos: `photos` (may include children).
- Financial: `iap_transactions`, `member_subscription_payments`, `club_subscriptions`, `team_subscriptions`, `event_payments`.
- Auth: `user_passkeys`, `user_roles`.

Treat these tables with extreme care in any restore/export/vendor handoff.

---

## 14. Local Development Setup

### 14.1 Prereqs
- Node.js ≥ 22.12 (the `package.json` engine requirement).
- npm with the committed `package-lock.json`.
- Git.
- For native builds: Xcode 15+ (iOS), Android Studio Ladybug+ (Android).
- Supabase CLI (`supabase --version`), Docker (only if running Supabase locally).

### 14.2 Steps
```sh
git clone <repo>
cd ignite-club-launchpad
npm ci
```

### 14.3 Environment
The repository currently tracks a development `.env`, but this does not authorize exposing, duplicating, or using its values in tests. Obtain environment access from the owner. The isolated baseline strips inherited hosted Supabase/database variables and accepts only localhost endpoints.

### 14.4 Run
```sh
npm run dev            # Vite dev server on http://localhost:8080
npm run build          # Production build → dist/
npm run test:run       # Vitest single-run
npm run lint           # ESLint
```

### 14.5 Native
```sh
npx cap sync android   # or ios
npx cap open android   # or ios
```

### 14.6 Test data
Use synthetic data in the disposable local Supabase workspace. Never copy real users/clubs or run automated integration tests against hosted development or production. See `SETUP-DEV-ENV.md`, `NATIVE_APP_BUILD_GUIDE.md`, and [`docs/testing/local-supabase.md`](testing/local-supabase.md).

### 14.7 Common issues
- Blank page after publish → check `.env` contains all three `VITE_SUPABASE_*` vars (Vite has no missing-var guard).
- OAuth returns to browser not app → Universal / App Links misconfig (see §6.4).
- Realtime not firing → verify table is in `supabase_realtime` publication.

---

## 15. Testing and QA

- **Framework:** Vitest (`vitest.config.ts`, `vitest.matrix.config.ts`).
- **E2E:** Playwright, including baseline journeys.
- **Frontend only:** `npm run test:run`.
- **Strict feature boundary:** `npm run typecheck:strict-features`. This is a
  curated, non-emitting strict-TypeScript gate for extracted business policies,
  contracts, scopes, query keys, repositories, workflows, cache-completion
  handlers, and services. The policy and workflow islands can also be checked
  separately with `npm run typecheck:strict-policies` and
  `npm run typecheck:strict-workflows`. Expand them incrementally only when every
  newly included module is already clean; this is not a claim that the entire
  legacy frontend is strict yet.
- **Complete isolated baseline:** `npm run test:baseline`.
- **CI:** frontend tests run for `main`; the complete baseline runs on `codespaces-review`.
- **Manual test docs:** `docs/qa/android-keyboard-checklist.md`, `docs/qa/ios-pinch-zoom-checklist.md`.

### Pre-release checklist
- [ ] Login (email + Google + passkey).
- [ ] Signup → email verify → complete profile.
- [ ] Password reset (email arrives from Resend).
- [ ] Create club → create team → invite member → member joins.
- [ ] Create event → RSVP → auto-post to chat fires.
- [ ] Team chat: send text, image, reaction, reply. Verify realtime on second device.
- [ ] Broadcast: club admin sends → members receive push + email.
- [ ] Upload photo → thumbnail appears → notification arrives.
- [ ] Competition: import fixtures → enter score → ladder updates.
- [ ] Subscription: buy on web (Stripe) and on iOS (IAP) → `club_subscriptions` row correct.
- [ ] Push notifications: web + iOS + Android.
- [ ] Web deploy: refresh deep link (no 404).
- [ ] Mobile deploy: install from TestFlight / Play Internal → open notification → deep link navigates correctly.

---

## 16. Known Issues, Technical Debt and Risks

Sourced from repository tests, dated audits, and code inspection; verify each item against current code:

| Area | Risk |
|---|---|
| Chat virtualization | Virtuoso identity must be stable; empty-mount crash previously hit — guarded but requires care |
| Native cold start | Push navigation/auth/resume ordering is regression-sensitive; preserve native harness coverage |
| Backdrop blur | Banned over scrollers — will freeze Android WebView |
| Per-user cache | Must use `ignite_` prefix or previous-user data leaks |
| Chat message queries | Must use `refetchOnMount: "always"` — `true` is a no-op with staleTime |
| RLS gaps | Any new tables must include GRANTs in same migration |
| Vault folders | `chat_group_id IS NOT NULL` must gate on `can_access_chat_group` |
| iOS gestures | Camera/getUserMedia must run sync in tap handler |
| RSVP | No bulk RSVP; recurring events capped to 4 upcoming; default 9:00 AM |
| Universal Links | Two AASA / assetlinks needed if DEV bundle diverges; currently unified |
| PITR | Not enabled — cost decision; rely on nightly artifact + supabase daily |
| Realtime billing | Bare `.channel().subscribe()` outside `useEffect` leaks channels |
| Strict-TypeScript expansion | The initial policy and workflow islands cover 106 production modules. Continue expansion incrementally; require behaviour tests and deliberate database nullability/JSON-contract review rather than broad casts |
| 1,023 migrations at review | High reconstruction/review cost; retain history until a baseline is independently verified |
| Public schema grants | Historic migrations should be audited for missing GRANTs |
| Storage backup destination | **[Needs confirmation]** and long-term off-GitHub archive |
| Two Firebase projects | Currently one project shared by DEV/PROD — no isolation for test push |
| Codemagic minutes | Every push builds ~15 min; cost scales with team size |

---

## 17. Vendor Handover Checklist

Access to transfer:
- [ ] **GitHub** repo — grant `admin` on the org / repo, ensure PR review policy set.
- [ ] **Supabase** — invite as `Owner` (or `Developer`) on DEV and PROD projects.
- [ ] **Netlify** — invite as `Owner` of the site/team.
- [ ] **Codemagic** — invite as team member with build + secret access.
- [ ] **Resend** — invite as team member; share verified sender domain.
- [ ] **Firebase** — invite as `Editor` on the Firebase project (FCM + Crashlytics).
- [ ] **AdMob** — invite as `Admin`.
- [ ] **App Store Connect** — add as `Admin` (Apple team).
- [ ] **Google Play Console** — add as `Admin` with release upload rights.
- [ ] **Stripe** — invite as `Developer` + `Analyst`; ensure Connect access if per-club billing used.
- [ ] **PlayHQ** — share API key + relevant club/association IDs.
- [ ] **Google Cloud** (Places / Drive / service accounts) — invite as `Owner` on the GCP project.
- [ ] **Domain / DNS** — share registrar access or delegated NS.
- [ ] **Backup destination** (S3 / B2) — invite/grant read+write.
- [ ] **Admin test accounts** — provide app_admin + club_admin + parent + player test users on DEV.
- [ ] Read this doc + `PROMOTION.md` + `SETUP-DEV-ENV.md` + `NATIVE_APP_BUILD_GUIDE.md` + `VIDEO_RECORDING_GUIDE.md`.

Release process for vendor:
1. Develop on `main` branch (Lovable auto-commits or vendor PRs).
2. Validate focused behaviour and the isolated baseline on `codespaces-review`.
3. Complete required manual checks; open a `prod` PR only for an authorized release window.
4. Merge → `promote-to-prod.yml` applies migrations + deploys edge fns.
5. Codemagic (on same push) builds Android + iOS. Uploads to stores.
6. Manually promote store builds Internal → Production when ready.

Rollback:
- Web: Netlify → "Publish previous deploy".
- DB: use nightly backup artifact + `scripts/restore-prod-backup.sh`.
- Mobile: re-promote previous store build (Apple/Google).
- Edge fns: revert commit + re-run `promote-to-prod.yml`.

---

## 18. Operational Runbook

| Symptom | First check | Second check | Fix |
|---|---|---|---|
| User can't log in | Supabase → Auth → find user, check `email_confirmed_at` | `auth_logs` for the request | Resend confirmation via admin panel |
| Missing invite email | Resend dashboard → search recipient | Edge fn logs for `send-invite-reminders` | Re-trigger from admin page |
| Message not delivered | Realtime → subscriber count on channel | `chat_notification_log` | Check FCM token validity |
| Failed email | Resend dashboard → status = bounced/failed | Edge fn logs `send-*-email` | Retry, or contact Resend |
| Media upload fails | Browser network 403 | `photos` bucket policies | Fix RLS / policy |
| Fixture/ladder wrong | `playhq_sync_log` last row | Force run `playhq-sync-club` | Re-import fixtures |
| Web deploy fails | Netlify build log | Missing env var? | Add to Netlify site env |
| Codemagic build fails | Codemagic build log | Signing / keystore / API key | Fix env group |
| Realtime not firing | `pg_publication_tables` includes table? | Client subscribed correctly? | Add table to publication |
| Push notification not received | `fcm_tokens` row for user | `check-push-failure-rate` | Delete stale token, re-register |

### Rollback playbook
1. **Identify last known good deploy** (Netlify + Codemagic + Supabase).
2. **Web:** Netlify → Publish previous deploy.
3. **Backend:** Revert offending commit in `prod` branch. `promote-to-prod.yml` re-runs (but does not remove already-applied migrations — write a compensating migration if needed).
4. **DB data:** Restore via `scripts/restore-prod-backup.sh` from latest nightly artifact.
5. **Mobile:** Halt phased rollout in Play Console / disable App Store version.

### Restore from backup
1. Download latest artifact from GitHub Actions → "Nightly PROD Backup".
2. `tar xzf prod-full-backup-*.tar.gz`.
3. `psql "postgres://postgres:<pw>@<host>:5432/postgres" < prod-schema.sql`.
4. `psql ... < prod-roles.sql`.
5. `psql ... < prod-data.sql` (with `--disable-triggers` for circular FKs).

### Adding a new club safely
- Prefer via app UI (`CreateClubPage`) as `app_admin`.
- If bulk: write migration adding row + `club_players` for creator + `user_roles` entry. Run via `promote-to-prod.yml`.

### Monitoring
- **[Needs confirmation]** whether Sentry / Crashlytics dashboard access is set up. Crashlytics is bundled; verify project has an active receiver.
- Supabase Dashboard → Reports (CPU, connections, egress).
- Resend Dashboard (deliverability).
- Firebase Console (FCM delivery, crash-free users).

---

## 19. Scaling Considerations

Recommendations from the dated capacity assessment and current architecture review:

| Concern | Trigger point | Action |
|---|---|---|
| Supabase DB CPU | 500+ DAU | Move to larger compute; add read replica for reports |
| Realtime channel count | 1,000+ DAU | Split channels per-club; enforce chat virtualization; drop fallback realtime |
| Storage egress | Media volume growth | Move to CDN (Cloudflare / Bunny) in front of Supabase Storage |
| Auth users | 10k+ | Supabase Team tier |
| Push volume | 10k+ MAU | Batch FCM sends; refine failure retry |
| Netlify bandwidth | Sustained traffic | Consider CDN egress plan |
| Codemagic minutes | Multiple daily builds | Reserve M2 slot / self-host build agent |
| Multi-club risk | 100+ clubs | Audit any hard-coded club-scoped queries; verify RLS scopes on every table |
| Migration set | 1,023 files at review | Retain history; design a baseline only with independent parity and rollback verification |
| Trigger coalescing | Chat volume | Batch notification enqueue triggers |
| Presence table | Chat volume | Split `user_presence` into hot/cold |

Assumptions that may break at scale:
- Single Firebase project for DEV + PROD → separate at scale.
- Single Stripe account → per-club Stripe Connect must be verified.
- Single Netlify build for all environments → introduce dedicated preview site.
- Photo bucket has no lifecycle policies → archive/cold-tier after N months.

---

## 20. Final Recommendations

### Top 10 things a vendor should understand first
1. Two Supabase projects (DEV + PROD), promoted via GitHub Actions on merge to `prod` branch.
2. `main` = DEV, `prod` = PROD. Lovable auto-commits to `main`.
3. `codemagic.yaml` has 4 workflows; `android-workflow` + `ios-workflow` are PROD.
4. All backend logic is Supabase Edge Functions (Deno) — no separate backend server.
5. RLS + `has_role()` is the authorization backbone. Never store roles on `profiles`.
6. All emails go through Resend via `send-*-email` edge functions.
7. Push = FCM (native) + VAPID (web). Tokens in `fcm_tokens` / `push_subscriptions`.
8. Backup workflows exist; retention, restorability, and hosted PITR state require external verification.
9. Bundle ID for both DEV and PROD is the PROD bundle — release tracks separate them.
10. Read canonical docs and relevant regression tests before changing virtualization, native lifecycle, caching, or camera gestures.

### Top 10 technical risks
1. 1,023 migration files at review — reconstruction and review cost is high; retain history until a replacement baseline is independently verified.
2. Public-schema `GRANT` compliance across historic migrations not audited.
3. Hosted PITR/retention and proven restore time are not repository-verifiable.
4. Single Firebase project shared DEV/PROD.
5. Storage backup destination not confirmed — potential data loss window.
6. Realtime subscription discipline critical to bill control.
7. Chat performance is fragile on Android WebView — anything violating memory rules regresses immediately.
8. Deep-link config drift across environments can silently break OAuth.
9. Edge function secret list not enforced in CI — could deploy code that references a missing secret.
10. `service_role` key exposure would be catastrophic; audit needed each release.

### Top 10 recommended improvements
1. Consolidate migrations into a baseline dump.
2. Add CI check that every new `CREATE TABLE public.*` has GRANTs in same migration.
3. Push nightly backup artifact off GitHub to long-term cold storage.
4. Verify Supabase backup/PITR configuration and perform a controlled restore exercise.
5. Split DEV/PROD Firebase projects.
6. Introduce Sentry (web + native) — Crashlytics only covers native crashes.
7. Add an automated restore-verification workflow.
8. Add per-club Stripe Connect end-to-end integration tests.
9. Document + enforce the edge-function secret inventory in CI (`docs/edge-secrets.md` currency check).
10. Retire unused edge functions to reduce cold-start cost surface.

### Top 10 questions to ask any vendor before handing over
1. Have you worked with Supabase Edge Functions (Deno) at production scale?
2. Show me how you'd write a new RLS policy for a new tenant-scoped table.
3. How would you diagnose a Realtime channel leak?
4. How would you add a new push notification type end-to-end (DB → edge fn → FCM → client)?
5. How would you roll back a bad migration that has already applied to prod?
6. How would you migrate Firebase to per-env projects without breaking existing installs?
7. What's your process for verifying deep links after an iOS/Android release?
8. How would you prove a nightly backup is restorable?
9. How would you handle a Stripe webhook signature failure investigation?
10. What monitoring would you add on day one?

---

## Appendix A — Files not to touch without care
- `src/integrations/supabase/types.ts` (auto-generated).
- `supabase/migrations/*` (append-only).
- `capacitor.config.ts` `appId` (breaks store link).
- `firebase/google-services.json` / `GoogleService-Info.plist` (must match Firebase project).
- `codemagic.yaml` signing sections.
- `.github/workflows/promote-to-prod.yml` guard step.

## Appendix B — Key documents in this repo
- `README.md` — canonical repository entry point.
- `docs/ARCHITECTURE.md` — authoritative system boundaries and invariants.
- `docs/PROMOTION.md` — authoritative promotion and rollback process.
- `SETUP-DEV-ENV.md` — local dev environment.
- `NATIVE_APP_BUILD_GUIDE.md` — mobile build walkthrough.
- `VIDEO_RECORDING_GUIDE.md` — pitch-board video recording feature.
- `docs/PROMOTION_CHECKLIST.md` — mirroring secrets from dev to prod.
- `docs/edge-secrets.md` — edge function secret inventory.
- `docs/qa/*.md` — manual QA checklists.
- `docs/README.md` — documentation authority and history index.

---

*End of Vendor Handover Documentation.*
