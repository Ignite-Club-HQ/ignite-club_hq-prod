import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Write = { table: string; kind: "insert" | "update" | "delete"; payload?: any; filters: Array<[string, any]> };

const mocks = vi.hoisted(() => ({
  mutations: [] as any[],
  queryOptions: [] as any[],
  queryCalls: [] as Array<{ table: string; method: string; args: any[] }>,
  writes: [] as Write[],
  results: {} as Record<string, Array<{ data: any; error: any }>>,
  isAppAdmin: false,
  roles: [] as any[],
  hasPro: false,
  clubs: [] as any[],
  activeClubFilter: null as string | null,
  invalidateQueries: vi.fn(),
  cancelQueries: vi.fn(),
  getQueryData: vi.fn(),
  setQueryData: vi.fn(),
  invoke: vi.fn(),
  upload: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  compensate: vi.fn(),
  removeCache: vi.fn(),
}));

const mutationNames = [
  "createFolder", "deleteFolder", "renameFolder", "renameFile", "renamePhoto",
  "uploadPhoto", "uploadFile", "addLink", "deletePhoto", "deleteFile",
  "restorePhoto", "restoreFile", "permanentDeletePhoto", "permanentDeleteFile", "moveFile",
];

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
      cancelQueries: mocks.cancelQueries,
      getQueryData: mocks.getQueryData,
      setQueryData: mocks.setQueryData,
    }),
    useQuery: (options: any) => {
      mocks.queryOptions.push(options);
      const key = options.queryKey?.[0];
      const values: Record<string, any> = {
        "is-app-admin": mocks.isAppAdmin,
        "user-admin-roles": mocks.roles,
        "vault-clubs": mocks.clubs,
        "vault-club-has-pro": mocks.hasPro,
        "vault-team-has-pro": mocks.hasPro,
        "vault-club-teams": [],
        "vault-team-folders": [],
        "vault-club-mini-leagues": [],
        "vault-subfolders": [],
        "vault-files": [],
        "vault-folder-tree": { descendants: [], pathById: new Map(), descendantIds: [] },
        "vault-recursive-search": { folders: [], files: [] },
        "vault-trash": { photos: [], files: [] },
        "pro-access-info": mocks.hasPro,
        "purchased-storage": 0,
        "storage-breakdown": null,
      };
      return { data: values[key], error: null, isLoading: false, isFetching: false, isFetched: true };
    },
    useMutation: (options: any) => {
      mocks.mutations.push(options);
      return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
    },
  };
});

function nextResult(table: string, kind: string) {
  return mocks.results[`${table}:${kind}`]?.shift() ?? { data: null, error: null };
}

function queryFor(table: string) {
  let write: Write | null = null;
  const query: any = {};
  query.select = vi.fn((...args: any[]) => { mocks.queryCalls.push({ table, method: "select", args }); return query; });
  query.insert = vi.fn((payload: any) => {
    write = { table, kind: "insert", payload, filters: [] };
    mocks.writes.push(write);
    return query;
  });
  query.update = vi.fn((payload: any) => {
    write = { table, kind: "update", payload, filters: [] };
    mocks.writes.push(write);
    return query;
  });
  query.delete = vi.fn(() => {
    write = { table, kind: "delete", filters: [] };
    mocks.writes.push(write);
    return query;
  });
  query.eq = vi.fn((column: string, value: any) => { mocks.queryCalls.push({ table, method: "eq", args: [column, value] }); write?.filters.push([column, value]); return query; });
  for (const method of ["in", "is", "not", "order", "limit", "ilike", "gte", "or"]) query[method] = vi.fn((...args: any[]) => { mocks.queryCalls.push({ table, method, args }); return query; });
  const resolve = () => nextResult(table, write?.kind ?? "select");
  query.single = vi.fn(async () => resolve());
  query.maybeSingle = vi.fn(async () => resolve());
  Object.defineProperty(query, "then", { value: (ok: any, fail: any) => Promise.resolve(resolve()).then(ok, fail) });
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(queryFor),
    functions: { invoke: mocks.invoke },
    storage: { from: vi.fn(() => ({ upload: mocks.upload, remove: vi.fn() })) },
    rpc: vi.fn(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1", email: "synthetic@example.test" } }) }));
vi.mock("@/hooks/useClubTheme", () => ({ useClubTheme: () => ({ activeClubFilter: mocks.activeClubFilter }) }));
vi.mock("@/hooks/useDebounce", () => ({ useDebounce: (value: any) => value }));
vi.mock("@/lib/vaultUpload", () => ({
  reserveVaultStorage: mocks.reserve,
  settleVaultStorage: mocks.settle,
  compensateVaultUpload: mocks.compensate,
  buildVaultStorageUrl: (path: string) => `http://127.0.0.1:54321/storage/${path}`,
}));
vi.mock("@/lib/mediaCache", () => ({ removePhotoFromCache: mocks.removeCache }));
vi.mock("recharts", () => ({ PieChart: () => null, Pie: () => null, Cell: () => null, ResponsiveContainer: ({ children }: any) => children, Tooltip: () => null }));

async function renderPage() {
  const { default: VaultPage } = await import("./VaultPage");
  render(<MemoryRouter><VaultPage /></MemoryRouter>);
  await waitFor(() => expect(mocks.mutations.length).toBeGreaterThanOrEqual(mutationNames.length));
}

function mutation(name: string) {
  return mocks.mutations[mutationNames.indexOf(name)];
}

function latestQuery(key: string, predicate: (options: any) => boolean = () => true) {
  return [...mocks.queryOptions].reverse().find((options) => options.queryKey?.[0] === key && predicate(options));
}

describe("VaultPage permission and mutation characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutations = [];
    mocks.queryOptions = [];
    mocks.queryCalls = [];
    mocks.writes = [];
    mocks.results = {};
    mocks.isAppAdmin = false;
    mocks.roles = [];
    mocks.hasPro = false;
    mocks.clubs = [];
    mocks.activeClubFilter = null;
    mocks.reserve.mockResolvedValue("reservation-1");
    mocks.settle.mockResolvedValue(undefined);
    mocks.compensate.mockResolvedValue(undefined);
    mocks.upload.mockResolvedValue({ error: null });
    mocks.invoke.mockResolvedValue({ data: {}, error: null });
    mocks.cancelQueries.mockResolvedValue(undefined);
  });

  it("fails closed when an authorized Vault role has no Pro entitlement", async () => {
    mocks.roles = [{ role: "club_admin", club_id: "club-1", team_id: null }];
    await renderPage();
    expect(screen.getByText("Vault is a Pro Feature")).toBeInTheDocument();
  });

  it("fails closed when Pro exists but the user has no Vault role", async () => {
    mocks.hasPro = true;
    mocks.roles = [{ role: "player", club_id: "club-1", team_id: "team-1" }];
    await renderPage();
    expect(screen.getByText("Permission Required")).toBeInTheDocument();
  });

  it("scopes a club root folder query to that club and excludes team and nested rows", async () => {
    mocks.hasPro = true;
    mocks.roles = [{ role: "club_admin", club_id: "club-1", team_id: null }];
    mocks.clubs = [{ id: "club-1", name: "Synthetic Club", is_pro: true, storage_used_bytes: 0 }];
    mocks.activeClubFilter = "club-1";
    await renderPage();
    await waitFor(() => expect(latestQuery("vault-subfolders", (q) => q.queryKey?.[1]?.type === "club")).toBeTruthy());
    mocks.results["vault_folders:select"] = [{ data: [], error: null }];
    mocks.queryCalls = [];
    await latestQuery("vault-subfolders", (q) => q.queryKey[1].type === "club").queryFn();
    expect(mocks.queryCalls).toEqual(expect.arrayContaining([
      { table: "vault_folders", method: "is", args: ["deleted_at", null] },
      { table: "vault_folders", method: "eq", args: ["club_id", "club-1"] },
      { table: "vault_folders", method: "is", args: ["team_id", null] },
      { table: "vault_folders", method: "is", args: ["parent_id", null] },
    ]));
  });

  it("shows coaches only generic chat folders and role-restricted folders they qualify for", async () => {
    mocks.hasPro = true;
    mocks.roles = [{ role: "coach", club_id: "club-1", team_id: "team-1" }];
    mocks.clubs = [{ id: "club-1", name: "Synthetic Club", is_pro: true, storage_used_bytes: 0 }];
    mocks.activeClubFilter = "club-1";
    await renderPage();
    await waitFor(() => expect(latestQuery("vault-subfolders", (q) => q.queryKey?.[1]?.type === "club")).toBeTruthy());
    mocks.results["vault_folders:select"] = [{
      data: [
        { id: "generic", name: "Policies", restricted_roles: null },
        { id: "chat", name: "Chat Images", restricted_roles: null },
        { id: "coach", name: "Coaches Chat", restricted_roles: ["coach"] },
        { id: "admin", name: "Club Admin Chat", restricted_roles: ["club_admin"] },
      ], error: null,
    }];
    const folders = await latestQuery("vault-subfolders", (q) => q.queryKey[1].type === "club").queryFn();
    expect(folders.map((folder: any) => folder.id)).toEqual(["chat", "coach"]);
  });

  it("does not expose loose club files to a coach at the club root", async () => {
    mocks.hasPro = true;
    mocks.roles = [{ role: "coach", club_id: "club-1", team_id: "team-1" }];
    mocks.clubs = [{ id: "club-1", name: "Synthetic Club", is_pro: true, storage_used_bytes: 0 }];
    mocks.activeClubFilter = "club-1";
    await renderPage();
    await waitFor(() => expect(latestQuery("vault-files", (q) => q.queryKey?.[1]?.type === "club")).toBeTruthy());
    mocks.queryCalls = [];
    const files = await latestQuery("vault-files", (q) => q.queryKey[1].type === "club").queryFn();
    expect(files).toEqual([]);
    // A scoped builder is created, but it is returned before it is awaited.
    expect(mocks.queryCalls.some((call) => call.table === "vault_files" && call.method === "order")).toBe(false);
  });

  it("filters recursive search results whose folder is outside the visible folder tree", async () => {
    mocks.hasPro = true;
    mocks.roles = [{ role: "coach", club_id: "club-1", team_id: "team-1" }];
    mocks.clubs = [{ id: "club-1", name: "Synthetic Club", is_pro: true, storage_used_bytes: 0 }];
    mocks.activeClubFilter = "club-1";
    await renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText("Search folders and files...")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Search folders and files..."), { target: { value: "secret" } });
    await waitFor(() => expect(latestQuery("vault-recursive-search", (q) => q.enabled === true)).toBeTruthy());
    mocks.results["vault_files:select"] = [{
      data: [
        { id: "root-safe", folder_id: null, name: "secret public.txt", file_type: "text/plain" },
        { id: "hidden", folder_id: "admin-folder", name: "secret admins.txt", file_type: "text/plain" },
      ], error: null,
    }];
    const result = await latestQuery("vault-recursive-search", (q) => q.enabled === true).queryFn();
    expect(result.files.map((file: any) => file.id)).toEqual(["root-safe"]);
  });

  it("uses exact ids and payloads for rename and move operations", async () => {
    await renderPage();
    await mutation("renameFolder").mutationFn({ folderId: "folder-1", newName: "Policies" });
    await mutation("renameFile").mutationFn({ fileId: "file-1", newName: "Rules.pdf" });
    await mutation("moveFile").mutationFn({ fileId: "file-1", targetFolderId: "folder-2", targetTeamId: "team-2" });
    expect(mocks.writes).toEqual([
      { table: "vault_folders", kind: "update", payload: { name: "Policies" }, filters: [["id", "folder-1"]] },
      { table: "vault_files", kind: "update", payload: { name: "Rules.pdf" }, filters: [["id", "file-1"]] },
      { table: "vault_files", kind: "update", payload: { folder_id: "folder-2", team_id: "team-2" }, filters: [["id", "file-1"]] },
    ]);
  });

  it("soft-deletes and restores only the selected Vault row", async () => {
    await renderPage();
    await mutation("deleteFile").mutationFn("file-1");
    const deleted = mocks.writes.at(-1)!;
    expect(deleted.table).toBe("vault_files");
    expect(deleted.kind).toBe("update");
    expect(deleted.payload.deleted_by).toBe("user-1");
    expect(deleted.payload.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deleted.filters).toEqual([["id", "file-1"]]);

    await mutation("restoreFile").mutationFn("file-1");
    expect(mocks.writes.at(-1)).toEqual({
      table: "vault_files", kind: "update",
      payload: { deleted_at: null, deleted_by: null }, filters: [["id", "file-1"]],
    });
  });

  it("rolls an optimistically removed photo back into the cache when deletion fails", async () => {
    await renderPage();
    const previousItems = [{ id: "photo-1", name: "Team photo.jpg" }];
    mocks.getQueryData.mockReturnValue(previousItems);
    const context = await mutation("deletePhoto").onMutate("photo-1");
    expect(mocks.cancelQueries).toHaveBeenCalledWith({ queryKey: ["vault-files"] });
    expect(context).toEqual({ previousItems, photoId: "photo-1" });

    mutation("deletePhoto").onError(new Error("RLS denied delete"), "photo-1", context);
    expect(mocks.setQueryData).toHaveBeenLastCalledWith(
      ["vault-files", { type: "root" }, false, false],
      previousItems,
    );
    expect(mocks.removeCache).not.toHaveBeenCalled();
  });

  it("propagates permission failures and does not invalidate caches as a success", async () => {
    await renderPage();
    const failure = { message: "RLS denied move", code: "42501" };
    mocks.results["vault_files:update"] = [{ data: null, error: failure }];
    await expect(mutation("moveFile").mutationFn({ fileId: "file-1", targetFolderId: null })).rejects.toEqual(failure);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it("permanently deletes files through the server boundary and propagates its failure", async () => {
    await renderPage();
    await mutation("permanentDeleteFile").mutationFn("file-1");
    expect(mocks.invoke).toHaveBeenCalledWith("permanent-delete-photos", {
      body: { fileIds: ["file-1"], deletionType: "permanent" },
    });

    mocks.invoke.mockResolvedValueOnce({ data: null, error: { message: "audit denied" } });
    await expect(mutation("permanentDeleteFile").mutationFn("file-2")).rejects.toThrow("audit denied");
  });

  it("compensates uploaded bytes and rolls back quota when metadata insertion fails", async () => {
    await renderPage();
    const failure = { message: "metadata insert denied", code: "42501" };
    mocks.results["vault_files:insert"] = [{ data: null, error: failure }];
    const file = new File(["synthetic"], "team-list.pdf", { type: "application/pdf" });
    await expect(mutation("uploadFile").mutationFn({ file, customFileName: "Team list" })).rejects.toEqual(failure);
    expect(mocks.upload).toHaveBeenCalledOnce();
    const storagePath = mocks.upload.mock.calls[0][0] as string;
    expect(mocks.compensate).toHaveBeenCalledWith(storagePath);
    // Root is deliberately unscoped in this harness, so no reservation is created.
    expect(mocks.reserve).toHaveBeenCalledWith(null, file.size);
    expect(mocks.settle).toHaveBeenCalledWith("reservation-1", false);
  });

  it("never inserts metadata when the storage upload fails and releases its reservation", async () => {
    await renderPage();
    const failure = { message: "object upload failed" };
    mocks.upload.mockResolvedValueOnce({ error: failure });
    const file = new File(["synthetic"], "document.pdf", { type: "application/pdf" });
    await expect(mutation("uploadFile").mutationFn({ file })).rejects.toEqual(failure);
    expect(mocks.writes.some((write) => write.kind === "insert" && write.table === "vault_files")).toBe(false);
    expect(mocks.settle).toHaveBeenCalledWith("reservation-1", false);
    expect(mocks.compensate).not.toHaveBeenCalled();
  });
});
