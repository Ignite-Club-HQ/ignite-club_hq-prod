import type { QueryClient } from "@tanstack/react-query";
import { mediaKeys } from "./mediaQueryKeys";

export interface PhotoReaction {
  photo_id: string;
  user_id: string;
  reaction_type: string;
  profiles?: { display_name: string | null; avatar_url: string | null } | null;
}

export const reactionKey = mediaKeys.reactionsForPhotos;

type Pending = { photoId: string; userId: string; reaction: PhotoReaction | null };
const pendingByClient = new WeakMap<QueryClient, Map<string, Pending>>();
function pendingFor(client: QueryClient) {
  let pending = pendingByClient.get(client);
  if (!pending) { pending = new Map(); pendingByClient.set(client, pending); }
  return pending;
}
const tokenFor = (userId: string, photoId: string) => JSON.stringify([userId, photoId]);

export function replaceOwnReaction(rows: PhotoReaction[], change: Pending): PhotoReaction[] {
  const others = rows.filter(r => r.photo_id !== change.photoId || r.user_id !== change.userId);
  return change.reaction ? [...others, change.reaction] : others;
}

export function overlayPending(client: QueryClient, userId: string, ids: readonly string[], rows: PhotoReaction[]) {
  return [...pendingFor(client).values()].reduce((result, change) =>
    change.userId === userId && ids.includes(change.photoId) ? replaceOwnReaction(result, change) : result, rows);
}

export function cachedReactions(client: QueryClient, userId: string | undefined, ids: readonly string[]) {
  if (!userId) return undefined;
  const entries = client.getQueriesData<PhotoReaction[]>({ queryKey: ["photo-reactions", userId] });
  const successful = entries.filter(([key, rows]) => rows !== undefined && Array.isArray(key[2]));
  if (!successful.length) return undefined;
  const rows = new Map<string, PhotoReaction>();
  successful.sort(([a], [b]) => (client.getQueryState(a)?.dataUpdatedAt ?? 0) - (client.getQueryState(b)?.dataUpdatedAt ?? 0));
  for (const [key, reactions] of successful) {
    const scope = key[2] as string[];
    // A newer successful empty list is authoritative too; older lists must
    // not resurrect removed reactions when expanding the loaded photo set.
    for (const [token, row] of rows) if (scope.includes(row.photo_id)) rows.delete(token);
    for (const row of reactions ?? []) {
      if (ids.includes(row.photo_id)) rows.set(tokenFor(row.user_id, row.photo_id), row);
    }
  }
  return overlayPending(client, userId, ids, [...rows.values()]);
}

function updateLists(client: QueryClient, change: Pending) {
  for (const [key] of client.getQueriesData({ queryKey: ["photo-reactions", change.userId] })) {
    if (!Array.isArray(key[2]) || !key[2].includes(change.photoId)) continue;
    client.setQueryData<PhotoReaction[]>(key, old => replaceOwnReaction(old ?? [], change));
  }
}

export async function beginReaction(client: QueryClient, key: ReturnType<typeof reactionKey>, change: Pending) {
  const token = tokenFor(change.userId, change.photoId);
  if (pendingFor(client).has(token)) throw new Error("Reaction is still saving");
  pendingFor(client).set(token, change);
  await client.cancelQueries({ queryKey: ["photo-reactions", change.userId] });
  const previous = cachedReactionsWithoutPending(client, key, change);
  if (client.getQueryData(key) === undefined) client.setQueryData(key, []);
  updateLists(client, change);
  return { change, previous, token };
}

function cachedReactionsWithoutPending(client: QueryClient, key: ReturnType<typeof reactionKey>, change: Pending) {
  const exact = client.getQueryData<PhotoReaction[]>(key);
  const lists = exact !== undefined ? [exact] : client.getQueriesData<PhotoReaction[]>({ queryKey: ["photo-reactions", change.userId] }).map(([, rows]) => rows ?? []);
  return lists.flat().find(r => r.photo_id === change.photoId && r.user_id === change.userId) ?? null;
}

export function finishReaction(client: QueryClient, context: Awaited<ReturnType<typeof beginReaction>>, failed: boolean) {
  updateLists(client, { ...context.change, reaction: failed ? context.previous : context.change.reaction });
  pendingFor(client).delete(context.token);
}

export function albumReactionPhoto<T extends { id: string; _albumPhotos?: T[] }>(photo: T, index: number = 0): T {
  return photo._albumPhotos?.[index] ?? photo._albumPhotos?.[0] ?? photo;
}