---
name: Jump Cold-Start Replica Race
description: refetchLatest callback in jumpToMessageInVirtualizedChat re-invalidates head query at attempts 4/16/40 so push-notification jumps to the newest message survive read-replica lag
type: feature
---
Cold-start push for the newest message can miss the row because the initial messages fetch hits a read-replica that hasn't replicated the just-inserted row. `tryLoadOlder` cannot help (target isn't older). `jumpToMessageInVirtualizedChat` takes an optional `refetchLatest` callback that fires on attempts 4, 16, 40 when `idx < 0`, throttled by `lastRefetchLatestAttempt` (>=12 apart). Wired in all 6 chat pages (Team/Group/Club/DM/Broadcast/ClubAdmin) on the push-entry `useEffect` only; reply/pin handlers do not need it (chat is already warm).
