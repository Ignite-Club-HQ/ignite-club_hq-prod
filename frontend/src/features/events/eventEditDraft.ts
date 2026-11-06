/**
 * Unsaved edit-event form data kept on this device so a legitimate
 * session-expiry → sign-in round trip (which leaves and re-enters the page)
 * does not lose the member's changes.
 *
 * Stored in sessionStorage under the `ignite_` prefix, so explicit sign-out
 * and cross-account sign-in sweep it (clearUserScopedCaches). Keys are scoped
 * to the signed-in account and the event, and a draft is only ever offered
 * back to the same account for the same event.
 */
export const EVENT_EDIT_DRAFT_PREFIX = "ignite_event_edit_draft:";
export const EVENT_EDIT_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type EventEditDraft<T = Record<string, unknown>> = {
  v: 1;
  accountId: string;
  eventId: string;
  savedAt: number;
  form: T;
};

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function eventEditDraftKey(accountId: string, eventId: string): string {
  return `${EVENT_EDIT_DRAFT_PREFIX}${accountId}:${eventId}`;
}

export function saveEventEditDraft<T>(accountId: string, eventId: string, form: T, now = Date.now()): void {
  const s = storage();
  if (!s || !accountId || !eventId) return;
  const draft: EventEditDraft<T> = { v: 1, accountId, eventId, savedAt: now, form };
  try { s.setItem(eventEditDraftKey(accountId, eventId), JSON.stringify(draft)); } catch { /* quota */ }
}

export function loadEventEditDraft<T>(accountId: string, eventId: string, now = Date.now()): T | null {
  const s = storage();
  if (!s || !accountId || !eventId) return null;
  const key = eventEditDraftKey(accountId, eventId);
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as EventEditDraft<T>;
    if (draft?.v !== 1 || draft.accountId !== accountId || draft.eventId !== eventId || now - draft.savedAt > EVENT_EDIT_DRAFT_MAX_AGE_MS) {
      s.removeItem(key);
      return null;
    }
    return draft.form;
  } catch {
    try { s.removeItem(key); } catch { /* ignore */ }
    return null;
  }
}

export function clearEventEditDraft(accountId: string, eventId: string): void {
  const s = storage();
  if (!s || !accountId || !eventId) return;
  try { s.removeItem(eventEditDraftKey(accountId, eventId)); } catch { /* ignore */ }
}
