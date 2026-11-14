import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchMediaReactions } from "./mediaReadRepository";
import { removeMediaReaction, replaceMediaReaction } from "./mediaEngagementRepository";
import { beginReaction, cachedReactions, finishReaction, overlayPending, reactionKey, type PhotoReaction } from "./photoReactionState";

export function usePhotoReactions(userId: string | undefined, photoIds: readonly string[], profile?: PhotoReaction["profiles"]) {
  const client = useQueryClient();
  const key = reactionKey(userId, photoIds);
  const ids = key[2];
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (!userId) return [];
      const rows = await fetchMediaReactions(ids, undefined, signal);
      if (signal.aborted) throw new Error("Reaction read cancelled");
      return overlayPending(client, userId, ids, rows);
    },
    enabled: !!userId && ids.length > 0,
    initialData: () => cachedReactions(client, userId, ids),
    initialDataUpdatedAt: 0,
    staleTime: 120000,
    refetchOnMount: "always",
    // Native reconnect/resume is owned by the existing staggered adapter.
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const mutation = useMutation({
    mutationFn: async ({ photoId, reactionType, accountId }: { photoId: string; reactionType: string | null; accountId: string }) => {
      if (reactionType === null) await removeMediaReaction({ photoId, userId: accountId });
      else await replaceMediaReaction({ photoId, userId: accountId, reactionType });
    },
    onMutate: ({ photoId, reactionType, accountId }) => beginReaction(client, reactionKey(accountId, ids), {
      photoId, userId: accountId,
      reaction: reactionType === null ? null : { photo_id: photoId, user_id: accountId, reaction_type: reactionType, profiles: profile },
    }),
    onSuccess: async (_result, variables, context) => {
      await client.cancelQueries({ queryKey: ["photo-reactions", variables.accountId] });
      if (context) finishReaction(client, context, false);
    },
    onError: async (_error, variables, context) => {
      await client.cancelQueries({ queryKey: ["photo-reactions", variables.accountId] });
      if (context) finishReaction(client, context, true);
      toast.error("Couldn't save your reaction. Please try again.");
    },
    onSettled: (_result, _error, variables) => {
      void client.invalidateQueries({ queryKey: ["photo-reactions", variables.accountId] });
    },
  });
  return {
    ...query,
    react: (photoId: string, reactionType: string | null) => { if (userId) mutation.mutate({ photoId, reactionType, accountId: userId }); },
    pendingPhotoId: mutation.isPending && mutation.variables?.accountId === userId ? mutation.variables.photoId : null,
  };
}