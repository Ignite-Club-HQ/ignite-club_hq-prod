import { useState, useCallback, useEffect } from "react";

const DRAFT_PREFIX = "chat_draft_";

/**
 * Like useState("") but persists the value to sessionStorage
 * so navigating away and back preserves the draft.
 */
export function useChatDraft(chatId: string | undefined): [string, (value: string) => void, () => void] {
  const key = chatId ? `${DRAFT_PREFIX}${chatId}` : "";

  const [message, setMessageState] = useState(() => {
    if (!key) return "";
    try {
      return sessionStorage.getItem(key) || "";
    } catch {
      return "";
    }
  });

  // When chatId changes, load the draft for the new chat
  useEffect(() => {
    if (!key) return;
    try {
      setMessageState(sessionStorage.getItem(key) || "");
    } catch {
      setMessageState("");
    }
  }, [key]);

  const setMessage = useCallback(
    (value: string) => {
      setMessageState(value);
      if (!key) return;
      try {
        if (value) {
          sessionStorage.setItem(key, value);
        } else {
          sessionStorage.removeItem(key);
        }
      } catch {
        // Storage full or unavailable — ignore
      }
    },
    [key]
  );

  // Clear draft (call after successful send)
  const clearDraft = useCallback(() => {
    setMessageState("");
    if (!key) return;
    try {
      sessionStorage.removeItem(key);
    } catch {}
  }, [key]);

  return [message, setMessage, clearDraft];
}
