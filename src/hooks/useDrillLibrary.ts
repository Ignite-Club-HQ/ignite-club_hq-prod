import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  listDrills,
  loadDrill,
  deleteDrill,
  stampRecentUse,
  type LibraryTab,
  type DrillSummary,
} from "@/components/pitch/training/drillStorage";
import type { Drill } from "@/components/pitch/training/types";

const KEYS = {
  list: (tab: LibraryTab, teamId?: string, search?: string) =>
    ["drills", "list", tab, teamId ?? null, search ?? ""] as const,
  one: (id: string) => ["drills", "one", id] as const,
};

export function useDrillList(tab: LibraryTab, teamId?: string, search?: string) {
  return useQuery<DrillSummary[]>({
    queryKey: KEYS.list(tab, teamId, search),
    queryFn: () => listDrills({ tab, teamId, search }),
    staleTime: 30_000,
  });
}

export function useDrill(drillId: string | null) {
  return useQuery<Drill>({
    queryKey: drillId ? KEYS.one(drillId) : ["drills", "one", "none"],
    queryFn: () => loadDrill(drillId!),
    enabled: !!drillId,
  });
}

export function useDeleteDrill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (drillId: string) => deleteDrill(drillId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drills"] });
    },
  });
}

export function useStampRecent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (drillId: string) => stampRecentUse(drillId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drills", "list", "recent"] });
    },
  });
}

export function useInvalidateDrills() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["drills"] });
}
