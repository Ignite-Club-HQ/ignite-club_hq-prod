import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  publishChatImageToGallery,
  type PublishChatImageArgs,
} from "@/lib/publishChatImageToGallery";
import {
  shouldShowGalleryNudge,
  markGalleryNudgeShown,
} from "@/lib/galleryPublishNudge";

interface UsePublishChatImageOptions {
  uploaderId: string | undefined;
  teamId: string | null;
  clubId: string | null;
}

/**
 * Reusable hook for "publish a chat image to the media gallery" used by team,
 * club and group chat pages. Tracks per-message in-flight + completed sets so
 * UI can render an inline chip with the right state, and exposes a one-shot
 * post-send nudge that suggests adding the just-sent image to the gallery.
 */
export function usePublishChatImage({ uploaderId, teamId, clubId }: UsePublishChatImageOptions) {
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());

  const canPublish = !!uploaderId && !!teamId; // photos table requires team_id

  const publish = useCallback(
    async (messageId: string, imageUrl: string) => {
      if (!canPublish || !uploaderId || !teamId) return;
      if (publishingIds.has(messageId) || publishedIds.has(messageId)) return;

      setPublishingIds((prev) => {
        const next = new Set(prev);
        next.add(messageId);
        return next;
      });

      try {
        const args: PublishChatImageArgs = {
          imageUrl,
          uploaderId,
          teamId,
          clubId,
        };
        const result = await publishChatImageToGallery(args);
        setPublishedIds((prev) => {
          const next = new Set(prev);
          next.add(messageId);
          return next;
        });
        toast.success(
          result.alreadyPublished
            ? "Already in the media gallery"
            : "Added to media gallery",
        );
      } catch (err: any) {
        console.error("[usePublishChatImage] failed", err);
        toast.error(err?.message || "Couldn't add to gallery");
      } finally {
        setPublishingIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [canPublish, uploaderId, teamId, clubId, publishingIds, publishedIds],
  );

  /**
   * Throttled toast nudge — call right after the user sends an image message.
   * Shows at most once every 24h per device, with an "Add" action that triggers
   * the publish flow once the message id resolves.
   */
  const nudgeAfterSend = useCallback(
    (resolveMessageId: () => string | null, imageUrl: string) => {
      if (!canPublish) return;
      if (!shouldShowGalleryNudge()) return;
      markGalleryNudgeShown();
      toast("Photo shared in chat", {
        description: "Also add it to the Media Gallery so it's saved for the team?",
        duration: 8000,
        action: {
          label: "Add",
          onClick: () => {
            const id = resolveMessageId();
            if (!id) return;
            void publish(id, imageUrl);
          },
        },
      });
    },
    [canPublish, publish],
  );

  return {
    publishingIds,
    publishedIds,
    publish,
    nudgeAfterSend,
    canPublish,
  };
}
