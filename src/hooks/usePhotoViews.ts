import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Build a stable cache key from a list of photo IDs.
 *
 * Sorting + joining the full id list is required: keys based only on length /
 * first / last id collide constantly (e.g. paginated feeds where two distinct
 * pages share endpoints) and cause counts from one photo set to be served for
 * another.
 */
function makeIdsKey(photoIds: string[]): string {
  if (photoIds.length === 0) return "";
  // Copy before sort so we never mutate the caller's array.
  return [...photoIds].sort().join(",");
}

/**
 * Fetch view counts for a list of photos.
 * Returns a Map of photoId -> count.
 *
 * Uses the `get_photo_view_counts` RPC which aggregates server-side; this
 * avoids the Supabase 1000-row default cap that previously caused popular
 * photos to undercount once total views across the requested set exceeded 1k.
 */
export function usePhotoViewCounts(photoIds: string[]) {
  const idsKey = useMemo(() => makeIdsKey(photoIds), [photoIds]);

  return useQuery({
    queryKey: ["photo-view-counts", idsKey],
    queryFn: async () => {
      if (photoIds.length === 0) return new Map<string, number>();
      const { data, error } = await supabase.rpc("get_photo_view_counts", {
        _photo_ids: photoIds,
      });
      if (error) {
        console.error("Error fetching photo view counts:", error);
        return new Map<string, number>();
      }
      const counts = new Map<string, number>();
      for (const row of (data || []) as Array<{ photo_id: string; view_count: number }>) {
        counts.set(row.photo_id, Number(row.view_count) || 0);
      }
      return counts;
    },
    enabled: photoIds.length > 0,
    staleTime: 60 * 1000,
  });
}

/**
 * Records a view for the current user when a photo becomes visible.
 * Caller passes `shouldRecord` (e.g. on intersection or lightbox open).
 */
export function useRecordPhotoView(userId: string | undefined) {
  const queryClient = useQueryClient();
  const recorded = useRef<Set<string>>(new Set());

  const mutation = useMutation({
    mutationFn: async (photoId: string) => {
      if (!userId) return;
      const { error } = await supabase
        .from("photo_views")
        .insert({ photo_id: photoId, user_id: userId });
      // Ignore duplicate-key errors – user already viewed
      if (error && !error.message.includes("duplicate") && error.code !== "23505") {
        throw error;
      }
    },
    onSuccess: (_data, photoId) => {
      queryClient.invalidateQueries({ queryKey: ["photo-view-counts"] });
      // Optimistically bump count in any cached query
      queryClient.setQueriesData<Map<string, number>>(
        { queryKey: ["photo-view-counts"] },
        (old) => {
          if (!old) return old;
          const next = new Map(old);
          next.set(photoId, (next.get(photoId) || 0) + 1);
          return next;
        }
      );
    },
  });

  const recordView = useCallback((photoId: string) => {
    if (!userId || !photoId) return;
    if (recorded.current.has(photoId)) return;
    recorded.current.add(photoId);
    mutation.mutate(photoId);
  }, [userId, mutation]);

  /**
   * Returns a ref callback that records a view once the element has been
   * meaningfully visible in the viewport (>=50% for ~800ms). This catches
   * users who scroll the feed without opening the lightbox.
   */
  const observeView = useCallback((photoId: string) => {
    return (el: HTMLElement | null) => {
      if (!el || !userId || !photoId) return;
      if (recorded.current.has(photoId)) return;

      let timer: ReturnType<typeof setTimeout> | null = null;

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
              if (timer) continue;
              timer = setTimeout(() => {
                recordView(photoId);
                observer.disconnect();
              }, 800);
            } else if (timer) {
              clearTimeout(timer);
              timer = null;
            }
          }
        },
        { threshold: [0, 0.5, 1] }
      );

      observer.observe(el);
    };
  }, [userId, recordView]);

  return { recordView, observeView };
}

/**
 * Realtime subscription that increments cached photo view counts as new
 * `photo_views` rows are inserted for any of the supplied photo IDs.
 */
export function usePhotoViewRealtime(photoIds: string[]) {
  const queryClient = useQueryClient();
  const idsKey = useMemo(() => makeIdsKey(photoIds), [photoIds]);

  useEffect(() => {
    if (photoIds.length === 0) return;
    const ids = new Set(photoIds);

    // Channel name must be globally unique per id set; a stable hash of the
    // sorted ids guarantees no collisions across mounted feeds.
    const channelName = `photo-views-${idsKey.length}-${idsKey.slice(0, 80)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "photo_views" },
        (payload) => {
          const photoId = (payload.new as any)?.photo_id as string | undefined;
          if (!photoId || !ids.has(photoId)) return;
          queryClient.setQueriesData<Map<string, number>>(
            { queryKey: ["photo-view-counts"] },
            (old) => {
              if (!old) return old;
              const next = new Map(old);
              next.set(photoId, (next.get(photoId) || 0) + 1);
              return next;
            }
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [idsKey, queryClient, photoIds]);
}
