
## Plan: Unified Chat Details panel + premium chat header

### Goal
Replace the current "Members" sheet trigger with a richer **Chat Details** panel reachable by tapping the header from every thread type, and refresh the header itself for a more premium feel. No changes to bottom nav or the gallery feature.

### Architecture overview
```text
Chat header (tap whole title block)
        │
        ▼
ChatDetailsSheet  (new, shared by all 5 thread types)
  ├─ Identity block (large avatar, name, sublabel, X)
  ├─ Context links  (View team / View club)        [conditional]
  ├─ Shared in chat (thumbs row + "View all →")    [opens ChatMediaViewer]
  ├─ Notifications  (single On/Off toggle, reuses ChatMuteButton logic)
  └─ Participants   (renamed; reuses ChatMembersSheet body)
```

### Part 1 — Chat Details panel

**New components**
1. `src/components/chat/ChatDetailsSheet.tsx`
   - Props: `chatType: "team" | "club" | "group" | "dm" | "broadcast"`, `chatId`, `name`, `sublabel`, `avatarUrl?`, `teamId?`, `clubId?`, `otherUserId?`, `open`, `onOpenChange`.
   - Right-side `Sheet` on desktop, bottom drawer on mobile (uses existing `ResponsiveDialog`/`Sheet` patterns and `max-h-[85vh]` per mobile sheet rule).
   - Sections rendered conditionally:
     - **Identity** — `ConversationAvatar` at `h-16 w-16`, bold name, muted sublabel.
     - **Context** — “View team page →” / “View club page →” buttons that `navigate()` to the relevant route. Hidden for DMs and broadcast.
     - **Shared in chat** — calls a new hook `useChatSharedMedia(chatType, chatId)` that selects `id, image_url, created_at, author_id` from the matching table (`messages`, `club_messages`, `group_messages`, `dm_messages`, broadcast `messages`) where `image_url IS NOT NULL`, ordered desc, limit 12. Renders horizontal thumb row, video glyph if URL ends in `.mp4/.mov/.webm`, "View all →".
     - **Notifications** — single Switch, wired to the same `chat_mute_preferences` row that `ChatMuteButton` uses (`muted_until = null` ON, future timestamp OFF). Existing 1-hour timed mute UI stays accessible from the header bell, but inside the panel we keep it to a lightweight toggle.
     - **Participants** — embeds the existing list from `ChatMembersSheet` (extracted into `ChatParticipantsList.tsx`) with header label "Participants · {count}". DM mode shows both users.

2. `src/components/chat/ChatMediaViewer.tsx`
   - Full-screen modal with `grid grid-cols-3 gap-1`, newest first.
   - Tap → reuses existing `FullscreenImageViewer` (already supports image + video, pinch zoom).
   - Footer overlay shows sender display name + relative date.
   - Completely independent of the media gallery code — own query hook, no writes.

3. `src/hooks/useChatSharedMedia.ts`
   - Returns `{ items, isLoading }` for the chat. One React Query keyed by `["chat-shared-media", chatType, chatId]`, staleTime 60s. Pulls author display_name in a follow-up `profiles` lookup (mirrors existing pattern in `ClubChatPage`).

**Refactor**
- Extract list body of `ChatMembersSheet` into `ChatParticipantsList.tsx` so it can be embedded inside `ChatDetailsSheet`. The standalone sheet stays available but is no longer launched from the header — the header opens `ChatDetailsSheet` instead.

### Part 2 — Premium header upgrade

**New component:** `src/components/chat/ChatHeaderShell.tsx`

Reusable header used by all 5 chat pages:
```text
[Back]  [Avatar 36px] [Title (15px, semibold) ▾]   [Search] [Bell] [⋯]
                      [Sublabel (12px, muted)]
```

Details:
- Container: `min-h-14 px-3 py-2.5 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80` plus a 1px `shadow-[0_1px_0_hsl(var(--border))]` for subtle elevation.
- Avatar: `h-9 w-9` with `ring-1 ring-border/60` for soft elevation; uses `ConversationAvatar` so DM/team/club/group/broadcast all share the same renderer.
- Title block is a single `<button>` with `flex-1 min-w-0 active:opacity-70 transition-opacity`, opens `ChatDetailsSheet`. Subtle `ChevronRight` (3.5px) shown after title only on touch devices for affordance.
- Title: `text-[15px] font-semibold tracking-tight truncate`. Subtitle: `text-[12px] text-muted-foreground truncate mt-0.5`.
- Action cluster: `gap-1.5`, all buttons `h-9 w-9`, `[&_svg]:size-[18px]`, with `active:scale-95 transition-transform` for press feedback.
- 3-dot menu: keep for group edit/delete only. Where its only entry would be "Refresh", drop it (pull-to-refresh already wired) — frees a slot and reduces clutter as requested.

**Per-page integration**

Replace the inline header markup in:
- `TeamChatPage.tsx` → `<ChatHeaderShell type="team" name={team.name} sublabel={team.clubs?.name} avatarUrl={team.logo_url ?? team.clubs?.logo_url} onOpenDetails={...}>`
- `ClubChatPage.tsx` → `type="club"`, sublabel = "Club chat".
- `GroupChatPage.tsx` → `type="group"`, sublabel = group context (team/club/league name) or member count.
- `DirectMessagePage.tsx` → `type="dm"` for normal users, `type="support"` for Ignite Support; sublabel hidden.
- `BroadcastChatPage.tsx` → `type="broadcast"`, name = "Announcements", sublabel = "Official updates & news".

`ChatHeaderShell` accepts a `rightSlot` so existing `ChatMuteButton`, `ChatHeaderMenu`, search button keep working without duplicating logic.

### Files

**Create**
- `src/components/chat/ChatHeaderShell.tsx`
- `src/components/chat/ChatDetailsSheet.tsx`
- `src/components/chat/ChatMediaViewer.tsx`
- `src/components/chat/ChatParticipantsList.tsx`
- `src/hooks/useChatSharedMedia.ts`

**Edit**
- `src/pages/TeamChatPage.tsx`
- `src/pages/ClubChatPage.tsx`
- `src/pages/GroupChatPage.tsx`
- `src/pages/DirectMessagePage.tsx`
- `src/pages/BroadcastChatPage.tsx`
- `src/components/chat/ChatMembersSheet.tsx` (extract list body, keep wrapper)
- `src/components/chat/ChatHeaderMenu.tsx` (hide refresh-only menu when no other actions, since pull-to-refresh covers it)

### Out of scope (explicit)
- No changes to bottom navigation, the Media tab, or any gallery/photos code.
- No removal of existing functionality — bell timed-mute, search, group edit/delete all preserved.
- No backend/database changes; all queries use existing tables and RLS.

### Success checks
- Tapping the header from each of the 5 thread types opens the same `ChatDetailsSheet` shape.
- Shared media reflects only that thread's `image_url`s and opens in `ChatMediaViewer` → `FullscreenImageViewer`.
- Notifications toggle inside the panel stays in sync with the header bell button (same query key invalidation).
- Header renders consistently across thread types with the new typography, spacing, avatar ring, and press feedback.
