import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageFrom, createSignedUrl, invoke } = vi.hoisted(() => ({
  storageFrom: vi.fn(),
  createSignedUrl: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: storageFrom },
    functions: { invoke },
  },
}));

import { getSignedPhotoUrls, resolveSignedUrl } from "./useSignedPhotoUrl";

const origin = "https://project.example";

describe("private media signed URL resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageFrom.mockReturnValue({ createSignedUrl });
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/direct" },
      error: null,
    });
    invoke.mockResolvedValue({ data: { signedUrls: {} }, error: null });
  });

  it("returns unrelated and unsupported URLs unchanged without signing calls", async () => {
    const ordinary = "https://cdn.example/image.jpg";
    const publicUnknownBucket = `${origin}/storage/v1/object/public/documents/file.pdf`;

    await expect(resolveSignedUrl(ordinary)).resolves.toBe(ordinary);
    await expect(resolveSignedUrl(publicUnknownBucket)).resolves.toBe(
      publicUnknownBucket,
    );
    expect(storageFrom).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["object/public", "photos", "clubs/club-1/photo one.jpg"],
    ["object/sign", "chat-attachments", "clubs/club-1/chat.jpg"],
    ["object/authenticated", "avatars", "users/user-1/avatar.png"],
    ["render/image/public", "photos", "clubs/club-1/rendered.webp"],
    ["render/image/sign", "photos", "clubs/club-1/signed-render.webp"],
  ])("extracts %s private URLs and signs the decoded object path", async (marker, bucket, decodedPath) => {
    const encodedPath = decodedPath.replace(" ", "%20");
    const url = `${origin}/storage/v1/${marker}/${bucket}/${encodedPath}?token=old#preview`;

    await expect(resolveSignedUrl(url)).resolves.toBe(
      "https://signed.example/direct",
    );
    expect(storageFrom).toHaveBeenCalledWith(bucket);
    expect(createSignedUrl).toHaveBeenCalledWith(decodedPath, 3600);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("falls back to the signing Edge Function with the original URL when direct signing is denied", async () => {
    const url = `${origin}/storage/v1/object/public/photos/clubs/club-1/photo.jpg`;
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "direct RLS denied" },
    });
    invoke.mockResolvedValue({
      data: { signedUrls: { [url]: "https://signed.example/fallback" } },
      error: null,
    });

    await expect(resolveSignedUrl(url)).resolves.toBe(
      "https://signed.example/fallback",
    );
    expect(invoke).toHaveBeenCalledWith("get-signed-photo-url", {
      body: { paths: [url], expiresIn: 3600 },
    });
  });

  it("fails closed instead of exposing a raw private URL when both signing paths fail", async () => {
    const url = `${origin}/storage/v1/object/public/photos/clubs/club-1/private.jpg`;
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "direct denied" },
    });
    invoke.mockResolvedValue({
      data: null,
      error: { message: "fallback denied" },
    });

    await expect(resolveSignedUrl(url)).rejects.toThrow(
      "Unable to create signed URL for private storage object",
    );
  });

  it("resolves a mixed batch while preserving the input-to-result mapping", async () => {
    const publicUrl = "https://cdn.example/public.jpg";
    const photoUrl = `${origin}/storage/v1/object/public/photos/clubs/club-1/batch.jpg`;
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/batch" },
      error: null,
    });

    await expect(getSignedPhotoUrls([publicUrl, photoUrl])).resolves.toEqual({
      [publicUrl]: publicUrl,
      [photoUrl]: "https://signed.example/batch",
    });
  });

  it("must not return the raw private URL from batch resolution when authorization fails", async () => {
    const privateUrl = `${origin}/storage/v1/object/public/photos/clubs/club-1/denied.jpg`;
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "direct denied" },
    });
    invoke.mockResolvedValue({
      data: null,
      error: { message: "fallback denied" },
    });

    const result = await getSignedPhotoUrls([privateUrl]);

    expect(result[privateUrl]).not.toBe(privateUrl);
    expect(result[privateUrl]).toBeUndefined();
  });
});
