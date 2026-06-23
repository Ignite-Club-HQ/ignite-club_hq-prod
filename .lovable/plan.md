## Goal

Free clubs should be able to *use* photos, file sharing, polls, and event-sharing — but bump into clearly-shown caps. Pro removes the caps. Vault, on-demand RSVP reminders, and advanced broadcasts stay Pro-only.

## Limits (per club, Free tier)

| Feature        | Limit                          | Reset                          |
| -------------- | ------------------------------ | ------------------------------ |
| Photo uploads  | 20/cycle                       | 30-day cycle anchored to `clubs.created_at` |
| Media storage  | 500 MB total (photos)          | Cumulative                     |
| File uploads   | 10 files total                 | Cumulative                     |
| File storage   | 100 MB total                   | Cumulative                     |
| Polls          | 2/cycle                        | 30-day cycle anchored to `clubs.created_at` |
| Event sharing  | unlimited (no gate)            | —                              |

Existing rows above caps are grandfathered read-only: clubs already over a limit see their content but cannot add new content until under cap or upgraded.

## Database

One SQL function to centralize quota math, used by client + edge functions:

```sql
public.get_club_free_usage(club_id uuid)
  returns table(
    cycle_start timestamptz, cycle_end timestamptz,
    photo_uploads_this_cycle int, photo_storage_bytes bigint,
    file_count int, file_storage_bytes bigint,
    polls_this_cycle int,
    is_pro boolean
  )
```

- Cycle math: `cycle_start = clubs.created_at + floor(extract(epoch from now()-created_at)/(30*86400))*'30 days'`.
- `photo_uploads_this_cycle` = `count(*) from photos where club_id=$ and created_at>=cycle_start`.
- `photo_storage_bytes` = `sum(file_size) from photos where club_id=$`.
- File count/storage: `vault_files where club_id=$ and (uploader's chat-attachment files — i.e. not gated by Pro vault feature)`. Need to confirm exact scope during implementation; if vault is the only file store, we count non-vault-folder files (chat attachments folder).
- `polls_this_cycle`: `count(*) from polls where club_id=$ and created_at>=cycle_start`.
- `is_pro`: existing logic (`is_pro OR is_pro_football OR admin overrides`, not expired).

Optional `pre-insert` trigger on `photos`/`polls` for hard server-side enforcement (denies insert when free + over cap). Client checks are advisory; trigger is the source of truth.

## Frontend

### New hook `useClubFreeUsage(clubId)`
Wraps `get_club_free_usage` via RPC, 60s stale. Returns `{ isPro, photo: {used, limit, storageUsed, storageLimit, atCap, storageAtCap}, file: {...}, poll: {used, limit, atCap}, cycleEnd }`.

### `<UsageMeter />` component
Compact progress bar + "X / Y used" label + small "Upgrade" link when atCap. Used inline on Media page header, Vault Files tab, and CreatePollDialog.

### MediaPage (`src/pages/MediaPage.tsx`)
- Remove `!hasProAccess` lock screen (the "Photos is a Pro Feature" block ~L1875).
- Always render the gallery for any role-having user.
- Show `<UsageMeter />` for the active club when Free.
- Disable upload FAB when `photo.atCap || photo.storageAtCap`; tap shows upgrade sheet with benefit copy.

### UploadPhotoSheet (`src/components/UploadPhotoSheet.tsx`)
- Strip the `has_pro_access` filter that hides Free clubs from the destination picker (lines ~189–300).
- Before each upload, re-check `useClubFreeUsage(selectedClubId)` — if would exceed cap, block with upgrade dialog.
- Track per-file size; reject batch when cumulative would push `storage_used_bytes + sum > 500MB`.

### Polls (`src/components/chat/CreatePollDialog.tsx` + chat composer)
- Remove Pro gate from Poll attach action in `ChatImageInput.tsx`.
- On dialog open, show "X of 2 free polls used this cycle". When atCap, replace form with upgrade CTA.

### Files
- Allow Free clubs into the file-upload UI in `ChatImageInput.tsx` (the "Attach file" item — currently `locked: !hasProAccess`).
- Gate at upload-time with usage check, not at menu level.
- Vault page: keep the Pro lock on the **Vault folder structure** feature (folders, drive sync) — that's the "Vault Pro feature". But the basic chat-attached file store remains accessible to Free under the 10/100MB cap. (If implementation shows files only live in vault_files, we'll need a `kind`/`source` discriminator already present — to check during build.)

### Event sharing
- `EventDetailPage.tsx`: remove `canShareEvent` Pro check (L607-613). Share is always allowed.
- `ChatImageInput.tsx`: remove `locked: !hasProAccess` on the "Share Event" action (L909-913).

### Keep Pro-only (no change)
- Vault folders/drive-sync UI in `VaultPage.tsx`
- Schedule message Pro check in `ScheduledMessagesPage.tsx`
- Broadcast composer (broadcast_messages / club_messages)
- On-demand RSVP reminders (`useScheduleProAccess` for the send-reminder action stays)

### Composer image attach
- `ChatImageInput.tsx` image attach (Camera / Camera roll) currently Pro-gated via `useScheduleProAccess`. Per spec, photos are now Free with caps — unlock these too, gate at upload time against the photo cap.

## Upgrade messaging

New helper `getUpgradeMessage(feature, club)` returns benefit-led copy:

- Photos cap: "You've used your 20 free photo uploads this cycle. Upgrade to Pro for unlimited uploads and storage."
- Photos storage: "Your club has used its 500 MB free photo storage. Upgrade to Pro for unlimited media storage."
- Files: "Store up to 10 files on Free. Upgrade to Pro for unlimited club document storage."
- Files storage: "Your club has used its 100 MB free file storage. Upgrade to Pro for unlimited document storage."
- Polls: "You've used your 2 free polls this cycle. Upgrade to Pro for unlimited polls."

Replace the existing generic "This is a Pro feature" toasts at the relevant call sites only.

## Out of scope

- Repricing or plan-tier changes
- Pro Football specific gates (unchanged)
- Migrating already-uploaded photos out for over-cap clubs (grandfathered read-only)
- Email/push notification of cap reached (future)

## Rollout

1. Migration: `get_club_free_usage` RPC + optional enforcement triggers.
2. Hook + UsageMeter component.
3. MediaPage + UploadPhotoSheet unlock + cap UI.
4. CreatePollDialog + composer poll unlock + cap UI.
5. File upload unlock + cap UI in ChatImageInput.
6. EventDetail + composer event-share unlock.
7. Verify Vault / Scheduled messages / Broadcasts remain gated.

Shipping in that order keeps each step independently revertable.