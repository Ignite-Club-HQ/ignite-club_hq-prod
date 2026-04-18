import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fetch view counts for a list of photos.
 * Returns a Map of photoId -> count.
 */
export function usePhotoViewCounts(photoIds: string[]) {
  const key = photoIds.length > 0
    ? `${photoIds.length}:${photoIds[0]}:${photoIds[photoIds.length - 1]}`
    : "";

  return useQuery({
    queryKey: ["photo-view-counts", key],
    queryFn: async () => {
      if (photoIds.length === 0) return new Map<string, number>();
      const { data, error } = await supabase
        .from("photo_views")
        .select("photo_id")
        .in("photo_id", photoIds);
      if (error) {
        console.error("Error fetching photo view counts:", error);
        return new Map<string, number>();
      }
      const counts = new Map<string, number>();
      for (const row of data || []) {
        counts.set(row.photo_id, (counts.get(row.photo_id) || 0) + 1);
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
  const idsKey = photoIds.length > 0
    ? `${photoIds.length}:${photoIds[0]}:${photoIds[photoIds.length - 1]}`
    : "";

  useEffect(() => {
    if (photoIds.length === 0) return;
    const ids = new Set(photoIds);

    const channel = supabase
      .channel(`photo-views-${idsKey}`)
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
  }, [idsKey, queryClient]);
}
