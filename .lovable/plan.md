## Goal
A single, lightweight sponsor/ad strip pinned at the top of every chat thread:
- **Pro club** → rotates that club's own sponsors (existing `MessagesSponsorCarousel`)
- **Free club** → rotates app-level paid ads (existing `AppAdCarousel`)
- **Never** sends notifications, **never** enters the message stream, **zero** virtualisation impact.

## What already exists (reused as-is)
- `SponsorOrAdCarousel` — resolves Pro status per-club and renders sponsor or app ad. Already in use on Home, Events, Messages inbox.
- `MessagesSponsorCarousel` (Pro path) and `AppAdCarousel` (Free path).
- `app_ad_settings` (location-keyed enable/disable) and `app_ad_analytics` (impressions/clicks).

## New work

### 1. New ad-settings location key: `"chat-thread"`
- Insert a row into `app_ad_settings` for `location = 'chat-thread'`, `is_enabled = true`.
- This lets app admins disable the new placement independently of the inbox.
- `SponsorOrAdCarousel`'s `location` prop type extends to include `"chat-thread"`.

### 2. New wrapper: `ChatThreadSponsorStrip`
- Props: `clubId: string | null` (the club this thread belongs to).
- Renders `SponsorOrAdCarousel` with `location="chat-thread"` and `activeClubFilter={clubId}` inside a fixed-height container (`h-14` or so) with `border-b` and solid `bg-background` (no backdrop-blur — Android WebView freeze rule).
- Hidden entirely (returns `null`) when there's nothing to show, so it never reserves empty space.
- Lives as a normal sibling **above** the message scroller — not `position: sticky` (sticky over Virtuoso causes layout-jank on scroll measurement). Because the scroller below has its own internal scroll, the strip stays visible naturally.

### 3. Mount it on all 6 chat thread pages
For each page, derive the thread's club id and drop `<ChatThreadSponsorStrip clubId={...} />` between the page header and the `ChatMessagesScroller`:

```text
┌──────────────────────────┐
│ Thread header            │
├──────────────────────────┤
│ ChatThreadSponsorStrip   │  ← new, fixed height, solid bg
├──────────────────────────┤
│                          │
│ ChatMessagesScroller     │  ← Virtuoso, untouched
│ (virtualised)            │
│                          │
├──────────────────────────┤
│ Composer                 │
└──────────────────────────┘
```

Pages + clubId source:
- `TeamChatPage` → `team.club_id`
- `ClubChatPage` → `clubId` (already in route)
- `GroupChatPage` → `group.club_id` (or null for personal groups; strip hides)
- `BroadcastChatPage` → broadcast's `club_id`
- `ClubAdminChatPage` → `clubId`
- `DirectMessagePage` → `null` (DMs aren't club-scoped → strip hides; no ads in DMs)

### 4. Notification safety (already done previous turn)
- `team_messages.is_sponsor` column + trigger guard remain in place.
- The new strip does NOT insert any chat-message rows, so there's no notification fan-out path to worry about. The column stays as a defence-in-depth measure for any legacy/manual sponsor inserts.

### 5. Analytics
- `MessagesSponsorCarousel` and `AppAdCarousel` already log impressions/clicks to `sponsor_analytics` and `app_ad_analytics`. We get per-thread visibility metrics for free; can later filter by `location='chat-thread'` for placement comparison.

## Virtualisation impact audit (per chat memory rules)
- Strip is a **sibling above** the Virtuoso scroller, not inside it → row identity, height cache, prepend/append behaviour all untouched.
- No `backdrop-blur` or CSS `filter: blur` used.
- Fixed-height container → no mid-scroll layout shift.
- Strip mounts once per thread; internal rotation re-renders only the strip subtree.

## Non-goals
- No inline sponsor messages in the chat stream (rejected previously).
- No bottom-of-thread placement (invisible — rejected).
- No DM ads (not club-scoped; would feel intrusive).
- No new tables; reuses `sponsors`, `app_ads`, `app_ad_settings`, analytics tables.

## Rollout
1. Migration: add `'chat-thread'` row to `app_ad_settings` (enabled by default).
2. Build `ChatThreadSponsorStrip` + extend `SponsorOrAdCarousel` location type.
3. Mount in all 6 chat thread pages.
4. Verify in preview that strip renders for Riverside (Free club → app ad) and Bridgewater (Pro club with sponsors → sponsor) at the top of a thread, doesn't bump unread counts, and doesn't appear in DMs.
