import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePhotoReactions } from "./usePhotoReactions";
import { albumReactionPhoto, beginReaction, cachedReactions, finishReaction, overlayPending, reactionKey, type PhotoReaction } from "./photoReactionState";

const api = vi.hoisted(() => ({ read: vi.fn(), replace: vi.fn(), remove: vi.fn() }));
vi.mock("./mediaReadRepository", () => ({ fetchMediaReactions: (...args: unknown[]) => api.read(...args) }));
vi.mock("./mediaEngagementRepository", () => ({ replaceMediaReaction: (...args: unknown[]) => api.replace(...args), removeMediaReaction: (...args: unknown[]) => api.remove(...args) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const row = (id: string, type = "like", userId = "paul"): PhotoReaction => ({ photo_id: id, user_id: userId, reaction_type: type });
const ids = Array.from({ length: 18 }, (_, i) => `photo-${i.toString().padStart(2, "0")}`);
let client: QueryClient;
let saved: PhotoReaction[];
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  saved = [row(ids[0]), row(ids[12], "thumbsup")];
  api.read.mockReset().mockImplementation(async (photos: string[]) => saved.filter(r => photos.includes(r.photo_id)));
  api.replace.mockReset().mockImplementation(async ({ photoId, userId, reactionType }) => { saved = [...saved.filter(r => r.photo_id !== photoId || r.user_id !== userId), row(photoId, reactionType, userId)]; });
  api.remove.mockReset().mockImplementation(async ({ photoId, userId }) => { saved = saved.filter(r => r.photo_id !== photoId || r.user_id !== userId); });
});
afterEach(() => { cleanup(); client.clear(); });

describe("DEV Media photo reaction state", () => {
  it("loads existing reactions for 9 then 18 photos within the same former bucket", async () => {
    const { result, rerender } = renderHook(({ photos }) => usePhotoReactions("paul", photos), { initialProps: { photos: ids.slice(0, 9) }, wrapper });
    await waitFor(() => expect(result.current.data).toEqual([row(ids[0])]));
    rerender({ photos: ids });
    await waitFor(() => expect(result.current.data).toContainEqual(row(ids[12], "thumbsup")));
    expect(api.read.mock.calls.map(c => c[0].length)).toEqual([9, 18]);
  });

  it("same-sized filters and highlighted photo inclusion get distinct deterministic keys", async () => {
    const { result, rerender } = renderHook(({ photos }) => usePhotoReactions("paul", photos), { initialProps: { photos: ids.slice(0, 9) }, wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ photos: ids.slice(9) });
    await waitFor(() => expect(result.current.data).toEqual([row(ids[12], "thumbsup")]));
    rerender({ photos: [...ids.slice(9), ids[0]] });
    await waitFor(() => expect(result.current.data).toContainEqual(row(ids[0])));
    expect(reactionKey("paul", [ids[1], ids[0], ids[1]])).toEqual(reactionKey("paul", [ids[0], ids[1]]));
  });

  it.each(["like", "thumbsup", null])("saves %s and reads it back after page return", async (type) => {
    saved = [row(ids[0], "clap")];
    const hook = renderHook(() => usePhotoReactions("paul", [ids[0]]), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    act(() => hook.result.current.react(ids[0], type));
    await waitFor(() => expect(hook.result.current.pendingPhotoId).toBeNull());
    await waitFor(() => expect(saved).toEqual(type ? [row(ids[0], type)] : []));
    hook.unmount();
    const returned = renderHook(() => usePhotoReactions("paul", [ids[0]]), { wrapper });
    await waitFor(() => expect(returned.result.current.data).toEqual(saved));
    expect(api.read.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("failed refresh retains successful rows and provides a retriable error", async () => {
    const { result } = renderHook(() => usePhotoReactions("paul", [ids[0]]), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([row(ids[0])]));
    api.read.mockRejectedValue(new Error("temporarily offline"));
    await act(async () => { await result.current.refetch(); });
    expect(result.current.isError).toBe(true);
    expect(result.current.data).toEqual([row(ids[0])]);
    api.read.mockResolvedValue([row(ids[0], "thumbsup")]);
    await act(async () => { await result.current.refetch(); });
    expect(result.current.data).toEqual([row(ids[0], "thumbsup")]);
  });

  it.each([undefined, [], [row(ids[0])]])("mutation failure restores prior state including %j", async (previous) => {
    const key = reactionKey("paul", [ids[0]]);
    if (previous !== undefined) client.setQueryData(key, previous);
    const context = await beginReaction(client, key, { photoId: ids[0], userId: "paul", reaction: row(ids[0], "fire") });
    expect(client.getQueryData(key)).toEqual([row(ids[0], "fire")]);
    finishReaction(client, context, true);
    expect(client.getQueryData(key)).toEqual(previous ?? []);
  });

  it("failed add/change/remove rolls back through the actual mutation hook", async () => {
    saved = [row(ids[0])];
    const { result } = renderHook(() => usePhotoReactions("paul", [ids[0]]), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(saved));
    api.replace.mockRejectedValue(new Error("write failed"));
    act(() => result.current.react(ids[0], "fire"));
    await waitFor(() => expect(api.replace).toHaveBeenCalled());
    await waitFor(() => expect(result.current.pendingPhotoId).toBeNull());
    expect(result.current.data).toEqual([row(ids[0])]);
    api.remove.mockRejectedValue(new Error("delete failed"));
    act(() => result.current.react(ids[0], null));
    await waitFor(() => expect(api.remove).toHaveBeenCalled());
    await waitFor(() => expect(result.current.pendingPhotoId).toBeNull());
    expect(result.current.data).toEqual([row(ids[0])]);
  });

  it("cancels pending reads and overlays new-list reads without overwriting optimistic changes", async () => {
    const key = reactionKey("paul", [ids[0]]);
    client.setQueryData(key, [row(ids[0])]);
    let release: (rows: PhotoReaction[]) => void = () => {};
    const pendingRead = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<PhotoReaction[]>(resolve => { release = resolve; }) }).catch(() => {});
    const context = await beginReaction(client, key, { photoId: ids[0], userId: "paul", reaction: row(ids[0], "fire") });
    release([row(ids[0])]);
    await pendingRead;
    expect(client.getQueryData(key)).toEqual([row(ids[0], "fire")]);
    expect(overlayPending(client, "paul", ids, [row(ids[0])])).toEqual([row(ids[0], "fire")]);
    const expanded = reactionKey("paul", ids);
    client.setQueryData(expanded, overlayPending(client, "paul", ids, [row(ids[0])]));
    finishReaction(client, context, true);
    expect(client.getQueryData(expanded)).toEqual([row(ids[0])]);
  });

  it("switching accounts cannot reuse the previous account's data or late mutation", async () => {
    const key = reactionKey("paul", [ids[0]]);
    client.setQueryData(key, [row(ids[0])]);
    expect(cachedReactions(client, "other", [ids[0]])).toBeUndefined();
    const context = await beginReaction(client, key, { photoId: ids[0], userId: "paul", reaction: row(ids[0], "fire") });
    const other = reactionKey("other", [ids[0]]);
    client.setQueryData(other, []);
    finishReaction(client, context, false);
    expect(client.getQueryData(other)).toEqual([]);
    api.read.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ account }) => usePhotoReactions(account, [ids[0]]), { initialProps: { account: "paul" }, wrapper });
    expect(result.current.data).toEqual([row(ids[0], "fire")]);
    rerender({ account: "new-account" });
    expect(result.current.data).toBeUndefined();
  });

  it("album controls target the visible member, never the cover or album id", () => {
    const first = { id: "first" }, second = { id: "second" };
    const cover = { id: "cover", _albumPhotos: [first, second] };
    expect(albumReactionPhoto(cover).id).toBe("first");
    expect(albumReactionPhoto(cover, 1).id).toBe("second");
    expect(albumReactionPhoto({ id: "standalone" }).id).toBe("standalone");
  });
});