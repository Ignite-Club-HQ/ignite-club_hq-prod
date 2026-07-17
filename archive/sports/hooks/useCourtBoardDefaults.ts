/**
 * useCourtBoardDefaults — loads and persists the per-team default game-board
 * settings shared by basketball + netball boards.
 *
 * Soccer is intentionally untouched; it has its own settings flow via
 * `usePitchSettings.ts` and `team_subscriptions.{minutes_per_half, ...}`.
 *
 * Defaults live on `team_subscriptions` under `court_*` columns and apply
 * the FIRST time a coach opens the board on a fresh device. Once the board
 * is running, in-game changes flow through the existing localStorage +
 * `active_games` sync path so we never overwrite a live game.
 */

import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CourtRotationMode = "off" | "time-based" | "quarter-break";
export type CourtValidationMode = "free" | "warn" | "strict" | "structured";
export type CourtPeriodType = "quarters" | "halves";

export interface CourtBoardDefaults {
  minutesPerQuarter: number | null;
  rotationMode: CourtRotationMode | null;
  rotationIntervalMinutes: number | null;
  validationMode: CourtValidationMode | null;
  periodType: CourtPeriodType | null;
  timeoutsPerHalf: number | null;
}

const EMPTY_DEFAULTS: CourtBoardDefaults = {
  minutesPerQuarter: null,
  rotationMode: null,
  rotationIntervalMinutes: null,
  validationMode: null,
  periodType: null,
  timeoutsPerHalf: null,
};

export function useCourtBoardDefaults(teamId: string, readOnly: boolean) {
  const { data: defaults = EMPTY_DEFAULTS, isLoading } = useQuery({
    queryKey: ["court-board-defaults", teamId],
    queryFn: async (): Promise<CourtBoardDefaults> => {
      const { data } = await supabase
        .from("team_subscriptions")
        .select(
          "court_minutes_per_quarter, court_rotation_mode, court_rotation_interval_minutes, court_validation_mode, court_period_type, court_timeouts_per_half"
        )
        .eq("team_id", teamId)
        .maybeSingle();
      return {
        minutesPerQuarter: data?.court_minutes_per_quarter ?? null,
        rotationMode: (data?.court_rotation_mode as CourtRotationMode) ?? null,
        rotationIntervalMinutes: data?.court_rotation_interval_minutes ?? null,
        validationMode: (data?.court_validation_mode as CourtValidationMode) ?? null,
        periodType: (data?.court_period_type as CourtPeriodType) ?? null,
        timeoutsPerHalf: data?.court_timeouts_per_half ?? null,
      };
    },
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
  });

  /**
   * Persist a single default. Builds an upsert that always carries `team_id`
   * so we don't blow away unrelated columns on conflict.
   */
  const persist = useCallback(
    async (overrides: Partial<{
      court_minutes_per_quarter: number;
      court_rotation_mode: CourtRotationMode;
      court_rotation_interval_minutes: number;
      court_validation_mode: CourtValidationMode;
      court_period_type: CourtPeriodType;
      court_timeouts_per_half: number;
    }>) => {
      if (readOnly) return;
      try {
        await supabase
          .from("team_subscriptions")
          .upsert({ team_id: teamId, ...overrides }, { onConflict: "team_id" });
      } catch (e) {
        console.error("[useCourtBoardDefaults] failed to persist:", e);
      }
    },
    [teamId, readOnly]
  );

  return { defaults, isLoading, persist };
}

/**
 * Helper: apply a loaded default to a setter, but only if the user hasn't
 * already touched the value (i.e. local state still equals the initial
 * fallback). Used inside a `useEffect` once defaults arrive from the DB.
 */
export function useApplyDefaultOnce<T>(
  loaded: T | null | undefined,
  isLoading: boolean,
  current: T,
  fallback: T,
  apply: (next: T) => void
) {
  useEffect(() => {
    if (isLoading) return;
    if (loaded === null || loaded === undefined) return;
    // Only apply if the user hasn't already moved off the fallback value.
    if (current !== fallback) return;
    if (loaded === current) return;
    apply(loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, isLoading]);
}
