import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const FREE_PHOTO_UPLOADS_PER_CYCLE = 20;
export const FREE_FILE_COUNT = 10;
export const FREE_FILE_STORAGE_BYTES = 100 * 1024 * 1024; // 100 MB
export const FREE_POLLS_PER_CYCLE = 2;

export interface ClubFreeUsage {
  isPro: boolean;
  cycleStart: Date | null;
  cycleEnd: Date | null;
  photo: {
    used: number;
    limit: number;
    atCountCap: boolean;
    atCap: boolean;
  };
  file: {
    used: number;
    limit: number;
    storageUsed: number;
    storageLimit: number;
    atCountCap: boolean;
    atStorageCap: boolean;
    atCap: boolean;
  };
  poll: {
    used: number;
    limit: number;
    atCap: boolean;
  };
}

/**
 * Read Free-tier usage counters for a club. Used to render usage meters and
 * gate uploads/polls at the call site. Returns isPro=true for clubs with
 * active Pro access — callers should skip caps in that case.
 */
export function useClubFreeUsage(clubId: string | null | undefined) {
  const enabled = !!clubId;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["club-free-usage", clubId],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ClubFreeUsage | null> => {
      const { data, error } = await supabase.rpc("get_club_free_usage", {
        _club_id: clubId!,
      });
      if (error) {
        console.error("[useClubFreeUsage] rpc failed", error);
        return null;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;

      const photoUsed = Number(row.photo_uploads_this_cycle ?? 0);
      const fileUsed = Number(row.file_count ?? 0);
      const fileBytes = Number(row.file_storage_bytes ?? 0);
      const pollUsed = Number(row.polls_this_cycle ?? 0);
      const isPro = !!row.is_pro;

      return {
        isPro,
        cycleStart: row.cycle_start ? new Date(row.cycle_start) : null,
        cycleEnd: row.cycle_end ? new Date(row.cycle_end) : null,
        photo: {
          used: photoUsed,
          limit: FREE_PHOTO_UPLOADS_PER_CYCLE,
          atCountCap: !isPro && photoUsed >= FREE_PHOTO_UPLOADS_PER_CYCLE,
          atCap: !isPro && photoUsed >= FREE_PHOTO_UPLOADS_PER_CYCLE,
        },
        file: {
          used: fileUsed,
          limit: FREE_FILE_COUNT,
          storageUsed: fileBytes,
          storageLimit: FREE_FILE_STORAGE_BYTES,
          atCountCap: !isPro && fileUsed >= FREE_FILE_COUNT,
          atStorageCap: !isPro && fileBytes >= FREE_FILE_STORAGE_BYTES,
          atCap:
            !isPro &&
            (fileUsed >= FREE_FILE_COUNT || fileBytes >= FREE_FILE_STORAGE_BYTES),
        },
        poll: {
          used: pollUsed,
          limit: FREE_POLLS_PER_CYCLE,
          atCap: !isPro && pollUsed >= FREE_POLLS_PER_CYCLE,
        },
      };
    },
  });

  return { usage: data ?? null, isLoading, refetch };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
