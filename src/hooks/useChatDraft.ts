import { useState, useCallback, useEffect } from "react";

const DRAFT_PREFIX = "chat_draft_";
const DRAFT_CHANGED_EVENT = "chat-draft-changed";

export interface ChatDraft {
  text: string;
  updatedAt: string;
}

function readDraft(key: string): ChatDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    // Backwards-compat: previously stored as plain text
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.text === "string") {
        return { text: parsed.text, updatedAt: parsed.updatedAt || new Date().toISOString() };
      }
    }
    return { text: raw, updatedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

function writeDraft(key: string, text: string) {
  try {
    if (text) {
      const payload: ChatDraft = { text, updatedAt: new Date().toISOString() };
      sessionStorage.setItem(key, JSON.stringify(payload));
    } else {
      sessionStorage.removeItem(key);
    }
    window.dispatchEvent(new CustomEvent(DRAFT_CHANGED_EVENT));
  } catch {
    // Storage full or unavailable — ignore
  }
}

/**
 * Like useState("") but persists the value to sessionStorage
 * so navigating away and back preserves the draft.
 */
export function useChatDraft(
  chatId: string | undefined,
): [string, (value: string | ((prev: string) => string)) => void, () => void] {
  const key = chatId ? `${DRAFT_PREFIX}${chatId}` : "";

  const [message, setMessageState] = useState(() => {
    if (!key) return "";
    return readDraft(key)?.text || "";
  });

  // When chatId changes, load the draft for the new chat
  useEffect(() => {
    if (!key) {
      setMessageState("");
      return;
    }
    setMessageState(readDraft(key)?.text || "");
  }, [key]);

  const setMessage = useCallback(
    (value: string | ((prev: string) => string)) => {
      setMessageState((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        if (key) writeDraft(key, next);
        return next;
      });
    },
    [key]
  );

  const clearDraft = useCallback(() => {
    setMessageState("");
    if (!key) return;
    writeDraft(key, "");
  }, [key]);

  return [message, setMessage, clearDraft];
}

/**
 * Return a snapshot of all chat drafts keyed by their chat id.
 */
export function getAllChatDrafts(): Record<string, ChatDraft> {
  const out: Record<string, ChatDraft> = {};
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      const id = k.slice(DRAFT_PREFIX.length);
      const draft = readDraft(k);
      if (draft && draft.text.trim()) out[id] = draft;
    }
  } catch {
    // ignore
  }
  return out;
}

/**
 * Subscribe to all chat drafts. Re-renders whenever any draft changes
 * (via setMessage/clearDraft) or another tab updates sessionStorage.
 */
export function useAllChatDrafts(): Record<string, ChatDraft> {
  const [drafts, setDrafts] = useState<Record<string, ChatDraft>>(() => getAllChatDrafts());

  useEffect(() => {
    const refresh = () => setDrafts(getAllChatDrafts());
    window.addEventListener(DRAFT_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener(DRAFT_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return drafts;
}
