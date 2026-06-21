// Lightweight offline cache for events lists and event details.
// Stores per user/filter combo so each user sees their own scoped data when offline.
//
// All keys are user-id namespaced so a shared device can never serve one user's
// cached events to another, even if `clearUserScopedCaches()` hasn't run yet
// (e.g. brief window before SIGNED_OUT fires).

const EVENTS_LIST_PREFIX = "ignite_events_list_";
const EVENT_DETAIL_PREFIX = "ignite_event_detail_";
const EVENT_RSVPS_PREFIX = "ignite_event_rsvps_";
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

interface Entry<T> {
  data: T;
  timestamp: number;
}

function safeGet<T>(key: string): T | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: Entry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > EXPIRY_MS) {
      try { localStorage.removeItem(key); } catch {}
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function safeSet<T>(key: string, data: T): void {
  try {
    if (typeof localStorage === "undefined") return;
    const entry: Entry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // quota or unavailable - ignore
  }
}

function userScope(userId: string | undefined | null): string {
  return userId && userId.length > 0 ? userId : "anon";
}

// ---- Events list ----
// scopeKey already encodes filter/team/club; we additionally namespace by
// userId so cross-user reads on a shared device are impossible.
export function getCachedEventsList(scopeKey: string, userId?: string | null): unknown[] | null {
  return safeGet<unknown[]>(`${EVENTS_LIST_PREFIX}${userScope(userId)}_${scopeKey}`);
}

export function cacheEventsList(scopeKey: string, events: unknown[], userId?: string | null): void {
  // Cap at 100 events to stay light
  safeSet(`${EVENTS_LIST_PREFIX}${userScope(userId)}_${scopeKey}`, events.slice(0, 100));
}

// ---- Event detail ----
export function getCachedEventDetail(eventId: string, userId?: string | null): unknown | null {
  return safeGet<unknown>(`${EVENT_DETAIL_PREFIX}${userScope(userId)}_${eventId}`);
}

export function cacheEventDetail(eventId: string, event: unknown, userId?: string | null): void {
  safeSet(`${EVENT_DETAIL_PREFIX}${userScope(userId)}_${eventId}`, event);
}

// ---- Event RSVPs ----
export function getCachedEventRsvps(eventId: string, userId?: string | null): unknown[] | null {
  return safeGet<unknown[]>(`${EVENT_RSVPS_PREFIX}${userScope(userId)}_${eventId}`);
}

export function cacheEventRsvps(eventId: string, rsvps: unknown[], userId?: string | null): void {
  safeSet(`${EVENT_RSVPS_PREFIX}${userScope(userId)}_${eventId}`, rsvps);
}
