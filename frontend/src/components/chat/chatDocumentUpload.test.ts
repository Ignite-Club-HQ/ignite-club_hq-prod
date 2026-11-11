import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), register: vi.fn(), access: vi.fn(), icp: true }));
vi.mock("@/live/domains", () => ({ connectLiveCompetitionDomain: async () => ({ actor: { get_vault_access: mocks.access } }) }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_feature: string, providers: any, scope: any) => mocks.icp ? providers.icp({ identity: scope?.competitionId ? { getPrincipal: () => "caller" } : "session", target: "icp" }) : providers.supabase() }));
vi.mock("@/live/mediaUpload", () => ({ tryUploadMediaToBlobStore: mocks.upload }));
vi.mock("@/live/features/vault", () => ({ registerLiveVaultFile: mocks.register }));
import { uploadIcpChatDocument, uploadIcpCompetitionChatDocument } from "./chatDocumentUpload";
const file = { name: "Training plan.PDF", type: "application/pdf", size: 1234 } as File;
const ref = { canister: "blob-store", path: "stored-file", content_hash: "hash" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.icp = true;
  mocks.upload.mockResolvedValue({ url: "https://files.icp0.io/plan.pdf", blobRef: ref });
  mocks.register.mockResolvedValue({});
  mocks.access.mockResolvedValue({ Ok: { club_id: "host-club", is_member: true, can_manage: true } });
});
describe("ICP device chat files", () => {
  it("uses the authorized competition host and grants competition access, never a team or club audience", async () => {
    const token = await uploadIcpCompetitionChatDocument(file, "competition-1");
    expect(mocks.access).toHaveBeenCalledWith("competition-1", "caller");
    expect(mocks.upload.mock.calls[0][0]).toMatchObject({ competitionId: "competition-1", lock: "own", file, mime: "application/pdf" });
    expect(mocks.upload.mock.calls[0][0].storagePath).toMatch(/^clubs\/host-club\/competitions\/competition-1\/chat\/files\//);
    const id = token.slice("[vault:".length, -1);
    expect(mocks.register).toHaveBeenCalledWith(expect.anything(), id, "", "host-club", null, file.name, "https://files.icp0.io/plan.pdf", 1234, "application/pdf", false, ref, null, "competition-1");
  });
  it.each([
    { club_id: "host-club", is_member: false, can_manage: true },
    { club_id: "host-club", is_member: true, can_manage: false },
    { club_id: "", is_member: true, can_manage: true },
  ])("refuses competition uploads before bytes leave when access is absent: %j", async access => {
    mocks.access.mockResolvedValue({ Ok: access });
    await expect(uploadIcpCompetitionChatDocument(file, "competition-1")).rejects.toThrow();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("never returns a competition token when metadata registration fails", async () => {
    mocks.register.mockRejectedValue(new Error("Access removed"));
    await expect(uploadIcpCompetitionChatDocument(file, "competition-1")).rejects.toThrow("Access removed");
  });
  it("uploads encrypted original bytes then registers a shareable vault file", async () => {
    const token = await uploadIcpChatDocument(file, "giddy-goat", "team-1");
    const [upload] = mocks.upload.mock.calls[0];
    expect(upload).toMatchObject({ context: { identity: "session", target: "icp" }, file, mime: "application/pdf", lock: "own" });
    expect(upload.storagePath).toMatch(/^clubs\/giddy-goat\/chat\/files\/[a-f0-9-]+\.pdf$/);
    const id = token.slice("[vault:".length, -1);
    expect(mocks.register).toHaveBeenCalledWith({ identity: "session", target: "icp" }, id, "", "giddy-goat", "team-1", "Training plan.PDF", "https://files.icp0.io/plan.pdf", 1234, "application/pdf", false, ref);
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(mocks.register.mock.invocationCallOrder[0]);
  });
  it("does not register a file or return a token when encrypted storage is unavailable", async () => {
    mocks.upload.mockResolvedValue(null);
    await expect(uploadIcpChatDocument(file, "giddy-goat")).rejects.toThrow("ICP storage");
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("surfaces registration failures instead of claiming attachment success", async () => {
    mocks.register.mockRejectedValue(new Error("Club role required"));
    await expect(uploadIcpChatDocument(file, "giddy-goat")).rejects.toThrow("Club role required");
  });
  it("does not divert an ICP file to Supabase when vault routing is unavailable", async () => {
    mocks.icp = false;
    await expect(uploadIcpChatDocument(file, "giddy-goat")).rejects.toThrow("connect to ICP");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("retains filename and uses a binary MIME fallback for untyped device files", async () => {
    await uploadIcpChatDocument({ ...file, type: "", name: "notes.txt" } as File, "giddy-goat");
    expect(mocks.upload.mock.calls[0][0].mime).toBe("application/octet-stream");
    expect(mocks.register.mock.calls[0][5]).toBe("notes.txt");
    expect(mocks.register.mock.calls[0][4]).toBe(null);
  });
});