import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; method: string; args: any[] };

const mocks = vi.hoisted(() => ({
  queries: [] as any[],
  infinite: null as any,
  mutations: [] as any[],
  calls: [] as Call[],
  tableResults: {} as Record<string, Array<{ data: any; error: any }>>,
  roles: [{ role: "club_admin", club_id: "club-1", team_id: null }] as any[],
  selectedClubId: "all",
  selectedTeamId: "all",
  cardPhotoIds: undefined as string[] | undefined,
  highlightedPhoto: null as any,
  cachedPhotos: null as any[] | null,
  cacheIsStale: false,
  pages: [{ photos: [] as any[], nextCursor: undefined as number | undefined }],
  invalidateQueries: vi.fn(),
  refetchQueries: vi.fn(),
  cancelQueries: vi.fn(),
  getQueryData: vi.fn(),
  setQueryData: vi.fn(),
  fetchNextPage: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
  channelHandlers: [] as Array<{ event: string; table: string; callback: (payload: any) => void }>,
  deleteMediaPhoto: vi.fn(),
  cachePhotos: vi.fn(),
  removePhotoFromCache: vi.fn(),
  observerDisconnect: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
      refetchQueries: mocks.refetchQueries,
      cancelQueries: mocks.cancelQueries,
      getQueryData: mocks.getQueryData,
      setQueryData: mocks.setQueryData,
    }),
    useQuery: (options: any) => {
      mocks.queries.push(options);
      const key = options.queryKey?.[0];
      const values: Record<string, any> = {
        "user-roles-media": mocks.roles,
        "has-pro-access": true,
        "user-profile-media": { display_name: "Synthetic User", avatar_url: null },
        "media-filter-clubs": [{ id: "club-1", name: "Synthetic Club" }],
        "media-filter-teams": [],
        "gallery-chat-card-photo-ids": mocks.cardPhotoIds,
        "highlighted-photo": mocks.highlightedPhoto,
        "photo-reactions": [],
        "photo-comments": [],
      };
      return {
        data: values[key], error: null, isLoading: false, isFetching: false,
        isFetched: true, refetch: vi.fn(),
      };
    },
    useInfiniteQuery: (options: any) => {
      mocks.infinite = options;
      return {
        data: { pages: mocks.pages, pageParams: [0] },
        isLoading: false, isFetching: false, isSuccess: true, isError: false,
        fetchNextPage: mocks.fetchNextPage,
        hasNextPage: false, isFetchingNextPage: false, refetch: vi.fn(),
      };
    },
    useMutation: (options: any) => {
      mocks.mutations.push(options);
      return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
    },
  };
});

function nextResult(table: string) {
  return mocks.tableResults[table]?.shift() ?? { data: [], error: null };
}

function queryFor(table: string) {
  const query: any = {};
  for (const method of ["select", "eq", "is", "in", "gte", "lte", "order", "range", "delete", "insert", "maybeSingle"]) {
    query[method] = vi.fn((...args: any[]) => {
      mocks.calls.push({ table, method, args });
      if (method === "maybeSingle") return Promise.resolve(nextResult(table));
      return query;
    });
  }
  Object.defineProperty(query, "then", { value: (ok: any, fail: any) => Promise.resolve(nextResult(table)).then(ok, fail) });
  return query;
}

function channelFor(name: string) {
  const channel: any = { name };
  channel.on = vi.fn((_type: string, filter: any, callback: (payload: any) => void) => {
    mocks.channelHandlers.push({ event: filter.event, table: filter.table, callback });
    return channel;
  });
  channel.subscribe = vi.fn(() => channel);
  return channel;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(queryFor), channel: mocks.channel, removeChannel: mocks.removeChannel,
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1", email: "synthetic@example.test" } }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/hooks/useClubTheme", () => ({ useClubTheme: () => ({ activeClubFilter: null }) }));
vi.mock("@/hooks/useClubProAccess", () => ({ useClubProAccess: () => ({ hasPro: true, isLoading: false }) }));
vi.mock("@/hooks/useClubFreeUsage", () => ({
  useClubFreeUsage: () => ({ usage: null, isLoading: false, refetch: vi.fn() }),
  readClubFreeUsageSnapshot: () => null,
  FREE_PHOTO_UPLOADS_PER_CYCLE: 10,
}));
vi.mock("@/hooks/useProfiles", () => ({ useProfiles: () => ({ getProfile: () => ({ display_name: "Synthetic User", avatar_url: null }), isLoading: false }) }));
vi.mock("@/hooks/usePhotoViews", () => ({
  usePhotoViewCounts: () => ({ data: new Map() }),
  useRecordPhotoView: () => ({ recordView: vi.fn(), observeView: vi.fn() }),
  usePhotoViewRealtime: vi.fn(),
}));
vi.mock("@/lib/persistedFilter", () => ({
  usePersistedFilter: (key: string) => [key.includes("selectedClubId") ? mocks.selectedClubId : mocks.selectedTeamId, vi.fn()],
}));
vi.mock("@/lib/ensureFreshSession", () => ({ ensureFreshSession: vi.fn(), isAuthLikeError: () => false }));
vi.mock("@/lib/supabaseAuthRetry", () => ({ abortAllInFlightRestGets: () => 0 }));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfileById: async () => ({ data: { display_name: "Synthetic User" } }) }));
vi.mock("@/lib/mediaCache", () => ({
  cachePhotos: mocks.cachePhotos,
  removePhotoFromCache: mocks.removePhotoFromCache,
  getFeedPhotosFromCache: () => ({ photos: mocks.cachedPhotos, isStale: mocks.cacheIsStale }),
  backgroundRefreshPhotos: vi.fn(),
}));
vi.mock("@/lib/mediaPhotoDeletion", () => ({ deleteMediaPhoto: mocks.deleteMediaPhoto }));
vi.mock("@/components/PhotoLightbox", () => ({ PhotoLightbox: () => null }));
vi.mock("@/components/AlbumCarousel", () => ({ AlbumCarousel: () => null }));
vi.mock("@/components/UploadPhotoSheet", () => ({ UploadPhotoSheet: () => null }));
vi.mock("@/components/MediaCommentSheet", () => ({ MediaCommentSheet: () => null }));
vi.mock("@/components/ReportPhotoDialog", () => ({ ReportPhotoDialog: () => null }));
vi.mock("@/components/BlockUserDialog", () => ({ BlockUserDialog: () => null }));
vi.mock("@/components/EmojiReactions", () => ({ EmojiReactions: () => null }));
vi.mock("@/components/LazyImage", () => ({ LazyImage: () => null }));
vi.mock("@/components/media/MediaSponsorTile", () => ({ MediaSponsorTile: () => null }));
vi.mock("@/components/media/MediaHeaderSponsorStrip", () => ({ MediaHeaderSponsorStrip: () => null }));

async function renderPage(route = "/media") {
  const { default: MediaPage } = await import("./MediaPage");
  const view = render(<MemoryRouter initialEntries={[route]}><MediaPage /></MemoryRouter>);
  await waitFor(() => expect(mocks.infinite).toBeTruthy());
  return view;
}

function mutation(index: number) {
  return mocks.mutations[index];
}

describe("MediaPage feed and mutation characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queries = [];
    mocks.infinite = null;
    mocks.mutations = [];
    mocks.calls = [];
    mocks.tableResults = {};
    mocks.roles = [{ role: "club_admin", club_id: "club-1", team_id: null }];
    mocks.selectedClubId = "all";
    mocks.selectedTeamId = "all";
    mocks.cardPhotoIds = undefined;
    mocks.highlightedPhoto = null;
    mocks.cachedPhotos = null;
    mocks.cacheIsStale = false;
    mocks.pages = [{ photos: [], nextCursor: undefined }];
    mocks.channelHandlers = [];
    mocks.channel.mockImplementation(channelFor);
    mocks.deleteMediaPhoto.mockResolvedValue(undefined);
    mocks.cancelQueries.mockResolvedValue(undefined);
    vi.stubGlobal("IntersectionObserver", class {
      observe = vi.fn();
      disconnect = mocks.observerDisconnect;
      unobserve = vi.fn();
    });
  });

  it("enforces feed visibility and deletion filters on every page and advances by the exact page size", async () => {
    await renderPage();
    mocks.tableResults.photos = [{ data: Array.from({ length: 9 }, (_, i) => ({ id: `photo-${i}` })), error: null }];
    const first = await mocks.infinite.queryFn({ pageParam: 0 });
    expect(mocks.calls).toEqual(expect.arrayContaining([
      { table: "photos", method: "eq", args: ["show_in_feed", true] },
      { table: "photos", method: "is", args: ["deleted_at", null] },
      { table: "photos", method: "range", args: [0, 8] },
    ]));
    expect(first.nextCursor).toBe(9);
    expect(mocks.cachePhotos).toHaveBeenCalledOnce();
  });

  it("propagates feed query failures instead of representing them as an empty gallery", async () => {
    await renderPage();
    const failure = { message: "RLS denied photos", code: "42501" };
    mocks.tableResults.photos = [{ data: null, error: failure }];
    await expect(mocks.infinite.queryFn({ pageParam: 0 })).rejects.toEqual(failure);
  });

  it("scopes an event deep link to the requested event", async () => {
    await renderPage("/media?event=event-1");
    mocks.tableResults.photos = [{ data: [], error: null }];
    await mocks.infinite.queryFn({ pageParam: 0 });
    expect(mocks.calls).toContainEqual({ table: "photos", method: "eq", args: ["event_id", "event-1"] });
    expect(mocks.cachePhotos).not.toHaveBeenCalled();
  });

  it("applies club and team filters together and keeps filtered pages out of the global cache", async () => {
    mocks.selectedClubId = "club-1";
    mocks.selectedTeamId = "team-1";
    await renderPage();
    mocks.tableResults.photos = [{ data: [], error: null }];
    await mocks.infinite.queryFn({ pageParam: 9 });
    expect(mocks.calls).toContainEqual({ table: "photos", method: "eq", args: ["club_id", "club-1"] });
    expect(mocks.calls).toContainEqual({ table: "photos", method: "eq", args: ["team_id", "team-1"] });
    expect(mocks.calls).toContainEqual({ table: "photos", method: "range", args: [9, 17] });
    expect(mocks.cachePhotos).not.toHaveBeenCalled();
  });

  it("restricts a gallery chat card to exactly the photo ids recorded for that batch", async () => {
    mocks.cardPhotoIds = ["photo-2", "photo-7"];
    await renderPage("/media?card=card-1");
    mocks.tableResults.photos = [{ data: [], error: null }];
    await mocks.infinite.queryFn({ pageParam: 0 });
    expect(mocks.calls).toContainEqual({ table: "photos", method: "in", args: ["id", ["photo-2", "photo-7"]] });
    expect(mocks.infinite.queryKey).toContain("card-1");
    expect(mocks.infinite.queryKey).toContain("photo-2,photo-7");
  });

  it("loads a highlighted photo independently when it is outside the current feed page", async () => {
    await renderPage("/media?photo=photo-highlighted");
    const highlightedQuery = [...mocks.queries].reverse().find((query) => query.queryKey?.[0] === "highlighted-photo");
    mocks.tableResults.photos = [{ data: { id: "photo-highlighted", show_in_feed: true }, error: null }];
    await expect(highlightedQuery.queryFn()).resolves.toEqual({ id: "photo-highlighted", show_in_feed: true });
    expect(mocks.calls).toEqual(expect.arrayContaining([
      { table: "photos", method: "eq", args: ["id", "photo-highlighted"] },
      { table: "photos", method: "eq", args: ["show_in_feed", true] },
      { table: "photos", method: "is", args: ["deleted_at", null] },
    ]));
  });

  it("invalidates the feed on Realtime inserts and removes every channel on unmount", async () => {
    const view = await renderPage();
    const feedHandler = mocks.channelHandlers.find((handler) => handler.table === "photos" && handler.event === "INSERT");
    expect(feedHandler).toBeTruthy();
    feedHandler!.callback({ new: { id: "photo-new", club_id: "club-1" } });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["photos", "user-1"] });
    const createdChannels = mocks.channel.mock.results.map((result) => result.value).filter(Boolean);
    view.unmount();
    for (const channel of createdChannels) expect(mocks.removeChannel).toHaveBeenCalledWith(channel);
    expect(mocks.observerDisconnect).toHaveBeenCalled();
  });

  it("invalidates comments and reactions only for photos loaded into this feed", async () => {
    mocks.pages = [{ photos: [{ id: "photo-loaded", uploader_id: "user-2", club_id: "club-1", created_at: "2026-07-30T00:00:00Z" }], nextCursor: undefined }];
    await renderPage();
    const commentHandler = mocks.channelHandlers.find((handler) => handler.table === "photo_comments");
    const reactionHandler = mocks.channelHandlers.find((handler) => handler.table === "photo_reactions");
    expect(commentHandler).toBeTruthy();
    expect(reactionHandler).toBeTruthy();

    commentHandler!.callback({ new: { photo_id: "photo-other" } });
    reactionHandler!.callback({ old: { photo_id: "photo-other" } });
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["photo-comments", "user-1"] });
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["photo-reactions", "user-1"] });

    commentHandler!.callback({ new: { photo_id: "photo-loaded" } });
    reactionHandler!.callback({ old: { photo_id: "photo-loaded" } });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["photo-comments", "user-1"] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["photo-reactions", "user-1"] });
  });

  it("hydrates cached photos into the same scoped Realtime lifecycle when the server has no rows", async () => {
    mocks.cachedPhotos = [{
      id: "photo-cached", file_url: "local-cache://photo", title: "Cached photo",
      caption: null, created_at: "2026-07-30T00:00:00Z", uploader_id: "user-2",
      team_id: "team-1", club_id: "club-1", folder_id: null,
    }];
    await renderPage();
    expect(mocks.channelHandlers.some((handler) => handler.table === "photo_comments")).toBe(true);
    const reactionQuery = [...mocks.queries].reverse().find((query) => query.queryKey?.[0] === "photo-reactions");
    expect(reactionQuery.enabled).toBe(true);
  });

  it("replaces a reaction using delete-then-insert with the authenticated user id", async () => {
    await renderPage();
    await mutation(0).mutationFn({ photoId: "photo-1", reactionType: "heart" });
    expect(mocks.calls.filter((call) => call.table === "photo_reactions")).toEqual([
      { table: "photo_reactions", method: "delete", args: [] },
      { table: "photo_reactions", method: "eq", args: ["photo_id", "photo-1"] },
      { table: "photo_reactions", method: "eq", args: ["user_id", "user-1"] },
      { table: "photo_reactions", method: "insert", args: [{ photo_id: "photo-1", user_id: "user-1", reaction_type: "heart" }] },
    ]);
  });

  it("creates a reply comment with the exact parent and propagates permission failures", async () => {
    await renderPage();
    await mutation(2).mutationFn({ photoId: "photo-1", text: "Great photo", replyToId: "comment-1" });
    expect(mocks.calls).toContainEqual({
      table: "photo_comments", method: "insert",
      args: [{ photo_id: "photo-1", user_id: "user-1", text: "Great photo", reply_to_id: "comment-1" }],
    });
    const failure = { message: "comment denied" };
    mocks.tableResults.photo_comments = [{ data: null, error: failure }];
    await expect(mutation(2).mutationFn({ photoId: "photo-1", text: "Denied" })).rejects.toEqual(failure);
  });

  it("maps the two deletion choices to distinct backend modes", async () => {
    await renderPage();
    await mutation(3).mutationFn({ photoId: "photo-1", deleteFromVault: false });
    await mutation(3).mutationFn({ photoId: "photo-2", deleteFromVault: true });
    expect(mocks.deleteMediaPhoto).toHaveBeenNthCalledWith(1, expect.anything(), {
      photoId: "photo-1", mode: "feed_only", callerId: "user-1",
    });
    expect(mocks.deleteMediaPhoto).toHaveBeenNthCalledWith(2, expect.anything(), {
      photoId: "photo-2", mode: "feed_and_vault", callerId: "user-1",
    });
  });

  it("rolls a failed optimistic photo deletion back without evicting its local cache", async () => {
    await renderPage();
    const previousPhotos = { pages: [{ photos: [{ id: "photo-1" }] }] };
    mocks.getQueryData.mockReturnValue(previousPhotos);
    let context: any;
    await act(async () => {
      context = await mutation(3).onMutate({ photoId: "photo-1", deleteFromVault: true });
    });
    expect(context).toEqual({ previousPhotos, photoId: "photo-1" });
    act(() => mutation(3).onError(new Error("delete denied"), { photoId: "photo-1", deleteFromVault: true }, context));
    expect(mocks.setQueryData).toHaveBeenLastCalledWith(mocks.infinite.queryKey, previousPhotos);
    expect(mocks.removePhotoFromCache).not.toHaveBeenCalled();
  });
});
