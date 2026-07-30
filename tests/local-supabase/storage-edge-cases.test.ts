import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

const bucket = "club-media-local";
const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe("local Storage: path, upsert and signed URL boundaries", () => {
  let fixture: SecurityFixture;
  const paths: string[] = [];
  beforeAll(async () => { await assertSyntheticLocalMarker(); fixture = await createSecurityFixture(); });
  afterAll(async () => {
    if (paths.length) await service.storage.from(bucket).remove(paths);
    await fixture?.cleanup();
  });

  it("rejects malformed and traversal-like object paths", async () => {
    for (const path of [
      `not-a-club/${fixture.memberA.id}/file.jpg`,
      `${fixture.clubA}/../${fixture.memberA.id}/file.jpg`,
      `${fixture.clubA}/${fixture.memberA.id}/../file.jpg`,
    ]) {
      const result = await fixture.memberA.client.storage.from(bucket).upload(path, image, { contentType: "image/jpeg" });
      expect(result.error).not.toBeNull();
    }
  });

  it("does not let a member upsert another member's object", async () => {
    const path = `${fixture.clubA}/${fixture.adminA.id}/${crypto.randomUUID()}.jpg`; paths.push(path);
    expect((await fixture.adminA.client.storage.from(bucket).upload(path, image, { contentType: "image/jpeg" })).error).toBeNull();
    const overwrite = await fixture.memberA.client.storage.from(bucket)
      .upload(path, new Uint8Array([1, 2, 3]), { contentType: "image/jpeg", upsert: true });
    expect(overwrite.error).not.toBeNull();
  });

  it("lets a club administrator delete a member-owned object", async () => {
    const path = `${fixture.clubA}/${fixture.memberA.id}/${crypto.randomUUID()}.jpg`;
    expect((await fixture.memberA.client.storage.from(bucket).upload(path, image, { contentType: "image/jpeg" })).error).toBeNull();
    expect((await fixture.adminA.client.storage.from(bucket).remove([path])).error).toBeNull();
    expect((await fixture.memberA.client.storage.from(bucket).download(path)).error).not.toBeNull();
  });

  it("expires a signed URL after its declared lifetime", async () => {
    const path = `${fixture.clubA}/${fixture.memberA.id}/${crypto.randomUUID()}.jpg`; paths.push(path);
    expect((await fixture.memberA.client.storage.from(bucket).upload(path, image, { contentType: "image/jpeg" })).error).toBeNull();
    const signed = await fixture.memberA.client.storage.from(bucket).createSignedUrl(path, 5);
    expect(signed.error).toBeNull();
    expect((await fetch(signed.data!.signedUrl)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 5_250));
    expect((await fetch(signed.data!.signedUrl)).status).not.toBe(200);
  });
});
