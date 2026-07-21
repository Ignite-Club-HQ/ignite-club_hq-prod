import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, selectProfiles, tableResults, queries } = vi.hoisted(() => ({
  from: vi.fn(),
  selectProfiles: vi.fn(),
  tableResults: new Map<string, { data: any; error: any }>(),
  queries: [] as Array<{ table: string; chain: any }>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfilesByIds: selectProfiles }));

import { useChatSharedMedia, type ChatSharedMediaType } from "./useChatSharedMedia";

function tableQuery(table: string) {
  const result = tableResults.get(table) ?? { data: [], error: null };
  const chain: any = {};
  for (const method of ["select", "is", "order", "limit", "eq", "in"]) {
    chain[method] = vi.fn(() => chain);
  }
  Object.defineProperty(chain, "then", {
    value: (resolve: any) => Promise.resolve(result).then(resolve),
  });
  queries.push({ table, chain });
  return chain;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

const row = (overrides: Record<string, any> = {}) => ({
  id: "message-1",
  image_url: null,
  text: null,
  created_at: "2026-07-20T12:00:00.000Z",
  author_id: "author-1",
  ...overrides,
});

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const FOLDER_ID = "22222222-2222-4222-8222-222222222222";
const ROOT_ID = "33333333-3333-4333-8333-333333333333";

describe("useChatSharedMedia scope and parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResults.clear();
    queries.length = 0;
    from.mockImplementation(tableQuery);
    selectProfiles.mockResolvedValue({ data: [] });
  });

  it.each([undefined, ""])("does not query with chat identity %s", chatId => {
    const { result } = renderHook(() => useChatSharedMedia("team", chatId), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(from).not.toHaveBeenCalled();
  });

  it("honours an explicit disabled option", () => {
    renderHook(() => useChatSharedMedia("team", "team-1", { enabled: false }), { wrapper });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["team", "team_messages", "team_id"],
    ["club", "club_messages", "club_id"],
    ["group", "group_messages", "group_id"],
    ["dm", "direct_messages", "conversation_id"],
  ] as const)("scopes %s media to the requested chat", async (chatType, table, column) => {
    const { result } = renderHook(() => useChatSharedMedia(chatType, "scope-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queries.find(q => q.table === table)!.chain;
    expect(query.eq).toHaveBeenCalledWith(column, "scope-1");
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("uses the broadcast feed without inventing a per-chat database filter", async () => {
    const { result } = renderHook(() => useChatSharedMedia("broadcast", "broadcast"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queries.find(q => q.table === "broadcast_messages")!.chain;
    expect(query.eq).not.toHaveBeenCalled();
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("loads enough messages for derived items while keeping a bounded query", async () => {
    const first = renderHook(() => useChatSharedMedia("team", "team-1", { limit: 12 }), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(queries[0].chain.limit).toHaveBeenCalledWith(60);
    first.unmount();

    const second = renderHook(() => useChatSharedMedia("club", "club-1", { limit: 30 }), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(queries.find(q => q.table === "club_messages")!.chain.limit).toHaveBeenCalledWith(90);
  });

  it("returns no media when the scoped message lookup fails", async () => {
    tableResults.set("team_messages", { data: null, error: { message: "RLS denied" } });
    const { result } = renderHook(() => useChatSharedMedia("team", "team-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(selectProfiles).not.toHaveBeenCalled();
  });

  it("adds profile metadata after deduplicating author lookups", async () => {
    tableResults.set("team_messages", { data: [
      row({ id: "message-1", image_url: "https://cdn.test/one.jpg" }),
      row({ id: "message-2", image_url: "https://cdn.test/two.jpg" }),
    ], error: null });
    selectProfiles.mockResolvedValue({ data: [{
      id: "author-1", display_name: "Alex Morgan", avatar_url: "https://cdn.test/avatar.jpg",
    }] });
    const { result } = renderHook(() => useChatSharedMedia("team", "team-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(selectProfiles).toHaveBeenCalledWith(["author-1"]);
    expect(result.current.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ author_name: "Alex Morgan", author_avatar: "https://cdn.test/avatar.jpg" }),
    ]));
  });

  it("derives photo, vault file, folder, root and external-link items from a message", async () => {
    tableResults.set("team_messages", { data: [row({
      image_url: "https://cdn.test/photo.jpg",
      text: `[vault:${FILE_ID}] [vaultfolder:${FOLDER_ID}] [vaultroot:team:${ROOT_ID}] https://www.example.com/rules.pdf.`,
    })], error: null });
    tableResults.set("vault_files", { data: [{ id: FILE_ID, name: "Team sheet.pdf", file_type: "application/pdf" }], error: null });
    tableResults.set("vault_folders", { data: [{ id: FOLDER_ID, name: "Match documents" }], error: null });
    const { result } = renderHook(() => useChatSharedMedia("team", "team-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBe(5));

    expect(result.current.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "photo", image_url: "https://cdn.test/photo.jpg" }),
      expect.objectContaining({ kind: "file", vaultFileId: FILE_ID, label: "Team sheet.pdf" }),
      expect.objectContaining({ kind: "file", vaultFolderId: FOLDER_ID, label: "Match documents" }),
      expect.objectContaining({ kind: "file", vaultRootScope: "team", vaultRootId: ROOT_ID }),
      expect.objectContaining({ kind: "link", url: "https://www.example.com/rules.pdf", sublabel: "example.com" }),
    ]));
  });

  it("deduplicates repeated file, folder and URL references within one message", async () => {
    tableResults.set("team_messages", { data: [row({
      text: `[vault:${FILE_ID}] [vault:${FILE_ID}] [vaultfolder:${FOLDER_ID}] [vaultfolder:${FOLDER_ID}] https://example.com/a https://example.com/a`,
    })], error: null });
    const { result } = renderHook(() => useChatSharedMedia("team", "team-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.filter(item => item.vaultFileId === FILE_ID)).toHaveLength(1);
    expect(result.current.data?.filter(item => item.vaultFolderId === FOLDER_ID)).toHaveLength(1);
    expect(result.current.data?.filter(item => item.url === "https://example.com/a")).toHaveLength(1);
  });

  it("sorts all derived items newest first", async () => {
    tableResults.set("team_messages", { data: [
      row({ id: "older", created_at: "2026-07-20T10:00:00Z", image_url: "older.jpg" }),
      row({ id: "newer", created_at: "2026-07-20T12:00:00Z", image_url: "newer.jpg" }),
    ], error: null });
    const { result } = renderHook(() => useChatSharedMedia("team", "team-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.map(item => item.message_id)).toEqual(["newer", "older"]);
  });

  it("must enforce the requested result limit after deriving media items", async () => {
    tableResults.set("team_messages", { data: [row({
      image_url: "photo.jpg",
      text: "https://example.com/one https://example.com/two https://example.com/three",
    })], error: null });
    const { result } = renderHook(() => useChatSharedMedia("team", "team-1", { limit: 2 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
  });
});
