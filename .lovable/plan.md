# RSVP comments (Heja-style)

## What exists today
- `rsvps.notes` already exists in the database and is shown under a person's name in attendance lists.
- On the event page there is a "Note to organiser" textarea, but it only saves as a side-effect of tapping a status button. If you type a note *after* answering, nothing is saved — it looks like it worked but doesn't.
- Children have no note field at all, and the quick RSVP buttons in chat/DMs have no way to add a reason.

## What we'll build
1. **A single RSVP sheet with a comment box**
   - Tapping Going / Maybe / Can't opens a compact bottom sheet: the chosen status at the top, a comment box ("Add a reason or note — optional"), and Save.
   - Save writes status + comment together. Quick answer stays fast: Save is enabled immediately, comment is optional.
   - Re-tapping the current status opens the same sheet so a member can add or edit a comment without changing their answer.

2. **Comments for children**
   - Same sheet for each child row, so a parent can explain per child ("Ella is away at a wedding").

3. **Comments from chat / DM quick RSVP**
   - After the one-tap answer in chat, show a small "Add a note" link that opens the same sheet, so nobody has to open the event just to explain.

4. **Where comments show**
   - Attendance rows keep showing the comment under the name (already supported), with a small comment icon so it reads as a member's note.
   - Admin RSVP changes made on someone's behalf keep the existing "set by admin" behaviour and can optionally carry an admin note.
   - Comments included in the event's attendance CSV/report export.

5. **Notifications**
   - When a member answers with a comment, the existing admin RSVP notification includes the comment text (truncated), so organisers see the reason without opening the event.

## Rules
- Comment length capped (500 chars) with a live counter near the limit.
- Comments are optional everywhere; never block an RSVP.
- Clearing the box removes the comment.
- Offline: queued RSVPs carry the comment and sync with it (the offline queue already has a notes field).

## Technical notes
- No schema change needed for members: reuse `rsvps.notes`.
- New shared `RsvpCommentSheet` component; `EventDetailPage` self + child RSVP mutations, `InlineRsvpActions`, and `AdminRsvpChanger` all route through it.
- Child mutation (`childRsvpMutation`) and `admin_upsert_rsvp` / `admin_update_rsvp_status` calls extended to pass notes.
- Remove the standalone "Note to organiser" card once the sheet is in, so there is one place to write a comment.
- Guard test: a status change that includes a comment persists both in one write; a comment-only edit does not change status.
