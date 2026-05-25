// Centralised purge of every per-user cache that lives outside React Query.
//
// Why this exists:
//   React Query's queryClient.clear() is called on SIGNED_OUT and on a
//   cross-user SIGNED_IN, but several modules maintain their own caches
//   (in-memory + localStorage) keyed only by team / club / thread — NOT by
//   user. On a shared device, those caches survived logout and the new user
//   was served the previous user's data on first paint (e.g. reviewer seeing
//   Bridgewater gallery photos cached by another account).
//
// This helper wipes:
//   * All `ignite_*` localStorage entries (covers mediaCache, profileCache,
//     rolesCache, clubTeamCache, messageCache, messagesPageCache,
//     rosterCache, scheduleCache, myTeamsCarouselCache and any future
//     namespaced caches that follow the same convention).
//   * The in-memory mirrors exposed by modules that maintain them, so the
//     next render sees an empty cache rather than the stale Map values.

import { clearMediaCache } from "./mediaCache";
import { clearProfileCache } from "./profileCache";
import { clearRolesCache } from "./rolesCache";
import { clearClubTeamCache } from "./clubTeamCache";
import { clearMessagesPageCache } from "./messagesPageCache";

const IGNITE_PREFIX = "ignite_";

// Auth / session / device-identity keys that MUST survive a user switch.
// Anything else under the `ignite_` prefix is treated as user-scoped data.
const PRESERVE_KEYS = new Set<string>([
  // add explicit allow-list entries here if a future cache legitimately
  // needs to outlive a user switch (e.g. an install-id).
]);

export function clearUserScopedCaches(): void {
  // 1. In-memory mirrors held by individual cache modules.
  try { clearMediaCache(); } catch { /* noop */ }
  try { clearProfileCache(); } catch { /* noop */ }
  try { clearRolesCache(); } catch { /* noop */ }
  try { clearClubTeamCache(); } catch { /* noop */ }
  try { clearMessagesPageCache(); } catch { /* noop */ }

  // 2. Sweep all namespaced localStorage entries.
  try {
    if (typeof localStorage === "undefined") return;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith(IGNITE_PREFIX)) continue;
      if (PRESERVE_KEYS.has(key)) continue;
      toRemove.push(key);
    }
    for (const key of toRemove) {
      try { localStorage.removeItem(key); } catch { /* noop */ }
    }
  } catch {
    /* localStorage unavailable (Safari private mode etc.) — nothing to do */
  }
}
