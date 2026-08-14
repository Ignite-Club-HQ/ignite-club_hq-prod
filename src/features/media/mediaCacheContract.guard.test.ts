import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Media cache ownership guard", () => {
  it("keeps the gallery page on the canonical key contract", () => {
    const page = read("src/pages/MediaPage.tsx");
    expect(page).toContain('@/features/media/mediaQueryKeys');
    for (const root of [
      "user-roles-media",
      "has-pro-access",
      "user-profile-media",
      "media-filter-clubs",
      "media-filter-teams",
      "gallery-chat-card-photo-ids",
      "photos",
      "highlighted-photo",
      "photo-reactions",
      "photo-comments",
    ]) {
      expect(page).not.toMatch(new RegExp(`queryKey:\\s*\\[\\s*["']${root}["']`));
    }
  });

  it("keeps exact optimistic keys separate from broad realtime prefixes", () => {
    const page = read("src/pages/MediaPage.tsx");
    const realtime = read("src/features/media/useMediaRealtime.ts");
    expect(page).toContain("mediaKeys.feed({");
    expect(page).toContain("mediaKeys.reactionsBucket(user?.id, photoCountBucket)");
    expect(page).toContain("mediaKeys.commentsBucket(user?.id, photoCountBucket)");
    expect(page).toContain("mediaKeys.feeds(user.id)");
    expect(realtime).toContain("mediaKeys.reactions(userId)");
    expect(realtime).toContain("mediaKeys.comments(userId)");
  });

  it("prevents Media uploads from routing metadata to a fixed hosted project", () => {
    const consumers = [
      read("src/components/UploadPhotoSheet.tsx"),
      read("src/lib/publishChatImageToGallery.ts"),
    ].join("\n");
    expect(consumers).toContain("buildMediaStorageUrl");
    expect(consumers).not.toContain("yabcfiuntwqjwvschnji");
    expect(consumers).not.toMatch(/const\s+SUPABASE_URL\s*=\s*["']https:\/\//);
  });

  it("keeps primary gallery and access reads behind Media repositories", () => {
    const page = read("src/pages/MediaPage.tsx");
    expect(page).toContain('@/features/media/mediaReadRepository');
    expect(page).toContain('@/features/media/mediaAccessRepository');
    expect(page).toContain('@/features/media/mediaEngagementRepository');
    expect(page).toContain('@/features/media/useMediaRealtime');
    expect(page).toContain('@/features/media/mediaPermissions');
    expect(page).toContain('@/features/media/useMediaPhotoDeletion');
    expect(page).not.toContain("deletePhotoMutation");
    expect(page).not.toContain("media-feed-${user.id}");
    expect(page).not.toContain("media-comments-${user.id}");
    for (const table of [
      "user_roles",
      "club_subscriptions",
      "team_subscriptions",
      "gallery_chat_cards",
      "photo_reactions",
      "photo_comments",
    ]) {
      expect(page).not.toContain(`.from("${table}")`);
    }
  });
});
