/**
 * Feature flag for the virtualised chat message list.
 *
 * On by default. Per-device override via localStorage (set "0" to opt out);
 * build-time override via `VITE_CHAT_VIRTUALIZATION=0` to force off. The
 * legacy non-virtualised list remains the safe fallback when disabled.
 */
const STORAGE_KEY = "ff:chat-virtualization";
const EVENT = "ff:chat-virtualization:changed";

export function isChatVirtualizationEnabled(): boolean {
  try {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") return true;
      if (stored === "0") return false;
    }
  } catch {
    /* ignore */
  }
  // @ts-ignore - import.meta.env at build time
  if (import.meta?.env?.VITE_CHAT_VIRTUALIZATION === "0") return false;
  return true;
}

export function setChatVirtualizationEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeChatVirtualization(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener(EVENT, listener as EventListener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, listener as EventListener);
    window.removeEventListener("storage", onStorage);
  };
}
