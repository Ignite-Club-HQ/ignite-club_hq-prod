import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  listDrills,
  loadDrill,
  deleteDrill,
  stampRecentUse,
  listSessionDrills,
  addToSession,
  removeFromSession,
  clearSession,
  listUpcomingTrainingEvents,
  listEventDrills,
  saveSessionToEvent,
  type LibraryTab,
  type DrillSummary,
  type SessionDrill,
  type UpcomingTrainingEvent,
} from "@/components/pitch/training/drillStorage";
import type { Drill } from "@/components/pitch/training/types";

const KEYS = {
  list: (tab: LibraryTab, teamId?: string, search?: string) =>
    ["drills", "list", tab, teamId ?? null, search ?? ""] as const,
  one: (id: string) => ["drills", "one", id] as const,
  session: () => ["drills", "session"] as const,
  eventDrills: (eventId: string) => ["drills", "event", eventId] as const,
  upcomingTraining: (teamId: string) =>
    ["drills", "upcoming-training", teamId] as const,
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

// ---------- Session plan ----------

export function useSessionDrills() {
  return useQuery<SessionDrill[]>({
    queryKey: KEYS.session(),
    queryFn: () => listSessionDrills(),
    staleTime: 10_000,
  });
}

export function useAddToSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (drillId: string) => addToSession(drillId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.session() }),
  });
}

export function useRemoveFromSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => removeFromSession(entryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.session() }),
  });
}

export function useClearSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => clearSession(),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.session() }),
  });
}

// ---------- Event-linked plan ----------

export function useUpcomingTrainingEvents(teamId: string | null | undefined) {
  return useQuery<UpcomingTrainingEvent[]>({
    queryKey: KEYS.upcomingTraining(teamId ?? ""),
    queryFn: () => listUpcomingTrainingEvents(teamId!),
    enabled: !!teamId,
    staleTime: 60_000,
  });
}

export function useEventDrills(eventId: string | null | undefined) {
  return useQuery<SessionDrill[]>({
    queryKey: KEYS.eventDrills(eventId ?? ""),
    queryFn: () => listEventDrills(eventId!),
    enabled: !!eventId,
    staleTime: 30_000,
  });
}

export function useSaveSessionToEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, drillIds }: { eventId: string; drillIds: string[] }) =>
      saveSessionToEvent(eventId, drillIds),
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: KEYS.eventDrills(vars.eventId) }),
  });
}
