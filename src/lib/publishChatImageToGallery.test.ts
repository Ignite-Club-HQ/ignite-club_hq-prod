import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, storageFrom, upload, remove, fetchMock } = vi.hoisted(() => ({
  from: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from, storage: { from: storageFrom } },
}));

import {
  publishChatImageToGallery,
  unpublishGalleryPhoto,
} from "./publishChatImageToGallery";

function lookupResult(data: unknown = null, error: unknown = null) {
  const query: any = {};
  for (const method of ["select", "eq", "is"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return query;
}

function insertResult(data: unknown = { id: "photo-new" }, error: unknown = null) {
  const query: any = {};
  query.insert = vi.fn(() => query);
  query.select = vi.fn(() => query);
  query.single = vi.fn().mockResolvedValue({ data, error });
  return query;
}

function updateResult(error: unknown = null) {
  const query: any = {};
  query.update = vi.fn(() => query);
  query.eq = vi.fn().mockResolvedValue({ error });
  return query;
}

const base = {
  imageUrl: "https://example.invalid/chat-image.jpg",
  uploaderId: "user-1",
  teamId: "team-1",
  clubId: "club-1",
  caption: "Winning goal",
};

describe("publishChatImageToGallery media permissions and consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
    });
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    storageFrom.mockReturnValue({ upload, remove });
    vi.spyOn(Date, "now").mockReturnValue(1_234_567_890);
    vi.spyOn(Math, "random").mockReturnValue(0.25);
  });

  it.each([
    [{ ...base, imageUrl: "" }, "imageUrl is required"],
    [{ ...base, uploaderId: "" }, "uploaderId is required"],
    [{ ...base, teamId: null, clubId: null }, "teamId or clubId is required"],
  ])("rejects invalid scope before querying or downloading", async (args, message) => {
    await expect(publishChatImageToGallery(args)).rejects.toThrow(message);
    expect(from).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns an existing publication without downloading or uploading again", async () => {
    const lookup = lookupResult({ id: "photo-existing" });
    from.mockReturnValueOnce(lookup);

    await expect(publishChatImageToGallery(base)).resolves.toEqual({
      photoId: "photo-existing",
      alreadyPublished: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it.each([
    [{ teamId: "team-1", clubId: "club-1" }, "clubs/club-1/teams/team-1/user-1/1234567890-9.jpg"],
    [{ teamId: "team-1", clubId: null }, "teams/team-1/user-1/1234567890-9.jpg"],
    [{ teamId: null, clubId: "club-1" }, "clubs/club-1/user-1/1234567890-9.jpg"],
  ])("uploads into the exact team or club storage scope", async (scope, expectedPath) => {
    const lookup = lookupResult();
    const insertion = insertResult();
    from.mockReturnValueOnce(lookup).mockReturnValueOnce(insertion);

    await expect(
      publishChatImageToGallery({ ...base, ...scope }),
    ).resolves.toEqual({ photoId: "photo-new", alreadyPublished: false });

    expect(storageFrom).toHaveBeenCalledWith("photos");
    expect(upload).toHaveBeenCalledWith(expectedPath, expect.any(Blob), {
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "31536000",
    });
    expect(insertion.insert).toHaveBeenCalledWith(expect.objectContaining({
      uploader_id: "user-1",
      team_id: scope.teamId,
      club_id: scope.clubId,
      file_size: 3,
      caption: "Winning goal",
      title: "Winning goal",
    }));
  });

  it("does not create a database row when storage permission rejects the upload", async () => {
    from.mockReturnValueOnce(lookupResult());
    upload.mockResolvedValue({ error: { message: "RLS denied" } });

    await expect(publishChatImageToGallery(base)).rejects.toThrow(
      "Could not save image to the gallery",
    );
    expect(from).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes the uploaded object when registering the photo row fails", async () => {
    const insertion = insertResult(null, { message: "insert denied" });
    from.mockReturnValueOnce(lookupResult()).mockReturnValueOnce(insertion);

    await expect(publishChatImageToGallery(base)).rejects.toEqual({
      message: "insert denied",
    });
    const uploadedPath = upload.mock.calls[0][0];
    expect(remove).toHaveBeenCalledWith([uploadedPath]);
  });

  it("must stop before copying media when the idempotency lookup fails", async () => {
    from.mockReturnValueOnce(
      lookupResult(null, { message: "cannot verify existing publication" }),
    );

    await expect(publishChatImageToGallery(base)).rejects.toThrow(
      "cannot verify existing publication",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("soft-deletes only the requested gallery row and surfaces permission failure", async () => {
    const success = updateResult();
    const denied = updateResult({ message: "delete denied" });
    from.mockReturnValueOnce(success).mockReturnValueOnce(denied);

    await expect(unpublishGalleryPhoto("photo-1")).resolves.toBeUndefined();
    expect(success.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(success.eq).toHaveBeenCalledWith("id", "photo-1");

    await expect(unpublishGalleryPhoto("photo-2")).rejects.toThrow("Could not undo");
    expect(denied.eq).toHaveBeenCalledWith("id", "photo-2");
  });
});
