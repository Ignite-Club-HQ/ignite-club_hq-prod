import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { cueSubDue } from "@/lib/gameCues";
import type { BasketballPlayer } from "@/components/basketball/types";

interface AssistantPlayer extends BasketballPlayer {}

interface UseBasketballCoachAssistantArgs {
  players: AssistantPlayer[];
  isRunning: boolean;
  isGameFinished: boolean;
  /** When true, suppress all alerts (e.g. coach paused auto-subs). */
  paused?: boolean;
  /** Total elapsed game seconds across all quarters. */
  totalElapsedSeconds: number;
  readOnly: boolean;
}

export interface CoachSuggestion {
  out: AssistantPlayer;
  in: AssistantPlayer;
  /** Seconds-played gap between out and in. */
  gapSeconds: number;
}

/**
 * Background "coach assistant" — silently observes playing time and surfaces:
 *   • the most over-played on-court player ("should rest")
 *   • the top 2 most under-played bench players ("owed minutes")
 *   • a single fairness-based sub recommendation
 *
 * Triggers a non-blocking toast + audio/haptic cue when a recommendation
 * first crosses the fairness threshold, with a cooldown so the coach is
 * never spammed. Manual subs naturally reset the recommendation because
 * minutesPlayed shifts.
 *
 * NOTHING in this hook mutates board state — the coach always decides.
 */
const FAIRNESS_GAP_TRIGGER_SECONDS = 120;   // 2 min gap → flag a recommendation
const FAIRNESS_GAP_RELEASE_SECONDS = 60;    // gap must close to <60s before next alert
const ALERT_COOLDOWN_MS = 90_000;           // never alert more than once per 90s
const MIN_GAME_SECONDS_BEFORE_ALERT = 90;   // first alert no earlier than 90s in

export function useBasketballCoachAssistant({
  players,
  isRunning,
  isGameFinished,
  paused = false,
  totalElapsedSeconds,
  readOnly,
}: UseBasketballCoachAssistantArgs) {
  const { toast } = useToast();

  const eligible = useMemo(
    () => players.filter((p) => !p.isInjured && !p.isFouledOut),
    [players]
  );
  const onCourt = useMemo(() => eligible.filter((p) => p.position !== null), [eligible]);
  const bench = useMemo(() => eligible.filter((p) => p.position === null), [eligible]);

  const overplayedOnCourtId = useMemo(() => {
    if (onCourt.length === 0 || bench.length === 0) return null;
    const sorted = [...onCourt].sort(
      (a, b) => (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0)
    );
    return sorted[0]?.id ?? null;
  }, [onCourt, bench.length]);

  /** Top 2 most under-played bench players, lowest minutes first. */
  const underplayedBenchIds = useMemo(() => {
    if (bench.length === 0) return [];
    return [...bench]
      .sort((a, b) => (a.minutesPlayed ?? 0) - (b.minutesPlayed ?? 0))
      .slice(0, 2)
      .map((p) => p.id);
  }, [bench]);

  const suggestion: CoachSuggestion | null = useMemo(() => {
    if (onCourt.length === 0 || bench.length === 0) return null;
    const out = onCourt.reduce<AssistantPlayer | null>((hi, p) => {
      if (!hi) return p;
      // Foul-trouble breaks ties — rest a player on 3+ fouls first.
      const aFoul = (p.fouls ?? 0) >= 3 ? 1 : 0;
      const bFoul = (hi.fouls ?? 0) >= 3 ? 1 : 0;
      if (aFoul !== bFoul) return aFoul > bFoul ? p : hi;
      return (p.minutesPlayed ?? 0) > (hi.minutesPlayed ?? 0) ? p : hi;
    }, null);
    const inPick = bench.reduce<AssistantPlayer | null>((lo, p) => {
      if (!lo) return p;
      return (p.minutesPlayed ?? 0) < (lo.minutesPlayed ?? 0) ? p : lo;
    }, null);
    if (!out || !inPick) return null;
    const gapSeconds = (out.minutesPlayed ?? 0) - (inPick.minutesPlayed ?? 0);
    if (gapSeconds < FAIRNESS_GAP_TRIGGER_SECONDS) return null;
    return { out, in: inPick, gapSeconds };
  }, [onCourt, bench]);

  // ---- Alert dispatch (cooldown + paused-aware, suppress while ignored) ----
  const lastAlertAtRef = useRef<number>(0);
  const armedRef = useRef<boolean>(true); // re-arms once gap closes below release threshold
  const lastAlertSubjectRef = useRef<string | null>(null);

  useEffect(() => {
    if (readOnly) return;
    if (!isRunning || isGameFinished || paused) return;
    if (totalElapsedSeconds < MIN_GAME_SECONDS_BEFORE_ALERT) return;

    if (!suggestion) {
      // Re-arm only when the situation is genuinely calmer than the release threshold.
      if (onCourt.length && bench.length) {
        const gap =
          Math.max(...onCourt.map((p) => p.minutesPlayed ?? 0)) -
          Math.min(...bench.map((p) => p.minutesPlayed ?? 0));
        if (gap < FAIRNESS_GAP_RELEASE_SECONDS) {
          armedRef.current = true;
          lastAlertSubjectRef.current = null;
        }
      }
      return;
    }

    if (!armedRef.current) return;
    const now = Date.now();
    if (now - lastAlertAtRef.current < ALERT_COOLDOWN_MS) return;

    // Avoid re-alerting the same out-player back-to-back.
    const subject = `${suggestion.out.id}->${suggestion.in.id}`;
    if (lastAlertSubjectRef.current === subject &&
        now - lastAlertAtRef.current < ALERT_COOLDOWN_MS * 2) return;

    lastAlertAtRef.current = now;
    armedRef.current = false;
    lastAlertSubjectRef.current = subject;
    cueSubDue();
    toast({
      title: "Sub suggested",
      description: `${suggestion.in.name} ON for ${suggestion.out.name}`,
      duration: 4000,
    });
  }, [suggestion, isRunning, isGameFinished, paused, totalElapsedSeconds, readOnly, toast, onCourt, bench]);

  return {
    overplayedOnCourtId,
    underplayedBenchIds,
    suggestion,
    /** True when a fresh fairness recommendation is active (drives the small badge). */
    hasActiveSuggestion: !!suggestion,
  };
}
