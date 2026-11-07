import type { QueryClient } from "@tanstack/react-query";
import { clearAllMessageCaches } from "./messageCache";
import { retirePrivateProfileSession } from "@/live/privateProfileSession";
import { navigateApp } from "./appNavigator";

const CHAT_KEYS = /^(team|club|group|dm)-messages$/;
const owners = new WeakMap<QueryClient, string | null>();
/** Existing query keys remain interoperable with realtime; the entire client
 * partition is synchronously retired before another account can render it. */
export function bindChatCacheAccount(client: QueryClient, account: string | null): void {
  if (owners.has(client) && owners.get(client) !== account) {
    retirePrivateProfileSession();
    void client.cancelQueries();
    client.clear();
    clearAllMessageCaches();
  }
  if (!owners.has(client) && account === null) {
    for (const query of client.getQueryCache().getAll()) {
      if (CHAT_KEYS.test(String(query.queryKey[0]))) client.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }
  owners.set(client, account);
}

export function isChatAccessDenial(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /(?:Conversation|Club chat|chat|membership) access forbidden|Account removal fenced|Club chat authorization changed/i.test(text);
}

/** Only an authoritative refusal retires disclosure, never a network timeout. */
export function installChatCachePrivacy(client: QueryClient): () => void {
  let clearing = false;
  return client.getQueryCache().subscribe(event => {
    const query = event.query;
    if (clearing || !CHAT_KEYS.test(String(query.queryKey[0])) || !isChatAccessDenial(query.state.error)) return;
    clearing = true;
    try {
      retirePrivateProfileSession();
      clearAllMessageCaches();
      void client.cancelQueries({ queryKey: query.queryKey, exact: true });
      client.removeQueries({ queryKey: query.queryKey, exact: true });
      navigateApp("/messages", { replace: true });
    } finally { clearing = false; }
  });
}