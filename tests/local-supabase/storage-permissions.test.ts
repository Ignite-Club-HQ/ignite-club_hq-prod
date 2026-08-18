import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

const bucket = "club-media-local";
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe("local Storage: club media authorization", () => {
  let fixture: SecurityFixture;
  const uploaded: string[] = [];

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
  });

  afterAll(async () => {
    if (uploaded.length) await service.storage.from(bucket).remove(uploaded);
    await fixture?.cleanup();
  });

  const pathFor = (clubId: string, userId: string, name = `${crypto.randomUUID()}.jpg`) =>
    `${clubId}/${userId}/${name}`;

  it("lets a club member upload and download their own valid image", async () => {
    const path = pathFor(fixture.clubA, fixture.memberA.id); uploaded.push(path);
    const upload = await fixture.memberA.client.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg" });
    expect(upload.error).toBeNull();
    const download = await fixture.memberA.client.storage.from(bucket).download(path);
    expect(download.error).toBeNull();
    expect(new Uint8Array(await download.data!.arrayBuffer())).toEqual(bytes);
  });

  it("denies cross-club upload even when the path names the caller", async () => {
    const path = pathFor(fixture.clubA, fixture.outsiderB.id);
    const result = await fixture.outsiderB.client.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg" });
    expect(result.error).not.toBeNull();
  });

  it("denies upload into another member's folder", async () => {
    const path = pathFor(fixture.clubA, fixture.adminA.id);
    const result = await fixture.memberA.client.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg" });
    expect(result.error).not.toBeNull();
  });

  it("does not let another club download or sign a private object", async () => {
    const path = pathFor(fixture.clubA, fixture.memberA.id); uploaded.push(path);
    expect((await fixture.memberA.client.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg" })).error).toBeNull();
    expect((await fixture.outsiderB.client.storage.from(bucket).download(path)).error).not.toBeNull();
    expect((await fixture.outsiderB.client.storage.from(bucket).createSignedUrl(path, 30)).error).not.toBeNull();
  });

  it("creates a usable short-lived signed URL for an authorized member", async () => {
    const path = pathFor(fixture.clubA, fixture.memberA.id); uploaded.push(path);
    expect((await fixture.memberA.client.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg" })).error).toBeNull();
    const signed = await fixture.memberA.client.storage.from(bucket).createSignedUrl(path, 30);
    expect(signed.error).toBeNull();
    const response = await fetch(signed.data!.signedUrl);
    expect(response.status).toBe(200);
  });

  it("lets an owner delete their object but denies an unrelated club", async () => {
    const path = pathFor(fixture.clubA, fixture.memberA.id);
    expect((await fixture.memberA.client.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg" })).error).toBeNull();
    // Storage intentionally returns an empty successful removal when RLS hides
    // the row, so prove denial by checking that the owner's object remains.
    expect((await fixture.outsiderB.client.storage.from(bucket).remove([path])).error).toBeNull();
    expect((await fixture.memberA.client.storage.from(bucket).download(path)).error).toBeNull();
    expect((await fixture.memberA.client.storage.from(bucket).remove([path])).error).toBeNull();
    expect((await fixture.memberA.client.storage.from(bucket).download(path)).error).not.toBeNull();
  });

  it("rejects disallowed media types and oversized files", async () => {
    const textPath = pathFor(fixture.clubA, fixture.memberA.id, `${crypto.randomUUID()}.txt`);
    const textUpload = await fixture.memberA.client.storage.from(bucket)
      .upload(textPath, new TextEncoder().encode("not an image"), { contentType: "text/plain" });
    expect(textUpload.error).not.toBeNull();

    const largePath = pathFor(fixture.clubA, fixture.memberA.id);
    const largeUpload = await fixture.memberA.client.storage.from(bucket)
      .upload(largePath, new Uint8Array(262145), { contentType: "image/jpeg" });
    expect(largeUpload.error).not.toBeNull();
  });

  it("denies anonymous private-object access", async () => {
    const path = pathFor(fixture.clubA, fixture.memberA.id); uploaded.push(path);
    expect((await fixture.memberA.client.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg" })).error).toBeNull();
    const anonymous = createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await anonymous.storage.from(bucket).download(path)).error).not.toBeNull();
  });
});
