import { describe, it, expect } from "vitest";
import { parseStorageObjectRef } from "../../supabase/functions/_shared/storageUrlAuth";
import { signAuthorizedBatch } from "../../supabase/functions/_shared/signedUrlBatch";

const ORIGIN = "https://proj.supabase.co";
const path = "general/11111111-1111-1111-1111-111111111111/1700000000000.jpg";

describe("signed photo links for sized URLs", () => {
  it("ignores ?w=&h= when resolving the stored file", () => {
    expect(parseStorageObjectRef(`${ORIGIN}/storage/v1/object/public/chat-attachments/${path}?w=960&h=1280`, ORIGIN))
      .toEqual({ bucket: "chat-attachments", path });
  });

  it("resolves image-transform URLs to the same file", () => {
    expect(parseStorageObjectRef(`${ORIGIN}/storage/v1/render/image/public/chat-attachments/${path}?width=960`, ORIGIN))
      .toEqual({ bucket: "chat-attachments", path });
  });

  it("returns a signed link for a URL ending in ?w=960&h=1280", async () => {
    const raw = `${ORIGIN}/storage/v1/object/public/chat-attachments/${path}?w=960&h=1280`;
    const res = await signAuthorizedBatch([raw], {
      supabaseUrl: ORIGIN,
      authorize: async (items) => ({ data: items.map((i) => ({ ...i, allowed: true })), error: null }),
      sign: async (_b, p) => ({ url: `${ORIGIN}/signed/${p}`, error: null }),
    });
    expect(res.signedUrls[raw]).toBe(`${ORIGIN}/signed/${path}`);
  });
});
