# Invite UX Overhaul — Focused Plan

Goal: Make adding team members and getting them to join dramatically simpler, while reducing the regression risk in `AddTeamMemberSheet.tsx` (currently 3,587 lines).

Benchmarked against Spond, TeamSnap, Heja. Scope below is intentionally sequenced so each phase ships independent value without breaking existing flows.

---

## Phase 1 — Unified Recipient Input (highest impact, lowest risk)

**Problem:** Single vs Bulk tabs force a mode decision before any data is entered. Different fields appear depending on the tab, doubling the UI surface.

**Change:**
- Replace the Single/Bulk tab switcher with **one smart input** that accepts:
  - Names only (e.g. `Alex Smith`)
  - Name + email (`Alex Smith <alex@example.com>`)
  - Name + phone (`Alex Smith +61 400 000 000`)
  - Comma-, newline-, or semicolon-separated lists for multiple recipients
- Render each parsed recipient as a removable **chip** below the input with an inline "edit" affordance.
- Detect role hints from the input (e.g. trailing `(parent)`, `(coach)`) but always default to the role chosen at the top.
- Bulk paste from spreadsheets works automatically (tab-separated lines parse to `name<TAB>email`).

**Files (new):**
- `src/components/invite/RecipientInput.tsx` — controlled chip input
- `src/components/invite/recipientParser.ts` — pure parser + unit tests
- `src/components/invite/recipientParser.test.ts`

**Files (edit):**
- `AddTeamMemberSheet.tsx` — remove the Single/Bulk tab block and the `mode` state, render `RecipientInput` instead. Keep all downstream submit logic (it already iterates over an array).

**Acceptance:**
- Single recipient flow has the same number of taps as today (or fewer).
- Pasting 20 names from a spreadsheet creates 20 chips in one action.
- Role + delivery selection still happen once for the whole batch.

---

## Phase 2 — Server-Side SMS Delivery

**Problem:** SMS uses `sms:` deep links, so coaches must manually open Messages and tap Send for every invite. WhatsApp uses `wa.me` which has the same friction.

**Change:**
- Add an edge function `send-invite-sms` that uses **Twilio** (already a recommended connector) to send the invite link automatically.
- Keep the existing `sms:` / `wa.me` fallback as a "Share manually" option for users who prefer it (or when phone validation fails).
- Email delivery (already server-side via Resend) is unchanged.

**New files:**
- `supabase/functions/send-invite-sms/index.ts`
- Add `TWILIO_*` connector via `standard_connectors--connect` (twilio)

**Edits:**
- `AddTeamMemberSheet.tsx` — when delivery=SMS and recipient has a valid phone, call the edge function instead of opening the `sms:` URL.
- Surface per-recipient delivery status (✓ Sent / ⚠ Failed → fallback to manual share).

**Acceptance:**
- Coach taps "Send" once → all SMS invites go out without leaving the app.
- Failed sends show a single "Share manually" affordance per recipient.
- Cost guardrail: confirm with user before sending >10 SMS in a single batch.

**Decision needed before build:** Confirm Twilio (vs MessageBird / AWS SNS). Twilio is the cleanest fit since it's already an available connector.

---

## Phase 3 — Persistent Team Join Link + QR

**Problem:** No way for a coach to drop a single link into an existing WhatsApp group or print a QR for sign-up night. Every invite today is one-to-one.

**Change:**
- Add a long-lived `team_join_tokens` table (`team_id`, `token`, `created_by`, `expires_at`, `max_uses`, `revoked_at`, `default_role`).
- Surface a **"Team Join Link"** card on:
  - The team detail page header (admins/coaches only, behind an "Invite" affordance)
  - Inside `AddTeamMemberSheet` as a tab/section called "Share a link"
- The card shows: copy link button, QR code (`qrcode.react`), "Revoke & regenerate" action, and current usage count.
- Joining via this link routes through the existing invite acceptance flow but creates a fresh `invites` row on consumption (so audit trail and child-linking still work).

**New files:**
- `src/components/invite/TeamJoinLinkCard.tsx`
- `src/pages/JoinTeamByTokenPage.tsx` (or extend the existing short-invite redirect)
- Migration for `team_join_tokens` + RLS

**Edits:**
- Routing: add `/join/team/:token` (or piggyback `/join/:token`)
- `EditTeamPage.tsx` / team header: surface the card

**Acceptance:**
- Coach can post one link in WhatsApp and 15 parents join without further input.
- Revocation invalidates the link immediately.
- Default role for token-based joins is configurable (defaults to `parent`).

**Memory rule to add:** "Team join tokens default to role=parent and expire after 30 days unless extended."

---

## Phase 4 — Deferred Child Details (parent-completes-profile)

**Problem:** Coaches today must enter year of birth, jersey number, etc. for each child *before* the parent has even joined. This is the biggest source of "too confusing" feedback.

**Change:**
- During invite creation, only require: **child first name** (or "unknown" placeholder) + parent contact.
- Child details (YOB, jersey, position, medical) become a **post-join checklist** the parent sees on first launch.
- Coaches can still optionally fill in these fields, behind an "Add details now (optional)" disclosure.
- Existing `children` rows continue to support coach-side edits — no behavior loss.

**Edits:**
- `AddTeamMemberSheet.tsx` — collapse the child details block under a disclosure
- New `src/components/invite/PostJoinChildChecklist.tsx` shown inside `HomeInviteFlow` / first-launch onboarding for parents whose linked children have incomplete profiles
- Trigger: surface a yellow banner on the team page for incomplete children (admin view only) with "Nudge parent" action

**Acceptance:**
- Inviting a parent with one child takes ≤4 fields (name, contact, role, child name).
- Incomplete-child banner disappears once parent submits the checklist.

---

## Phase 5 — Modular Refactor (last, behind a feature flag)

Once Phases 1–4 ship and stabilise, split `AddTeamMemberSheet.tsx` into:

- `useInviteFlow.ts` — single hook owning state machine (recipients → role → delivery → submit → success)
- `RecipientStep.tsx` (Phase 1 input)
- `RoleStep.tsx`
- `DeliveryStep.tsx`
- `SuccessShare.tsx`
- `BulkProgress.tsx` (per-recipient send status)
- `AddTeamMemberSheet.tsx` becomes a ~150-line composer

**Acceptance:** No behavior change. Test parity verified by replaying existing manual QA scripts.

---

## Phases NOT in scope (explicitly deferred)

- Federated invite acceptance (Apple Wallet pass, Google Pay pass)
- AI parsing of pasted rosters with arbitrary columns — Phase 1's parser is deterministic only
- Removing the email/share success-screen duality — revisit after Phase 2 telemetry shows which channel users actually pick

---

## Open questions before Phase 1 starts

1. Twilio account: use the workspace-level Twilio connector, or does each club need its own number? (Affects sender ID + cost allocation.)
2. Team join link defaults: 30-day expiry, unlimited uses, role=parent — confirm.
3. Should the persistent join link replace or coexist with one-off invites? Recommendation: **coexist**. One-off invites stay the default for known recipients (better tracking); join link is for "broadcast" scenarios.

---

## Suggested build order

1. **Phase 1** (Unified Input) — 1 PR, frontend only, ~1 day
2. **Phase 3** (Join Link + QR) — backend + frontend, ~2 days, big perceived win
3. **Phase 2** (Server SMS) — depends on Twilio decision, ~1 day after secrets configured
4. **Phase 4** (Deferred child details) — ~1.5 days, mostly UI
5. **Phase 5** (Refactor) — ~1 day, no user-visible change
