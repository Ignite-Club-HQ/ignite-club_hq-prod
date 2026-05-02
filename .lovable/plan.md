# Invite UX Overhaul — Focused Plan

Goal: Make adding team members and getting them to join dramatically simpler, while reducing the regression risk in `AddTeamMemberSheet.tsx` (currently 3,587 lines).

Benchmarked against Spond, TeamSnap, Heja. Scope sequenced so each phase ships independent value without breaking existing flows.

**Decisions locked in:**
- ❌ **No server-side SMS** — keep email (Resend) + manual `sms:` / `wa.me` share links as today.
- ✅ **Persistent join link** defaults: 30-day expiry, unlimited uses, role = parent.
- ✅ **One-off invites coexist** with the join link (one-off stays default for known recipients; join link for broadcast).
- ✅ **Coach fills child details upfront, but optional** — collapsed under an "Add details now (optional)" disclosure.

---

## Phase 1 — Unified Recipient Input

**Problem:** Single vs Bulk tabs force a mode decision before any data is entered. Different fields appear depending on the tab, doubling UI surface area.

**Change:**
- Replace Single/Bulk tabs with **one smart input** that accepts:
  - Names only (`Alex Smith`)
  - Name + email (`Alex Smith <alex@example.com>`)
  - Comma-, newline-, semicolon-, or tab-separated lists for multiple recipients (spreadsheet paste works)
- Render each parsed recipient as a removable **chip** with inline edit.
- Role + delivery selection happen once for the whole batch (already the case downstream).

**New files:**
- `src/components/invite/RecipientInput.tsx`
- `src/components/invite/recipientParser.ts` + `.test.ts`

**Edits:**
- `AddTeamMemberSheet.tsx` — remove Single/Bulk tab block and `mode` state; render `RecipientInput`. Keep all downstream submit logic (it already iterates an array).

**Acceptance:**
- Single recipient flow has the same number of taps as today (or fewer).
- Pasting 20 names from a spreadsheet creates 20 chips in one action.

---

## Phase 2 — Persistent Team Join Link + QR

**Problem:** No way for a coach to drop a single link into an existing WhatsApp group or print a QR for sign-up night. Every invite today is one-to-one.

**Change:**
- New table `team_join_tokens` (`team_id`, `token`, `created_by`, `expires_at`, `max_uses`, `revoked_at`, `default_role`).
- **Defaults:** 30-day expiry, unlimited uses, `default_role = 'parent'`. Admin can override at generation time.
- New **"Team Join Link"** card surfaced on:
  - Team detail page (admins/coaches only)
  - Inside `AddTeamMemberSheet` as a "Share a link" section (coexists with one-off — one-off stays the primary CTA)
- Card shows: copy link button, QR code (`qrcode.react`), "Revoke & regenerate", current usage count.
- Joining via the link routes through the existing invite acceptance flow but creates a fresh `invites` row on consumption (keeps audit trail and child-linking intact).

**New files:**
- `src/components/invite/TeamJoinLinkCard.tsx`
- `src/components/invite/TeamJoinQRCode.tsx`
- Migration: `team_join_tokens` table + RLS (admin/coach create/revoke; public can resolve token by hash for join page)
- Edge function: `consume-team-join-token` (validates token, checks expiry/revoke/uses, creates invite row, returns redirect)

**Edits:**
- Routing: add `/join/team/:token` (or extend existing short-invite redirect)
- Team header / `EditTeamPage.tsx` — surface card behind admin/coach role check
- `AddTeamMemberSheet.tsx` — add collapsible "Share a link" section below the one-off form

**Acceptance:**
- Coach posts one link in WhatsApp; 15 parents join without further coach input.
- Revocation invalidates the link immediately.
- One-off invite flow remains the visible default.

**Memory rule to add (after build):** "Team join tokens default to 30-day expiry, unlimited uses, role=parent. Coexist with one-off invites — never replace."

---

## Phase 3 — Optional Child Details Collapse

**Problem:** Coaches today must enter year of birth, jersey number, etc. for each child *before* the parent has joined. Biggest source of "too confusing" feedback.

**Change:**
- Keep all current child fields, but collapse them under a single **"Add details now (optional)"** disclosure that's closed by default.
- Required fields remain: child first name + parent contact.
- After parent joins, they can edit/complete the child profile from their own account (already supported).

**Edits:**
- `AddTeamMemberSheet.tsx` — wrap YOB / jersey / position / medical fields in a collapsible block; default closed.
- Add a subtle "Parent can complete this later" hint under the disclosure.

**Acceptance:**
- Inviting a parent with one child takes ≤4 fields by default (parent name, parent contact, role, child name).
- Coaches who want full data still get it via one tap on the disclosure.

---

## Phase 4 — Modular Refactor (last, no behavior change)

Once Phases 1–3 stabilise, split `AddTeamMemberSheet.tsx` into:

- `useInviteFlow.ts` — single hook owning state machine (recipients → role → delivery → submit → success)
- `RecipientStep.tsx`
- `RoleStep.tsx`
- `DeliveryStep.tsx`
- `SuccessShare.tsx`
- `BulkProgress.tsx`
- `AddTeamMemberSheet.tsx` becomes a ~150-line composer

**Acceptance:** No user-visible change. Existing manual QA scripts pass.

---

## Out of scope (deferred)

- Server-side SMS / WhatsApp Business API
- Federated invite passes (Apple Wallet / Google Pay)
- AI parsing of pasted rosters with arbitrary columns

---

## Suggested build order

1. **Phase 1** — Unified Input (frontend only, ~1 day)
2. **Phase 2** — Join Link + QR (backend + frontend, ~2 days, biggest perceived win)
3. **Phase 3** — Optional child details collapse (~½ day)
4. **Phase 4** — Refactor (~1 day, no user-visible change)
