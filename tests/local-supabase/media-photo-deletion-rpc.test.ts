import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSyntheticLocalMarker,
  createSecurityFixture,
  service,
  type SecurityFixture,
  type SyntheticUser,
} from "./fixtures";

describe("local Media deletion RPC: feed and Vault consistency", () => {
  let fixture: SecurityFixture;
  const photoIds: string[] = [];
  const fileIds: string[] = [];

  async function createPair(options: {
    clubId: string;
    teamId?: string | null;
    uploader: SyntheticUser;
    suffix: string;
  }) {
    const url = `https://local.invalid/photos/${options.suffix}.jpg`;
    const photo = await service.from("photos").insert({
      club_id: options.clubId,
      team_id: options.teamId ?? null,
      uploader_id: options.uploader.id,
      file_url: url,
      image_url: url,
      file_size: 2048,
      show_in_feed: true,
    }).select("id").single();
    if (photo.error) throw photo.error;
    photoIds.push(photo.data.id);

    const file = await service.from("vault_files").insert({
      club_id: options.clubId,
      team_id: options.teamId ?? null,
      uploaded_by: options.uploader.id,
      file_url: url,
      file_size: 2048,
    }).select("id").single();
    if (file.error) throw file.error;
    fileIds.push(file.data.id);
    return { photoId: photo.data.id as string, fileId: file.data.id as string };
  }

  async function state(photoId: string, fileId: string) {
    const photo = await service.from("photos")
      .select("show_in_feed, deleted_at")
      .eq("id", photoId)
      .single();
    const file = await service.from("vault_files")
      .select("deleted_at, deleted_by")
      .eq("id", fileId)
      .single();
    if (photo.error) throw photo.error;
    if (file.error) throw file.error;
    return { photo: photo.data, file: file.data };
  }

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
  });

  afterAll(async () => {
    await service.from("vault_files").delete().in("id", fileIds);
    await service.from("photos").delete().in("id", photoIds);
    await fixture?.cleanup();
  });

  it("removes an uploader's photo from the feed without changing its Vault copy", async () => {
    const pair = await createPair({
      clubId: fixture.clubA,
      uploader: fixture.memberA,
      suffix: "feed-only",
    });
    const result = await fixture.memberA.client.rpc("delete_media_photo", {
      _photo_id: pair.photoId,
      _mode: "feed_only",
    });
    expect(result.error).toBeNull();
    expect(result.data[0]).toMatchObject({
      photo_id: pair.photoId,
      mode: "feed_only",
      vault_updated: false,
    });
    expect(await state(pair.photoId, pair.fileId)).toEqual({
      photo: { show_in_feed: false, deleted_at: null },
      file: { deleted_at: null, deleted_by: null },
    });
  });

  it("atomically moves an uploader's feed photo and matching Vault file to trash", async () => {
    const pair = await createPair({
      clubId: fixture.clubA,
      uploader: fixture.memberA,
      suffix: "feed-and-vault",
    });
    const result = await fixture.memberA.client.rpc("delete_media_photo", {
      _photo_id: pair.photoId,
      _mode: "feed_and_vault",
    });
    expect(result.error).toBeNull();
    expect(result.data[0]).toMatchObject({
      photo_id: pair.photoId,
      vault_file_id: pair.fileId,
      vault_updated: true,
      already_deleted: false,
    });
    const after = await state(pair.photoId, pair.fileId);
    expect(after.photo.show_in_feed).toBe(false);
    expect(after.photo.deleted_at).not.toBeNull();
    expect(after.file.deleted_at).not.toBeNull();
    expect(after.file.deleted_by).toBe(fixture.memberA.id);
  });

  it("rejects cross-club deletion and leaves both records unchanged", async () => {
    const pair = await createPair({
      clubId: fixture.clubB,
      uploader: fixture.outsiderB,
      suffix: "cross-club-denied",
    });
    const result = await fixture.adminA.client.rpc("delete_media_photo", {
      _photo_id: pair.photoId,
      _mode: "feed_and_vault",
    });
    expect(result.error).not.toBeNull();
    expect(await state(pair.photoId, pair.fileId)).toEqual({
      photo: { show_in_feed: true, deleted_at: null },
      file: { deleted_at: null, deleted_by: null },
    });
  });

  it("allows a team admin only for their exact team", async () => {
    expect((await service.from("user_roles").insert({
      user_id: fixture.memberA.id,
      role: "team_admin",
      club_id: fixture.clubA,
      team_id: fixture.teamA,
    })).error).toBeNull();
    const ownTeam = await createPair({
      clubId: fixture.clubA,
      teamId: fixture.teamA,
      uploader: fixture.adminA,
      suffix: "team-admin-allowed",
    });
    const otherTeam = await createPair({
      clubId: fixture.clubB,
      teamId: fixture.teamB,
      uploader: fixture.outsiderB,
      suffix: "team-admin-denied",
    });

    expect((await fixture.memberA.client.rpc("delete_media_photo", {
      _photo_id: ownTeam.photoId,
      _mode: "feed_and_vault",
    })).error).toBeNull();
    expect((await fixture.memberA.client.rpc("delete_media_photo", {
      _photo_id: otherTeam.photoId,
      _mode: "feed_and_vault",
    })).error).not.toBeNull();
    expect((await state(otherTeam.photoId, otherTeam.fileId)).photo.show_in_feed).toBe(true);
  });

  it("is idempotent when the same deletion is retried", async () => {
    const pair = await createPair({
      clubId: fixture.clubA,
      uploader: fixture.memberA,
      suffix: "idempotent",
    });
    const first = await fixture.memberA.client.rpc("delete_media_photo", {
      _photo_id: pair.photoId,
      _mode: "feed_and_vault",
    });
    const second = await fixture.memberA.client.rpc("delete_media_photo", {
      _photo_id: pair.photoId,
      _mode: "feed_and_vault",
    });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data[0]).toMatchObject({
      vault_file_id: pair.fileId,
      vault_updated: true,
      already_deleted: true,
    });
    const after = await state(pair.photoId, pair.fileId);
    expect(after.photo.deleted_at).not.toBeNull();
    expect(after.file.deleted_at).not.toBeNull();
  });
});
