import { useState, useMemo, useEffect, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Clock, Play, AlertTriangle, RefreshCw, Loader2, X, BarChart3, Pencil, ChevronDown, Settings2, RotateCcw, Sparkles, ShieldCheck, ShieldAlert, Zap, Wand2, Check, ArrowRight, Sliders, GripVertical, Info } from "lucide-react";
import { PitchPosition } from "./PositionBadge";
import { cn } from "@/lib/utils";
import SubPlanEditor from "./SubPlanEditor";
import { buildSubWindows } from "./planner/windows";
import { buildEqualTimePlan } from "./planner/equalTime";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";


interface PlayerTimeForecast {
  player: Player;
  predictedMinutes: number;
  percentageOfGame: number;
  startsOnPitch: boolean;
  gkRole?: 'full' | '1h' | '2h'; // GK for full game, 1st half, or 2nd half
}

// Calculate playing time forecast for each player based on the plan
export function calculateTimeForecasts(
  players: Player[],
  plan: SubstitutionEvent[],
  minutesPerHalf: number,
  preferredSecondHalfGkId?: string,
  rotateGkAtHalftime: boolean = true,
  currentHalf: 1 | 2 = 1,
  currentElapsedSeconds: number = 0,
): PlayerTimeForecast[] {
  const totalGameMinutes = minutesPerHalf * 2;
  const halfSec = minutesPerHalf * 60;
  const startAbs = currentHalf === 1
    ? Math.min(currentElapsedSeconds, halfSec)
    : halfSec + Math.min(currentElapsedSeconds, halfSec);
  const playersOnPitch = players.filter(p => p.position !== null);
  const benchPlayers = players.filter(p => p.position === null);
  
  // Track time on pitch for each player
  const timeOnPitch = new Map<string, number>();
  const startsOnPitchMap = new Map<string, boolean>();
  
  // Initialize all players
  players.forEach(p => {
    timeOnPitch.set(p.id, 0);
    startsOnPitchMap.set(p.id, p.position !== null);
  });
  
  // Track who's on pitch at any moment
  const currentOnPitch = new Set(playersOnPitch.map(p => p.id));

  playersOnPitch.forEach(player => {
    timeOnPitch.set(player.id, player.minutesPlayed || 0);
  });

  // Determine GK roles
  const startingGk = playersOnPitch.find(p => inferredPitchPosition(p) === "GK");
  // Find the halftime GK swap (a sub at time 0 in half 2 involving the starting GK)
  const gkSwapSub = startingGk 
    ? plan.find(s => s.half === 2 && s.time === 0 && s.playerOut.id === startingGk.id)
    : null;
  const preferredSecondHalfGk = preferredSecondHalfGkId
    ? players.find(p => p.id === preferredSecondHalfGkId && p.id !== startingGk?.id)
    : undefined;
  const inferredSecondHalfGk = rotateGkAtHalftime && currentHalf === 1
    ? preferredSecondHalfGk || gkSwapSub?.playerIn
    : undefined;
  
  const gkRoles = new Map<string, 'full' | '1h' | '2h'>();
  if (startingGk) {
    if (inferredSecondHalfGk) {
      gkRoles.set(startingGk.id, '1h');
      gkRoles.set(inferredSecondHalfGk.id, '2h');
    } else {
      gkRoles.set(startingGk.id, 'full');
    }
  }
  
  const orderedPlan = [...plan]
    .filter(sub => !sub.executed && !sub.skipped)
    .map(sub => ({ sub, abs: sub.half === 1 ? sub.time : halfSec + sub.time }))
    .filter(item => item.abs >= startAbs)
    .sort((a, b) => a.abs - b.abs);
  let lastTime = startAbs;

  for (const { sub, abs } of orderedPlan) {
    const elapsed = Math.max(0, abs - lastTime);
    currentOnPitch.forEach(playerId => {
      timeOnPitch.set(playerId, (timeOnPitch.get(playerId) || 0) + elapsed);
    });
    currentOnPitch.delete(sub.playerOut.id);
    currentOnPitch.add(sub.playerIn.id);
    lastTime = abs;
  }

  const remaining = Math.max(0, halfSec * 2 - lastTime);
  currentOnPitch.forEach(playerId => {
    timeOnPitch.set(playerId, (timeOnPitch.get(playerId) || 0) + remaining);
  });
  
  // Convert to forecast objects
  return players.map(player => ({
    player,
    predictedMinutes: Math.round((timeOnPitch.get(player.id) || 0) / 60),
    percentageOfGame: Math.round(((timeOnPitch.get(player.id) || 0) / 60 / totalGameMinutes) * 100),
    startsOnPitch: startsOnPitchMap.get(player.id) || false,
    gkRole: gkRoles.get(player.id),
  })).sort((a, b) => b.predictedMinutes - a.predictedMinutes);
}

// ===========================================================================
// Fairness Simulator
// ---------------------------------------------------------------------------
// Walk a generated plan and produce per-player stint stats: total minutes,
// number of short shifts (<3 min on pitch) and bounce-backs (<3 min on bench
// between two on-pitch stints). Used by the in-dialog Fairness Simulator
// to surface problematic plans before the coach commits.
// ===========================================================================

const FAIRNESS_SHORT_SHIFT_SECONDS = 180;
const FAIRNESS_BOUNCE_BACK_SECONDS = 180;

interface FairnessPlayerStat {
  playerId: string;
  playerName: string;
  totalSeconds: number;
  shortShifts: number;
  bounceBacks: number;
  startsOnPitch: boolean;
}

interface FairnessReport {
  perPlayer: FairnessPlayerStat[];
  spreadSeconds: number;          // max - min playing time
  minSeconds: number;
  maxSeconds: number;
  avgSeconds: number;
  totalShortShifts: number;
  totalBounceBacks: number;
  totalSubs: number;
  /** Subjective overall grade derived from spread + short-shift count. */
  grade: "excellent" | "good" | "fair" | "poor";
}

function calculateFairnessReport(
  players: { id: string; name: string; position: { x: number; y: number } | null }[],
  plan: SubstitutionEvent[],
  minutesPerHalf: number,
): FairnessReport {
  const halfSec = minutesPerHalf * 60;
  const totalSec = halfSec * 2;

  // Per-player stints in absolute seconds. Starters open at 0; bench players
  // open a stint when subbed on, close it when subbed off.
  const stints = new Map<string, { start: number; end: number }[]>();
  for (const p of players) {
    stints.set(p.id, p.position !== null ? [{ start: 0, end: totalSec }] : []);
  }

  const events = [...plan].sort((a, b) => {
    const aAbs = (a.half - 1) * halfSec + a.time;
    const bAbs = (b.half - 1) * halfSec + b.time;
    return aAbs - bAbs;
  });

  for (const ev of events) {
    if (ev.skipped) continue;
    const abs = (ev.half - 1) * halfSec + ev.time;
    const outArr = stints.get(ev.playerOut.id);
    if (outArr && outArr.length) {
      const last = outArr[outArr.length - 1];
      if (last.end > abs) last.end = abs;
    }
    const inArr = stints.get(ev.playerIn.id);
    if (inArr) inArr.push({ start: abs, end: totalSec });
  }

  const perPlayer: FairnessPlayerStat[] = players.map((p) => {
    const arr = stints.get(p.id) || [];
    let total = 0;
    let shortShifts = 0;
    let bounceBacks = 0;
    for (let i = 0; i < arr.length; i++) {
      const dur = Math.max(0, arr[i].end - arr[i].start);
      total += dur;
      if (dur < FAIRNESS_SHORT_SHIFT_SECONDS) shortShifts++;
      if (i > 0) {
        const gap = arr[i].start - arr[i - 1].end;
        if (gap > 0 && gap < FAIRNESS_BOUNCE_BACK_SECONDS) bounceBacks++;
      }
    }
    return {
      playerId: p.id,
      playerName: p.name,
      totalSeconds: total,
      shortShifts,
      bounceBacks,
      startsOnPitch: p.position !== null,
    };
  });

  const totals = perPlayer.map((s) => s.totalSeconds);
  const minSeconds = totals.length ? Math.min(...totals) : 0;
  const maxSeconds = totals.length ? Math.max(...totals) : 0;
  const avgSeconds = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  const spreadSeconds = maxSeconds - minSeconds;
  const totalShortShifts = perPlayer.reduce((a, s) => a + s.shortShifts, 0);
  const totalBounceBacks = perPlayer.reduce((a, s) => a + s.bounceBacks, 0);

  // Grade thresholds (in minutes)
  const spreadMin = spreadSeconds / 60;
  let grade: FairnessReport["grade"];
  if (spreadMin <= 4 && totalShortShifts === 0 && totalBounceBacks === 0) grade = "excellent";
  else if (spreadMin <= 7 && totalShortShifts <= 1 && totalBounceBacks <= 1) grade = "good";
  else if (spreadMin <= 12 && totalShortShifts <= 3) grade = "fair";
  else grade = "poor";

  return {
    perPlayer: perPlayer.sort((a, b) => b.totalSeconds - a.totalSeconds),
    spreadSeconds,
    minSeconds,
    maxSeconds,
    avgSeconds,
    totalShortShifts,
    totalBounceBacks,
    totalSubs: events.length,
    grade,
  };
}

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isInjured?: boolean;
  teamSide?: "a" | "b";
}

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
  skipped?: boolean;
}

/**
 * Swap two players' lineup positions (and currentPitchPosition snapshot).
 * Used by the priority-bias loop to actually move a higher-priority bench
 * player onto the pitch (and the displaced starter to the bench) so the
 * scheduler then redistributes minutes from the new lineup. Full-game GKs
 * are never passed in here — only outfielders.
 */
export function swapLineupPositions(players: Player[], idA: string, idB: string): Player[] {
  const A = players.find(p => p.id === idA);
  const B = players.find(p => p.id === idB);
  if (!A || !B) return players;
  return players.map(p => {
    if (p.id === idA) return { ...p, position: B.position, currentPitchPosition: B.currentPitchPosition };
    if (p.id === idB) return { ...p, position: A.position, currentPitchPosition: A.currentPitchPosition };
    return p;
  });
}


interface MiniLeagueTeams {
  teamAPlayerIds: string[];
  teamBPlayerIds: string[];
  teamAColor?: string;
  teamBColor?: string;
  teamAName?: string;
  teamBName?: string;
}

/** Power-user overrides for sub-planner thresholds. All optional — when
 *  omitted the planner uses its built-in defaults. Exposed via the Advanced
 *  Settings panel in the AutoSubPlanDialog. */
export interface AutoSubAdvancedOverrides {
  /** Standard mode: hard floor on the sub-window cadence (sec). Default 240. */
  standardIntervalFloorSec?: number;
  /** Standard mode: target/maximum sub-window cadence (sec). Default 420. */
  standardTargetIntervalSec?: number;
  /** Frequent mode: minimum gap between sub windows (sec). Default 180. */
  frequentIntervalFloorSec?: number;
  /** Minimum on-pitch shift before a player can be pulled (sec). Default 180. */
  minShiftSeconds?: number;
  /** Halftime guard: no interval-driven sub windows within this many sec of HT
   *  (when a halftime GK swap is scheduled). Default = the active interval floor. */
  halftimeGuardSeconds?: number;
  /** Override the Max-Spread cap (sec) coming from the parent settings. When
   *  set, replaces the `maxSpreadMinutes` prop value. Lower = stricter
   *  fairness (planner sacrifices queue order sooner). */
  maxSpreadOverrideSec?: number;
  /** Optional coach drag order: lower index = should be favoured for more time. */
  playerPriorityOrder?: string[];
}

interface AutoSubPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Player[];
  teamSize: number;
  minutesPerHalf: number;
  onStartPlan: (plan: SubstitutionEvent[]) => void;
  existingPlan?: SubstitutionEvent[];
  editMode?: boolean;
  rotationSpeed?: number; // 1 = slow, 2 = medium, 3 = fast
  disablePositionSwaps?: boolean; // When true, skip position swaps in auto generation
  disableBatchSubs?: boolean; // When true, only do one sub at a time
  rotateGkAtHalftime?: boolean; // When true, swap GK at halftime
  /** Max acceptable playing-time spread (minutes). Planner stays in queue
   *  (FIFO) order while projected spread is within this cap; once projected
   *  to exceed it, fairness overrides queue. Defaults to 5 minutes. */
  maxSpreadMinutes?: number;
  currentElapsedSeconds?: number; // Current game elapsed seconds (for mid-game start)
  currentHalf?: 1 | 2; // Current half (for mid-game start)
  preferredSecondHalfGkId?: string; // Preferred 2nd half GK from lineup screen
  showStepper?: boolean; // Show the Lineup → Subs step indicator
  /** When provided alongside showStepper, the "Lineup" step becomes a button
   *  that closes the dialog and returns the user to the lineup picker. */
  onBackToLineup?: () => void;
  miniLeagueTeams?: MiniLeagueTeams; // When set, generate per-team plans
  /** Optional power-user overrides for planner thresholds. */
  advancedOverrides?: AutoSubAdvancedOverrides;
  /** Called when the priority-bias loop swaps players between starting and
   *  bench so the parent can sync its lineup before the plan runs. */
  onLineupChange?: (players: Player[]) => void;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const inferredOutfieldPosition = (player: Pick<Player, "currentPitchPosition" | "assignedPositions">): PitchPosition => {
  if (player.currentPitchPosition && player.currentPitchPosition !== "GK") return player.currentPitchPosition;
  return player.assignedPositions?.find(pos => pos !== "GK") || "MID";
};

const inferredPitchPosition = (player: Pick<Player, "currentPitchPosition" | "assignedPositions">): PitchPosition => {
  if (player.currentPitchPosition) return player.currentPitchPosition;
  if (player.assignedPositions?.length === 1 && player.assignedPositions[0] === "GK") return "GK";
  return inferredOutfieldPosition(player);
};

/**
 * STARVATION GUARANTEE — final post-pass.
 *
 * Some upstream branches (high min-shift overrides, single-half matches, GK
 * protection eating sub windows) can leave a healthy bench player with 0
 * scheduled minutes. The Riverside U12 case (9v9 +4, 20-min match) hit this:
 * only 4 sub events were generated, and the same bench player got recycled
 * so 2 others sat the whole match.
 *
 * This pass simulates the plan, finds outfield-eligible players with 0
 * minutes, and rewires existing sub events so each starved player comes ON
 * at least once — by replacing the `playerIn` of a sub whose original IN is
 * the most over-served. We never invent new windows, change OUT, or alter
 * timings; we only redirect who comes on. Position eligibility is honoured.
 *
 * If a starved player is structurally unsubbable (no compatible OUT
 * position in any existing window), they're left alone — better to surface
 * the issue in the diagnostics panel than to break the lineup.
 */
function ensureNoStarvedPlayers(
  plan: SubstitutionEvent[],
  players: Player[],
  halfDurationSeconds: number,
): SubstitutionEvent[] {
  if (plan.length === 0 || players.length === 0) return plan;

  const eligible = (p: Player) =>
    !p.isInjured &&
    !(p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK");

  const canPlay = (p: Player, pos?: PitchPosition) =>
    !pos || !p.assignedPositions?.length || p.assignedPositions.includes(pos);

  const totalSec = halfDurationSeconds * 2;
  const absTime = (s: SubstitutionEvent) =>
    s.half === 1 ? s.time : halfDurationSeconds + s.time;

  const simulate = (): Map<string, number> => {
    const onPitch = new Set(players.filter(p => p.position).map(p => p.id));
    const totals = new Map<string, number>(players.map(p => [p.id, 0]));
    const sorted = [...plan].sort((a, b) => absTime(a) - absTime(b));
    let last = 0;
    for (const ev of sorted) {
      const t = absTime(ev);
      onPitch.forEach(id => totals.set(id, (totals.get(id) ?? 0) + (t - last)));
      last = t;
      onPitch.delete(ev.playerOut.id);
      onPitch.add(ev.playerIn.id);
    }
    onPitch.forEach(id => totals.set(id, (totals.get(id) ?? 0) + (totalSec - last)));
    return totals;
  };

  // Walk the plan to know who is on the pitch and at which position throughout
  // the match. Used by both the rewire pass and the injection pass.
  const buildTimeline = () => {
    const sorted = [...plan].sort((a, b) => absTime(a) - absTime(b));
    const onPitch = new Map<string, PitchPosition | undefined>();
    players.filter(p => p.position).forEach(p => onPitch.set(p.id, p.currentPitchPosition));
    // Snapshot of who's on pitch at each event (BEFORE applying the event).
    const segments: { from: number; to: number; onPitch: Map<string, PitchPosition | undefined> }[] = [];
    let last = 0;
    for (const ev of sorted) {
      const t = absTime(ev);
      if (t > last) segments.push({ from: last, to: t, onPitch: new Map(onPitch) });
      onPitch.delete(ev.playerOut.id);
      onPitch.set(ev.playerIn.id, ev.playerOut.currentPitchPosition);
      last = t;
    }
    if (totalSec > last) segments.push({ from: last, to: totalSec, onPitch: new Map(onPitch) });
    return segments;
  };

  // Up to N rounds — each pass can only rescue starvation visible after the
  // previous swap, so iterate but cap to keep this O(n²) bounded.
  const MAX_ROUNDS = 4;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const totals = simulate();
    const starved = players
      .filter(p => eligible(p))
      .filter(p => (totals.get(p.id) ?? 0) === 0)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (starved.length === 0) break;

    let progressed = false;
    for (const victim of starved) {
      const candidates = plan
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => {
          if (s.positionSwap) return false; // don't corrupt position-swap chains
          if (s.playerIn.id === victim.id) return false;
          if (s.playerOut.id === victim.id) return false;
          if (!canPlay(victim, s.playerOut.currentPitchPosition)) return false;
          const sameWindowYoyo = plan.some(
            o => o !== s && absTime(o) === absTime(s) && o.playerOut.id === victim.id,
          );
          if (sameWindowYoyo) return false;
          const inIsAlsoStarved = starved.some(p => p.id === s.playerIn.id);
          if (inIsAlsoStarved) return false;
          return true;
        })
        .map(({ s, idx }) => ({ s, idx, inTotal: totals.get(s.playerIn.id) ?? 0 }))
        .sort((a, b) => b.inTotal - a.inTotal);

      if (candidates.length === 0) continue;

      const target = candidates[0];
      plan[target.idx] = { ...target.s, playerIn: victim };
      progressed = true;
    }

    if (!progressed) break;
  }

  // ---- Final injection pass --------------------------------------------------
  // Anyone still at 0 minutes after rewiring gets a brand-new sub event injected
  // mid-match. Pulls the most over-served on-pitch player they can replace.
  for (let inject = 0; inject < 6; inject++) {
    const totals = simulate();
    const stillStarved = players
      .filter(p => eligible(p))
      .filter(p => (totals.get(p.id) ?? 0) === 0)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (stillStarved.length === 0) break;

    let injectedAny = false;
    for (const victim of stillStarved) {
      const segments = buildTimeline();
      // Prefer the longest segment in H2 mid-half (avoids near-half-end edges).
      const ranked = segments
        .map(seg => ({ seg, dur: seg.to - seg.from }))
        .filter(r => r.dur >= 60) // need at least 1 min stint to matter
        .sort((a, b) => b.dur - a.dur);

      let placed = false;
      for (const { seg } of ranked) {
        // Find an over-served field player at this segment that victim can replace.
        const victimPos = victim.currentPitchPosition;
        const candidatesOut = [...seg.onPitch.entries()]
          .filter(([id]) => id !== victim.id)
          .filter(([id]) => {
            const p = players.find(pp => pp.id === id);
            if (!p) return false;
            if (p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK") return false;
            return true;
          })
          .filter(([, pos]) => canPlay(victim, pos))
          .map(([id, pos]) => ({ id, pos, total: totals.get(id) ?? 0 }))
          .sort((a, b) => b.total - a.total);

        if (candidatesOut.length === 0) continue;

        const out = candidatesOut[0];
        const playerOut = players.find(p => p.id === out.id);
        if (!playerOut) continue;

        // Insertion time: one-third into the segment (away from boundaries).
        const insertAbs = Math.floor(seg.from + Math.max(60, (seg.to - seg.from) / 3));
        const half: 1 | 2 = insertAbs < halfDurationSeconds ? 1 : 2;
        const time = half === 1 ? insertAbs : insertAbs - halfDurationSeconds;

        const newEvent: SubstitutionEvent = {
          half,
          time,
          executed: false,
          playerOut: { ...playerOut, currentPitchPosition: out.pos } as Player,
          playerIn: { ...victim, currentPitchPosition: out.pos } as Player,
        };
        plan.push(newEvent);
        injectedAny = true;
        placed = true;
        break;
      }
      if (!placed) {
        // Last-ditch: skip this victim; loop will terminate on no-progress.
      }
    }
    if (!injectedAny) break;
  }

  plan.sort((a, b) => absTime(a) - absTime(b));
  return plan;
}

export function isPlanPlayableFromPlayers(
  players: Pick<Player, "id" | "position">[],
  plan: Pick<SubstitutionEvent, "half" | "time" | "playerOut" | "playerIn" | "executed" | "skipped">[],
  halfDurationSeconds: number,
): boolean {
  const playerIds = new Set(players.map(p => p.id));
  const onPitch = new Set(players.filter(p => p.position !== null).map(p => p.id));
  const remainingPlan = plan
    .filter(sub => !sub.executed && !sub.skipped)
    .sort((a, b) =>
      (a.half === 1 ? a.time : halfDurationSeconds + a.time) -
      (b.half === 1 ? b.time : halfDurationSeconds + b.time)
    );

  for (const sub of remainingPlan) {
    if (!playerIds.has(sub.playerOut.id) || !playerIds.has(sub.playerIn.id)) return false;
    if (!onPitch.has(sub.playerOut.id) || onPitch.has(sub.playerIn.id)) return false;
    onPitch.delete(sub.playerOut.id);
    onPitch.add(sub.playerIn.id);
  }

  return true;
}

/**
 * Rotation modes (rotation_speed integer):
 * - 1 = Standard (DEFAULT) — FIFO queue, ~6–8 min between subs, 1–2 swaps per
 *   window, soft fairness (no spread escalation). Designed for real-world
 *   junior coaching: minimal interruptions, predictable order, "fair enough".
 * - 2 = Frequent — 2 subs / window, near-perfect fairness with full cycle.
 *
 * Anything outside 1–2 (including legacy 3 / null) collapses to the nearest mode.
 */
export const normalizeRotationSpeed = (speed: number | null | undefined): number => {
  const s = typeof speed === "number" ? speed : 1;
  if (s >= 2) return 2;
  return 1;
};

/** Target gap between Standard-mode sub windows (seconds). 7 min sits in the
 *  spec'd 6–8 min window: low disruption, predictable cadence. */
const PRACTICAL_SUB_INTERVAL_SECONDS = 7 * 60;
/** Maximum players swapped in a single Standard-mode window. */
const PRACTICAL_MAX_SUBS_PER_WINDOW = 2;
/** Fairness floor: players projected below this fraction of target minutes
 *  override the FIFO queue and are prioritised ON. */
const PRACTICAL_MIN_THRESHOLD_RATIO = 0.75;
/** Soft cap: players projected above this fraction of target minutes are
 *  prioritised to come OFF next AND blocked from coming ON. */
const PRACTICAL_MAX_THRESHOLD_RATIO = 1.2;
/** No subs before this minute mark from kickoff (settling-in window). */
const PRACTICAL_NO_SUB_BEFORE_SECONDS = 5 * 60;
/** No subs in this trailing window of each half. */
const PRACTICAL_NO_SUB_AFTER_SECONDS = 150; // 2.5 min
/** Players just subbed on are protected from being pulled off for this long. */
const PRACTICAL_RECENT_SUB_PROTECTION_SECONDS = 4 * 60;
/** How early (seconds) we may pull a sub forward to rescue a player who would
 *  otherwise breach the minimum threshold. */
const PRACTICAL_EARLY_SUB_TOLERANCE_SECONDS = 60;
/** Keep normal Standard windows from landing immediately beside forced GK
 *  participation windows. */
const PRACTICAL_GK_WINDOW_BUFFER_SECONDS = 3 * 60;

// ===========================================================================
// EQUAL-TIME OVERRIDE — global fairness post-pass.
// ---------------------------------------------------------------------------
// The conventional planner is a set of local heuristics (starter bias,
// continuity, GK protection, churn removal). Those heuristics are good at
// producing natural-looking rotations but they cannot see the whole match, so
// on some squad shapes — most visibly when the goalkeeper rotates at halftime —
// they settle on a plan whose playing-time spread breaks the coach's cap.
//
// `buildEqualTimePlan` solves the same problem globally: it allocates each
// player a per-half outfield budget (accounting for the halves a keeper is
// unavailable for outfield duty) and walks the match filling those budgets.
// This helper runs that planner across a range of substitution cadences and
// adopts its output when it is fairer than the conventional plan.
//
// It is deliberately shared by every branch of `createSubPlan` (standard,
// frequent and the legacy fallback) so fairness is enforced on the plan the
// coach actually receives, whichever branch produced it.
// ===========================================================================

/**
 * Playing-time totals using the same model as `calculateTimeForecasts` and the
 * pitch board itself: a player accrues time whenever they are on the pitch,
 * and a substitution takes `playerOut` off and puts `playerIn` on. Goalkeepers
 * are on the pitch, so their time is included automatically.
 */
function naivePlanTotals(
  players: Player[],
  plan: SubstitutionEvent[],
  halfDurationSeconds: number,
): Map<string, number> {
  const totalSec = halfDurationSeconds * 2;
  const onPitch = new Set(players.filter(p => p.position !== null).map(p => p.id));
  // Include time already banked before this plan. The equal-time planner uses
  // that history when compensating deficits; comparing candidate plans without
  // it could reject the corrective plan and preserve a visibly unfair one.
  const totals = new Map<string, number>(
    players.map(p => [p.id, Math.max(0, p.minutesPlayed ?? 0)] as const),
  );
  const abs = (s: SubstitutionEvent) =>
    s.half === 1 ? s.time : halfDurationSeconds + s.time;
  const ordered = [...plan].sort((a, b) => abs(a) - abs(b));
  let last = 0;
  for (const ev of ordered) {
    const t = Math.max(last, Math.min(totalSec, abs(ev)));
    onPitch.forEach(id => totals.set(id, (totals.get(id) ?? 0) + (t - last)));
    last = t;
    onPitch.delete(ev.playerOut.id);
    onPitch.add(ev.playerIn.id);
  }
  onPitch.forEach(id => totals.set(id, (totals.get(id) ?? 0) + (totalSec - last)));
  return totals;
}

/** Players the planner can actually rebalance — excludes locked-in keepers. */
function rebalanceablePlayers(players: Player[], rotateGkAtHalftime: boolean): Player[] {
  return players.filter(p => {
    if (p.isInjured) return false;
    const gkOnly =
      p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK";
    // A GK-only player is locked to goal for the whole match unless the keeper
    // rotates at halftime, in which case they are only locked for one half and
    // their total is still a fairness input.
    if (gkOnly && !rotateGkAtHalftime) return false;
    return true;
  });
}

function planSpreadSeconds(
  players: Player[],
  plan: SubstitutionEvent[],
  halfDurationSeconds: number,
  rotateGkAtHalftime: boolean,
): number {
  const totals = naivePlanTotals(players, plan, halfDurationSeconds);
  const values = rebalanceablePlayers(players, rotateGkAtHalftime).map(
    p => totals.get(p.id) ?? 0,
  );
  if (values.length < 2) return 0;
  return Math.max(...values) - Math.min(...values);
}

interface EqualTimeOverrideOptions {
  playerData: Player[];
  teamSize: number;
  halfDurationSeconds: number;
  gkOnPitch: Player | null | undefined;
  halftimeGkIn: Player | null | undefined;
  rotateGkAtHalftime: boolean;
  maxSpreadMinutes: number;
  rotationSpeed: number;
  eff: {
    standardTargetInterval: number;
    standardIntervalFloor: number;
    frequentIntervalFloor: number;
    minShiftSeconds: number;
  };
  priorityOrderLength: number;
  startHalf: 1 | 2;
  startElapsedSeconds: number;
  benchCount: number;
  currentPlan: SubstitutionEvent[];
}

function applyEqualTimeOverride(
  opts: EqualTimeOverrideOptions,
): SubstitutionEvent[] | null {
  const {
    playerData,
    teamSize,
    halfDurationSeconds,
    gkOnPitch,
    halftimeGkIn,
    rotateGkAtHalftime,
    maxSpreadMinutes,
    rotationSpeed,
    eff,
    priorityOrderLength,
    startHalf,
    startElapsedSeconds,
    benchCount,
    currentPlan,
  } = opts;

  // Only from kickoff, only when the coach hasn't imposed a manual priority
  // order (which is an explicit instruction to be unequal), and only when
  // there is somebody on the bench to rotate with.
  if (priorityOrderLength > 0 || startHalf !== 1 || startElapsedSeconds !== 0) return null;
  if (benchCount <= 0) return null;

  try {
    const capSec = Math.max(0, maxSpreadMinutes) * 60;
    const currentSpread = planSpreadSeconds(
      playerData,
      currentPlan,
      halfDurationSeconds,
      rotateGkAtHalftime,
    );

    // Sweep substitution cadences from the calmest to the busiest. The
    // equal-time planner groups swaps into windows spaced `minShiftSec` apart,
    // so a larger value means a quieter plan. Take the FIRST (calmest) cadence
    // that meets the cap; otherwise keep whichever produced the least spread.
    const cadenceFloor =
      rotationSpeed >= 2 ? eff.frequentIntervalFloor : eff.standardIntervalFloor;
    const rawCadences = [
      eff.standardTargetInterval,
      cadenceFloor,
      Math.max(60, eff.minShiftSeconds),
      240,
      180,
      120,
      90,
      60,
    ]
      .map(v => Math.max(60, Math.round(v)))
      .filter(v => v <= halfDurationSeconds);
    // Keep the sweep on the correct side of the selected mode's own cadence
    // floor. Without this, Standard and Frequent sweep the same superset and
    // both stop on whichever cadence first meets the spread cap — producing
    // identical plans regardless of the chosen rotation mode.
    const modeCadences = rawCadences.filter(v =>
      rotationSpeed >= 2 ? v <= eff.frequentIntervalFloor : v >= eff.standardIntervalFloor,
    );
    const cadences = Array.from(
      new Set(
        (modeCadences.length > 0
          ? modeCadences
          : [Math.max(60, Math.min(halfDurationSeconds, Math.round(cadenceFloor)))]),
      ),
    ).sort((a, b) => b - a);


    let best: { plan: SubstitutionEvent[]; spread: number } | null = null;
    for (const minShiftSec of cadences) {
      const eqResult = buildEqualTimePlan({
        players: playerData as unknown as Parameters<typeof buildEqualTimePlan>[0]["players"],
        teamSize,
        halfDurationSec: halfDurationSeconds,
        gk1H: (gkOnPitch || undefined) as never,
        gk2H: (rotateGkAtHalftime
          ? halftimeGkIn || gkOnPitch || undefined
          : gkOnPitch || undefined) as never,
        chunkSec: 30,
        minShiftSec,
        noSubBeforeSec: 0,
        noSubAfterSec: 30,
        // Standard deliberately prefers the compact equal-time cycle. Frequent
        // uses the windowed allocator so the two product modes do not collapse
        // to an identical number of match interruptions.
        preferCompactCycle: rotationSpeed < 2,
      });
      const candidate = eqResult.plan as unknown as SubstitutionEvent[];
      if (candidate.length === 0) continue;
      const spread = planSpreadSeconds(
        playerData,
        candidate,
        halfDurationSeconds,
        rotateGkAtHalftime,
      );
      if (!best || spread < best.spread) best = { plan: candidate, spread };
      if (spread <= capSec) break;
    }

    if (!best) return null;
    // Adopt when the equal-time plan meets the cap the conventional plan
    // misses, or when it is simply fairer. Ties keep the conventional plan so
    // the familiar rotation shape wins when fairness is equivalent.
    const currentMeetsCap = currentSpread <= capSec;
    const eqMeetsCap = best.spread <= capSec;
    if (eqMeetsCap && !currentMeetsCap) return best.plan;
    if (best.spread < currentSpread) return best.plan;
    return null;
  } catch (err) {
    // Never break the planner — fall through to the conventional output.
    // eslint-disable-next-line no-console
    console.warn("[createSubPlan] equal-time override failed:", err);
    return null;
  }
}


// ===========================================================================
// STANDARD-MODE CALMNESS GUARANTEE
// ---------------------------------------------------------------------------
// Product rule: "Standard" must ALWAYS be the quieter plan. Because fairness
// post-passes can push Standard onto a busier cadence than Frequent on some
// squad shapes, the public `createSubPlan` wraps the planner: it builds the
// Frequent reference plan for the same inputs and, if Standard came out with
// the same or more substitutions, re-plans Standard on progressively calmer
// interval floors until it is strictly quieter. Recursion is guarded so the
// inner calls never re-enter this wrapper.
// ===========================================================================
let standardCalmnessReentryGuard = false;

/** Calmer interval floors (sec) tried in order when Standard is too busy. */
const STANDARD_CALMDOWN_FLOORS_SEC = [300, 360, 420, 480, 540, 600];

const substitutionAbsoluteTime = (
  substitution: Pick<SubstitutionEvent, "half" | "time">,
  halfDurationSeconds: number,
) => substitution.half === 1
  ? substitution.time
  : halfDurationSeconds + substitution.time;

/** Product cadence is measured in interruption moments, not player movements. */
function countSubstitutionWindows(
  plan: SubstitutionEvent[],
  halfDurationSeconds: number,
): number {
  return new Set(plan.map((substitution) =>
    substitutionAbsoluteTime(substitution, halfDurationSeconds))).size;
}

/**
 * Find the fairest playable way to combine one adjacent pair of substitution
 * windows. This lets Standard remain genuinely quieter without deleting a
 * player's turn or hiding extra churn inside the plan.
 */
function compactOneSubstitutionWindow(
  source: SubstitutionEvent[],
  players: Player[],
  halfDurationSeconds: number,
  rotateGkAtHalftime: boolean,
  maxSpreadSeconds: number,
): SubstitutionEvent[] | null {
  const sourceWindows = Array.from(new Set(source.map((substitution) =>
    substitutionAbsoluteTime(substitution, halfDurationSeconds)))).sort((a, b) => a - b);
  if (sourceWindows.length < 2) return null;

  let best: { plan: SubstitutionEvent[]; spread: number } | null = null;
  const sameWindowYoyoCount = (plan: SubstitutionEvent[]) => {
    const windows = new Map<number, { ins: Set<string>; outs: Set<string> }>();
    for (const substitution of plan) {
      const absolute = substitutionAbsoluteTime(substitution, halfDurationSeconds);
      const window = windows.get(absolute) ?? { ins: new Set<string>(), outs: new Set<string>() };
      window.ins.add(substitution.playerIn.id);
      window.outs.add(substitution.playerOut.id);
      windows.set(absolute, window);
    }
    let count = 0;
    windows.forEach((window) => window.ins.forEach((id) => {
      if (window.outs.has(id)) count += 1;
    }));
    return count;
  };
  const sourceYoyos = sameWindowYoyoCount(source);
  for (let index = 0; index < sourceWindows.length - 1; index += 1) {
    const left = sourceWindows[index];
    const right = sourceWindows[index + 1];
    // Never merge across the halftime boundary. Keep the halftime goalkeeper
    // handover as its own explicit, predictable operation.
    if ((left < halfDurationSeconds) !== (right < halfDurationSeconds)) continue;
    if (left === halfDurationSeconds || right === halfDurationSeconds) continue;

    const midpoint = Math.round(((left + right) / 2) / 30) * 30;
    for (const target of Array.from(new Set([left, midpoint, right]))) {
      const candidate = source.map((substitution) => {
        const absolute = substitutionAbsoluteTime(substitution, halfDurationSeconds);
        if (absolute !== left && absolute !== right) return substitution;
        return {
          ...substitution,
          half: (target < halfDurationSeconds ? 1 : 2) as 1 | 2,
          time: target < halfDurationSeconds ? target : target - halfDurationSeconds,
        };
      }).sort((a, b) =>
        substitutionAbsoluteTime(a, halfDurationSeconds) -
        substitutionAbsoluteTime(b, halfDurationSeconds));

      if (!isPlanPlayableFromPlayers(players, candidate, halfDurationSeconds)) continue;
      // Combining windows must not create an on/off instruction for the same
      // player at one whistle. Preserve any unavoidable existing halftime GK
      // handover, but never introduce additional yo-yos.
      if (sameWindowYoyoCount(candidate) > Math.max(1, sourceYoyos)) continue;
      const spread = planSpreadSeconds(
        players,
        candidate,
        halfDurationSeconds,
        rotateGkAtHalftime,
      );
      if (spread > maxSpreadSeconds) continue;
      if (!best || spread < best.spread) best = { plan: candidate, spread };
    }
  }
  return best?.plan ?? null;
}

export function createSubPlan(
  playerData: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  rotationSpeedInput: number = 1,
  disablePositionSwaps: boolean = false,
  disableBatchSubs: boolean = false,
  rotateGkAtHalftime: boolean = true,
  startElapsedSeconds: number = 0,
  startHalf: 1 | 2 = 1,
  preferredSecondHalfGkId?: string,
  maxSpreadMinutes: number = 5,
  advancedOverrides: AutoSubAdvancedOverrides = {}
): SubstitutionEvent[] {
  const run = (speed: number, overrides: AutoSubAdvancedOverrides) =>
    createSubPlanInternal(
      playerData,
      teamSize,
      halfDurationSeconds,
      speed,
      disablePositionSwaps,
      disableBatchSubs,
      rotateGkAtHalftime,
      startElapsedSeconds,
      startHalf,
      preferredSecondHalfGkId,
      maxSpreadMinutes,
      overrides,
    );

  const plan = run(rotationSpeedInput, advancedOverrides);
  const speed = normalizeRotationSpeed(rotationSpeedInput);
  // Only Standard (speed 1) carries the "always fewer subs" promise.
  if (speed !== 1 || standardCalmnessReentryGuard || plan.length === 0) return plan;

  standardCalmnessReentryGuard = true;
  try {
    const frequentReference = run(2, advancedOverrides);
    if (frequentReference.length === 0) {
      return plan;
    }

    const frequentWindows = countSubstitutionWindows(frequentReference, halfDurationSeconds);
    const capSeconds = Math.max(0, maxSpreadMinutes) * 60;
    const qualifying: SubstitutionEvent[][] = [];
    const consider = (candidate: SubstitutionEvent[] | null) => {
      if (!candidate) return;
      if (countSubstitutionWindows(candidate, halfDurationSeconds) >= frequentWindows) return;
      if (candidate.length > frequentReference.length) return;
      if (planSpreadSeconds(
        playerData,
        candidate,
        halfDurationSeconds,
        rotateGkAtHalftime,
      ) > capSeconds) return;
      qualifying.push(candidate);
    };

    consider(plan);
    consider(compactOneSubstitutionWindow(
      plan,
      playerData,
      halfDurationSeconds,
      rotateGkAtHalftime,
      capSeconds,
    ));
    // Frequent is the tightest fair allocation. Coalescing one of its windows
    // is a safe Standard candidate: same player movements, one less match
    // interruption, and accepted only if the selected spread remains intact.
    consider(compactOneSubstitutionWindow(
      frequentReference,
      playerData,
      halfDurationSeconds,
      rotateGkAtHalftime,
      capSeconds,
    ));

    let best = plan;
    for (const floorSec of STANDARD_CALMDOWN_FLOORS_SEC) {
      if (floorSec > halfDurationSeconds) break;
      const calmer = run(1, {
        ...advancedOverrides,
        standardIntervalFloorSec: floorSec,
        standardTargetIntervalSec: Math.max(
          floorSec,
          advancedOverrides.standardTargetIntervalSec ?? floorSec + 120,
        ),
      });
      if (calmer.length === 0) continue;
      if (calmer.length < best.length) best = calmer;
      consider(calmer);
      consider(compactOneSubstitutionWindow(
        calmer,
        playerData,
        halfDurationSeconds,
        rotateGkAtHalftime,
        capSeconds,
      ));
      // Preserve the legacy fallback boundary when no cap-preserving compact
      // candidate exists. Continuing to ever-higher floors can reduce raw
      // event count at the cost of a dramatically worse playing-time spread.
      if (best.length < frequentReference.length) break;
    }

    if (qualifying.length > 0) {
      return qualifying.sort((left, right) => {
        const spreadDelta = planSpreadSeconds(
          playerData, left, halfDurationSeconds, rotateGkAtHalftime,
        ) - planSpreadSeconds(
          playerData, right, halfDurationSeconds, rotateGkAtHalftime,
        );
        if (spreadDelta !== 0) return spreadDelta;
        return countSubstitutionWindows(left, halfDurationSeconds) -
          countSubstitutionWindows(right, halfDurationSeconds);
      })[0];
    }
    return best;
  } catch {
    return plan;
  } finally {
    standardCalmnessReentryGuard = false;
  }
}

function createSubPlanInternal(

  playerData: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  rotationSpeedInput: number = 1,
  disablePositionSwaps: boolean = false,
  disableBatchSubs: boolean = false,
  rotateGkAtHalftime: boolean = true,
  startElapsedSeconds: number = 0,
  startHalf: 1 | 2 = 1,
  preferredSecondHalfGkId?: string,
  maxSpreadMinutes: number = 5,
  advancedOverrides: AutoSubAdvancedOverrides = {}
): SubstitutionEvent[] {
  const rotationSpeed = normalizeRotationSpeed(rotationSpeedInput);
  // Resolve overrides → effective tunables (clamped to safe ranges)
  const ov = advancedOverrides || {};
  // Ultra-thin bench auto-tighten: when bench is ≤1 the standard floors
  // (4 min interval / 3 min shift) become the bottleneck and prevent
  // equal-time rotations. Drop them so e.g. a 5-player / 4-a-side / 40-min
  // squad can sub every 4 min and land each player on 32'/8'.
  const _benchCount = (playerData ?? []).filter(p => p.position === null).length;
  const _ultraThinBench = _benchCount > 0 && _benchCount <= 1;
  const _autoIntervalFloor = _ultraThinBench ? 180 : 240;       // 3 min vs 4 min
  const _autoFreqFloor     = _ultraThinBench ? 120 : 180;       // 2 min vs 3 min
  const _autoMinShift      = _ultraThinBench ? 150 : 180;       // 2.5 min vs 3 min
  const _autoTarget        = _ultraThinBench ? 240 : PRACTICAL_SUB_INTERVAL_SECONDS;
  const eff = {
    standardTargetInterval: Math.max(180, Math.min(900, ov.standardTargetIntervalSec ?? _autoTarget)),
    standardIntervalFloor: Math.max(120, Math.min(600, ov.standardIntervalFloorSec ?? _autoIntervalFloor)),
    frequentIntervalFloor: Math.max(60, Math.min(420, ov.frequentIntervalFloorSec ?? _autoFreqFloor)),
    minShiftSeconds: Math.max(60, Math.min(360, ov.minShiftSeconds ?? _autoMinShift)),
    halftimeGuardSeconds: ov.halftimeGuardSeconds !== undefined
      ? Math.max(0, Math.min(420, ov.halftimeGuardSeconds))
      : undefined, // undefined → fall back to interval floor at use site
  };
  const priorityOrder = Array.isArray(ov.playerPriorityOrder) ? ov.playerPriorityOrder : [];
  const priorityRank = new Map(priorityOrder.map((id, index) => [id, index] as const));
  const priorityBiasMaxSeconds = Math.max(0, (maxSpreadMinutes * 60) / 2);
  const priorityTargetBiasSeconds = (id: string) => {
    const rank = priorityRank.get(id);
    if (rank === undefined || priorityOrder.length < 2 || priorityBiasMaxSeconds <= 0) return 0;
    const midpoint = (priorityOrder.length - 1) / 2;
    return ((midpoint - rank) / Math.max(1, midpoint)) * priorityBiasMaxSeconds;
  };
  const priorityPullOffCompare = (a: string, b: string) => {
    if (priorityOrder.length < 2) return 0;
    return (priorityRank.get(b) ?? Number.MAX_SAFE_INTEGER) - (priorityRank.get(a) ?? Number.MAX_SAFE_INTEGER);
  };
  const priorityBringOnCompare = (a: string, b: string) => {
    if (priorityOrder.length < 2) return 0;
    return (priorityRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (priorityRank.get(b) ?? Number.MAX_SAFE_INTEGER);
  };
  const plan: SubstitutionEvent[] = [];
  
  if (!playerData || playerData.length === 0 || teamSize <= 0 || halfDurationSeconds <= 0) {
    return [];
  }

  playerData = playerData.map(p =>
    p.position !== null && !p.currentPitchPosition
      ? { ...p, currentPitchPosition: inferredPitchPosition(p) }
      : p
  );
  
  const playersOnPitch = playerData.filter(p => p.position !== null);
  const benchPlayers = playerData.filter(p => p.position === null);
  
  if (benchPlayers.length === 0) return [];
  
  // Separate GK from outfield players
  const gkOnPitch = playersOnPitch.find(p => p.currentPitchPosition === "GK");
  // Resolve the 2H GK. If the coach explicitly picked one in the lineup
  // screen, honour it absolutely — whether they're currently on the bench
  // OR already on the pitch in an outfield role. Only fall back to the
  // sole-GK bench player when no explicit preference was provided.
  const explicitGkOnBench = preferredSecondHalfGkId
    ? benchPlayers.find(p => p.id === preferredSecondHalfGkId)
    : undefined;
  const explicitGkOnPitch = preferredSecondHalfGkId
    ? playersOnPitch.find(p => p.id === preferredSecondHalfGkId && p.currentPitchPosition !== "GK")
    : undefined;
  const fallbackGkOnBench = !preferredSecondHalfGkId
    ? benchPlayers.find(p => p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1)
    : undefined;

  // `gkOnBench` represents a 2H GK that needs to come ON from the bench at HT.
  // If the explicit pick is already on the pitch, there's no bench-incoming GK.
  const gkOnBench = explicitGkOnBench || (preferredSecondHalfGkId ? undefined : fallbackGkOnBench);
  const preferredOnPitchGk = explicitGkOnPitch;
  const predictedFallbackGk = !gkOnBench && !preferredOnPitchGk && rotateGkAtHalftime && gkOnPitch
    ? benchPlayers.find(p => p.assignedPositions?.includes("GK") || !p.assignedPositions?.length) || null
    : null;
  const halftimeGkIn = rotateGkAtHalftime && gkOnPitch && startHalf === 1
    ? (gkOnBench || preferredOnPitchGk || predictedFallbackGk || null)
    : null;
  
  // Determine whether the starting GK will be rotated out at halftime — if so,
  // they need to be eligible for H2 outfield rotation, otherwise they sit the
  // entire 2nd half (e.g. starting GK gets 50% while everyone else gets 67–83%).
  const startingGkWillRotate = !!(rotateGkAtHalftime && gkOnPitch && startHalf === 1);
  const startingGkCanPlayOutfield = !!gkOnPitch;
  const includeStartingGkInRotation = startingGkWillRotate && startingGkCanPlayOutfield;

  const outfieldPlayers = playerData.filter(p => {
    if (p.currentPitchPosition === "GK") {
      // Include the starting GK in the rotation pool so they can come on as
      // an outfielder in the 2nd half after the halftime GK swap.
      return includeStartingGkInRotation;
    }
    if (halftimeGkIn && p.id === halftimeGkIn.id) return true;
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    return true;
  });

  const outfieldOnPitch = playersOnPitch.filter(p => p.currentPitchPosition !== "GK");
  const outfieldOnBench = benchPlayers.filter(p => {
    if (halftimeGkIn && p.id === halftimeGkIn.id) return true;
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    return true;
  });
  
  if (outfieldOnBench.length === 0) {
    if (rotateGkAtHalftime && gkOnBench && gkOnPitch) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch,
        playerIn: gkOnBench,
        executed: false,
      });
    }
    return plan;
  }
  
  // Calculate remaining game time based on when we're starting
  // Clamp elapsed time to half duration to avoid negative remaining time
  const clampedStartElapsed = Math.min(startElapsedSeconds, halfDurationSeconds);
  const remainingInCurrentHalf = halfDurationSeconds - clampedStartElapsed;
  const remainingHalves = startHalf === 1 ? remainingInCurrentHalf + halfDurationSeconds : remainingInCurrentHalf;
  const totalRemainingSeconds = Math.max(remainingHalves, 0);
  const fieldPositions = outfieldOnPitch.length || Math.max(teamSize - (gkOnPitch ? 1 : 0), 1);
  const totalOutfieldPlayers = outfieldPlayers.length;

  // EXACT EQUAL-TIME ROTATION FOR ONE-BENCH + HALFTIME GK SWAP
  // ---------------------------------------------------------------------------
  // Canonical case: 7-a-side, 8 available, 40 min. Everyone must get exactly
  // 35' because each player has one equal bench stint. With a halftime GK swap,
  // the 2H GK must be benched before HT, then the 1H GK must immediately return
  // as an outfielder at HT. The generic planner tends to drift here because it
  // protects GK continuity and starts H2 with the 1H GK still benched.
  const oneBenchHalftimeGkExactEligible =
    priorityOrder.length === 0 &&
    rotateGkAtHalftime &&
    !!gkOnPitch &&
    !!halftimeGkIn &&
    gkOnPitch.id !== halftimeGkIn.id &&
    outfieldOnBench.length === 1 &&
    playerData.filter(p => !p.isInjured).length === teamSize + 1 &&
    startHalf === 1 &&
    clampedStartElapsed === 0;

  if (oneBenchHalftimeGkExactEligible) {
    const healthyPlayers = playerData.filter(p => !p.isInjured);
    const totalMatchSec = halfDurationSeconds * 2;
    const benchStintSec = totalMatchSec / healthyPlayers.length;
    const periodsPerHalf = halfDurationSeconds / benchStintSec;
    const exactPossible =
      Number.isInteger(benchStintSec) &&
      Number.isInteger(periodsPerHalf) &&
      periodsPerHalf >= 2;

    if (exactPossible) {
      const playerById = new Map(playerData.map(p => [p.id, p]));
      const nonGkOutfield = outfieldOnPitch.filter(p => p.id !== halftimeGkIn.id);
      const h1RegularBenchCount = Math.max(0, periodsPerHalf - 2);
      const h1Regulars = nonGkOutfield.slice(0, h1RegularBenchCount);
      const h2Regulars = nonGkOutfield.slice(h1RegularBenchCount);
      const h1BenchQueue = [outfieldOnBench[0], ...h1Regulars, halftimeGkIn];
      const h2BenchQueue = [...h2Regulars, gkOnPitch];

      if (h1BenchQueue.length === periodsPerHalf && h2BenchQueue.length === periodsPerHalf) {
        const currentPositions = new Map<string, PitchPosition>();
        outfieldOnPitch.forEach(p => currentPositions.set(p.id, inferredOutfieldPosition(p)));
        const exactPlan: SubstitutionEvent[] = [];

        const emitDirectSub = (half: 1 | 2, time: number, outgoing: Player, incoming: Player) => {
          const outPos = currentPositions.get(outgoing.id) || inferredOutfieldPosition(outgoing);
          exactPlan.push({
            time,
            half,
            playerOut: { ...outgoing, currentPitchPosition: outPos },
            playerIn: { ...incoming, currentPitchPosition: outPos },
            executed: false,
          });
          currentPositions.delete(outgoing.id);
          currentPositions.set(incoming.id, outPos);
        };

        for (let i = 1; i < h1BenchQueue.length; i++) {
          const outgoing = playerById.get(h1BenchQueue[i].id);
          const incoming = playerById.get(h1BenchQueue[i - 1].id);
          if (!outgoing || !incoming) break;
          emitDirectSub(1, Math.round(benchStintSec * i), outgoing, incoming);
        }

        exactPlan.push({
          time: 0,
          half: 2,
          playerOut: gkOnPitch,
          playerIn: halftimeGkIn,
          executed: false,
        });

        currentPositions.delete(halftimeGkIn.id);

        for (let i = 0; i < h2BenchQueue.length; i++) {
          const outgoing = playerById.get(h2BenchQueue[i].id);
          const incoming = i === 0 ? gkOnPitch : playerById.get(h2BenchQueue[i - 1].id);
          if (!outgoing || !incoming) break;
          emitDirectSub(2, Math.round(benchStintSec * i), outgoing, incoming);
        }

        return exactPlan;
      }
    }
  }

  // EXACT EQUAL-TIME ROTATION FOR ULTRA-THIN BENCHES
  // -------------------------------------------------
  // 4-a-side with 5 available players is the canonical case: one player is
  // always off, so equal game time means equal BENCH periods. The generic
  // planner spaces `N` windows across the match, which accidentally creates
  // short first/long later bench stints (e.g. 18/17/17/16/13). For exactly one
  // bench player and no GK constraint, use a simple queue with periods snapped
  // to a full multiple of the player count. Examples:
  // - 20 min match, 5 players → 5 × 4-min periods → everyone plays 16'
  // - 40 min match, 5 players → 10 × 4-min periods → everyone plays 32'
  // Allow the exact thin-bench planner to also cover the case where there's a
  // full-game GK locked into goal (no halftime swap). The remaining outfielders
  // + 1 bench rotate via simple round-robin, achieving exact equal outfield
  // minutes — e.g. 8 players / 7-aside / 40 min with locked GK → 7 outfielders
  // each play 34.3 min, GK 40 min (mathematical floor for that config).
  const canUseExactThinBenchPlanner =
    outfieldOnBench.length === 1 &&
    totalOutfieldPlayers === outfieldOnPitch.length + 1 &&
    totalOutfieldPlayers > 1 &&
    !halftimeGkIn &&
    startHalf === 1 &&
    clampedStartElapsed === 0 &&
    totalRemainingSeconds > 0;

  if (canUseExactThinBenchPlanner) {
    const preferredPeriodSeconds = 4 * 60;
    const minimumPeriodsForCadence = Math.max(
      totalOutfieldPlayers,
      Math.ceil(totalRemainingSeconds / preferredPeriodSeconds),
    );
    const equalPeriodCount = Math.max(
      totalOutfieldPlayers,
      Math.ceil(minimumPeriodsForCadence / totalOutfieldPlayers) * totalOutfieldPlayers,
    );
    const thinPlayerById = new Map(playerData.map(p => [p.id, p]));
    const rotationOnPitch = outfieldOnPitch.map(p => ({
      id: p.id,
      position: (p.currentPitchPosition || "MID") as PitchPosition,
    }));
    let benchId = outfieldOnBench[0].id;
    const exactPlan: SubstitutionEvent[] = [];

    for (let period = 1; period < equalPeriodCount; period++) {
      const absoluteSeconds = Math.round((totalRemainingSeconds * period) / equalPeriodCount);
      const outgoing = rotationOnPitch.shift();
      const incoming = thinPlayerById.get(benchId);
      const playerOut = outgoing ? thinPlayerById.get(outgoing.id) : undefined;
      if (!outgoing || !incoming || !playerOut) break;

      const { half, time } = absoluteSeconds < halfDurationSeconds
        ? { half: 1 as const, time: absoluteSeconds }
        : { half: 2 as const, time: absoluteSeconds - halfDurationSeconds };

      exactPlan.push({
        time,
        half,
        playerOut,
        playerIn: { ...incoming, currentPitchPosition: outgoing.position },
        executed: false,
      });

      rotationOnPitch.push({ id: incoming.id, position: outgoing.position });
      benchId = outgoing.id;
    }

    return exactPlan;
  }

  // ===========================================================================
  // PRACTICAL MODE (rotationSpeed === 1) — early return.
  // FIFO queue rotation, ~7 min between sub windows, max 2 swaps per window.
  // No spread escalation. Designed to mirror how a real junior coach manages
  // a game: predictable order, few interruptions, "fair enough" distribution.
  // ===========================================================================
  if (rotationSpeed === 1) {
    const startAbs = startHalf === 1 ? clampedStartElapsed : halfDurationSeconds + clampedStartElapsed;
    const endAbs = halfDurationSeconds * 2;
    const subsPerWindow = Math.max(
      1,
      Math.min(
        disableBatchSubs ? 1 : PRACTICAL_MAX_SUBS_PER_WINDOW,
        outfieldOnBench.length,
        outfieldOnPitch.length
      )
    );
    // BENCH-AWARE CADENCE: the default 7-min window keeps Standard low-disruption,
    // but with a large bench (e.g. 9v9 +5, 11v11 +6) a fixed 7-min cadence can't
    // rotate everyone through within the spread cap and minutes blow out to 16-20'.
    // Shrink the interval just enough to deliver one full rotation cycle in the
    // remaining game time, with a hard floor of 4 min so windows never get tricky.
    // Cycle = N off-events needed (one per outfielder), batched `subsPerWindow` at a time.
    const cycleWindowsNeeded = Math.ceil(totalOutfieldPlayers / subsPerWindow);
    const cadenceForCycle = totalRemainingSeconds > 0 && cycleWindowsNeeded > 0
      ? Math.floor(totalRemainingSeconds / (cycleWindowsNeeded + 1))
      : eff.standardTargetInterval;
    const PRACTICAL_MIN_INTERVAL = Math.min(
      eff.standardIntervalFloor,
      Math.max(90, Math.floor(cadenceForCycle || eff.standardIntervalFloor)),
    ); // Short games / large benches must not be starved by a fixed 4-min floor.
    const intervalSec = Math.max(
      PRACTICAL_MIN_INTERVAL,
      Math.min(eff.standardTargetInterval, cadenceForCycle)
    );
    const noSubBeforeSeconds = Math.min(
      PRACTICAL_NO_SUB_BEFORE_SECONDS,
      Math.max(60, Math.floor(halfDurationSeconds * 0.2)),
    );
    const noSubAfterSeconds = Math.min(
      PRACTICAL_NO_SUB_AFTER_SECONDS,
      Math.max(45, Math.floor(halfDurationSeconds * 0.12)),
    );
    const halftimeBlackoutSeconds = Math.min(90, Math.max(30, Math.floor(intervalSec * 0.5)));

    // ---- Fairness model ------------------------------------------------------
    // targetSec = (gameDuration × playersOnField) / totalPlayers
    // minThreshold = 0.75 × target — fairness floor (override FIFO)
    // maxThreshold = 1.20 × target — soft cap (prioritise OFF, block ON)
    // GK priority is handled with protected outfield runs either side of the
    // halftime keeper swap, without adding double-credit on top of GK minutes.
    const fullGameSec = halfDurationSeconds * 2;
    const fairPlayerCount = Math.max(playerData.filter(p => !p.isInjured).length, 1);
    const targetSecPerPlayer = (fullGameSec * teamSize) / fairPlayerCount;
    const playerTargetSec = (id: string) => Math.max(0, targetSecPerPlayer + priorityTargetBiasSeconds(id));
    const playerMinThresholdSec = (id: string) => playerTargetSec(id) * PRACTICAL_MIN_THRESHOLD_RATIO;
    const playerMaxThresholdSec = (id: string) => playerTargetSec(id) * PRACTICAL_MAX_THRESHOLD_RATIO;

    // GK-PROTECTED players: anyone assigned as GK in any half. They must finish
    // at or near the top of the allowed spread (target + spread/2) without
    // exceeding the spread cap. We don't widen the spread to favour them — we
    // bias OUT/IN selection so they sit at the top of the existing range.
    const gkProtectedIds = new Set<string>();
    if (gkOnPitch) gkProtectedIds.add(gkOnPitch.id);
    if (halftimeGkIn) gkProtectedIds.add(halftimeGkIn.id);
    const isGkProtected = (id: string) => gkProtectedIds.has(id);
    // Top of the allowed spread — GK-protected players aim for this.
    const gkCeilingSec = targetSecPerPlayer + (maxSpreadMinutes / 2) * 60;

    // Track projected playing seconds per outfield player. Seed from minutes
    // already accumulated (for mid-game starts), converted to seconds.
    const projected = new Map<string, number>();
    outfieldPlayers.forEach(p => projected.set(p.id, p.minutesPlayed || 0));
    if (gkOnPitch && startHalf === 1) {
      projected.set(gkOnPitch.id, (projected.get(gkOnPitch.id) || 0) + halfDurationSeconds);
    }
    if (halftimeGkIn) {
      projected.set(halftimeGkIn.id, (projected.get(halftimeGkIn.id) || 0) + halfDurationSeconds);
    }

    const halfTimeAbs = halfDurationSeconds;

    const remainingOutfieldAvailability = (id: string, absT: number) => {
      if (includeStartingGkInRotation && id === gkOnPitch?.id) {
        return Math.max(1, endAbs - Math.max(absT, halfTimeAbs));
      }
      if (halftimeGkIn && id === halftimeGkIn.id) {
        return absT < halfTimeAbs ? Math.max(1, halfTimeAbs - absT) : 1;
      }
      return Math.max(1, endAbs - absT);
    };

    const isKeeperRotationPlayer = (id: string) => id === gkOnPitch?.id || id === halftimeGkIn?.id;
    const needsProtectedOutfieldRun = (id: string) => {
      const guaranteedGkSeconds = id === gkOnPitch?.id || id === halftimeGkIn?.id ? halfDurationSeconds : 0;
      return guaranteedGkSeconds < targetSecPerPlayer - (maxSpreadMinutes * 60) / 2;
    };
    // GKs already get a guaranteed 20 min in goal — that's the priority. Do
    // NOT add an additional outfield bonus on top, or their total minutes
    // balloon past the cap and starve bench players (creating large spreads).
    // The "priority" for GKs is realised purely by being shielded from being
    // pulled off too early (see overCap/FIFO filters below) and by the forced
    // outfield window for the 2H GK before halftime.
    const effectiveMinSec = (id: string) => playerMinThresholdSec(id);
    const effectiveTargetSec = (id: string) => playerTargetSec(id);
    const shortfall = (id: string) => effectiveTargetSec(id) - (projected.get(id) || 0);
    const needScore = (id: string, absT: number, queueIndex = 0) => {
      const need = shortfall(id);
      return (need / remainingOutfieldAvailability(id, absT)) * 10000 + need * 0.05 - queueIndex * 0.01;
    };

    // Build candidate sub-window times.
    // Rules: no subs before minute 5 from kickoff, none in last ~2.5 min of
    // each half, none right around halftime. ~7 min cadence keeps things
    // predictable and lands us in the 8–14 total subs sweet spot.
    const earliestAbs = Math.max(startAbs + 60, noSubBeforeSeconds);
    const isInBlackout = (t: number) => {
      // Last N seconds of half 1
      if (t > halfDurationSeconds - noSubAfterSeconds && t <= halfDurationSeconds) return true;
      // Last N seconds of half 2
      if (t > endAbs - noSubAfterSeconds) return true;
      // Right around halftime
      if (Math.abs(t - halfDurationSeconds) < halftimeBlackoutSeconds) return true;
      // Before settling-in window in either half
      if (t < noSubBeforeSeconds) return true;
      if (t > halfDurationSeconds && t < halfDurationSeconds + noSubBeforeSeconds) return true;
      return false;
    };

    // Forced and extra window collectors (consumed by buildSubWindows below).
    const forcedWindowTimes: number[] = [];
    const extraWindowTimes: number[] = [];
    // GOALKEEPER RULE: GKs may ONLY be swapped at halftime (the GK position
    // itself can only change at start-of-game or halftime). However, the
    // nominated 2H GK can play OUTFIELD in 1H — they're just a normal field
    // player until they take the gloves at HT. Same for the 1H GK in 2H.
    // We give the 2H GK a forced outfield run in 1H so they don't end the
    // match well below the fairness floor.
    const forcedInByWindow = new Map<number, string>();
    const forcedOutByWindow = new Map<number, string>();
    let halftimeGkBenchByAbs: number | null = null;
    if (halftimeGkIn && needsProtectedOutfieldRun(halftimeGkIn.id) && startHalf === 1 && halfDurationSeconds > 12 * 60) {
      const tinySquad = outfieldOnBench.length <= 2;
      const h1GkOn = noSubBeforeSeconds;
      const h1GkOffOffset = tinySquad ? noSubAfterSeconds : Math.max(noSubAfterSeconds, Math.min(3 * 60, intervalSec));
      const h1GkOff = Math.max(h1GkOn + 9 * 60, halfDurationSeconds - h1GkOffOffset);
      halftimeGkBenchByAbs = Math.floor(h1GkOff);
      [h1GkOn, h1GkOff].forEach(gkTime => {
        if (gkTime > startAbs) forcedWindowTimes.push(Math.floor(gkTime));
      });
      if (h1GkOn > startAbs) forcedInByWindow.set(Math.floor(h1GkOn), halftimeGkIn.id);
      if (h1GkOff > startAbs) forcedOutByWindow.set(Math.floor(h1GkOff), halftimeGkIn.id);
    }
    // Mirror window in H2 for the 1H GK so they get outfield time toward the
    // top of the allowed spread.
    if (includeStartingGkInRotation && gkOnPitch && needsProtectedOutfieldRun(gkOnPitch.id) && halfDurationSeconds > 12 * 60) {
      const tinySquad = outfieldOnBench.length <= 2;
      const h2GkOnOffset = tinySquad ? Math.min(2 * 60, noSubBeforeSeconds) : noSubBeforeSeconds;
      const h2GkOn = halfDurationSeconds + h2GkOnOffset;
      if (h2GkOn > startAbs) {
        forcedWindowTimes.push(Math.floor(h2GkOn));
        forcedInByWindow.set(Math.floor(h2GkOn), gkOnPitch.id);
      }
    }
    if (startAbs < halfTimeAbs && halfDurationSeconds > 18 * 60 && outfieldOnBench.length >= 3) {
      const h2FairnessRescue = halfDurationSeconds + Math.floor(halfDurationSeconds * 0.5);
      if (h2FairnessRescue < endAbs - noSubAfterSeconds && !isInBlackout(h2FairnessRescue)) {
        extraWindowTimes.push(Math.floor(h2FairnessRescue));
      }
      const h2LateFairnessRescue = halfDurationSeconds + Math.floor(halfDurationSeconds * 0.72);
      if (h2LateFairnessRescue < endAbs - noSubAfterSeconds && !isInBlackout(h2LateFairnessRescue)) {
        extraWindowTimes.push(Math.floor(h2LateFairnessRescue));
      }
    }
    // Tiny squads (≤2 bench): extra mid-2H rescue window so 1H FWDs get pulled.
    if (outfieldOnBench.length <= 2 && halfDurationSeconds > 14 * 60) {
      const h2R = halfDurationSeconds + Math.floor(halfDurationSeconds * 0.5);
      if (h2R < endAbs - noSubAfterSeconds && !isInBlackout(h2R)) {
        extraWindowTimes.push(h2R);
      }
    }

    // Unified window builder — single source of truth for cadence, blackouts,
    // and forced-time merging across Standard / Frequent / Advanced.
    const baseWindowTimes = buildSubWindows({
      startAbs,
      endAbs,
      halfDurationSeconds,
      targetIntervalSec: intervalSec,
      intervalFloorSec: PRACTICAL_MIN_INTERVAL,
      noSubBeforeSec: noSubBeforeSeconds,
      noSubAfterSec: noSubAfterSeconds,
      halftimeGuardSec: halftimeBlackoutSeconds,
      halftimeGuardActive: true,
      forcedTimes: forcedWindowTimes,
      extraTimes: extraWindowTimes,
      forcedBufferSec: PRACTICAL_GK_WINDOW_BUFFER_SECONDS,
    });

    const onPitchOrder: string[] = outfieldOnPitch.map(p => p.id);
    const benchOrder: string[] = outfieldOnBench.map(p => p.id);

    // Track when each player was last subbed ON (absolute seconds) — used to
    // protect recent subs from being immediately pulled off.
    const lastSubbedOnAbs = new Map<string, number>();

    // RULE: every outfield starter must be benched at least once. Track who
    // has yet to be subbed off; bias selection toward never-benched players.
    // GK-PROTECTED EXEMPTION: players assigned as GK in either half are
    // exempt from the bench-once rule. They should be allowed to play their
    // full outfield run before/after their GK shift to reach the top of the
    // allowed spread (equal-highest minutes).
    const neverBenched = new Set<string>(
      outfieldOnPitch.filter(p => !isGkProtected(p.id)).map(p => p.id),
    );

    const willGkSwapAtHt =
      rotateGkAtHalftime && startHalf === 1 && !!gkOnPitch && !!halftimeGkIn;

    // Accrue projected outfield time as we walk through the schedule.
    let lastTickAbs = startAbs;
    const accrueUntil = (absT: number) => {
      const dt = Math.max(0, absT - lastTickAbs);
      if (dt === 0) return;
      onPitchOrder.forEach(id => projected.set(id, (projected.get(id) || 0) + dt));
      lastTickAbs = absT;
    };

    const pendingWindows = [...baseWindowTimes];
    let gkSwapApplied = false;

    while (pendingWindows.length > 0) {
      let t = pendingWindows.shift()!;

      // Rescue check: if any bench player is currently below the floor and
      // would stay below by this window, allow pulling sub up to ~2 min earlier.
      const isForcedGkWindow = forcedInByWindow.has(t) || forcedOutByWindow.has(t);
      const benchUnder = benchOrder.filter(
        id => (projected.get(id) || 0) < effectiveMinSec(id)
      );
      if (!isForcedGkWindow && benchUnder.length > 0) {
        const earliest = Math.max(lastTickAbs + 60, t - PRACTICAL_EARLY_SUB_TOLERANCE_SECONDS);
        if (earliest < t) t = Math.floor(earliest);
      }

      // Apply HT GK swap to queues at first window after halftime.
      if (willGkSwapAtHt && !gkSwapApplied && t > halfTimeAbs) {
        accrueUntil(halfTimeAbs);
        const startingGkId = gkOnPitch!.id;
        const h2GkId = halftimeGkIn!.id;
        const ip = onPitchOrder.indexOf(h2GkId);
        if (ip >= 0) onPitchOrder.splice(ip, 1);
        const ib = benchOrder.indexOf(h2GkId);
        if (ib >= 0) benchOrder.splice(ib, 1);
        if (!benchOrder.includes(startingGkId)) benchOrder.unshift(startingGkId);
        gkSwapApplied = true;
      }

      accrueUntil(t);

      const swaps = Math.min(subsPerWindow, onPitchOrder.length, benchOrder.length);
      if (swaps === 0) continue;
      const windowIns = new Set<string>();
      const windowOuts = new Set<string>();

      const { half, time } = (() => ({
        half: (t < halfDurationSeconds ? 1 : 2) as 1 | 2,
        time: t < halfDurationSeconds ? t : t - halfDurationSeconds,
      }))();

      for (let i = 0; i < swaps; i++) {
        const isActiveGk = (id: string) =>
          (gkOnPitch && id === gkOnPitch.id && t < halfTimeAbs) ||
          (halftimeGkIn && id === halftimeGkIn.id && t >= halfTimeAbs);

        // -------- Pick playerOut --------
        // Priority: (1) the nominated 2H GK must be back on the bench before
        // halftime, (2) the highest-minute player, especially if over cap.
        // Over-cap pull: prefer subbing off players who are above the cap, OR
        // when a bench player is below their effective floor. Keepers should
        // generally NOT be pulled off via over-cap logic — they need their
        // outfield run to land in the top half of total minutes.
        // GK-PROTECTED PROMOTION (OUT): if any GK-protected player on the
        // pitch is below their target ceiling AND a non-GK-protected player
        // on the pitch is at/above the non-GK floor, prefer pulling the
        // non-GK-protected player off so the GK-protected one keeps banking
        // outfield minutes toward the top of the spread.
        const gkProtectedOnPitchBelowCeiling = onPitchOrder.some(
          id => isGkProtected(id) && needsProtectedOutfieldRun(id) && !isActiveGk(id) && (projected.get(id) || 0) < gkCeilingSec - 30
        );

        const overCap = onPitchOrder
          .filter(id => !isActiveGk(id))
          .filter(id => !windowIns.has(id))
          // Protect recently-subbed-on players (<4 min on field).
          .filter(id => {
            const onAt = lastSubbedOnAbs.get(id);
            return onAt === undefined || (t - onAt) >= PRACTICAL_RECENT_SUB_PROTECTION_SECONDS;
          })
          // Keep the nominated 2H GK on until their planned pre-halftime bench window.
          .filter(id => id !== halftimeGkIn?.id || halftimeGkBenchByAbs === null || t >= halftimeGkBenchByAbs)
          // Don't pull a GK-protected player off via over-cap until they've
          // reached the top of the allowed spread (gkCeilingSec). Their
          // outfield run should land them at equal-highest minutes.
          .filter(id => !isGkProtected(id) || !needsProtectedOutfieldRun(id) || (projected.get(id) || 0) >= gkCeilingSec - 30)
          .filter(id => (projected.get(id) || 0) > playerMaxThresholdSec(id) || benchOrder.some(benchId => (projected.get(benchId) || 0) < effectiveMinSec(benchId)))
          .sort((a, b) => {
            // GK-protected promotion: prefer pulling non-GK-protected first
            // when a GK-protected on-pitch is still below ceiling.
            if (gkProtectedOnPitchBelowCeiling) {
              const aGk = isGkProtected(a) ? 1 : 0;
              const bGk = isGkProtected(b) ? 1 : 0;
              if (aGk !== bGk) return aGk - bGk;
            }
            // Bench-everyone rule: prefer pulling never-benched players first.
            const aNB = neverBenched.has(a) ? 1 : 0;
            const bNB = neverBenched.has(b) ? 1 : 0;
            if (aNB !== bNB) return bNB - aNB;
            const priorityCmp = priorityPullOffCompare(a, b);
            if (priorityCmp !== 0) return priorityCmp;
            return (projected.get(b) || 0) - (projected.get(a) || 0);
          });

        let outId: string | null = null;
        const forcedOutId = forcedOutByWindow.get(t);
        const h2GkNeedsBenchForHalftime = halftimeGkIn?.id &&
          (halftimeGkBenchByAbs === null || t >= halftimeGkBenchByAbs) &&
          !windowIns.has(halftimeGkIn.id) &&
          onPitchOrder.includes(halftimeGkIn.id);
        if (forcedOutId && onPitchOrder.includes(forcedOutId) && !windowIns.has(forcedOutId)) {
          outId = forcedOutId;
          const idx = onPitchOrder.indexOf(outId);
          if (idx >= 0) onPitchOrder.splice(idx, 1);
        } else if (h2GkNeedsBenchForHalftime) {
          outId = halftimeGkIn!.id;
          const idx = onPitchOrder.indexOf(outId);
          if (idx >= 0) onPitchOrder.splice(idx, 1);
        } else if (overCap.length > 0) {
          outId = overCap[0];
          const idx = onPitchOrder.indexOf(outId);
          if (idx >= 0) onPitchOrder.splice(idx, 1);
        } else {
          // Build the eligible candidate list, then choose.
          const buildEligible = (allowRecentSub: boolean) => {
            const out: string[] = [];
            for (let j = 0; j < onPitchOrder.length; j++) {
              const candidate = onPitchOrder[j];
              if (isActiveGk(candidate)) continue;
              if (windowIns.has(candidate)) continue;
              if (candidate === halftimeGkIn?.id && halftimeGkBenchByAbs !== null && t < halftimeGkBenchByAbs) continue;
              // Don't sub off a GK-protected player while they're still below
              // their ceiling — they need to finish at the top of the spread.
              if (isGkProtected(candidate) && needsProtectedOutfieldRun(candidate) && (projected.get(candidate) || 0) < gkCeilingSec - 30) continue;
              if (isKeeperRotationPlayer(candidate) && (projected.get(candidate) || 0) < effectiveMinSec(candidate)) continue;
              if (!allowRecentSub) {
                const onAt = lastSubbedOnAbs.get(candidate);
                if (onAt !== undefined && (t - onAt) < PRACTICAL_RECENT_SUB_PROTECTION_SECONDS) continue;
              }
              out.push(candidate);
            }
            return out;
          };

          // BENCH-EVERYONE GUARANTEE: if remaining sub windows are scarce
          // relative to never-benched starters still on the pitch, force one
          // of them off NOW — even if it costs a recently-subbed player a
          // shorter shift. Threshold: windows-left ≤ never-benched-on-pitch.
          const neverBenchedOnPitch = onPitchOrder.filter(id => neverBenched.has(id) && !isActiveGk(id) && !windowIns.has(id));
          const windowsLeft = pendingWindows.length + 1;
          const mustForceNeverBenched = neverBenchedOnPitch.length > 0 && windowsLeft <= neverBenchedOnPitch.length + 1;

          let eligible = buildEligible(false);
          // If we must force a never-benched player but none are eligible
          // under the recent-sub-protection rule, drop that protection.
          if (mustForceNeverBenched && !eligible.some(id => neverBenched.has(id))) {
            eligible = buildEligible(true);
          }

          if (eligible.length > 0) {
            // GK-protected first; never-benched next; then existing tiebreaks.
            eligible.sort((a, b) => {
              if (gkProtectedOnPitchBelowCeiling) {
                const aGk = isGkProtected(a) ? 1 : 0;
                const bGk = isGkProtected(b) ? 1 : 0;
                if (aGk !== bGk) return aGk - bGk;
              }
              const aNB = neverBenched.has(a) ? 1 : 0;
              const bNB = neverBenched.has(b) ? 1 : 0;
              if (aNB !== bNB) return bNB - aNB;
              const priorityCmp = priorityPullOffCompare(a, b);
              if (priorityCmp !== 0) return priorityCmp;
              if (aNB === 1 && bNB === 1) {
                return onPitchOrder.indexOf(b) - onPitchOrder.indexOf(a);
              }
              if (outfieldOnBench.length <= 2) {
                return (projected.get(b) || 0) - (projected.get(a) || 0);
              }
              return onPitchOrder.indexOf(a) - onPitchOrder.indexOf(b);
            });
            outId = eligible[0];
            const idx = onPitchOrder.indexOf(outId);
            if (idx >= 0) onPitchOrder.splice(idx, 1);
          }
        }
        if (!outId) break;

        // -------- Pick playerIn --------
        // Priority: lowest adjusted minutes first. This preserves simple
        // windows but makes Standard genuinely fair instead of queue-only.
        const under = benchOrder
          .map((id, index) => ({ id, proj: projected.get(id) || 0, score: needScore(id, t, index) }))
          .filter(b => !windowOuts.has(b.id))
          .filter(b => b.proj < effectiveMinSec(b.id))
          .sort((a, b) => (b.score - a.score) || priorityBringOnCompare(a.id, b.id));

        let inId: string | undefined;
        const forcedInId = forcedInByWindow.get(t);
        if (forcedInId && benchOrder.includes(forcedInId) && !windowOuts.has(forcedInId)) {
          inId = forcedInId;
          const idx = benchOrder.indexOf(inId);
          if (idx >= 0) benchOrder.splice(idx, 1);
        } else if (under.length > 0) {
          inId = under[0].id;
          const idx = benchOrder.indexOf(inId);
          if (idx >= 0) benchOrder.splice(idx, 1);
        } else {
          // Mostly FIFO. Only jump the queue for a genuinely low-minute player
          // (or a forced GK window); otherwise bench order stays predictable.
          const fifoCandidates = benchOrder
            .map((id, index) => ({ id, index, score: needScore(id, t, index), projected: projected.get(id) || 0 }))
            .filter(item => !windowOuts.has(item.id))
            .filter(item => item.projected <= playerMaxThresholdSec(item.id));
          const fifoFirst = fifoCandidates[0];
          const urgent = fifoCandidates
            .filter(item => item.projected < targetSecPerPlayer)
            .sort((a, b) => (b.score - a.score) || priorityBringOnCompare(a.id, b.id))[0];
          const fifoIdx = (urgent && (!fifoFirst || urgent.score > fifoFirst.score + 500))
            ? urgent.index
            : fifoFirst?.index ?? -1;
          if (fifoIdx >= 0) {
            inId = benchOrder.splice(fifoIdx, 1)[0];
          } else {
            const fallbackIdx = benchOrder.findIndex(id => !windowOuts.has(id));
            inId = fallbackIdx >= 0 ? benchOrder.splice(fallbackIdx, 1)[0] : undefined;
          }
        }

        if (!inId) {
          onPitchOrder.unshift(outId);
          break;
        }

        const playerOut = playerData.find(p => p.id === outId)!;
        const playerIn = playerData.find(p => p.id === inId)!;
        const pos = (playerOut.currentPitchPosition || "MID") as PitchPosition;

        plan.push({
          time,
          half,
          playerOut,
          playerIn: { ...playerIn, currentPitchPosition: pos },
          executed: false,
        });

        onPitchOrder.push(inId);
        windowIns.add(inId);
        windowOuts.add(outId);
        benchOrder.push(outId);
        lastSubbedOnAbs.set(inId, t);
        neverBenched.delete(outId);
      }

      // BENCH-EVERYONE GUARANTEE: if there are still never-benched starters
      // on the pitch and we don't have enough remaining windows to bench them
      // all, inject extra synthetic windows ~2 min apart before end of game.
      const tNext = pendingWindows[0] ?? endAbs;
      const isActiveGkAt = (id: string, absT: number) =>
        (gkOnPitch && id === gkOnPitch.id && absT < halfTimeAbs) ||
        (halftimeGkIn && id === halftimeGkIn.id && absT >= halfTimeAbs);
      const stillNB = onPitchOrder.filter(id => neverBenched.has(id) && !isActiveGkAt(id, tNext));
      if (stillNB.length > pendingWindows.length) {
        const deficit = stillNB.length - pendingWindows.length;
        const lastScheduled = pendingWindows.length > 0 ? pendingWindows[pendingWindows.length - 1] : t;
        for (let k = 1; k <= deficit; k++) {
          const extra = Math.min(
            lastScheduled + k * Math.max(90, Math.min(2 * 60, intervalSec)),
            endAbs - noSubAfterSeconds,
          );
          if (extra > t && !pendingWindows.includes(extra)) {
            pendingWindows.push(extra);
          }
        }
        pendingWindows.sort((a, b) => a - b);
      }
    }

    // Final accrual to end of game.
    accrueUntil(endAbs);

    if (willGkSwapAtHt && startHalf === 1) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch!,
        playerIn: halftimeGkIn!,
        executed: false,
      });
    }

    // ===========================================================================
    // STANDARD-MODE REMOVAL PASS — drop late "churn" subs that demote the
    // already-lowest player. The fill loop above can schedule a sub like
    // `Louie -> Hugo` right before full time even when Louie is already the
    // most-underplayed player on the field; benching them at the death just
    // makes the spread worse. We delete a sub iff the resulting plan is still
    // playable AND the lowest projected total strictly improves while spread
    // does not get worse.
    // ===========================================================================
    const subAbs = (s: SubstitutionEvent) =>
      s.half === 1 ? s.time : halfDurationSeconds + s.time;
    const isHtGkSwap = (s: SubstitutionEvent) =>
      !!gkOnPitch && s.half === 2 && s.time === 0 && s.playerOut.id === gkOnPitch.id;
    const standardGkDuty = (id: string) => {
      let duty = 0;
      if (startingGkWillRotate && gkOnPitch && id === gkOnPitch.id) {
        duty += Math.max(0, halfDurationSeconds - startElapsedSeconds);
      }
      if (halftimeGkIn && id === halftimeGkIn.id) duty += halfDurationSeconds;
      return duty;
    };
    const standardSimulate = (candidatePlan: SubstitutionEvent[]) => {
      const onP = new Set<string>(outfieldOnPitch.map(p => p.id));
      const totals = new Map<string, number>();
      outfieldPlayers.forEach(p => totals.set(p.id, p.minutesPlayed || 0));
      const sorted = [...candidatePlan].sort((a, b) => subAbs(a) - subAbs(b));
      let last = startAbs;
      let valid = true;
      for (const ev of sorted) {
        const t = subAbs(ev);
        if (t < last) valid = false;
        const elapsed = Math.max(0, t - last);
        onP.forEach(id => totals.set(id, (totals.get(id) || 0) + elapsed));
        last = t;
        if (isHtGkSwap(ev)) { onP.delete(ev.playerIn.id); continue; }
        if (!onP.has(ev.playerOut.id) || onP.has(ev.playerIn.id)) valid = false;
        onP.delete(ev.playerOut.id);
        onP.add(ev.playerIn.id);
      }
      const tail = Math.max(0, endAbs - last);
      onP.forEach(id => totals.set(id, (totals.get(id) || 0) + tail));
      const projected = new Map<string, number>();
      for (const p of outfieldPlayers) {
        projected.set(p.id, (totals.get(p.id) || 0) + standardGkDuty(p.id));
      }
      return { projected, valid };
    };
    const STANDARD_REMOVAL_TOLERANCE = 5;
    for (let pass = 0; pass < 6; pass++) {
      const sim = standardSimulate(plan);
      if (!sim.valid) break;
      const values = [...sim.projected.values()];
      if (values.length < 2) break;
      const baseMin = Math.min(...values);
      const baseSpread = Math.max(...values) - baseMin;

      let bestRemoval: { index: number; min: number; spread: number } | null = null;
      for (let i = 0; i < plan.length; i++) {
        if (isHtGkSwap(plan[i])) continue;
        const trialPlan = plan.filter((_, j) => j !== i);
        const trial = standardSimulate(trialPlan);
        if (!trial.valid) continue;
        const tv = [...trial.projected.values()];
        const trialMin = Math.min(...tv);
        const trialSpread = Math.max(...tv) - trialMin;
        if (trialMin > baseMin + STANDARD_REMOVAL_TOLERANCE && trialSpread <= baseSpread) {
          if (
            !bestRemoval ||
            trialMin > bestRemoval.min ||
            (trialMin === bestRemoval.min && trialSpread < bestRemoval.spread)
          ) {
            bestRemoval = { index: i, min: trialMin, spread: trialSpread };
          }
        }
      }
      if (!bestRemoval) break;
      plan.splice(bestRemoval.index, 1);
    }

    const sortedStandard = plan.sort((a, b) =>
      (a.half === 1 ? a.time : halfDurationSeconds + a.time) -
      (b.half === 1 ? b.time : halfDurationSeconds + b.time)
    );
    {
      const eqPlan = applyEqualTimeOverride({
        playerData, teamSize, halfDurationSeconds,
        gkOnPitch, halftimeGkIn, rotateGkAtHalftime, maxSpreadMinutes,
        rotationSpeed, eff,
        priorityOrderLength: priorityOrder.length,
        startHalf, startElapsedSeconds: clampedStartElapsed,
        benchCount: outfieldOnBench.length,
        currentPlan: sortedStandard,
      });
      if (eqPlan) {
        sortedStandard.length = 0;
        sortedStandard.push(...eqPlan);
      }
    }

    return ensureNoStarvedPlayers(sortedStandard, playerData, halfDurationSeconds);
  }
  // ===========================================================================
  // BALANCED / FREQUENT MODES — fairness-driven planner below.
  // ===========================================================================

  
  // CORE PRINCIPLE: Equal playing time for ALL outfield players over remaining game
  // Use remaining time for calculations
  const totalFieldSeconds = totalRemainingSeconds * fieldPositions;
  const idealSecondsPerPlayer = Math.floor(totalFieldSeconds / totalOutfieldPlayers);
  
  // Track accumulated playing time
  // Initialize playing time with already-accumulated minutes for mid-game starts
  const playingTime = new Map<string, number>();
  outfieldPlayers.forEach(p => playingTime.set(p.id, p.minutesPlayed || 0));
  
  // Track who's currently on pitch and their positions
  const currentOnPitch = new Map<string, PitchPosition>();
  outfieldOnPitch.forEach(p => {
    currentOnPitch.set(p.id, p.currentPitchPosition as PitchPosition);
  });
  
  const getPlayer = (id: string) => outfieldPlayers.find(p => p.id === id);
  
  // Calculate minimum number of subs needed to achieve equal time
  const minSubsNeeded = Math.max(outfieldOnBench.length, Math.ceil(totalOutfieldPlayers / 2));
  
  // Determine how many players to sub at once based on rotation speed and bench size
  // Key principle: batch as many subs together as possible to reduce interruptions
  // With a large bench, we want to swap multiple players simultaneously
  let subsAtOnce = 1;
  if (!disableBatchSubs && outfieldOnBench.length >= 2) {
    const hasLargeBench = outfieldOnBench.length >= 4;
    switch (rotationSpeed) {
      case 1: subsAtOnce = 1; break;
      case 2: subsAtOnce = Math.min(2, outfieldOnBench.length); break;
      case 3: subsAtOnce = Math.min(hasLargeBench ? 3 : 2, outfieldOnBench.length); break;
      default: subsAtOnce = 1;
    }
  }
  
  // Calculate the ideal number of sub windows to achieve equal playing time
  // Goal: minimize interruptions while maintaining fairness
  // Each window swaps up to subsAtOnce players, so we need fewer windows with bigger batches
  const totalSubsNeeded = Math.max(minSubsNeeded, outfieldOnBench.length);
  const idealWindows = Math.ceil(totalSubsNeeded / subsAtOnce);
  
  // Apply rotation speed modifier
  // All modes ensure every bench player gets rotated in — the difference is batch size,
  // which affects how many sub windows are needed (more windows = more interruptions)
  let subWindowsPerHalf: number;
  switch (rotationSpeed) {
    case 1: // Minimal - 1 sub at a time, so needs more windows but less disruption per window
      subWindowsPerHalf = Math.max(2, totalSubsNeeded);
      break;
    case 3: // Equal Time - bigger batches, slightly more windows for finer control
      subWindowsPerHalf = Math.max(2, idealWindows);
      break;
    case 2: // Balanced
    default:
      subWindowsPerHalf = Math.max(1, idealWindows);
      break;
  }
  
  // Minimum 45 seconds between sub windows for practicality
  const minSubInterval = 45;
  const maxWindowsPerHalf = Math.floor(halfDurationSeconds / minSubInterval);
  const actualWindowsPerHalf = Math.min(subWindowsPerHalf, maxWindowsPerHalf);
  
  // Generate sub window times evenly distributed
  const generateSubTimes = (halfDuration: number, numWindows: number): number[] => {
    const times: number[] = [];
    if (numWindows <= 0) return times;
    const interval = halfDuration / (numWindows + 1);
    for (let i = 1; i <= numWindows; i++) {
      times.push(Math.floor(i * interval));
    }
    return times;
  };
  
  // Helper to find best substitution candidate
  const findBestSubCandidate = (
    onPitchSorted: { id: string; time: number; player: Player }[],
    benchSorted: { id: string; time: number; player: Player }[],
    excludePlayerOutIds: Set<string>,
    excludePlayerInIds: Set<string>
  ) => {
    interface SubCandidate {
      playerOut: Player;
      playerIn: Player;
      positionSwap?: SubstitutionEvent["positionSwap"];
      score: number;
      positionValid: boolean;
    }
    
    const candidates: SubCandidate[] = [];
    
    const filteredOnPitch = onPitchSorted.filter(p => !excludePlayerOutIds.has(p.id));
    const filteredBench = benchSorted.filter(p => !excludePlayerInIds.has(p.id));
    
    for (const benchEntry of filteredBench) {
      for (const pitchEntry of filteredOnPitch) {
        const pitchPos = currentOnPitch.get(pitchEntry.id);
        const timeDiffCorrected = pitchEntry.time - benchEntry.time;
        
        // Use a 30-second minimum threshold instead of hard zero to allow
        // beneficial rotations when times are close but not exactly equal
        if (timeDiffCorrected < 30) continue;
        
        const directMatch = !benchEntry.player.assignedPositions?.length || 
            benchEntry.player.assignedPositions.includes(pitchPos!);
        
        if (directMatch) {
          candidates.push({
            playerOut: pitchEntry.player,
            playerIn: benchEntry.player,
            score: timeDiffCorrected,
            positionValid: true
          });
        }
        
        if (!disablePositionSwaps) {
          const pitchPlayers = Array.from(currentOnPitch.entries());
          for (const [swapId, swapPos] of pitchPlayers) {
            if (swapId === pitchEntry.id || excludePlayerOutIds.has(swapId)) continue;
            const swapPlayer = getPlayer(swapId);
            if (!swapPlayer) continue;
            
            const swapPlayerCanPlayOutPos = !swapPlayer.assignedPositions?.length || 
                swapPlayer.assignedPositions.includes(pitchPos!);
            const incomingCanPlaySwapPos = !benchEntry.player.assignedPositions?.length || 
                benchEntry.player.assignedPositions.includes(swapPos);
            
            if (swapPlayerCanPlayOutPos && incomingCanPlaySwapPos) {
              candidates.push({
                playerOut: pitchEntry.player,
                playerIn: benchEntry.player,
                positionSwap: {
                  player: swapPlayer,
                  fromPosition: swapPos,
                  toPosition: pitchPos!,
                },
                score: timeDiffCorrected,
                positionValid: true
              });
            }
          }
        }
        
        if (!candidates.some(c => c.playerOut.id === pitchEntry.player.id && c.playerIn.id === benchEntry.player.id && c.positionValid)) {
          candidates.push({
            playerOut: pitchEntry.player,
            playerIn: benchEntry.player,
            score: timeDiffCorrected * 0.5,
            positionValid: false
          });
        }
      }
    }
    
    candidates.sort((a, b) => {
      if (a.positionValid !== b.positionValid) return b.positionValid ? 1 : -1;
      return b.score - a.score;
    });
    
    return candidates[0] || null;
  };
  
  // Threshold: subs within this many seconds of half-end get snapped
  const END_OF_HALF_SNAP_THRESHOLD = 60;

  // FAIRNESS TARGET: balance TOTAL minutes, not just outfield minutes. A player
  // doing a half in goal already has that GK time banked, so their outfield
  // target is the shared total target minus their GK duty. This gives GKs real
  // field time without forcing them 5-10 minutes above everyone else.
  const averageTotalSecondsPerPlayer = playerData.length > 0
    ? (totalRemainingSeconds * teamSize) / playerData.length
    : 0;
  const isGkPlayer = (id: string) =>
    (includeStartingGkInRotation && id === gkOnPitch?.id) ||
    (halftimeGkIn ? id === halftimeGkIn.id : false);
  const gkDutySeconds = (id: string) => {
    let duty = 0;
    if (startingGkWillRotate && id === gkOnPitch?.id) {
      duty += Math.max(0, halfDurationSeconds - startElapsedSeconds);
    }
    if (halftimeGkIn && id === halftimeGkIn.id) {
      duty += halfDurationSeconds;
    }
    return duty;
  };
  // FAIRNESS RULE: every player's TOTAL minutes target (field + GK duty) is
  // equal. GKs do NOT get extra total minutes — that would mean less time for
  // outfielders. Instead, GKs get a tiebreaker priority bonus in the scheduler
  // (see scoring below) so when needs are equal, the GK is rotated on first,
  // landing them at "equal top" of the playing time list rather than below.
  const fieldTargetSeconds = (id: string) =>
    Math.max(0, averageTotalSecondsPerPlayer - gkDutySeconds(id));
  // Adjusted time for sorting: players above their personal target are picked
  // off first; players furthest below target are picked on first.
  const adjustedTime = (id: string) =>
    (playingTime.get(id) || 0) - fieldTargetSeconds(id);

  const canUseInOutfield = (player: Player, position?: PitchPosition) => {
    if (!position || position === "GK" || player.isInjured) return false;
    // A nominated half-game GK still needs fair total minutes, so allow them
    // to cover an outfield slot outside their goalkeeping half.
    if (player.id === gkOnPitch?.id || player.id === halftimeGkIn?.id) return true;
    if (player.assignedPositions?.length === 1 && player.assignedPositions.includes("GK")) return true;
    return !player.assignedPositions?.length || player.assignedPositions.includes(position);
  };

  const playerById = new Map(playerData.map(p => [p.id, p]));
  const fieldSlots = outfieldOnPitch.map(p => ({
    position: p.currentPitchPosition as PitchPosition,
    playerId: p.id,
  }));

  const currentFieldSeconds = new Map<string, number>();
  outfieldPlayers.forEach(p => currentFieldSeconds.set(p.id, p.minutesPlayed || 0));

  const totalExistingSeconds = playerData.reduce((sum, p) => sum + (p.minutesPlayed || 0), 0);
  const sharedTotalTarget = playerData.length > 0
    ? (totalExistingSeconds + totalRemainingSeconds * teamSize) / playerData.length
    : 0;
    const rawFieldTargets = new Map<string, number>();
  outfieldPlayers.forEach(p => {
    // FAIRNESS: every player aims for the SAME total minutes (field + GK duty).
    // GKs already have GK time banked, so their outfield target is the shared
    // total minus their GK duty. They naturally play LESS outfield, not more —
    // landing them at equal total minutes alongside everyone else.
      const base = Math.max(0, sharedTotalTarget + priorityTargetBiasSeconds(p.id) - (p.minutesPlayed || 0) - gkDutySeconds(p.id));
    rawFieldTargets.set(p.id, base);
  });
  const rawTargetTotal = Array.from(rawFieldTargets.values()).reduce((sum, value) => sum + value, 0);
  const fieldTargetScale = rawTargetTotal > 0 ? totalFieldSeconds / rawTargetTotal : 1;
  const targetFieldSeconds = (id: string) => (rawFieldTargets.get(id) || 0) * fieldTargetScale;

  const toPlanTime = (absoluteSeconds: number): { half: 1 | 2; time: number } => ({
    half: absoluteSeconds < halfDurationSeconds ? 1 : 2,
    time: absoluteSeconds < halfDurationSeconds ? absoluteSeconds : absoluteSeconds - halfDurationSeconds,
  });

  const startAbsoluteSeconds = startHalf === 1 ? clampedStartElapsed : halfDurationSeconds + clampedStartElapsed;
  const endAbsoluteSeconds = halfDurationSeconds * 2;
  // Cap subs per window, but do NOT under-schedule windows in minimal mode.
  // Minimal means fewer players swapped at once; it must still create enough
  // rotation points for every rotatable player to share bench time fairly.
  const benchSize = Math.max(1, outfieldOnBench.length);
  const maxSubEventsPerWindow = Math.max(
    1,
    Math.min(disableBatchSubs ? 1 : subsAtOnce, benchSize, fieldSlots.length)
  );
  // Rotation continuity: with multiple bench players, someone who has just been
  // brought on should not be the player removed at the very next rotation.
  // They re-enter the normal off-order after one further window has passed.
  let previousRotationPlayerInIds = new Set<string>();

  // QUEUE TRACKING (queue-first rotation with fairness override)
  // ------------------------------------------------------------
  // Players go on/off in FIFO order: oldest-waiting bench player goes on,
  // longest-on-pitch player goes off. Fairness only overrides queue order
  // when the projected end-of-game gap exceeds FAIRNESS_TOLERANCE_SECONDS.
  // A MIN_SHIFT_SECONDS guarantees no player is pulled too soon after coming on.
  const FAIRNESS_TOLERANCE_SECONDS = 60;
  const MIN_SHIFT_SECONDS = eff.minShiftSeconds;
  // Position weight for ordering starters into the off-queue:
  // GK never rotates off via queue; defenders go first, then mids, then forwards.
  const positionRotationOrder = (pos: PitchPosition | undefined): number => {
    switch (pos) {
      case "GK": return 99;
      case "DEF": return 0;
      case "MID": return 1;
      case "FWD": return 2;
      default: return 3;
    }
  };
  // lastOnAt = absolute seconds when the player most recently entered the pitch.
  // Starters are seeded with offsets based on position so DEF rotate first.
  // Lower lastOnAt = been on longer = next off.
  const lastOnAt = new Map<string, number>();
  outfieldOnPitch.forEach(p => {
    const offset = positionRotationOrder(p.currentPitchPosition as PitchPosition);
    // Sub-second offsets keep starters ordered by position without affecting
    // shift-length math (which works in whole seconds).
    lastOnAt.set(p.id, startAbsoluteSeconds - 1000 + offset);
  });
  // lastOffAt = absolute seconds when the player most recently came off the pitch.
  // Bench players at start are all "waiting" since startAbsoluteSeconds.
  // Lower lastOffAt = been waiting longer = next on.
  const lastOffAt = new Map<string, number>();
  outfieldOnBench.forEach((p, idx) => {
    // Slight stagger by bench order so the first bench player goes on first.
    lastOffAt.set(p.id, startAbsoluteSeconds - 1000 + idx);
  });

  // FAIRNESS-DRIVEN WINDOW COUNT
  // ----------------------------
  // For perfectly equal minutes, each player spends T·B/N seconds on the bench
  // (T = remaining time, B = bench size, N = total rotatable players). One full
  // "cycle" rotates every player off exactly once and requires N sub-events.
  // With `subsAtOnce` swaps per window, a full cycle = N / subsAtOnce windows.
  //
  // Speed controls how many cycles we run (more cycles = shorter shifts, more
  // disruption, but identical fairness ceiling). All speeds aim for at least
  // ONE full cycle so every bench player gets equal time off.
  const baseCycleEvents = totalOutfieldPlayers; // one off-event per player
  // Cycles per speed: minimal=1 (longest shifts), balanced=1, fast=2 (shorter shifts)
  // Both minimal and balanced run a single full fairness cycle — they differ in
  // batch size (subsAtOnce), not in window count. Fast doubles rotations.
  let cycleMultiplier = rotationSpeed === 3 ? 2 : 1;
  // SPREAD CAP ESCALATION: when the user has set a tight max-spread, a single
  // cycle may not give bench players enough on-pitch time to converge. The
  // dominant residual spread comes from players "locked out" of part of the
  // game (e.g. half-game GKs) who need a precise number of outfield turns to
  // hit their share. Estimate that residual and add cycles until it fits.
  const maxGkLockoutSeconds = Math.max(
    0,
    ...outfieldPlayers.map(p => gkDutySeconds(p.id))
  );
  // Residual spread ≈ outfield need a locked-out player misses if we run too
  // few cycles. A locked-out player needs ~`shareOutfield` minutes; a single
  // cycle gives them at most one turn (~window length).
  const targetSpreadSeconds = Math.max(60, maxSpreadMinutes * 60);
  const estimatedResidualSpread = maxGkLockoutSeconds > 0
    ? Math.min(maxGkLockoutSeconds, halfDurationSeconds * 0.4)
    : 0;
  if (estimatedResidualSpread > targetSpreadSeconds) {
    // LIGHT FREQUENT: cap escalation tighter so we don't pile on extra cycles.
    // Frequent (speed=2) tops out at +1 cycle; Fast (speed=3) keeps the higher
    // ceiling for tight-spread scenarios.
    const escalationCeiling = rotationSpeed === 3 ? 6 : 2;
    const escalationBoost = rotationSpeed === 3 ? 2 : 0;
    cycleMultiplier = Math.min(
      escalationCeiling,
      Math.max(cycleMultiplier, Math.ceil(estimatedResidualSpread / targetSpreadSeconds) + escalationBoost)
    );
  }
  // Pick the smallest window count whose total off-events (W * subsAtOnce) is
  // a multiple of N players — this is the ONLY way to get exactly equal time.
  const desiredOffEvents = baseCycleEvents * cycleMultiplier;
  let targetWindowsTotal = Math.max(1, Math.ceil(desiredOffEvents / maxSubEventsPerWindow));
  // Snap upward until W * subsAtOnce is divisible by N (fairness divisibility).
  while ((targetWindowsTotal * maxSubEventsPerWindow) % totalOutfieldPlayers !== 0) {
    targetWindowsTotal++;
    // Safety: never exceed 2x the desired count
    if (targetWindowsTotal > Math.ceil(desiredOffEvents / maxSubEventsPerWindow) * 2 + totalOutfieldPlayers) break;
  }
  // Floor interval prevents churn but never overrides fairness windows. We
  // recompute as evenly-spaced windows across remaining time.
  // LIGHT FREQUENT: raise the floor for speed=2 from 120s to 180s so shifts
  // are noticeably longer than current Frequent (~3 min vs ~2 min) while
  // still rotating much more often than Standard (~5 min).
  const intervalFromWindows = totalRemainingSeconds / (targetWindowsTotal + 1);
  const minIntervalFloor = rotationSpeed === 3
    ? 90
    : Math.min(eff.frequentIntervalFloor, Math.max(60, Math.floor(intervalFromWindows)));
  const halftimeGuardWindow = eff.halftimeGuardSeconds ?? minIntervalFloor;
  const maxIntervalSeconds = Math.max(minIntervalFloor, Math.floor(intervalFromWindows));
  const directEventTimes = new Set<number>();

  // SHIFT-FLOOR GUARD: if a halftime GK swap is going to happen, don't place
  // any interval-driven sub window within `minIntervalFloor` seconds of HT —
  // otherwise a player can come on at window N and be forced off at HT, producing
  // a sub-1-min "shift" that's impossible for the optimizer to remove because
  // the HT event is fixed.
  const halftimeGuardActive = !!(
    startAbsoluteSeconds < halfDurationSeconds && rotateGkAtHalftime && gkOnPitch && halftimeGkIn
  );

  // Unified window builder — same helper Standard uses, just with Frequent's
  // numbers. Frequent has no settling-in window and a 45 s edge buffer.
  const sortedDirectEventTimes = buildSubWindows({
    startAbs: startAbsoluteSeconds,
    endAbs: endAbsoluteSeconds,
    halfDurationSeconds,
    targetIntervalSec: maxIntervalSeconds,
    intervalFloorSec: maxIntervalSeconds,
    noSubBeforeSec: 0,
    noSubAfterSec: 45,
    halftimeGuardSec: halftimeGuardWindow,
    halftimeGuardActive,
    edgeBufferSec: 45,
    includeHalftimeWhenGuardActive: true,
  });


  const isAvailableForInterval = (player: Player, intervalStart: number, intervalEnd: number) => {
    if (player.isInjured) return false;
    if (includeStartingGkInRotation && player.id === gkOnPitch?.id && intervalStart < halfDurationSeconds) return false;
    if (halftimeGkIn && player.id === halftimeGkIn.id && intervalEnd > halfDurationSeconds) return false;
    return true;
  };

  const remainingAvailabilitySeconds = (player: Player, intervalStart: number) => {
    const start = Math.max(intervalStart, startAbsoluteSeconds);
    if (includeStartingGkInRotation && player.id === gkOnPitch?.id) {
      return Math.max(1, endAbsoluteSeconds - Math.max(start, halfDurationSeconds));
    }
    if (halftimeGkIn && player.id === halftimeGkIn.id) {
      return Math.max(1, halfDurationSeconds - Math.min(start, halfDurationSeconds));
    }
    return Math.max(1, endAbsoluteSeconds - start);
  };

  const addFieldTime = (elapsed: number) => {
    if (elapsed <= 0) return;
    fieldSlots.forEach(slot => {
      if (slot.playerId) {
        currentFieldSeconds.set(slot.playerId, (currentFieldSeconds.get(slot.playerId) || 0) + elapsed);
      }
    });
  };

  const choosePlayerForSlot = (
    position: PitchPosition,
    currentSlotPlayerId: string | null,
    usedIds: Set<string>,
    currentIds: Set<string>,
    intervalStart: number,
    intervalEnd: number
  ) => {
    const intervalLength = Math.max(0, intervalEnd - intervalStart);
    const candidates = outfieldPlayers.filter(player => {
      if (usedIds.has(player.id)) return false;
      if (!isAvailableForInterval(player, intervalStart, intervalEnd)) return false;
      if (!canUseInOutfield(player, position)) return false;
      // Avoid moving players between slots in the generated plan; only keep a
      // player in their current slot or bring someone on from the bench.
      if (currentIds.has(player.id) && player.id !== currentSlotPlayerId) return false;
      return true;
    });

    candidates.sort((a, b) => {
      const aNeed = targetFieldSeconds(a.id) - (currentFieldSeconds.get(a.id) || 0);
      const bNeed = targetFieldSeconds(b.id) - (currentFieldSeconds.get(b.id) || 0);
      const aUrgency = aNeed / remainingAvailabilitySeconds(a, intervalStart);
      const bUrgency = bNeed / remainingAvailabilitySeconds(b, intervalStart);
      // Pure fairness ordering — no GK bonus. With correct targets, GKs
      // already need less outfield time and will naturally end at equal totals.
      const aScore = aUrgency * 1000 + aNeed * 0.01 - intervalLength + (a.id === currentSlotPlayerId ? 20 : 0);
      const bScore = bUrgency * 1000 + bNeed * 0.01 - intervalLength + (b.id === currentSlotPlayerId ? 20 : 0);
      return bScore - aScore;
    });

    return candidates[0] || null;
  };

  const applyFairRotationAt = (absoluteSeconds: number, nextAbsoluteSeconds: number, reservedSubEvents = 0) => {
    const maxChanges = Math.max(0, maxSubEventsPerWindow - reservedSubEvents);
    if (maxChanges === 0) {
      previousRotationPlayerInIds = new Set<string>();
      return;
    }

    const currentIds = new Set(fieldSlots.map(slot => slot.playerId).filter(Boolean) as string[]);

    // FAIRNESS-DRIVEN SELECTION (with queue tiebreakers + bounce-back guard)
    // -----------------------------------------------------------------------
    // 1. Bench order: by current playing time ASC (least-played first).
    //    Tiebreaker: lastOffAt ASC (longest waiting first).
    // 2. Pitch order: by current playing time DESC (most-played first).
    //    Tiebreaker: lastOnAt ASC (longest on first).
    // 3. MIN_SHIFT_SECONDS prevents pulling someone who just came on.
    // 4. Strict anti-bounce-back: never pull a player who entered in the
    //    immediately previous window.
    // 5. Only commit a swap if it actually reduces the gap between the two
    //    players' projected end-of-game minutes (avoids churn).
    const projectedFinalSeconds = (id: string) => {
      // If they stay in their current state for the rest of the game.
      const onPitchNow = currentIds.has(id);
      const remaining = endAbsoluteSeconds - absoluteSeconds;
      const accumulated = currentFieldSeconds.get(id) || 0;
      return accumulated + (onPitchNow ? remaining : 0);
    };

    // Each player's TOTAL minutes target = field + GK duty already received.
    // Sorting by deficit-against-target (rather than raw field minutes) means
    // GKs — who have minutes banked from goalkeeping — naturally rank lower in
    // the bench queue, ensuring everyone finishes at equal TOTAL minutes.
    const totalTarget = (id: string) => {
      const p = playerById.get(id);
      const baseMinutes = p?.minutesPlayed || 0;
      return Math.max(0, sharedTotalTarget - baseMinutes - gkDutySeconds(id));
    };
    const deficit = (id: string) => totalTarget(id) - (currentFieldSeconds.get(id) || 0);
    // Urgency = deficit / time remaining where the player is still available.
    // This makes a player with limited availability (e.g. 2H-GK only available
    // in H1 for outfield duty) escalate their priority as their window closes.
    const urgency = (p: Player) => {
      const remain = remainingAvailabilitySeconds(p, absoluteSeconds);
      return deficit(p.id) / Math.max(1, remain);
    };

    // QUEUE-FIRST with hard max-spread cap.
    // -----------------------------------------------------------------------
    // The cap is enforced on PROJECTED final minutes (= field minutes already
    // banked + minutes still to be played if we leave the player in their
    // current state). When the projected spread between the most-played and
    // least-played available players would exceed the user cap, we override
    // queue order and force the worst offenders to swap. Otherwise we keep
    // pure FIFO queue ordering for predictability.
    const maxSpreadSeconds = Math.max(60, maxSpreadMinutes * 60);
    // Escalation kicks in earlier than the hard cap so we have time to correct
    // before we'd actually breach it.
    // Use 40% of the cap so corrections start well before the breach.
    const escalationThreshold = Math.max(30, maxSpreadSeconds * 0.4);

    // Each player has a TARGET total (field + GK duty already received) equal
    // to the average across the squad. The "shortfall" we want to close is
    // (target − projected total). When the spread between shortfalls breaches
    // the cap, override queue order to prioritise the most-shortfall players.
    const totalProjected = (id: string) => {
      const p = playerById.get(id);
      const baseMinutes = (p?.minutesPlayed || 0);
      return baseMinutes + gkDutySeconds(id) + projectedFinalSeconds(id);
    };
    // GK PROTECTION (Frequent mode): players assigned as GK in either half
    // should finish at the TOP of the allowed spread band — not the floor.
    // We lift their total target by the spread cap so the fairness scheduler
    // treats them as still "owed" minutes until they reach gkCeilingSec.
    const spreadHalfSec = Math.max(0, maxSpreadMinutes * 60) / 2;
    const gkCeilingTotal = sharedTotalTarget + spreadHalfSec;
    const playerTotalTarget = (id: string) => {
      const p = playerById.get(id);
      const baseMinutes = (p?.minutesPlayed || 0);
      const isProtected =
        (includeStartingGkInRotation && id === gkOnPitch?.id) ||
        (halftimeGkIn ? id === halftimeGkIn.id : false);
      const target = (isProtected ? gkCeilingTotal : sharedTotalTarget) + priorityTargetBiasSeconds(id);
      return Math.max(baseMinutes + gkDutySeconds(id), target);
    };
    const shortfall = (id: string) => playerTotalTarget(id) - totalProjected(id);

    // Snapshot now so we can detect cap breaches.
    const projectionsNow = new Map<string, number>();
    const shortfallsNow = new Map<string, number>();
    outfieldPlayers.forEach(p => {
      projectionsNow.set(p.id, totalProjected(p.id));
      shortfallsNow.set(p.id, shortfall(p.id));
    });
    const shortfallVals = Array.from(shortfallsNow.values());
    const shortfallSpread = Math.max(...shortfallVals) - Math.min(...shortfallVals);
    const capBreached = shortfallSpread > escalationThreshold;

    const isGkProtectedFreq = (id: string) =>
      (includeStartingGkInRotation && id === gkOnPitch?.id) ||
      (halftimeGkIn ? id === halftimeGkIn.id : false);

    const benchQueue = outfieldPlayers
      .filter(p => !currentIds.has(p.id))
      .filter(p => isAvailableForInterval(p, absoluteSeconds, nextAbsoluteSeconds))
      .sort((a, b) => {
        // PHASE 5: shortfall is always the primary criterion. The bench
        // player furthest below their fair-share total comes on first. FIFO
        // (longest-waiting) only acts as a tiebreaker inside a small
        // deadband to keep the queue stable when shortfalls are essentially
        // equal. The previous capBreached gate is retained as a stronger
        // override for clearly-breaching situations.
        const aS = shortfallsNow.get(a.id) ?? 0;
        const bS = shortfallsNow.get(b.id) ?? 0;
        const deadband = capBreached ? 15 : 30;
        if (Math.abs(aS - bS) > deadband) return bS - aS;
        // GK protection: bring protected players on first when both still owe minutes.
        const aGk = isGkProtectedFreq(a.id) ? 1 : 0;
        const bGk = isGkProtectedFreq(b.id) ? 1 : 0;
        if (aGk !== bGk) {
          const aProj = projectionsNow.get(a.id) ?? 0;
          const bProj = projectionsNow.get(b.id) ?? 0;
          if (aGk && aProj < gkCeilingTotal - 30) return -1;
          if (bGk && bProj < gkCeilingTotal - 30) return 1;
        }
        // Tiebreaker: pure FIFO — longest-waiting bench player first.
        return (lastOffAt.get(a.id) ?? 0) - (lastOffAt.get(b.id) ?? 0);
      });

    const pitchSlotsWithMeta = fieldSlots
      .map((slot, index) => ({ slot, index, playerOut: slot.playerId ? playerById.get(slot.playerId) : undefined }))
      .filter(({ playerOut }) => !!playerOut);

    const usedSlotIndexes = new Set<number>();
    const usedInIds = new Set<string>();
    const selectedSubs: { slotIndex: number; playerOut: Player; playerIn: Player }[] = [];

    for (let bi = 0; bi < benchQueue.length && selectedSubs.length < maxChanges; bi++) {
      const playerIn = benchQueue[bi];
      if (usedInIds.has(playerIn.id)) continue;

      // Pitch candidates compatible with this incoming player.
      // When cap is breached: pull the highest projected total first.
      // Otherwise: queue order (longest currently-on-pitch first).
      const eligibleSlots = pitchSlotsWithMeta
        .filter(({ slot, index, playerOut }) =>
          !usedSlotIndexes.has(index) &&
          !!playerOut &&
          canUseInOutfield(playerIn, slot.position) &&
          absoluteSeconds - (lastOnAt.get(playerOut!.id) ?? 0) >= MIN_SHIFT_SECONDS &&
          !previousRotationPlayerInIds.has(playerOut!.id)
        )
        .sort((a, b) => {
          // PHASE 5: shortfall-gradient pull-off. Player with the SMALLEST
          // shortfall (most over their fair share) comes off first. FIFO
          // (longest currently-on-pitch) only tiebreaks inside the deadband.
          const aS = shortfallsNow.get(a.playerOut!.id) ?? 0;
          const bS = shortfallsNow.get(b.playerOut!.id) ?? 0;
          const deadband = capBreached ? 15 : 30;
          if (Math.abs(aS - bS) > deadband) return aS - bS;
          // GK protection: never pull a protected player off until they reach
          // gkCeilingTotal — pull non-protected players first.
          const aGk = isGkProtectedFreq(a.playerOut!.id) ? 1 : 0;
          const bGk = isGkProtectedFreq(b.playerOut!.id) ? 1 : 0;
          if (aGk !== bGk) {
            const aProj = projectionsNow.get(a.playerOut!.id) ?? 0;
            const bProj = projectionsNow.get(b.playerOut!.id) ?? 0;
            if (aGk && aProj < gkCeilingTotal - 30) return 1;
            if (bGk && bProj < gkCeilingTotal - 30) return -1;
          }
          // Tiebreaker: queue order — longest currently-on-pitch first.
          return (lastOnAt.get(a.playerOut!.id) ?? 0) - (lastOnAt.get(b.playerOut!.id) ?? 0);
        });

      if (eligibleSlots.length === 0) continue;

      let chosenSlot = eligibleSlots[0];
      let playerOut = chosenSlot.playerOut!;

      // GK PROTECTION (Frequent): if the chosen slot is a GK-protected player
      // who hasn't reached the spread ceiling yet, prefer a non-GK slot if any
      // is available. Falls through to the GK swap only if no alternative.
      const bankedTotal = (id: string) => {
        const p = playerById.get(id);
        return (p?.minutesPlayed || 0) + gkDutySeconds(id) + (currentFieldSeconds.get(id) || 0);
      };
      const inIsProtected = isGkProtectedFreq(playerIn.id);
      if (
        isGkProtectedFreq(playerOut.id) &&
        bankedTotal(playerOut.id) < gkCeilingTotal - 30 &&
        !inIsProtected
      ) {
        const altSlot = eligibleSlots.find(s =>
          s !== chosenSlot && !isGkProtectedFreq(s.playerOut!.id),
        );
        if (altSlot) {
          chosenSlot = altSlot;
          playerOut = altSlot.playerOut!;
        }
      }

      // Only commit if the swap actually narrows the shortfall gap between
      // these two players. (Avoids churn when shortfalls are already balanced.)
      const inShortfall = shortfallsNow.get(playerIn.id) ?? 0;
      const outShortfall = shortfallsNow.get(playerOut.id) ?? 0;
      const gapBefore = inShortfall - outShortfall;
      if (gapBefore < 30 && !capBreached) {
        continue;
      }
      // Hard refusal: never make the spread worse (incoming player already above target).
      if (gapBefore < 0) continue;

      usedSlotIndexes.add(chosenSlot.index);
      usedInIds.add(playerIn.id);
      selectedSubs.push({ slotIndex: chosenSlot.index, playerOut, playerIn });
    }

    selectedSubs.forEach(({ slotIndex, playerOut, playerIn }) => {
      const { half, time } = toPlanTime(absoluteSeconds);
      plan.push({
        time,
        half,
        playerOut,
        playerIn,
        executed: false,
      });

      fieldSlots[slotIndex].playerId = playerIn.id;
      // Update queue trackers: outgoing player joins bench wait queue,
      // incoming player starts a fresh on-pitch shift.
      lastOffAt.set(playerOut.id, absoluteSeconds);
      lastOnAt.set(playerIn.id, absoluteSeconds);
    });

    previousRotationPlayerInIds = new Set(selectedSubs.map(sub => sub.playerIn.id));
  };

  let directLastTime = startAbsoluteSeconds;
  for (let i = 0; i < sortedDirectEventTimes.length; i++) {
    const eventTime = sortedDirectEventTimes[i];
    addFieldTime(eventTime - directLastTime);
    directLastTime = eventTime;

    let reservedSubEvents = 0;
    if (eventTime === halfDurationSeconds && rotateGkAtHalftime && gkOnPitch && halftimeGkIn) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch,
        playerIn: halftimeGkIn,
        executed: false,
      });
      reservedSubEvents = 1;
      fieldSlots.forEach(slot => {
        if (slot.playerId === halftimeGkIn.id) slot.playerId = null;
      });
      // Queue updates for the GK swap: starting GK becomes available for the
      // outfield bench queue (H2 onward), halftime GK is now on pitch as GK.
      lastOffAt.set(gkOnPitch.id, eventTime);
      lastOnAt.set(halftimeGkIn.id, eventTime);
    }

    const nextTime = sortedDirectEventTimes[i + 1] ?? endAbsoluteSeconds;
    applyFairRotationAt(eventTime, nextTime, reservedSubEvents);
  }
  addFieldTime(endAbsoluteSeconds - directLastTime);

  const getPlanAbsoluteSeconds = (sub: SubstitutionEvent) =>
    sub.half === 1 ? sub.time : halfDurationSeconds + sub.time;
  const isDirectHalftimeGkSwapSub = (sub: SubstitutionEvent) =>
    !!gkOnPitch && sub.half === 2 && sub.time === 0 && sub.playerOut.id === gkOnPitch.id;
  const fairPlayerIds = playerData.filter(p => !p.isInjured).map(p => p.id);

  const simulateFullPlan = (candidatePlan: SubstitutionEvent[]) => {
    const totals = new Map<string, number>();
    playerData.forEach(p => totals.set(p.id, p.minutesPlayed || 0));

    const onPitch = new Map<string, PitchPosition>();
    playersOnPitch.forEach(p => {
      if (p.currentPitchPosition) onPitch.set(p.id, p.currentPitchPosition);
    });

    // Track when each player most recently came onto the pitch (in absolute seconds).
    // Starters are seeded at startAbsoluteSeconds. Used to penalise short shifts
    // (a player taken off less than MIN_SHIFT_SECONDS_PENALTY after coming on).
    const cameOnAt = new Map<string, number>();
    playersOnPitch.forEach(p => cameOnAt.set(p.id, startAbsoluteSeconds));
    const MIN_SHIFT_SECONDS_PENALTY = eff.minShiftSeconds;

    const ordered = candidatePlan
      .map((sub, index) => ({ sub, index, absoluteSeconds: getPlanAbsoluteSeconds(sub) }))
      .sort((a, b) => a.absoluteSeconds - b.absoluteSeconds);
    const snapshots: { index: number; before: Map<string, PitchPosition>; absoluteSeconds: number; nextAbsoluteSeconds: number }[] = [];
    let last = startAbsoluteSeconds;
    let valid = true;
    let bounceBackCount = 0;
    let shortShiftCount = 0;
    let currentWindowTime: number | null = null;
    let previousWindowPlayerIns = new Set<string>();
    let currentWindowPlayerIns = new Set<string>();

    ordered.forEach((entry, orderIndex) => {
      const elapsed = entry.absoluteSeconds - last;
      if (elapsed < 0) valid = false;
      if (elapsed > 0) {
        onPitch.forEach((_, id) => totals.set(id, (totals.get(id) || 0) + elapsed));
      }

      if (currentWindowTime !== entry.absoluteSeconds) {
        previousWindowPlayerIns = currentWindowPlayerIns;
        currentWindowPlayerIns = new Set<string>();
        currentWindowTime = entry.absoluteSeconds;
      }

      if (benchSize > 1 && previousWindowPlayerIns.has(entry.sub.playerOut.id) && !isDirectHalftimeGkSwapSub(entry.sub)) {
        bounceBackCount++;
      }

      // Short-shift penalty: catches bounce-backs across more than one window.
      if (benchSize > 1 && !isDirectHalftimeGkSwapSub(entry.sub)) {
        const onSince = cameOnAt.get(entry.sub.playerOut.id);
        if (onSince !== undefined && entry.absoluteSeconds - onSince < MIN_SHIFT_SECONDS_PENALTY) {
          shortShiftCount++;
        }
      }

      snapshots.push({
        index: entry.index,
        before: new Map(onPitch),
        absoluteSeconds: entry.absoluteSeconds,
        nextAbsoluteSeconds: ordered[orderIndex + 1]?.absoluteSeconds ?? endAbsoluteSeconds,
      });

      const outPosition = onPitch.get(entry.sub.playerOut.id);
      if (!outPosition || onPitch.has(entry.sub.playerIn.id)) valid = false;

      onPitch.delete(entry.sub.playerOut.id);
      cameOnAt.delete(entry.sub.playerOut.id);
      if (entry.sub.positionSwap) {
        const swapFromPosition = onPitch.get(entry.sub.positionSwap.player.id);
        if (!swapFromPosition) valid = false;
        if (swapFromPosition) onPitch.set(entry.sub.playerIn.id, swapFromPosition);
        onPitch.set(entry.sub.positionSwap.player.id, outPosition || entry.sub.positionSwap.toPosition);
      } else if (outPosition) {
        onPitch.set(entry.sub.playerIn.id, outPosition);
      }
      cameOnAt.set(entry.sub.playerIn.id, entry.absoluteSeconds);

      currentWindowPlayerIns.add(entry.sub.playerIn.id);

      last = entry.absoluteSeconds;
    });

    const remaining = endAbsoluteSeconds - last;
    if (remaining > 0) {
      onPitch.forEach((_, id) => totals.set(id, (totals.get(id) || 0) + remaining));
    }

    return { totals, snapshots, valid, bounceBackCount, shortShiftCount };
  };

  const fairnessObjective = (totals: Map<string, number>, bounceBackCount = 0, shortShiftCount = 0) => {
    const values = fairPlayerIds.map(id => totals.get(id) || 0);
    if (values.length < 2) return 0;
    const spread = Math.max(...values) - Math.min(...values);
    return spread * 1000 + bounceBackCount * 10_000_000 + shortShiftCount * 5_000_000;
  };

  // Iterative fairness optimizer. Each pass tries every legal single-sub
  // identity replacement at every snapshot and keeps the edit that most
  // reduces (spread × 1000 + GK shortfall). Runs until no improvement.
  const MAX_OPTIMIZER_ITERATIONS = 120;
  for (let iter = 0; iter < MAX_OPTIMIZER_ITERATIONS; iter++) {
    const currentSim = simulateFullPlan(plan);
    if (!currentSim.valid) break;
    const currentScore = fairnessObjective(currentSim.totals, currentSim.bounceBackCount, currentSim.shortShiftCount);
    if (currentScore === 0) break;
    let bestEdit: { index: number; replacement: SubstitutionEvent; score: number } | null = null;

    for (const snapshot of currentSim.snapshots) {
      const original = plan[snapshot.index];
      if (!original || isDirectHalftimeGkSwapSub(original)) continue;

      const incomingCandidates = playerData.filter(player =>
        !snapshot.before.has(player.id) &&
        isAvailableForInterval(player, snapshot.absoluteSeconds, snapshot.nextAbsoluteSeconds)
      );

      for (const [outId, outPosition] of snapshot.before.entries()) {
        if (outPosition === "GK") continue;
        const playerOut = playerById.get(outId);
        if (!playerOut) continue;

        for (const playerIn of incomingCandidates) {
          if (!canUseInOutfield(playerIn, outPosition)) continue;
          if (playerOut.id === original.playerOut.id && playerIn.id === original.playerIn.id && !original.positionSwap) continue;

          const replacement: SubstitutionEvent = {
            ...original,
            playerOut,
            playerIn,
            positionSwap: undefined,
          };

          plan[snapshot.index] = replacement;
          const trial = simulateFullPlan(plan);
          const score = trial.valid ? fairnessObjective(trial.totals, trial.bounceBackCount, trial.shortShiftCount) : Number.POSITIVE_INFINITY;
          plan[snapshot.index] = original;

          // Accept any strict improvement (no slack) so the optimizer can keep
          // tightening the spread until truly optimal.
          if (trial.valid && score < (bestEdit?.score ?? currentScore)) {
            bestEdit = { index: snapshot.index, replacement, score };
          }
        }
      }
    }

    if (!bestEdit || bestEdit.score >= currentScore) break;
    plan[bestEdit.index] = bestEdit.replacement;
  }

  plan.sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    if (a.time !== b.time) return a.time - b.time;
    const aIsGkSwap = !!gkOnPitch && a.half === 2 && a.time === 0 && a.playerOut.id === gkOnPitch.id;
    const bIsGkSwap = !!gkOnPitch && b.half === 2 && b.time === 0 && b.playerOut.id === gkOnPitch.id;
    if (aIsGkSwap !== bIsGkSwap) return aIsGkSwap ? -1 : 1;
    return 0;
  });

  {
      const eqPlan = applyEqualTimeOverride({
        playerData, teamSize, halfDurationSeconds,
        gkOnPitch, halftimeGkIn, rotateGkAtHalftime, maxSpreadMinutes,
        rotationSpeed, eff,
        priorityOrderLength: priorityOrder.length,
        startHalf, startElapsedSeconds: clampedStartElapsed,
        benchCount: outfieldOnBench.length,
        currentPlan: plan,
      });
      if (eqPlan) {
        plan.length = 0;
        plan.push(...eqPlan);
      }
    }

  return ensureNoStarvedPlayers(plan, playerData, halfDurationSeconds);

  // Process each half (start from current half for mid-game)
  for (let half = startHalf; half <= 2; half++) {
    const isStartHalf = half === startHalf;

    // At the start of H2, apply the halftime GK swap to the simulation state:
    // the incoming GK leaves the outfield pool (they're now in goal). The
    // outgoing GK is already off the pitch and will be rotated in normally.
    if (half === 2 && halftimeGkIn && currentOnPitch.has(halftimeGkIn.id)) {
      currentOnPitch.delete(halftimeGkIn.id);
    }

    const halfRemaining = isStartHalf ? halfDurationSeconds - startElapsedSeconds : halfDurationSeconds;
    const rawSubTimes = generateSubTimes(halfRemaining, actualWindowsPerHalf)
      .map(t => isStartHalf ? t + startElapsedSeconds : t); // Offset times for current half

    // Filter subs too close to end of half:
    // - First half: snap to halftime (half 2, time 0)
    // - Second half: drop entirely (don't sub someone off within 1 min of full time)
    const subTimes: number[] = [];
    const deferredToHalftime: number[] = [];
    for (const t of rawSubTimes) {
      if ((halfDurationSeconds - t) <= END_OF_HALF_SNAP_THRESHOLD) {
        if (half === 1) {
          deferredToHalftime.push(t);
        }
        // half === 2: drop — no point subbing within 1 min of full time
      } else {
        subTimes.push(t);
      }
    }

    let lastEventTime = isStartHalf ? startElapsedSeconds : 0;
    
    for (const subTime of subTimes) {
      // Add elapsed time to players currently on pitch
      const elapsed = subTime - lastEventTime;
      currentOnPitch.forEach((_, id) => {
        playingTime.set(id, (playingTime.get(id) || 0) + elapsed);
      });
      lastEventTime = subTime;
      
      // Get sorted lists — use GK-adjusted time so goalkeepers are prioritised
      // (picked first off the bench, picked last off the pitch).
      const onPitchSorted = Array.from(currentOnPitch.keys())
        .map(id => ({ id, time: adjustedTime(id), player: getPlayer(id)! }))
        .filter(p => p.player)
        .sort((a, b) => b.time - a.time);
      
      const benchSorted = outfieldPlayers
        .filter(p => !currentOnPitch.has(p.id))
        // Starting GK is in the rotation pool but NOT actually available until
        // they come off goal at halftime — exclude them from H1 sub windows.
        .filter(p => !(includeStartingGkInRotation && half === 1 && p.id === gkOnPitch?.id))
        // Halftime GK substitute is in goal during H2, not on the bench.
        .filter(p => !(half === 2 && halftimeGkIn && p.id === halftimeGkIn.id))
        .map(p => ({ id: p.id, time: adjustedTime(p.id), player: p }))
        .sort((a, b) => a.time - b.time);
      
      if (onPitchSorted.length === 0 || benchSorted.length === 0) continue;
      
      // Determine how many subs to make at this time window
      const currentBenchSize = benchSorted.length;
      const subsThisWindow = Math.min(subsAtOnce, currentBenchSize, onPitchSorted.length);
      
      // Track which players we've already used in this window
      const usedPlayerOutIds = new Set<string>();
      const usedPlayerInIds = new Set<string>();
      
      for (let subIdx = 0; subIdx < subsThisWindow; subIdx++) {
        // Refresh sorted lists excluding already-used players
        const availableOnPitch = onPitchSorted.filter(p => !usedPlayerOutIds.has(p.id));
        const availableBench = benchSorted.filter(p => !usedPlayerInIds.has(p.id));
        
        if (availableOnPitch.length === 0 || availableBench.length === 0) break;
        
        const mostPlayedOnPitch = availableOnPitch[0];
        const leastPlayedOnBench = availableBench[0];
        
        // Only check time difference for the first sub of a batch window
        // Additional batch subs are made to rotate more players together
        // Use 30s threshold for consistency with candidate scoring
        if (subIdx === 0 && (mostPlayedOnPitch.time - leastPlayedOnBench.time) < 30) break;
        
        const best = findBestSubCandidate(onPitchSorted, benchSorted, usedPlayerOutIds, usedPlayerInIds);
        
        if (best) {
          const incomingPosition = best.positionSwap 
            ? best.positionSwap.fromPosition 
            : currentOnPitch.get(best.playerOut.id);
          
          plan.push({
            time: subTime,
            half: half as 1 | 2,
            playerOut: best.playerOut,
            playerIn: best.playerIn,
            positionSwap: best.positionSwap,
            executed: false,
          });
          
          // Mark players as used in this window
          usedPlayerOutIds.add(best.playerOut.id);
          usedPlayerInIds.add(best.playerIn.id);
          
          // Update pitch state
          currentOnPitch.delete(best.playerOut.id);
          currentOnPitch.set(best.playerIn.id, incomingPosition!);
          
          if (best.positionSwap) {
            currentOnPitch.set(best.positionSwap.player.id, best.positionSwap.toPosition);
          }
        } else {
          break; // No valid subs found
        }
      }
    }
    
    // Add remaining time in half
    const remainingTime = halfDurationSeconds - lastEventTime;
    currentOnPitch.forEach((_, id) => {
      playingTime.set(id, (playingTime.get(id) || 0) + remainingTime);
    });

    // Process deferred end-of-half subs as halftime subs (half 2, time 0)
    if (half === 1 && deferredToHalftime.length > 0) {
      const onPitchSorted = Array.from(currentOnPitch.keys())
        .map(id => ({ id, time: adjustedTime(id), player: getPlayer(id)! }))
        .filter(p => p.player)
        .sort((a, b) => b.time - a.time);
      const benchSorted = outfieldPlayers
        .filter(p => !currentOnPitch.has(p.id))
        // Starting GK is still in goal at the end of H1 — not a real bench option here.
        .filter(p => !(includeStartingGkInRotation && p.id === gkOnPitch?.id))
        .map(p => ({ id: p.id, time: adjustedTime(p.id), player: p }))
        .sort((a, b) => a.time - b.time);
      const usedOutIds = new Set<string>();
      const usedInIds = new Set<string>();
      for (let di = 0; di < deferredToHalftime.length; di++) {
        const availableOnPitch = onPitchSorted.filter(p => !usedOutIds.has(p.id));
        const availableBench = benchSorted.filter(p => !usedInIds.has(p.id));
        if (availableOnPitch.length === 0 || availableBench.length === 0) break;
        const best = findBestSubCandidate(onPitchSorted, benchSorted, usedOutIds, usedInIds);
        if (best) {
          const incomingPosition = best.positionSwap
            ? best.positionSwap.fromPosition
            : currentOnPitch.get(best.playerOut.id);
          plan.push({
            time: 0,
            half: 2,
            playerOut: best.playerOut,
            playerIn: best.playerIn,
            positionSwap: best.positionSwap,
            executed: false,
          });
          usedOutIds.add(best.playerOut.id);
          usedInIds.add(best.playerIn.id);
          currentOnPitch.delete(best.playerOut.id);
          currentOnPitch.set(best.playerIn.id, incomingPosition!);
          if (best.positionSwap) {
            currentOnPitch.set(best.positionSwap.player.id, best.positionSwap.toPosition);
          }
        } else {
          break;
        }
      }
    }
  }
  
  // Handle GK substitution at halftime (only if we haven't passed halftime)
  if (rotateGkAtHalftime && gkOnPitch && startHalf === 1) {
    // Prefer the H2 GK we predicted upfront (and gave the priority bonus to)
    // so the simulation stays consistent. Fall back to least-played GK-eligible
    // bench player only if none was predicted.
    const gkReplacementPlayer = halftimeGkIn || (() => {
      const benchAtHalftime = outfieldPlayers
        .filter(p => !currentOnPitch.has(p.id))
        .map(p => ({ player: p, time: playingTime.get(p.id) || 0 }))
        .sort((a, b) => a.time - b.time);
      // Eligible: players with GK in assigned positions, OR players with no positions set (eligible for all)
      const gkEligible = benchAtHalftime.filter(p => 
        p.player.assignedPositions?.includes("GK") || !p.player.assignedPositions?.length
      );
      return gkEligible[0]?.player || null;
    })();
    
    if (gkReplacementPlayer) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch,
        playerIn: gkReplacementPlayer,
        executed: false,
      });
    }
  }
  
  // Snap subs scheduled within 60s of the start of a half to time 0 (half-time sub)
  // This avoids scheduling a sub e.g. 14 seconds into the 2nd half when it should just happen at half time
  const HALF_BOUNDARY_THRESHOLD = 60;
  for (const sub of plan) {
    if (sub.time > 0 && sub.time <= HALF_BOUNDARY_THRESHOLD) {
      sub.time = 0;
    }
  }
  
  const isHalftimeGkSwapSub = (sub: SubstitutionEvent) =>
    !!gkOnPitch && sub.half === 2 && sub.time === 0 && sub.playerOut.id === gkOnPitch.id;

  const sortPlan = () => {
    plan.sort((a, b) => {
      if (a.half !== b.half) return a.half - b.half;
      if (a.time !== b.time) return a.time - b.time;
      // The GK change must happen before any other halftime subs so the H2 GK
      // is removed from the outfield rotation before normal subs are applied.
      if (isHalftimeGkSwapSub(a) !== isHalftimeGkSwapSub(b)) {
        return isHalftimeGkSwapSub(a) ? -1 : 1;
      }
      return 0;
    });
  };

  sortPlan();

  type SimulationSnapshot = {
    index: number;
    sub: SubstitutionEvent;
    before: Map<string, PitchPosition>;
  };

  const canPlayPosition = (player: Player, position?: PitchPosition) =>
    !!position && (!player.assignedPositions?.length || player.assignedPositions.includes(position));

  const simulateOutfieldPlan = (candidatePlan: SubstitutionEvent[]) => {
    const t = new Map<string, number>();
    outfieldPlayers.forEach(p => t.set(p.id, p.minutesPlayed || 0));

    const onP = new Map<string, PitchPosition>();
    outfieldOnPitch.forEach(p => onP.set(p.id, p.currentPitchPosition as PitchPosition));

    const snapshots: SimulationSnapshot[] = [];
    let valid = true;
    let lt = startElapsedSeconds;
    let lh: 1 | 2 = startHalf;

    candidatePlan.forEach((sub, index) => {
      const elapsed = sub.half === lh
        ? sub.time - lt
        : (halfDurationSeconds - lt) + sub.time;

      if (elapsed < 0) valid = false;
      if (elapsed > 0) {
        onP.forEach((_, id) => t.set(id, (t.get(id) || 0) + elapsed));
      }

      lt = sub.time;
      lh = sub.half;
      snapshots.push({ index, sub, before: new Map(onP) });

      if (isHalftimeGkSwapSub(sub)) {
        // This is a goalkeeping change, not an outfield substitution. If the
        // incoming GK was playing outfield in H1, remove them from field play.
        onP.delete(sub.playerIn.id);
        return;
      }

      const outPos = onP.get(sub.playerOut.id);
      if (!outPos || onP.has(sub.playerIn.id)) {
        valid = false;
      }

      onP.delete(sub.playerOut.id);
      if (sub.positionSwap) {
        const swapFromPos = onP.get(sub.positionSwap.player.id);
        if (!swapFromPos || !canPlayPosition(sub.playerIn, swapFromPos) || !canPlayPosition(sub.positionSwap.player, outPos)) {
          valid = false;
        }
        if (swapFromPos) onP.set(sub.playerIn.id, swapFromPos);
        if (outPos) onP.set(sub.positionSwap.player.id, outPos);
      } else if (outPos) {
        if (!canPlayPosition(sub.playerIn, outPos)) valid = false;
        onP.set(sub.playerIn.id, outPos);
      }
    });

    const endE = halfDurationSeconds - lt;
    if (endE > 0) onP.forEach((_, id) => t.set(id, (t.get(id) || 0) + endE));
    if (lh === 1) onP.forEach((_, id) => t.set(id, (t.get(id) || 0) + halfDurationSeconds));

    return { times: t, snapshots, valid };
  };

  const totalProjectedSeconds = (times: Map<string, number>, id: string) =>
    (times.get(id) || 0) + gkDutySeconds(id);

  // ITERATIVE FAIRNESS PASS: make legal, state-aware edits only. The previous
  // pass could miss cases where the overplayed player never appeared as a
  // matching `playerIn`/`playerOut`. Here we inspect the actual pitch state at
  // each sub window and replace that window with `overplayed off, underplayed on`.
  const fairnessTargets = outfieldPlayers;
  // Tolerance lowered (was 30s) so the loop keeps searching for improving
  // swaps until the spread is within ~5 seconds. The loop still exits early
  // when no swap can improve, so this only burns iterations when there's
  // actual room to tighten fairness.
  const FAIRNESS_TOLERANCE = 5;
  const MAX_REBALANCE_ITERATIONS = 32;

  const fairnessSpread = (times: Map<string, number>) => {
    const values = fairnessTargets.map(p => totalProjectedSeconds(times, p.id));
    if (values.length < 2) return 0;
    return Math.max(...values) - Math.min(...values);
  };

  for (let iter = 0; iter < MAX_REBALANCE_ITERATIONS; iter++) {
    const sim = simulateOutfieldPlan(plan);
    const ftimes = fairnessTargets.map(p => ({ id: p.id, t: totalProjectedSeconds(sim.times, p.id) }));
    if (ftimes.length < 2) break;

    ftimes.sort((a, b) => b.t - a.t);
    const over = ftimes[0];
    const under = ftimes[ftimes.length - 1];
    const currentSpread = over.t - under.t;
    if (currentSpread <= FAIRNESS_TOLERANCE) break;

    const overPlayer = getPlayer(over.id);
    const underPlayer = getPlayer(under.id);
    if (!overPlayer || !underPlayer) break;

    let bestEdit: { index: number; replacement: SubstitutionEvent; spread: number } | null = null;

    for (const snapshot of sim.snapshots) {
      const sub = plan[snapshot.index];
      if (!sub || isHalftimeGkSwapSub(sub)) continue;
      if (!snapshot.before.has(over.id) || snapshot.before.has(under.id)) continue;

      const overPosition = snapshot.before.get(over.id);
      if (!overPosition) continue;

      // Build candidate replacements for this snapshot:
      //  1. DIRECT MATCH — under can take over's position straight up.
      //  2. POSITION SWAP — find a 3rd on-pitch player Q whose slot under can
      //     play and who can move into over's slot. This unlocks a much wider
      //     pool of fairness swaps when assigned positions don't overlap.
      const candidateReplacements: SubstitutionEvent[] = [];

      if (canPlayPosition(underPlayer, overPosition)) {
        candidateReplacements.push({
          ...sub,
          playerOut: overPlayer,
          playerIn: underPlayer,
          positionSwap: undefined,
        });
      }

      if (!disablePositionSwaps) {
        for (const [qId, qPos] of snapshot.before.entries()) {
          if (qId === over.id || qId === under.id || qId === overPlayer.id) continue;
          if (!canPlayPosition(underPlayer, qPos)) continue;
          if (!canPlayPosition({ assignedPositions: getPlayer(qId)?.assignedPositions } as Player, overPosition)) continue;
          const qPlayer = getPlayer(qId);
          if (!qPlayer) continue;
          candidateReplacements.push({
            ...sub,
            playerOut: overPlayer,
            playerIn: underPlayer,
            positionSwap: {
              player: qPlayer,
              fromPosition: qPos,
              toPosition: overPosition,
            },
          });
        }
      }

      for (const replacement of candidateReplacements) {
        const original = plan[snapshot.index];
        plan[snapshot.index] = replacement;
        const trial = simulateOutfieldPlan(plan);
        const spread = trial.valid ? fairnessSpread(trial.times) : currentSpread;
        plan[snapshot.index] = original;

        if (trial.valid && spread < (bestEdit?.spread ?? currentSpread)) {
          bestEdit = { index: snapshot.index, replacement, spread };
        }
      }
    }

    if (!bestEdit) break;
    plan[bestEdit.index] = bestEdit.replacement;
  }

  // ============================================================
  // REMOVAL PASS — drop redundant subs that hurt fairness.
  // ------------------------------------------------------------
  // The fill loop can leave "tail" subs at the end of a half that bench an
  // already-low player to bring on a similar-time player. Removing such
  // subs both reduces churn and tightens the spread. We delete a sub only
  // when the resulting plan is still valid AND the new fairness min is
  // strictly higher (no other player gets demoted as a side effect).
  // ============================================================
  for (let pass = 0; pass < 6; pass++) {
    sortPlan();
    const sim = simulateOutfieldPlan(plan);
    if (!sim.valid) break;
    const baseSpread = fairnessSpread(sim.times);
    const baseMin = Math.min(...fairnessTargets.map(p => totalProjectedSeconds(sim.times, p.id)));

    let bestRemoval: { index: number; spread: number; min: number } | null = null;
    for (let i = 0; i < plan.length; i++) {
      const sub = plan[i];
      if (isHalftimeGkSwapSub(sub)) continue;
      const trialPlan = plan.filter((_, j) => j !== i);
      const trial = simulateOutfieldPlan(trialPlan);
      if (!trial.valid) continue;
      const trialMin = Math.min(...fairnessTargets.map(p => totalProjectedSeconds(trial.times, p.id)));
      const trialSpread = fairnessSpread(trial.times);
      // Accept removal only if the lowest player strictly improves AND spread
      // does not get worse. This prevents removing useful subs that happen to
      // have a neutral effect on the min.
      if (trialMin > baseMin + FAIRNESS_TOLERANCE && trialSpread <= baseSpread) {
        if (
          !bestRemoval ||
          trialMin > bestRemoval.min ||
          (trialMin === bestRemoval.min && trialSpread < bestRemoval.spread)
        ) {
          bestRemoval = { index: i, spread: trialSpread, min: trialMin };
        }
      }
    }
    if (!bestRemoval) break;
    plan.splice(bestRemoval.index, 1);
  }
  // ============================================================
  // PHASE 4 — Spread-driven extra-window injection.
  // ------------------------------------------------------------
  // The rebalance loop above can only REPLACE existing sub events. When the
  // residual spread is caused by an under-played player who never appears as
  // a candidate `playerIn` in any existing window (e.g. a bench player whose
  // assigned positions don't overlap with anyone currently being subbed off),
  // no swap can fix them. Here we try to INSERT a brand-new sub event in a
  // quiet gap so the under-played player gets on the pitch.
  //
  // Constraints:
  // - Only fires when residual spread > 2× FAIRNESS_TOLERANCE (≥10 s today).
  // - New window must respect a 90-s minimum gap from neighbouring subs.
  // - New window must not cross the half boundary.
  // - The over-played player must actually be on pitch in the candidate gap.
  // - Direct position match preferred; falls back to a 3rd-player swap.
  // - Each insertion must reduce the simulated spread.
  // ============================================================
  // Only inject when spread exceeds the user-set cap. The rebalance loop
  // above already handles tighter (≥5 s) refinements via in-place swaps.
  // Injection is heavier (adds a real sub event) so we reserve it for cases
  // where the user's max-spread preference is actually being violated.
  const SPREAD_INJECTION_THRESHOLD = Math.max(FAIRNESS_TOLERANCE * 4, maxSpreadMinutes * 60 * 1.5);
  const SPREAD_INJECTION_MIN_GAP_SEC = 90;
  const SPREAD_INJECTION_MAX_INSERTIONS = 4;

  const subAbsSeconds = (s: SubstitutionEvent) =>
    s.half === 1 ? s.time : halfDurationSeconds + s.time;

  for (let inj = 0; inj < SPREAD_INJECTION_MAX_INSERTIONS; inj++) {
    sortPlan();
    const sim = simulateOutfieldPlan(plan);
    if (!sim.valid) break;
    const ftimes = fairnessTargets.map(p => ({ id: p.id, t: totalProjectedSeconds(sim.times, p.id) }));
    if (ftimes.length < 2) break;
    ftimes.sort((a, b) => b.t - a.t);
    const over = ftimes[0];
    const under = ftimes[ftimes.length - 1];
    const currentSpread = over.t - under.t;
    if (currentSpread <= SPREAD_INJECTION_THRESHOLD) break;

    const overPlayer = getPlayer(over.id);
    const underPlayer = getPlayer(under.id);
    if (!overPlayer || !underPlayer) break;

    // Build the list of candidate gaps from existing sub timings. Each gap is
    // [prevAbs, nextAbs] within the same half, plus a synthetic final gap up
    // to end-of-game and an initial gap from start.
    type Gap = { startAbs: number; endAbs: number; insertAfterIndex: number; half: 1 | 2; pitchBefore: Map<string, PitchPosition> };
    const gaps: Gap[] = [];
    const startAbsLocal = startHalf === 1 ? startElapsedSeconds : halfDurationSeconds + startElapsedSeconds;
    const endAbsLocal = halfDurationSeconds * 2;

    // Initial pitch state at startAbs — read from sim's first snapshot if any,
    // otherwise reconstruct from outfieldOnPitch.
    const initialPitch = new Map<string, PitchPosition>();
    outfieldOnPitch.forEach(p => initialPitch.set(p.id, p.currentPitchPosition as PitchPosition));

    let prevAbs = startAbsLocal;
    let prevHalf: 1 | 2 = startHalf;
    let prevPitch = new Map(initialPitch);
    for (let i = 0; i <= sim.snapshots.length; i++) {
      const snap = sim.snapshots[i];
      const nextAbs = snap ? subAbsSeconds(snap.sub) : endAbsLocal;
      const nextHalf = snap ? snap.sub.half : (2 as const);
      // Only consider intra-half gaps (avoid HT crossings — too fiddly).
      if (prevHalf === nextHalf && nextAbs - prevAbs >= SPREAD_INJECTION_MIN_GAP_SEC * 2 + 30) {
        gaps.push({
          startAbs: prevAbs,
          endAbs: nextAbs,
          insertAfterIndex: i - 1, // -1 means insert at front
          half: prevHalf,
          pitchBefore: new Map(prevPitch),
        });
      }
      if (snap) {
        prevAbs = subAbsSeconds(snap.sub);
        prevHalf = snap.sub.half;
        // Apply this sub to pitch state for the next gap.
        const outPos = prevPitch.get(snap.sub.playerOut.id);
        prevPitch.delete(snap.sub.playerOut.id);
        if (snap.sub.positionSwap && outPos) {
          const swapFromPos = prevPitch.get(snap.sub.positionSwap.player.id);
          if (swapFromPos) {
            prevPitch.set(snap.sub.playerIn.id, swapFromPos);
            prevPitch.set(snap.sub.positionSwap.player.id, outPos);
          }
        } else if (outPos) {
          prevPitch.set(snap.sub.playerIn.id, outPos);
        }
      }
    }

    let bestInsertion: { sub: SubstitutionEvent; insertAfterIndex: number; spread: number } | null = null;

    for (const gap of gaps) {
      // Need over on pitch and under NOT on pitch in this gap.
      const overPos = gap.pitchBefore.get(over.id);
      if (!overPos) continue;
      if (gap.pitchBefore.has(under.id)) continue;

      // Pick midpoint, snap to integer, respect min-gap from both ends.
      const tAbs = Math.floor((gap.startAbs + gap.endAbs) / 2);
      if (tAbs - gap.startAbs < SPREAD_INJECTION_MIN_GAP_SEC) continue;
      if (gap.endAbs - tAbs < SPREAD_INJECTION_MIN_GAP_SEC) continue;
      const tInHalf = gap.half === 1 ? tAbs : tAbs - halfDurationSeconds;
      if (tInHalf <= 0) continue;

      const candidates: SubstitutionEvent[] = [];
      // Direct match.
      if (canPlayPosition(underPlayer, overPos)) {
        candidates.push({
          time: tInHalf,
          half: gap.half,
          playerOut: overPlayer,
          playerIn: underPlayer,
          executed: false,
        });
      }
      // Swap fallback via a 3rd on-pitch player.
      if (!disablePositionSwaps) {
        for (const [qId, qPos] of gap.pitchBefore.entries()) {
          if (qId === over.id || qId === under.id) continue;
          if (!canPlayPosition(underPlayer, qPos)) continue;
          const qPlayer = getPlayer(qId);
          if (!qPlayer || !canPlayPosition(qPlayer, overPos)) continue;
          candidates.push({
            time: tInHalf,
            half: gap.half,
            playerOut: overPlayer,
            playerIn: underPlayer,
            executed: false,
            positionSwap: { player: qPlayer, fromPosition: qPos, toPosition: overPos },
          });
        }
      }

      for (const cand of candidates) {
        const trialPlan = [...plan, cand];
        trialPlan.sort((a, b) => {
          if (a.half !== b.half) return a.half - b.half;
          if (a.time !== b.time) return a.time - b.time;
          if (isHalftimeGkSwapSub(a) !== isHalftimeGkSwapSub(b)) {
            return isHalftimeGkSwapSub(a) ? -1 : 1;
          }
          return 0;
        });
        const trial = simulateOutfieldPlan(trialPlan);
        if (!trial.valid) continue;
        const trialSpread = fairnessSpread(trial.times);
        // Hard guard: no individual fairness target may lose more than 60 s
        // of projected playing time as a side effect. Without this, the
        // injection can solve "high vs zero" by quietly downgrading an
        // already-fine middle player below the 75 % floor.
        const REGRESSION_LIMIT = 60;
        let regressed = false;
        for (const p of fairnessTargets) {
          const before = totalProjectedSeconds(sim.times, p.id);
          const after = totalProjectedSeconds(trial.times, p.id);
          if (after < before - REGRESSION_LIMIT) {
            regressed = true;
            break;
          }
        }
        if (regressed) continue;
        // Only commit if injection brings spread inside the user cap AND
        // strictly improves the current best.
        if (trialSpread <= maxSpreadMinutes * 60 && trialSpread < (bestInsertion?.spread ?? currentSpread)) {
          bestInsertion = { sub: cand, insertAfterIndex: gap.insertAfterIndex, spread: trialSpread };
        }
      }
    }

    if (!bestInsertion) break;
    plan.push(bestInsertion.sub);
  }

  sortPlan();

  // ============================================================
  // EQUAL-TIME POST-PASS — global fairness override.
  // ------------------------------------------------------------
  // When no per-player priority order is configured and we're planning from
  // kickoff, try a deterministic deficit-driven plan that globally optimises
  // toward equal target minutes. Adopt it if it strictly beats the current
  // plan's spread. This makes simple cases (e.g. 8 players / 7-aside / 40 min)
  // converge to mathematically perfect distributions instead of getting
  // dragged off-target by starter bias / continuity / GK protection.
  // ============================================================
  {
    const eqPlan = applyEqualTimeOverride({
      playerData,
      teamSize,
      halfDurationSeconds,
      gkOnPitch,
      halftimeGkIn,
      rotateGkAtHalftime,
      maxSpreadMinutes,
      rotationSpeed,
      eff,
      priorityOrderLength: priorityOrder.length,
      startHalf,
      startElapsedSeconds: clampedStartElapsed,
      benchCount: outfieldOnBench.length,
      currentPlan: plan,
    });
    if (eqPlan) {
      plan.length = 0;
      plan.push(...eqPlan);
      sortPlan();
    }
  }


  return ensureNoStarvedPlayers(plan, playerData, halfDurationSeconds);
}

// Generate per-team plans for mini-league mode and merge them
function createMiniLeagueSubPlan(
  players: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  rotationSpeed: number,
  disablePositionSwaps: boolean,
  disableBatchSubs: boolean,
  rotateGkAtHalftime: boolean,
  startElapsedSeconds: number,
  startHalf: 1 | 2,
  miniLeagueTeams: MiniLeagueTeams,
  preferredSecondHalfGkId?: string,
  maxSpreadMinutes: number = 5,
  advancedOverrides: AutoSubAdvancedOverrides = {}
): SubstitutionEvent[] {
  const teamAPlayers = players.filter(p => p.teamSide === "a");
  const teamBPlayers = players.filter(p => p.teamSide === "b");
  
  const planA = teamAPlayers.length > 0
    ? createSubPlan(teamAPlayers, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, startElapsedSeconds, startHalf, preferredSecondHalfGkId, maxSpreadMinutes, advancedOverrides)
    : [];
  
  const planB = teamBPlayers.length > 0
    ? createSubPlan(teamBPlayers, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, startElapsedSeconds, startHalf, undefined, maxSpreadMinutes, advancedOverrides)
    : [];
  
  // Merge and sort by half then time
  const merged = [...planA, ...planB];
  merged.sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    return a.time - b.time;
  });
  
  return merged;
}

// ===========================================================================
// FairnessDiagnostics — always-visible "Game time fairness" summary derived
// directly from the forecast minutes. Shows target vs actual min/max/spread,
// plus a plain-English message and constraint warnings.
// ===========================================================================
function FairnessDiagnostics({
  forecasts,
  teamSize,
  squadSize,
  matchMinutes,
  minShiftSeconds,
  rotateGkAtHalftime,
  mode,
}: {
  forecasts: Array<{ player: { id: string }; predictedMinutes: number; gkRole?: 'full' | '1h' | '2h' | null }>;
  teamSize: number;
  squadSize: number;
  matchMinutes: number;
  minShiftSeconds: number;
  rotateGkAtHalftime: boolean;
  mode: 'Standard' | 'Frequent';
}) {
  if (!forecasts.length || squadSize <= teamSize) return null;

  // Target uses outfield slots × match length / outfield squad size. We treat
  // a "full game" GK as out of the rotation pool to avoid skewing the target.
  const fullGameGkIds = new Set(forecasts.filter(f => f.gkRole === 'full').map(f => f.player.id));
  const outfieldSlots = Math.max(0, teamSize - (fullGameGkIds.size > 0 ? 1 : 0));
  const outfieldSquad = squadSize - fullGameGkIds.size;
  const outfieldForecasts = forecasts.filter(f => !fullGameGkIds.has(f.player.id));
  if (outfieldSquad <= 0 || outfieldSlots <= 0 || outfieldForecasts.length === 0) return null;

  const target = (outfieldSlots * matchMinutes) / outfieldSquad;
  const mins = outfieldForecasts.map(f => f.predictedMinutes);
  const min = Math.min(...mins);
  const max = Math.max(...mins);
  const spread = max - min;

  // Fairness scoring -------------------------------------------------------
  // Max deviation: largest |actual - target| in minutes.
  const maxDeviation = mins.reduce((acc, m) => Math.max(acc, Math.abs(m - target)), 0);
  // Fairness %: 100 means everyone hits target exactly. We scale the largest
  // deviation against the target — a 5-min miss on a 35-min target is ~14 %.
  const fairnessPct = target > 0
    ? Math.max(0, Math.min(100, 100 - (maxDeviation / target) * 100))
    : 100;
  // Mathematical floor: smallest spread possible given integer-minute math.
  // 0 when (slots × T) divides evenly by N; 1 minute otherwise.
  const totalPlayerMin = outfieldSlots * matchMinutes;
  const perfectFloorMin = totalPlayerMin % outfieldSquad === 0 ? 0 : 1;

  const mathematicalMinSpread = matchMinutes - Math.floor(target) - Math.floor(target);
  // Bench size relative to outfield slots — flags large benches that need more rotations.
  const benchSize = squadSize - teamSize;
  const isLargeBench = benchSize >= Math.ceil(teamSize / 2);
  const minShiftMin = minShiftSeconds / 60;
  const constrainedByMinShift = spread > 3 && target < minShiftMin * 1.5;

  let tone: 'good' | 'warn' | 'info' = 'good';
  let message = `Fair plan: all players are within ${Math.ceil(spread)} min of each other.`;
  if (spread <= 3) {
    tone = 'good';
    message = `Fair plan: all outfielders are within ${Math.ceil(spread)} min of target game time.`;
  } else if (spread <= 6) {
    tone = 'info';
    message = `Slightly uneven: spread of ${spread.toFixed(1)} min between most- and least-played outfielder.`;
    if (constrainedByMinShift) {
      message += ' Minimum time on field is preventing a tighter rotation.';
    } else if (isLargeBench && mode === 'Standard') {
      message += ' Try Frequent mode or lower “How often to suggest subs”.';
    }
  } else {
    tone = 'warn';
    message = `Uneven plan: ${spread.toFixed(1)} min between most- and least-played outfielder.`;
    if (isLargeBench) {
      message += ' Large bench — try Frequent mode or lower “How often to suggest subs”.';
    } else if (constrainedByMinShift) {
      message += ' Lower “Minimum time on field” to allow shorter shifts.';
    } else {
      message += ' Lower “Minimum gap between sub moments” to allow more rotations.';
    }
  }

  const toneClasses =
    tone === 'good' ? 'border-emerald-500/40 bg-emerald-500/5' :
    tone === 'warn' ? 'border-amber-500/40 bg-amber-500/5' :
    'border-border bg-muted/30';

  return (
    <div className={cn('rounded-lg border p-3 space-y-2 mb-2', toneClasses)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">Game time fairness</p>
        <span className="text-[11px] text-muted-foreground">{mode} mode</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">Target per player</span>
        <span className="text-right tabular-nums font-medium text-foreground">{target.toFixed(1)} min</span>
        <span className="text-muted-foreground">Highest</span>
        <span className="text-right tabular-nums text-foreground">{max.toFixed(1)} min</span>
        <span className="text-muted-foreground">Lowest</span>
        <span className="text-right tabular-nums text-foreground">{min.toFixed(1)} min</span>
        <span className="text-muted-foreground">Spread</span>
        <span className={cn(
          'text-right tabular-nums font-medium',
          tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-foreground'
        )}>{spread.toFixed(1)} min</span>
        <span className="text-muted-foreground">Max deviation</span>
        <span className="text-right tabular-nums text-foreground">{maxDeviation.toFixed(1)} min</span>
        <span className="text-muted-foreground">Fairness score</span>
        <span className={cn(
          'text-right tabular-nums font-medium',
          fairnessPct >= 95 ? 'text-emerald-600' : fairnessPct >= 85 ? 'text-foreground' : 'text-amber-600'
        )}>{fairnessPct.toFixed(0)}%</span>
        <span className="text-muted-foreground">Mathematical floor</span>
        <span className="text-right tabular-nums text-muted-foreground">
          {perfectFloorMin === 0 ? '0 min (perfect possible)' : `${perfectFloorMin} min`}
        </span>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{message}</p>
      {rotateGkAtHalftime && fullGameGkIds.size === 0 && forecasts.some(f => f.gkRole === '1h' || f.gkRole === '2h') && (
        <p className="text-[10px] leading-snug text-muted-foreground italic">
          Goalkeeper is being swapped at halftime — outfield minutes shown exclude GK time.
        </p>
      )}
    </div>
  );
}

// ===========================================================================
// Plan fix suggestions — coach-facing diagnose → fix → preview flow.
// Reads the auto-computed fairness report + current overrides, infers concrete
// problems, and offers tappable fixes that mutate AutoSubAdvancedOverrides.
// ===========================================================================

interface PlanFix {
  id: string;
  title: string;
  tradeoff: string;
  /** Returns the mutated overrides; clamped to the same min/max as the sliders. */
  apply: (current: AutoSubAdvancedOverrides) => AutoSubAdvancedOverrides;
}

const SLIDER_RANGES = {
  standardTargetIntervalSec: { min: 180, max: 900 },
  standardIntervalFloorSec: { min: 120, max: 600 },
  frequentIntervalFloorSec: { min: 60, max: 420 },
  minShiftSeconds: { min: 60, max: 360 },
  halftimeGuardSeconds: { min: 0, max: 420 },
} as const;

function clampOverride(
  key: keyof typeof SLIDER_RANGES,
  next: number,
): number {
  const r = SLIDER_RANGES[key];
  return Math.max(r.min, Math.min(r.max, next));
}

function bumpOverride(
  current: AutoSubAdvancedOverrides,
  key: keyof typeof SLIDER_RANGES,
  delta: number,
): AutoSubAdvancedOverrides {
  const base = current[key] ?? ADV_DEFAULTS[key as keyof typeof ADV_DEFAULTS];
  const next = clampOverride(key, base + delta);
  if (next === base) return current;
  return { ...current, [key]: next };
}

function buildPlanFixes(args: {
  spreadMin: number;
  shortShifts: number;
  bounceBacks: number;
  totalSubs: number;
  isLargeBench: boolean;
  constrainedByMinShift: boolean;
  mode: "Standard" | "Frequent";
  overrides: AutoSubAdvancedOverrides;
  hasHalftimeClash: boolean;
}): PlanFix[] {
  const fixes: PlanFix[] = [];
  const o = args.overrides;

  // Make minutes fairer — only when the spread is meaningfully off.
  if (args.spreadMin > 3) {
    const targetKey = "standardTargetIntervalSec" as const;
    const cur = o[targetKey] ?? ADV_DEFAULTS[targetKey];
    if (cur > SLIDER_RANGES[targetKey].min) {
      fixes.push({
        id: "fairer",
        title: "Make minutes fairer",
        tradeoff: "Gives the planner more chances to balance game time, but creates more substitution moments.",
        apply: (c) => bumpOverride(c, targetKey, -60),
      });
    }
  }

  // Allow shorter shifts — when min-shift is the bottleneck.
  if (args.spreadMin > 3 && args.constrainedByMinShift) {
    const cur = o.minShiftSeconds ?? ADV_DEFAULTS.minShiftSeconds;
    if (cur > SLIDER_RANGES.minShiftSeconds.min) {
      fixes.push({
        id: "shorter-shifts",
        title: "Allow shorter shifts",
        tradeoff: "Lets the planner pull players sooner so minutes balance faster, but shifts can feel brief.",
        apply: (c) => bumpOverride(c, "minShiftSeconds", -30),
      });
    }
  }

  // Reduce short shifts — when short cameos detected.
  if (args.shortShifts > 0) {
    const cur = o.minShiftSeconds ?? ADV_DEFAULTS.minShiftSeconds;
    if (cur < SLIDER_RANGES.minShiftSeconds.max) {
      fixes.push({
        id: "protect-shifts",
        title: "Reduce short shifts",
        tradeoff: "Keeps players on for longer turns. The minutes difference between players may grow a little.",
        apply: (c) => bumpOverride(c, "minShiftSeconds", 30),
      });
    }
  }

  // Space out substitution moments — when bounce-backs detected or plan is busy.
  const busy = args.totalSubs > Math.max(6, args.spreadMin * 2);
  if (args.bounceBacks > 0 || busy) {
    const cur = o.standardIntervalFloorSec ?? ADV_DEFAULTS.standardIntervalFloorSec;
    if (cur < SLIDER_RANGES.standardIntervalFloorSec.max) {
      fixes.push({
        id: "space-out",
        title: "Space out substitution moments",
        tradeoff: "Fewer interruptions in the game, but minutes may even out more slowly.",
        apply: (c) => bumpOverride(c, "standardIntervalFloorSec", 30),
      });
    }
  }

  // Avoid subs near halftime — only when a halftime clash is detected.
  if (args.hasHalftimeClash) {
    const cur = o.halftimeGuardSeconds ?? ADV_DEFAULTS.halftimeGuardSeconds;
    if (cur < SLIDER_RANGES.halftimeGuardSeconds.max) {
      fixes.push({
        id: "halftime",
        title: "Avoid subs near halftime",
        tradeoff: "Keeps the halftime break clean, but can push some rotations earlier or later than ideal.",
        apply: (c) => bumpOverride(c, "halftimeGuardSeconds", 60),
      });
    }
  }

  // Reduce stoppages — only when plan looks overly busy and minutes are fine.
  if (args.spreadMin <= 4 && busy) {
    const cur = o.standardTargetIntervalSec ?? ADV_DEFAULTS.standardTargetIntervalSec;
    if (cur < SLIDER_RANGES.standardTargetIntervalSec.max) {
      fixes.push({
        id: "reduce-stoppages",
        title: "Reduce stoppages",
        tradeoff: "Fewer interruptions, but minutes may not balance quite as tightly.",
        apply: (c) => bumpOverride(c, "standardTargetIntervalSec", 60),
      });
    }
  }

  // Fallback — when overrides differ from recommended defaults, always offer
  // a reset so coaches who tuned themselves into a corner have one tap out.
  const overridesDirty = (Object.keys(ADV_DEFAULTS) as Array<keyof typeof ADV_DEFAULTS>)
    .some((k) => o[k] !== undefined && o[k] !== ADV_DEFAULTS[k]);
  if (overridesDirty) {
    fixes.push({
      id: "reset-defaults",
      title: "Reset to recommended defaults",
      tradeoff: "Undoes your custom slider tweaks and starts fresh from the planner's defaults.",
      apply: () => ({}),
    });
  }

  return fixes;
}

// Pick the single highest-priority fix to recommend, based on the dominant
// problem in the current plan. Falls back to the first available fix.
function pickRecommendedFix(
  fixes: PlanFix[],
  signals: { hasHalftimeClash: boolean; shortShifts: number; bounceBacks: number; spreadMin: number; constrainedByMinShift: boolean },
): PlanFix | null {
  if (fixes.length === 0) return null;
  const byId = (id: string) => fixes.find((f) => f.id === id);
  if (signals.hasHalftimeClash) { const f = byId("halftime"); if (f) return f; }
  if (signals.shortShifts > 0) {
    const f = byId("protect-shifts"); if (f) return f;
    const r = byId("reset-defaults"); if (r) return r;
  }
  if (signals.bounceBacks > 0) { const f = byId("space-out"); if (f) return f; }
  if (signals.spreadMin > 6) {
    const f = byId("fairer"); if (f) return f;
    const r = byId("reset-defaults"); if (r) return r;
  }
  if (signals.spreadMin > 3 && signals.constrainedByMinShift) { const f = byId("shorter-shifts"); if (f) return f; }
  const reduce = byId("reduce-stoppages"); if (reduce) return reduce;
  const reset = byId("reset-defaults"); if (reset) return reset;
  return fixes[0];
}

function PlanFixSuggestions({
  fixes,
  promoted,
  activeFixId,
  onApply,
  readOnly,
}: {
  fixes: PlanFix[];
  /** The fix shown in the top slot — either the active priority or recommendation. */
  promoted: PlanFix | null;
  /** Currently applied priority id, or null if none. Mutually exclusive. */
  activeFixId: string | null;
  onApply: (fix: PlanFix) => void;
  readOnly: boolean;
}) {
  const [showOthers, setShowOthers] = useState(false);
  if (readOnly || !promoted) return null;
  const others = fixes.filter((f) => f.id !== promoted.id);
  const isPromotedActive = activeFixId === promoted.id;
  const headerLabel = activeFixId ? "Current priority" : "Recommended priority";
  const buttonLabel = isPromotedActive ? "Recalculate plan" : "Use this priority";

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2.5 mb-2">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold text-primary">
        <Wand2 className="h-3.5 w-3.5" />
        {headerLabel}
      </div>
      <div>
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground">{promoted.title}</p>
          {isPromotedActive && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              <Check className="h-2.5 w-2.5" />
              Current
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug mt-1">{promoted.tradeoff}</p>
      </div>
      <Button
        type="button"
        size="sm"
        className="w-full gap-1.5"
        onClick={() => onApply(promoted)}
      >
        <Wand2 className="h-3.5 w-3.5" />
        {buttonLabel}
      </Button>
      {others.length > 0 && (
        <div className="pt-1 border-t border-primary/20">
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            className="flex items-center justify-between w-full text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <span>{activeFixId ? `Try a different priority (${others.length})` : `Other priorities (${others.length})`}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showOthers ? "rotate-180" : "")} />
          </button>
          {showOthers && (
            <div className="grid gap-1.5 mt-2">
              {others.map((fix) => (
                <button
                  key={fix.id}
                  type="button"
                  onClick={() => onApply(fix)}
                  className="text-left rounded-md border border-border bg-background hover:bg-muted/60 transition-colors p-2 min-h-[40px] group"
                >
                  <div className="flex items-start gap-2">
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-medium text-foreground">{fix.title}</span>
                      <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">
                        {fix.tradeoff}
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 group-hover:text-foreground transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// PlanStatusCard — calm, plain-English headline + 3 key chips. Replaces the
// dense "Game time fairness" grid for everyday coaches.
// ===========================================================================
function PlanStatusCard({
  totalSubs,
  spreadMin,
  shortShifts,
  hasHalftimeClash,
}: {
  totalSubs: number;
  spreadMin: number;
  shortShifts: number;
  hasHalftimeClash: boolean;
}) {
  const hasShortShifts = shortShifts > 0;
  const hasSpread = spreadMin > 6;
  const needsAdjustment = hasHalftimeClash || hasShortShifts || hasSpread;

  const toneClasses = needsAdjustment
    ? "border-amber-500/40 bg-amber-500/5"
    : "border-emerald-500/40 bg-emerald-500/5";

  return (
    <div className={cn("rounded-lg border p-3 mb-2", toneClasses)}>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Subs</div>
          <div className="text-sm font-bold text-foreground tabular-nums">{totalSubs}</div>
        </div>
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Minutes diff</div>
          <div className={cn("text-sm font-bold tabular-nums", hasSpread ? "text-amber-600" : "text-foreground")}>
            {spreadMin.toFixed(1)}m
          </div>
        </div>
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Very short turns</div>
          <div className={cn("text-sm font-bold tabular-nums", hasShortShifts ? "text-amber-600" : "text-emerald-600")}>
            {shortShifts}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// PlayersNeedingAttention — only flags outfielders with notable issues
// (lowest/highest minutes, short shifts, bounce-backs). Hides the full bar
// list behind a "Show all player minutes" toggle.
// ===========================================================================
function PlayersNeedingAttention({
  forecasts,
  fairnessReport,
}: {
  forecasts: PlayerTimeForecast[];
  fairnessReport: FairnessReport | null;
}) {
  const outfield = forecasts.filter((f) => f.gkRole !== "full");
  if (outfield.length < 3) return null;

  const sorted = [...outfield].sort((a, b) => a.predictedMinutes - b.predictedMinutes);
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];
  const spread = highest.predictedMinutes - lowest.predictedMinutes;

  type Row = { id: string; number?: number; name: string; minutes: number; reason: string; tone: string };
  const rows: Row[] = [];
  const seen = new Set<string>();

  if (spread > 3) {
    rows.push({ id: lowest.player.id, number: lowest.player.number, name: lowest.player.name, minutes: lowest.predictedMinutes, reason: "Lowest minutes", tone: "border-amber-500/50 text-amber-600" });
    seen.add(lowest.player.id);
    if (!seen.has(highest.player.id)) {
      rows.push({ id: highest.player.id, number: highest.player.number, name: highest.player.name, minutes: highest.predictedMinutes, reason: "Highest minutes", tone: "border-amber-500/50 text-amber-600" });
      seen.add(highest.player.id);
    }
  }

  if (fairnessReport) {
    for (const stat of fairnessReport.perPlayer) {
      if (rows.length >= 5) break;
      if (seen.has(stat.playerId)) continue;
      const f = forecasts.find((x) => x.player.id === stat.playerId);
      if (!f) continue;
      if (stat.shortShifts > 0) {
        rows.push({ id: stat.playerId, number: f.player.number, name: f.player.name, minutes: f.predictedMinutes, reason: `${stat.shortShifts} very short turn${stat.shortShifts > 1 ? "s" : ""}`, tone: "border-red-500/50 text-red-500" });
        seen.add(stat.playerId);
      } else if (stat.bounceBacks > 0) {
        rows.push({ id: stat.playerId, number: f.player.number, name: f.player.name, minutes: f.predictedMinutes, reason: `${stat.bounceBacks} bounce-back${stat.bounceBacks > 1 ? "s" : ""}`, tone: "border-purple-500/50 text-purple-500" });
        seen.add(stat.playerId);
      }
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5 mb-2">
      <p className="text-xs font-semibold text-foreground">Players needing attention</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={`${row.id}-${row.reason}`} className="flex items-center gap-2 text-xs">
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold shrink-0">
              {row.number ?? "?"}
            </div>
            <span className="flex-1 min-w-0 truncate text-foreground">{row.name}</span>
            <span className="text-muted-foreground tabular-nums shrink-0">{row.minutes}'</span>
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 shrink-0", row.tone)}>
              {row.reason}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanImpactPreview({
  overrides,
  defaultMaxSpreadMinutes,
  baseline,
  totalSubs,
  spreadMin,
  shortShifts,
  hasHalftimeClash,
}: {
  overrides: AutoSubAdvancedOverrides;
  defaultMaxSpreadMinutes: number;
  baseline: { totalSubs: number; spreadMin: number; shortShifts: number; hasHalftimeClash: boolean } | null;
  totalSubs: number;
  spreadMin: number;
  shortShifts: number;
  hasHalftimeClash: boolean;
}) {
  const overrideKeys = Object.keys(overrides) as (keyof AutoSubAdvancedOverrides)[];
  const active = overrideKeys.filter((k) => overrides[k] !== undefined);
  if (active.length === 0) return null;

  const phrases: string[] = [];
  if (overrides.standardTargetIntervalSec !== undefined) {
    phrases.push(
      overrides.standardTargetIntervalSec < ADV_DEFAULTS.standardTargetIntervalSec
        ? "give players more even minutes"
        : "reduce the number of substitutions",
    );
  }
  if (overrides.standardIntervalFloorSec !== undefined) {
    phrases.push(
      overrides.standardIntervalFloorSec > ADV_DEFAULTS.standardIntervalFloorSec
        ? "space out substitutions"
        : "allow substitutions more often",
    );
  }
  if (overrides.minShiftSeconds !== undefined) {
    phrases.push(
      overrides.minShiftSeconds > ADV_DEFAULTS.minShiftSeconds
        ? "stop very short turns on the pitch"
        : "allow shorter turns so minutes balance faster",
    );
  }
  if (overrides.halftimeGuardSeconds !== undefined) {
    phrases.push(
      overrides.halftimeGuardSeconds > ADV_DEFAULTS.halftimeGuardSeconds
        ? "keep substitutions away from halftime"
        : "allow substitutions closer to halftime",
    );
  }
  if (overrides.maxSpreadOverrideSec !== undefined) {
    const min = overrides.maxSpreadOverrideSec / 60;
    phrases.push(
      min < defaultMaxSpreadMinutes
        ? "tighten the acceptable minutes difference"
        : "loosen the acceptable minutes difference",
    );
  }

  const sentence = phrases.length
    ? `This will ${phrases.slice(0, -1).join(", ")}${phrases.length > 1 ? " and " : ""}${phrases[phrases.length - 1]}.`
    : "Custom tuning is active.";

  return (
    <PlanImpactPreviewBody
      sentence={sentence}
      baseline={baseline}
      totalSubs={totalSubs}
      spreadMin={spreadMin}
      shortShifts={shortShifts}
      hasHalftimeClash={hasHalftimeClash}
    />
  );
}

function PlanImpactPreviewBody({
  sentence,
  baseline,
  totalSubs,
  spreadMin,
  shortShifts,
  hasHalftimeClash,
}: {
  sentence: string;
  baseline: { totalSubs: number; spreadMin: number; shortShifts: number; hasHalftimeClash: boolean } | null;
  totalSubs: number;
  spreadMin: number;
  shortShifts: number;
  hasHalftimeClash: boolean;
}) {
  const [open, setOpen] = useState(true);

  const Row = ({
    label,
    before,
    after,
    improved,
  }: { label: string; before: string; after: string; improved: boolean | null }) => (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums text-foreground flex items-center justify-end gap-1.5">
        {baseline ? (
          <>
            <span className="text-muted-foreground line-through">{before}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span
              className={cn(
                "font-semibold",
                improved === true && "text-emerald-600 dark:text-emerald-400",
                improved === false && "text-amber-600 dark:text-amber-400",
              )}
            >
              {after}
            </span>
          </>
        ) : (
          <span>{after}</span>
        )}
      </span>
    </>
  );

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-sm font-semibold text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          What changed
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open ? "rotate-180" : "")} />
      </button>
      {open && (
        <>
          <p className="text-[11px] leading-snug text-foreground">{sentence}</p>
          {(() => {
            if (!baseline) return null;
            const improvedAny =
              totalSubs < baseline.totalSubs ||
              spreadMin < baseline.spreadMin ||
              shortShifts < baseline.shortShifts ||
              (baseline.hasHalftimeClash && !hasHalftimeClash);
            const worsenedAny =
              totalSubs > baseline.totalSubs ||
              spreadMin > baseline.spreadMin + 0.05 ||
              shortShifts > baseline.shortShifts ||
              (!baseline.hasHalftimeClash && hasHalftimeClash);
            // If the active priority made things worse overall, warn the
            // coach so they can switch rather than treat it as a success.
            if (worsenedAny && !improvedAny) {
              return (
                <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                  This priority made the plan worse overall. Try a different priority below.
                </p>
              );
            }
            if (worsenedAny) {
              return (
                <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                  This improved one thing but made another worse. Try a different priority if the trade-off isn't right.
                </p>
              );
            }
            return null;
          })()}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] pt-2 border-t border-primary/20">
            <Row
              label="Total substitutions"
              before={`${baseline?.totalSubs ?? totalSubs}`}
              after={`${totalSubs}`}
              improved={baseline ? totalSubs < baseline.totalSubs ? true : totalSubs > baseline.totalSubs ? false : null : null}
            />
            <Row
              label="Minutes difference"
              before={`${(baseline?.spreadMin ?? spreadMin).toFixed(1)}m`}
              after={`${spreadMin.toFixed(1)}m`}
              improved={baseline ? spreadMin < baseline.spreadMin ? true : spreadMin > baseline.spreadMin ? false : null : null}
            />
            <Row
              label="Very short turns"
              before={`${baseline?.shortShifts ?? shortShifts}`}
              after={`${shortShifts}`}
              improved={baseline ? shortShifts < baseline.shortShifts ? true : shortShifts > baseline.shortShifts ? false : null : null}
            />
            <Row
              label="Subs near halftime"
              before={baseline?.hasHalftimeClash ? "Yes" : "No"}
              after={hasHalftimeClash ? "Yes" : "No"}
              improved={baseline ? (baseline.hasHalftimeClash && !hasHalftimeClash) ? true : (!baseline.hasHalftimeClash && hasHalftimeClash) ? false : null : null}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// PlanModeToggles — pick Standard or Frequent rotation cadence. Standard
// keeps subs low; Frequent rotates more often for tighter minutes spread.
// ===========================================================================
const MODE_TOGGLES: { id: 1 | 2; title: string; tradeoff: string }[] = [
  {
    id: 1,
    title: "Standard",
    tradeoff: "Fewer substitutions, longer shifts. Minutes may differ a little more between players.",
  },
  {
    id: 2,
    title: "Frequent",
    tradeoff: "More substitutions, tighter rotation. Minutes even out faster across the squad.",
  },
];

function PlanModeToggles({
  activeMode,
  onChange,
  readOnly,
  disabledModes = [],
}: {
  activeMode: 1 | 2;
  onChange: (mode: 1 | 2) => void;
  readOnly: boolean;
  disabledModes?: (1 | 2)[];
}) {
  if (readOnly) return null;
  return (
    <div className="space-y-1.5 mb-2">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-0.5">
        Rotation mode
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {MODE_TOGGLES.map((m) => {
          const isActive = activeMode === m.id;
          const isDisabled = disabledModes.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onChange(m.id)}
              aria-disabled={isDisabled}
              title={isDisabled ? "Not available for this squad size and match length" : undefined}
              className={cn(
                "text-left rounded-md border transition-colors p-2.5 min-h-[40px]",
                isActive
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background hover:bg-muted/60",
                isDisabled && "opacity-50 cursor-not-allowed hover:bg-background",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className="block text-xs font-semibold text-foreground">{m.title}</span>
                {isActive && !isDisabled && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    <Check className="h-2.5 w-2.5" />
                    On
                  </span>
                )}
                {isDisabled && (
                  <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Unavailable
                  </span>
                )}
              </span>
              <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">
                {m.tradeoff}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// SortablePlayerMinutesRow — drag handle + minute-forecast row used in the
// "Show all player minutes" list. Drag is enabled only for outfielders so
// the coach can soft-bias rotation order without disturbing locked GKs.
// ===========================================================================
function SortablePlayerMinutesRow({
  forecast,
  fairnessReport,
  draggable,
}: {
  forecast: PlayerTimeForecast;
  fairnessReport: FairnessReport | null;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: forecast.player.id,
    disabled: !draggable,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const stat = fairnessReport?.perPlayer.find(s => s.playerId === forecast.player.id);
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 p-2 rounded-lg bg-muted/50",
        isDragging && "ring-2 ring-primary/40"
      )}
    >
      {draggable ? (
        <button
          type="button"
          aria-label="Drag to reorder priority"
          className="touch-none p-1 -ml-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <div className="w-6 shrink-0" aria-hidden />
      )}
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-bold shrink-0">
        {forecast.player.number || "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium truncate">{forecast.player.name}</span>
          <Badge
            variant="outline"
            className={cn(
              "text-xs px-1.5 py-0",
              forecast.startsOnPitch ? "border-emerald-500/50 text-emerald-500" : "border-muted-foreground/50"
            )}
          >
            {forecast.startsOnPitch ? 'Start' : 'Bench'}
          </Badge>
          {forecast.gkRole && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-500/50 text-amber-600">
              {forecast.gkRole === 'full' ? 'GK' : forecast.gkRole === '1h' ? 'GK 1H' : 'GK 2H'}
            </Badge>
          )}
          {stat?.shortShifts ? (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-red-500/50 text-red-500">
              {stat.shortShifts} very short
            </Badge>
          ) : null}
          {stat?.bounceBacks ? (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-purple-500/50 text-purple-500">
              {stat.bounceBacks} bounce
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Progress value={forecast.percentageOfGame} className="h-2 flex-1" />
          <span className="text-xs text-muted-foreground w-20 text-right shrink-0 tabular-nums">
            {forecast.predictedMinutes}' ({forecast.percentageOfGame}%)
          </span>
        </div>
      </div>
    </div>
  );
}

function DialogInner({
  players, 
  teamSize, 
  minutesPerHalf, 
  onStartPlan,
  onClose,
  existingPlan,
  editMode,
  rotationSpeed = 2,
  disablePositionSwaps = false,
  disableBatchSubs = false,
  rotateGkAtHalftime = true,
  maxSpreadMinutes = 5,
  currentElapsedSeconds = 0,
  currentHalf = 1,
  preferredSecondHalfGkId,
  isSetupFlow = false,
  miniLeagueTeams,
  advancedOverrides,
  onLineupChange,
}: {
  players: Player[];
  teamSize: number;
  minutesPerHalf: number;
  onStartPlan: (plan: SubstitutionEvent[]) => void;
  onClose: () => void;
  existingPlan?: SubstitutionEvent[];
  editMode?: boolean;
  rotationSpeed?: number;
  disablePositionSwaps?: boolean;
  disableBatchSubs?: boolean;
  rotateGkAtHalftime?: boolean;
  maxSpreadMinutes?: number;
  currentElapsedSeconds?: number;
  currentHalf?: 1 | 2;
  preferredSecondHalfGkId?: string;
  isSetupFlow?: boolean;
  miniLeagueTeams?: MiniLeagueTeams;
  advancedOverrides?: AutoSubAdvancedOverrides;
  onLineupChange?: (players: Player[]) => void;
}) {
  const hasRemainingPlan = !!existingPlan?.some(s => !s.executed && !s.skipped);
  const isExistingPlanPlayable = hasRemainingPlan &&
    isPlanPlayableFromPlayers(players, existingPlan!, minutesPerHalf * 60);
  // In edit mode, always load the existing plan so the user can review/adjust
  // it — even if the lineup has drifted and made it technically unplayable.
  // In forecast mode, treat stale plans as none so auto-generation kicks in
  // (a stale plan would render bench players stuck on 0 minutes).
  const effectiveExistingPlan = editMode
    ? (hasRemainingPlan ? existingPlan : undefined)
    : (isExistingPlanPlayable ? existingPlan : undefined);
  const [plan, setPlan] = useState<SubstitutionEvent[] | null>(effectiveExistingPlan || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const activeTab: 'forecast' | 'edit' = editMode ? 'edit' : 'forecast';

  // ---- Advanced overrides (persisted) -----------------------------------
  // External `advancedOverrides` prop wins; otherwise we read/write our own
  // copy in localStorage so the panel survives reloads.
  // v2 storage key — bumped when the priority toggles were removed so any
  // leftover overrides from the deleted "Make minutes fairer" / "Fewer subs"
  // toggles don't keep starving bench players in Frequent mode.
  const ADV_STORAGE_KEY = "autoSubPlan.advancedOverrides.v2";
  const [localOverrides, setLocalOverrides] = useState<AutoSubAdvancedOverrides>(() => {
    if (advancedOverrides) return {};
    try {
      if (typeof window !== "undefined") {
        // One-time cleanup of the v1 key (priority-toggle leftovers).
        window.localStorage.removeItem("autoSubPlan.advancedOverrides.v1");
      }
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(ADV_STORAGE_KEY) : null;
      return raw ? JSON.parse(raw) as AutoSubAdvancedOverrides : {};
    } catch { return {}; }
  });
  const effectiveOverrides: AutoSubAdvancedOverrides = advancedOverrides ?? localOverrides;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Only ONE priority can be active at a time (mutually exclusive).
  // Picking another priority replaces the current one rather than stacking.
  const [activeFixId, setActiveFixId] = useState<string | null>(null);
  // Local override of rotation speed (Standard=1 / Frequent=2). Defaults to
  // the prop so the dialog opens in the coach's saved mode but can be
  // toggled in-dialog without leaving the planner.
  const normalizedPropMode: 1 | 2 = rotationSpeed === 1 ? 1 : 2;
  const [rotationSpeedOverride, setRotationSpeedOverride] = useState<1 | 2>(normalizedPropMode);
  const effectiveRotationSpeed: 1 | 2 = rotationSpeedOverride;
  // Snapshot of plan metrics from BEFORE the coach applied any priority, so
  // the impact preview can show before→after diffs.
  const baselineMetricsRef = useRef<{ totalSubs: number; spreadMin: number; shortShifts: number; hasHalftimeClash: boolean } | null>(null);
  const [showAllMinutes, setShowAllMinutes] = useState(true);
  const [showTimelinePreview, setShowTimelinePreview] = useState(true);
  // Fairness simulator: lazily computed on coach demand so the dialog stays
  // snappy. Cleared whenever the underlying plan changes.
  const [fairnessReport, setFairnessReport] = useState<FairnessReport | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  // Safeguard notice: set when Frequent mode would have left an outfield
  // player with 0 minutes and we silently fell back to Standard rotation.
  const [frequentFallbackNotice, setFrequentFallbackNotice] = useState<string | null>(null);
  // True when Frequent rotation can't fit every player into this match
  // length — drives a disabled Frequent toggle so the coach can't pick a
  // mode that would silently fall back to Standard.
  const [frequentBlocked, setFrequentBlocked] = useState(false);
  // Coach-supplied priority order — top of list = wants more minutes.
  // Soft bias only: nudges minutes among bench-rotation outfielders without
  // overriding fairness/short-shift rules. `null` = neutral (planner default).
  const [playerPriority, setPlayerPriority] = useState<string[] | null>(null);
  // Players after applying priority-bias position swaps. When the coach
  // drags a bench player above a starter, this view actually swaps their
  // positions so the planner — and its forecasts — reflect the new lineup.
  // Falls back to the input `players` when no bias is active.
  const [effectivePlayers, setEffectivePlayers] = useState<Player[]>(players);
  // PointerSensor with a small activation distance so taps on rows still
  // scroll naturally; only deliberate drags from the grip handle reorder.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const persistLocal = (next: AutoSubAdvancedOverrides) => {
    setLocalOverrides(next);
    try { window.localStorage.setItem(ADV_STORAGE_KEY, JSON.stringify(next)); } catch {}
  };

  /**
   * Apply a coach-facing priority. Mutually exclusive: resets overrides to
   * defaults first, then applies only this fix on top — so picking another
   * option replaces the current strategy rather than stacking on top of it.
   */
  const applyPlanFix = (fix: PlanFix) => {
    if (advancedOverrides) return;
    // Tapping the active toggle clears it back to recommended defaults.
    if (activeFixId === fix.id || fix.id === "reset-defaults") {
      persistLocal({});
      setActiveFixId(null);
      return;
    }
    persistLocal(fix.apply({}));
    setActiveFixId(fix.id);
  };

  
  // Effective max-spread: panel override (in seconds) wins over the prop.
  const effectiveMaxSpreadMinutes = effectiveOverrides.maxSpreadOverrideSec !== undefined
    ? effectiveOverrides.maxSpreadOverrideSec / 60
    : maxSpreadMinutes;

  /**
   * Build a plan from the given roster, with optional priority-bias position
   * swaps. When the coach has dragged players in the priority list, we run
   * an iterative loop: generate a plan, compute forecasts, and if a
   * higher-priority outfielder has materially fewer minutes (>1.5m) than a
   * lower-priority outfielder below them, physically swap their lineup
   * positions and regenerate. GKs (full-game) are pinned. Loops until
   * stable or 8 iterations to prevent runaway recalculation.
   *
   * Returns both the plan AND the player roster used to generate it so the
   * caller can mirror those position swaps to the parent's lineup before
   * the plan starts running.
   */
  const buildPlanFromRoster = (roster: Player[], speed: 1 | 2): { plan: SubstitutionEvent[]; roster: Player[] } => {
    const halfDurationSeconds = minutesPerHalf * 60;
    const planningOverrides: AutoSubAdvancedOverrides = playerPriority?.length
      ? { ...effectiveOverrides, playerPriorityOrder: playerPriority }
      : effectiveOverrides;
    const make = (rs: Player[]) => miniLeagueTeams
      ? createMiniLeagueSubPlan(rs, teamSize, halfDurationSeconds, speed, disablePositionSwaps!, disableBatchSubs!, rotateGkAtHalftime!, currentElapsedSeconds!, currentHalf!, miniLeagueTeams, preferredSecondHalfGkId, effectiveMaxSpreadMinutes, planningOverrides)
      : createSubPlan(rs, teamSize, halfDurationSeconds, speed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, currentElapsedSeconds, currentHalf, preferredSecondHalfGkId, effectiveMaxSpreadMinutes, planningOverrides);

    let working = roster;
    if (playerPriority && playerPriority.length >= 2) {
      const rank = new Map(playerPriority.map((id, index) => [id, index] as const));
      const isSwappableOutfielder = (p: Player) =>
        p.currentPitchPosition !== "GK" && !(p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK");
      const outfieldStarterCount = working.filter(p => p.position !== null && isSwappableOutfielder(p)).length;
      const desiredStarters = new Set(
        playerPriority
          .filter(id => working.some(p => p.id === id && isSwappableOutfielder(p)))
          .slice(0, outfieldStarterCount)
      );

      for (const desiredId of desiredStarters) {
        const desired = working.find(p => p.id === desiredId);
        if (!desired || desired.position !== null) continue;
        const replacement = working
          .filter(p => p.position !== null && isSwappableOutfielder(p) && !desiredStarters.has(p.id))
          .sort((a, b) => (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER))[0];
        if (replacement) working = swapLineupPositions(working, desiredId, replacement.id);
      }
    }

    return { plan: make(working), roster: working };
  };

  const generatePlan = (allPlayers: Player[]) => {
    return buildPlanFromRoster(allPlayers, effectiveRotationSpeed);
  };
  
  // Auto-generate plan on mount AND whenever planner inputs change.
  // Without this, changing Subs Speed / Max Spread / etc. in the settings
  // dialog leaves the previously generated plan stale (e.g. Frequent still
  // showed Balanced's 38 subs because the plan was only generated once).
  useEffect(() => {
    if (editMode) return;
    const playersOnP = players.filter(p => p.position !== null);
    const benchP = players.filter(p => p.position === null);
    const hasEnough = miniLeagueTeams
      ? playersOnP.length > 0 && benchP.length > 0
      : playersOnP.length >= teamSize && benchP.length > 0;
    if (!hasEnough) {
      setIsGenerating(false);
      return;
    }
    setIsGenerating(true);
    const t = setTimeout(() => {
      try {
        // Always probe Frequent so we know whether it's a viable choice for
        // the current squad/match length, regardless of which mode is
        // currently selected. If it would strand an outfield player at 0
        // minutes we lock the toggle to Standard.
        const frequentProbe = miniLeagueTeams
          ? createMiniLeagueSubPlan(players, teamSize, minutesPerHalf * 60, 2, disablePositionSwaps!, disableBatchSubs!, rotateGkAtHalftime!, currentElapsedSeconds!, currentHalf!, miniLeagueTeams, preferredSecondHalfGkId, effectiveMaxSpreadMinutes, effectiveOverrides)
          : createSubPlan(players, teamSize, minutesPerHalf * 60, 2, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, currentElapsedSeconds, currentHalf, preferredSecondHalfGkId, effectiveMaxSpreadMinutes, effectiveOverrides);
        const probeFc = calculateTimeForecasts(players, frequentProbe, minutesPerHalf, preferredSecondHalfGkId, rotateGkAtHalftime, currentHalf, currentElapsedSeconds);
        const probeStranded = probeFc.filter(f => f.gkRole !== 'full' && f.predictedMinutes === 0);
        const frequentNotViable = probeStranded.length > 0;
        setFrequentBlocked(frequentNotViable);

        if (frequentNotViable && effectiveRotationSpeed === 2) {
          setRotationSpeedOverride(1);
          setFrequentFallbackNotice(`Frequent rotation isn't possible with this squad and match length — every player would need a turn but the rotation can't fit them all. Standard rotation is being used instead.`);
          const { plan: standardPlan, roster: standardRoster } = buildPlanFromRoster(players, 1);
          setEffectivePlayers(standardRoster);
          setPlan(standardPlan);
        } else {
          if (!frequentNotViable) setFrequentFallbackNotice(null);
          const { plan: nextPlan, roster: nextRoster } = generatePlan(players);
          setEffectivePlayers(nextRoster);
          setPlan(nextPlan);
        }
      } catch (error) {
        console.error("Error auto-generating plan:", error);
        setPlan([]);
      } finally {
        setIsGenerating(false);
      }
    }, 10);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveRotationSpeed,
    effectiveMaxSpreadMinutes,
    minutesPerHalf,
    disablePositionSwaps,
    disableBatchSubs,
    rotateGkAtHalftime,
    teamSize,
    preferredSecondHalfGkId,
    // Regenerate when the live roster / on-pitch assignments change so that
    // swapping the GK (or any starter) before opening the planner refreshes
    // the "GK 1H / GK 2H" badges and minute forecasts. We key on a compact
    // signature to avoid loops from referential identity changes.
    players.map(p => `${p.id}:${p.currentPitchPosition ?? ''}:${p.position ? '1' : '0'}`).join('|'),
    // Regenerate when advanced overrides change.
    JSON.stringify(effectiveOverrides),
    // Re-run bias when the coach reorders the priority list.
    playerPriority ? playerPriority.join('|') : '',
  ]);
  
  const playersOnPitch = players.filter(p => p.position !== null);
  const benchPlayers = players.filter(p => p.position === null);
  const hasEnoughPlayers = miniLeagueTeams
    ? playersOnPitch.length > 0 && benchPlayers.length > 0
    : playersOnPitch.length >= teamSize && benchPlayers.length > 0;
  
  // Calculate time forecasts when plan exists
  const forecasts = useMemo(() => {
    if (!plan) return [];
    return calculateTimeForecasts(effectivePlayers, plan, minutesPerHalf, preferredSecondHalfGkId, rotateGkAtHalftime, currentHalf, currentElapsedSeconds);
  }, [plan, effectivePlayers, minutesPerHalf, preferredSecondHalfGkId, rotateGkAtHalftime, currentHalf, currentElapsedSeconds]);

  // Reset stale fairness report whenever the plan changes (regen, edits, etc.)
  useEffect(() => { setFairnessReport(null); }, [plan]);

  const handleRunSimulator = () => {
    if (!plan) return;
    setIsSimulating(true);
    setTimeout(() => {
      try {
        const report = calculateFairnessReport(players, plan, minutesPerHalf);
        setFairnessReport(report);
      } catch (err) {
        console.error("[AutoSubPlan] Fairness sim error:", err);
      } finally {
        setIsSimulating(false);
      }
    }, 10);
  };
  
  const handleGenerate = () => {
    setIsGenerating(true);
    console.log("[AutoSubPlan] Generating with rotationSpeed:", rotationSpeed, "minutesPerHalf:", minutesPerHalf, "disableBatchSubs:", disableBatchSubs);
    // Use setTimeout to allow UI to update before heavy computation
    setTimeout(() => {
      try {
        const { plan: generatedPlan, roster: generatedRoster } = generatePlan(players);
        console.log("[AutoSubPlan] Generated", generatedPlan.length, "subs", miniLeagueTeams ? "(mini-league per-team)" : "");
        setEffectivePlayers(generatedRoster);
        setPlan(generatedPlan);
      } catch (error) {
        console.error("Error generating plan:", error);
        setPlan([]);
      } finally {
        setIsGenerating(false);
      }
    }, 10);
  };
  
  const handleStart = () => {
    if (plan && plan.length > 0) {
      // If priority bias swapped any starter↔bench positions, push the new
      // lineup back to the parent so the pitch matches the plan that's
      // about to run.
      if (onLineupChange) {
        const lineupChanged = effectivePlayers.some(ep => {
          const orig = players.find(p => p.id === ep.id);
          return !orig || orig.position !== ep.position;
        });
        if (lineupChanged) onLineupChange(effectivePlayers);
      }
      onStartPlan(plan);
      onClose();
    }
  };
  
  const squadSize = players.length;
  const squadEqualsOnField = !miniLeagueTeams && squadSize === teamSize && playersOnPitch.length === teamSize;
  const squadBelowOnField = !miniLeagueTeams && squadSize < teamSize;

  if (squadBelowOnField) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <AlertTriangle className="h-12 w-12 text-red-500" />
        <p className="text-center text-foreground font-medium">
          Not enough players to start a {teamSize}-a-side game.
        </p>
        <p className="text-center text-sm text-muted-foreground">
          You have {squadSize} player{squadSize === 1 ? '' : 's'} available — at least {teamSize} are required on the pitch.
        </p>
        <Button onClick={onClose} className="gap-2 mt-2">Go back</Button>
      </div>
    );
  }

  if (squadEqualsOnField) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Clock className="h-12 w-12 text-primary" />
        <p className="text-center text-foreground font-medium">No substitutions needed.</p>
        <p className="text-center text-sm text-muted-foreground">
          Your squad of {squadSize} matches the {teamSize} players on the pitch — every player is on for the full match.
        </p>
        <Button onClick={onClose} className="gap-2 mt-2">
          <Play className="h-4 w-4" />
          Continue to Pitch Board
        </Button>
      </div>
    );
  }

   if (!hasEnoughPlayers) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <p className="text-center text-muted-foreground">
          {benchPlayers.length === 0 
            ? "No bench players available — auto-substitutions aren't needed."
            : `You need ${teamSize} players on pitch and at least 1 on the bench to generate a substitution plan.`
          }
        </p>
        <p className="text-sm text-muted-foreground">
          Current: {playersOnPitch.length} on pitch, {benchPlayers.length} on bench
        </p>
        <Button onClick={onClose} className="gap-2 mt-2">
          <Play className="h-4 w-4" />
          {benchPlayers.length === 0 ? "Continue to Pitch Board" : "Go Back"}
        </Button>
      </div>
    );
  }
  
  if (isGenerating && !plan) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Generating substitution plan...</p>
      </div>
    );
  }
  
  if (plan === null) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Clock className="h-12 w-12 text-primary" />
        <p className="text-center text-muted-foreground">
          Generate an automatic substitution plan to give all {players.length} players equal playing time.
        </p>
        <Button onClick={handleGenerate} className="gap-2">
          <Play className="h-4 w-4" />
          Generate Plan
        </Button>
        <button
          onClick={onClose}
          className="mt-2 w-full max-w-xs rounded-lg border border-border bg-muted/30 p-3 text-center transition-colors hover:bg-muted/50 active:bg-muted/70"
        >
          <span className="text-sm font-medium text-foreground">Skip</span>
          <p className="mt-1 text-xs text-muted-foreground">
            You can make substitutions and swaps manually during the game instead
          </p>
        </button>
      </div>
    );
  }
  
  return (
    <>
      <div className="space-y-4">
        {/* Edit tab removed — manual editing only via parent-driven editMode */}
        
        {activeTab === 'forecast' && (
          /* Playing Time Forecast */
          <div className="pr-1">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3">
                Predicted playing time based on {plan.length} substitution{plan.length !== 1 ? 's' : ''} over {minutesPerHalf * 2} minutes
              </p>

              {(() => {
                const autoFair = calculateFairnessReport(players, plan, minutesPerHalf);
                const halfSec = minutesPerHalf * 60;
                const guard = effectiveOverrides.halftimeGuardSeconds ?? ADV_DEFAULTS.halftimeGuardSeconds;
                const hasHalftimeClash = plan.some(ev => {
                  const distFromHt = ev.half === 1 ? halfSec - ev.time : ev.time;
                  return distFromHt < guard;
                });
                // Spread reflects exactly what the coach sees in the per-player
                // minutes list below — max minus min across every player.
                const allMinutes = forecasts.map(f => f.predictedMinutes);
                const spreadMin = allMinutes.length
                  ? Math.max(...allMinutes) - Math.min(...allMinutes)
                  : 0;
                return (
                  <>
                    <PlanStatusCard
                      totalSubs={autoFair.totalSubs}
                      spreadMin={spreadMin}
                      shortShifts={autoFair.totalShortShifts}
                      hasHalftimeClash={hasHalftimeClash}
                    />
                    <PlanModeToggles
                      activeMode={effectiveRotationSpeed}
                      onChange={setRotationSpeedOverride}
                      readOnly={!!advancedOverrides}
                      disabledModes={frequentBlocked ? [2] : []}
                    />
                    {frequentFallbackNotice && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{frequentFallbackNotice}</span>
                      </div>
                    )}
                    {(() => {
                      if (!rotateGkAtHalftime || !preferredSecondHalfGkId) return null;
                      if (minutesPerHalf * 60 <= 12 * 60) return null;
                      const gk2H = players.find(p => p.id === preferredSecondHalfGkId);
                      if (!gk2H || gk2H.position) return null;
                      return (
                        <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-400">
                          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>
                            <strong>{gk2H.name}</strong> starts on the bench and is set as 2H GK — extra subs are added so they get outfield minutes in the 1st half. This can widen the minutes spread. Pick a starter as 2H GK for a tighter plan.
                          </span>
                        </div>
                      );
                    })()}
                  </>
                );
              })()}

              {/* Sub timeline preview — read-only chronological list of every planned swap */}
              {plan.length > 0 && (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setShowTimelinePreview((v) => !v)}
                    className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground rounded-md border border-border bg-muted/20 px-3 py-2"
                  >
                    <span>{showTimelinePreview ? "Hide sub timeline" : "Show sub timeline"} ({plan.length})</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showTimelinePreview ? "rotate-180" : "")} />
                  </button>
                  {showTimelinePreview && (
                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className="divide-y divide-border">
                        {[1, 2].map((half) => {
                          const halfSubs = plan.filter((s) => s.half === half);
                          if (halfSubs.length === 0) return null;
                          const groups: { time: number; items: typeof halfSubs }[] = [];
                          halfSubs.forEach((sub) => {
                            const existing = groups.find((g) => g.time === sub.time);
                            if (existing) existing.items.push(sub);
                            else groups.push({ time: sub.time, items: [sub] });
                          });
                          groups.sort((a, b) => a.time - b.time);
                          return (
                            <div key={half}>
                              <div className="px-3 py-1.5 bg-muted/50 text-xs font-semibold text-muted-foreground">
                                {half === 1 ? "1st Half" : "2nd Half"}
                              </div>
                              {groups.map((group) => {
                                const mins = Math.floor(group.time / 60);
                                const secs = group.time % 60;
                                const timeLabel = group.time === 0 && half === 2
                                  ? "HT"
                                  : `${mins}:${secs.toString().padStart(2, "0")}`;
                                return (
                                  <div key={`${half}-${group.time}`} className="flex gap-2.5 px-3 py-2">
                                    <div className="flex flex-col items-center pt-0.5 shrink-0 w-14">
                                      <Badge className="font-mono text-xs h-5 border-transparent bg-foreground/15 text-foreground hover:bg-foreground/20">
                                        {timeLabel}
                                      </Badge>
                                    </div>
                                    <div className="flex-1 space-y-1 min-w-0">
                                      {group.items.map((sub, i) => (
                                        <div key={i} className="flex items-center gap-1 text-sm">
                                          <span className="truncate text-destructive">{sub.playerOut.name}</span>
                                          <span className="text-muted-foreground text-xs">→</span>
                                          <span className="truncate text-green-600 dark:text-green-400">{sub.playerIn.name}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}


              <button
                type="button"
                onClick={() => setShowAllMinutes((v) => !v)}
                className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground rounded-md border border-border bg-muted/20 px-3 py-2"
              >
                <span>{showAllMinutes ? "Hide all player minutes" : "Show all player minutes"}</span>
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAllMinutes ? "rotate-180" : "")} />
              </button>
              {showAllMinutes && (() => {
                // Outfielders are draggable; full-game GKs are pinned at the
                // bottom and non-draggable so the bias pass never tries to
                // touch them.
                const outfield = forecasts.filter(f => f.gkRole !== 'full');
                const fullGks = forecasts.filter(f => f.gkRole === 'full');
                const priority = playerPriority ?? [];
                const orderedOutfield = [...outfield].sort((a, b) => {
                  const ai = priority.indexOf(a.player.id);
                  const bi = priority.indexOf(b.player.id);
                  if (ai === -1 && bi === -1) {
                    // Default: most predicted minutes first (mirrors the
                    // implicit "current top of list" so first drag is intuitive).
                    return b.predictedMinutes - a.predictedMinutes;
                  }
                  if (ai === -1) return 1;
                  if (bi === -1) return -1;
                  return ai - bi;
                });
                const sortableIds = orderedOutfield.map(f => f.player.id);

                const handleDragEnd = (e: DragEndEvent) => {
                  const { active, over } = e;
                  if (!over || active.id === over.id) return;
                  const oldIndex = sortableIds.indexOf(String(active.id));
                  const newIndex = sortableIds.indexOf(String(over.id));
                  if (oldIndex < 0 || newIndex < 0) return;
                  const next = arrayMove(sortableIds, oldIndex, newIndex);
                  setPlayerPriority(next);
                };

                return (
                  <>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                      <span className="flex items-center gap-1.5">
                        <GripVertical className="h-3 w-3" />
                        Drag to prioritise — top players get nudged more minutes.
                        {isGenerating && (
                          <span className="ml-1 inline-flex items-center gap-1 text-primary">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Updating…
                          </span>
                        )}
                      </span>
                      {playerPriority && playerPriority.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPlayerPriority(null)}
                          className="text-primary hover:underline"
                        >
                          Reset priority
                        </button>
                      )}
                    </div>
                    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                        <div className="space-y-1.5">
                          {orderedOutfield.map(forecast => (
                            <SortablePlayerMinutesRow
                              key={forecast.player.id}
                              forecast={forecast}
                              fairnessReport={fairnessReport}
                              draggable
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                    {fullGks.length > 0 && (
                      <div className="space-y-1.5 mt-1.5">
                        {fullGks.map(forecast => (
                          <SortablePlayerMinutesRow
                            key={forecast.player.id}
                            forecast={forecast}
                            fairnessReport={fairnessReport}
                            draggable={false}
                          />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}

            </div>
          </div>
        )}

        {activeTab === 'edit' && (
          /* Manual Edit Mode */
          <SubPlanEditor
            plan={plan}
            players={players}
            minutesPerHalf={minutesPerHalf}
            teamSize={teamSize}
            onPlanChange={setPlan}
          />
        )}
      </div>

      {/* Advanced settings — power-user thresholds for auto-sub planning. */}
      <AdvancedSettingsPanel
        open={advancedOpen}
        onToggle={() => setAdvancedOpen(o => !o)}
        overrides={effectiveOverrides}
        readOnly={!!advancedOverrides}
        onChange={persistLocal}
        defaultMaxSpreadMinutes={maxSpreadMinutes}
      />

      <div className="flex gap-2 justify-end mt-4">
        <Button variant="outline" onClick={onClose}>
          {isSetupFlow ? "Skip — do subs manually" : "Cancel"}
        </Button>
        <Button onClick={handleStart} className="gap-2" disabled={plan.length === 0}>
          <Play className="h-4 w-4" />
          Start Plan
        </Button>
      </div>
    </>
  );
}

export default function AutoSubPlanDialog({
  open,
  onOpenChange,
  players,
  teamSize,
  minutesPerHalf,
  onStartPlan,
  existingPlan,
  editMode,
  rotationSpeed = 2,
  disablePositionSwaps = false,
  disableBatchSubs = false,
  rotateGkAtHalftime = true,
  maxSpreadMinutes = 5,
  currentElapsedSeconds = 0,
  currentHalf = 1,
  preferredSecondHalfGkId,
  showStepper = false,
  onBackToLineup,
  miniLeagueTeams,
  advancedOverrides,
  onLineupChange,
}: AutoSubPlanDialogProps) {
  const handleClose = () => onOpenChange(false);
  
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay 
          className={cn(
            "fixed inset-0 z-[99998] bg-black/80",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 z-[99999] flex flex-col",
            "bg-background duration-200 overflow-hidden pt-[env(safe-area-inset-top)] landscape:pt-1",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-4 p-4 border-b border-border">
            <DialogPrimitive.Title className="min-w-0 flex-1 text-base sm:text-lg font-semibold leading-tight tracking-tight flex items-center gap-2">
              <Clock className="h-5 w-5 shrink-0" />
              <span className="min-w-0 truncate">
                {editMode ? "Edit Substitution Plan" : "Auto Substitution Plan"}
              </span>
            </DialogPrimitive.Title>
            <div className="flex items-center gap-3 shrink-0">
              {!editMode && showStepper && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {onBackToLineup ? (
                    <button
                      type="button"
                      onClick={onBackToLineup}
                      className="flex items-center gap-1.5 rounded-md px-1 py-0.5 -mx-1 hover:bg-muted/60 transition-colors"
                      aria-label="Go back to lineup"
                    >
                      <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                      <span className="underline-offset-2 hover:underline">Lineup</span>
                    </button>
                  ) : (
                    <>
                      <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                      <span>Lineup</span>
                    </>
                  )}
                  <span className="text-muted-foreground/50 mx-0.5">→</span>
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">2</span>
                  <span className="font-medium text-foreground">Subs</span>
                </div>
              )}
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto p-4">
            {open && (
              <DialogInner
                players={players}
                teamSize={teamSize}
                minutesPerHalf={minutesPerHalf}
                onStartPlan={onStartPlan}
                onClose={handleClose}
                existingPlan={existingPlan}
                editMode={editMode}
                rotationSpeed={rotationSpeed}
                disablePositionSwaps={disablePositionSwaps}
                disableBatchSubs={disableBatchSubs}
                rotateGkAtHalftime={rotateGkAtHalftime}
                maxSpreadMinutes={maxSpreadMinutes}
                currentElapsedSeconds={currentElapsedSeconds}
                currentHalf={currentHalf}
                preferredSecondHalfGkId={preferredSecondHalfGkId}
                isSetupFlow={showStepper}
                miniLeagueTeams={miniLeagueTeams}
                advancedOverrides={advancedOverrides}
                onLineupChange={onLineupChange}
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ===========================================================================
// Advanced Settings Panel — power-user thresholds for the auto-sub planner.
// Renders inside the AutoSubPlanDialog footer as a collapsible section.
// All values are stored as seconds and apply per-mode where indicated.
// ===========================================================================

const ADV_DEFAULTS = {
  standardTargetIntervalSec: 7 * 60,   // 420
  standardIntervalFloorSec: 4 * 60,    // 240
  frequentIntervalFloorSec: 180,
  minShiftSeconds: 180,
  halftimeGuardSeconds: 180,
} as const;

function fmtSec(sec: number): string {
  if (sec >= 60 && sec % 60 === 0) return `${sec / 60} min`;
  if (sec >= 60) return `${(sec / 60).toFixed(1)} min`;
  return `${sec}s`;
}

function NumberRow({
  label, hint, value, defaultValue, min, max, step, disabled, onChange,
}: {
  label: string;
  hint: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (next: number | undefined) => void;
}) {
  const isOverridden = value !== defaultValue;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-foreground">{label}</label>
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-xs tabular-nums",
            isOverridden ? "text-primary font-semibold" : "text-muted-foreground"
          )}>
            {fmtSec(value)}
          </span>
          {isOverridden && !disabled && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              reset
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary disabled:opacity-50"
      />
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

function AdvancedSettingsPanel({
  open, onToggle, overrides, readOnly, onChange, defaultMaxSpreadMinutes,
}: {
  open: boolean;
  onToggle: () => void;
  overrides: AutoSubAdvancedOverrides;
  readOnly: boolean;
  onChange: (next: AutoSubAdvancedOverrides) => void;
  defaultMaxSpreadMinutes: number;
}) {
  const defaultMaxSpreadSec = Math.round(defaultMaxSpreadMinutes * 60);
  const v = {
    standardTargetIntervalSec: overrides.standardTargetIntervalSec ?? ADV_DEFAULTS.standardTargetIntervalSec,
    standardIntervalFloorSec: overrides.standardIntervalFloorSec ?? ADV_DEFAULTS.standardIntervalFloorSec,
    frequentIntervalFloorSec: overrides.frequentIntervalFloorSec ?? ADV_DEFAULTS.frequentIntervalFloorSec,
    minShiftSeconds: overrides.minShiftSeconds ?? ADV_DEFAULTS.minShiftSeconds,
    halftimeGuardSeconds: overrides.halftimeGuardSeconds ?? ADV_DEFAULTS.halftimeGuardSeconds,
    maxSpreadOverrideSec: overrides.maxSpreadOverrideSec ?? defaultMaxSpreadSec,
  };
  const overrideCount = (Object.keys(overrides) as (keyof AutoSubAdvancedOverrides)[])
    .filter(k => overrides[k] !== undefined).length;

  const set = (key: Exclude<keyof AutoSubAdvancedOverrides, "playerPriorityOrder">, next: number | undefined) => {
    if (readOnly) return;
    const merged: AutoSubAdvancedOverrides = { ...overrides };
    if (next === undefined) delete merged[key];
    else merged[key] = next;
    onChange(merged);
  };

  const resetAll = () => onChange({});

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sliders className="h-4 w-4" />
          Show expert controls
          {overrideCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {overrideCount} custom
            </Badge>
          )}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-4 border-t border-border">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Raw planner thresholds. Most coaches won't need these — use the suggested fixes above instead.
          </p>
          {readOnly && (
            <p className="text-[11px] text-muted-foreground italic">
              These thresholds are controlled by the parent screen and can't be changed here.
            </p>
          )}

          {/* Balance game time */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Balance game time
            </p>
            <NumberRow
              label="Fairer minutes vs fewer stoppages"
              hint="Lower = more substitution moments and fairer minutes. Higher = fewer interruptions but a wider playing-time spread."
              value={v.standardTargetIntervalSec}
              defaultValue={ADV_DEFAULTS.standardTargetIntervalSec}
              min={180} max={900} step={30}
              disabled={readOnly}
              onChange={(n) => set("standardTargetIntervalSec", n)}
            />
            <NumberRow
              label="Max playing-time spread"
              hint="The biggest acceptable gap between your most-played and least-played outfielder by full-time. Tighter = fairer minutes but more subs."
              value={v.maxSpreadOverrideSec}
              defaultValue={defaultMaxSpreadSec}
              min={120} max={720} step={30}
              disabled={readOnly}
              onChange={(n) => set("maxSpreadOverrideSec", n)}
            />
          </div>

          {/* Prevent awkward timing */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Prevent awkward timing
            </p>
            <NumberRow
              label="Space out substitution moments"
              hint="Lower = more frequent substitution moments and fairer minutes. Higher = calmer match flow."
              value={v.standardIntervalFloorSec}
              defaultValue={ADV_DEFAULTS.standardIntervalFloorSec}
              min={120} max={600} step={30}
              disabled={readOnly}
              onChange={(n) => set("standardIntervalFloorSec", n)}
            />
            <NumberRow
              label="Space out substitution moments (Frequent mode)"
              hint="Applies only when Frequent mode is selected. Lower = more rotations, busier match flow."
              value={v.frequentIntervalFloorSec}
              defaultValue={ADV_DEFAULTS.frequentIntervalFloorSec}
              min={60} max={420} step={15}
              disabled={readOnly}
              onChange={(n) => set("frequentIntervalFloorSec", n)}
            />
          </div>

          {/* Player shift protection */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Player shift protection
            </p>
            <NumberRow
              label="Allow short cameos vs protect player shifts"
              hint="Lower = players can come off sooner so minutes balance faster. Higher = no cameo shifts but a wider playing-time spread."
              value={v.minShiftSeconds}
              defaultValue={ADV_DEFAULTS.minShiftSeconds}
              min={60} max={360} step={15}
              disabled={readOnly}
              onChange={(n) => set("minShiftSeconds", n)}
            />
          </div>

          {/* Halftime protection */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Halftime protection
            </p>
            <NumberRow
              label="Allow halftime subs vs keep halftime clean"
              hint="Lower = subs can land near the halftime whistle. Higher = halftime stays untouched but rotations may shift earlier or later."
              value={v.halftimeGuardSeconds}
              defaultValue={ADV_DEFAULTS.halftimeGuardSeconds}
              min={0} max={420} step={15}
              disabled={readOnly}
              onChange={(n) => set("halftimeGuardSeconds", n)}
            />
          </div>

          {/* Compact tuning summary */}
          <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Current tuning:</span>{" "}
            subs roughly every {Math.round(v.standardTargetIntervalSec / 60)} min,
            minimum {Math.round(v.standardIntervalFloorSec / 60)} min between sub moments,
            players stay on at least {Math.round(v.minShiftSeconds / 60)} min.
          </div>

          {!readOnly && overrideCount > 0 && (
            <div className="flex justify-end pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={resetAll}
              >
                <RotateCcw className="h-3 w-3" />
                Reset all to defaults
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Fairness Simulator Panel
// One-click "run the plan and grade it" surfaced inside the Forecast tab.
// Renders nothing scary by default — just a CTA. Once the coach taps Run,
// shows spread + grade + short shifts + bounce-backs and unlocks per-player
// flag badges in the list below.
// ===========================================================================
function FairnessSimulatorPanel({
  report,
  isSimulating,
  onRun,
  modeLabel,
  teamSize,
  benchSize,
}: {
  report: FairnessReport | null;
  isSimulating: boolean;
  onRun: () => void;
  modeLabel: string;
  teamSize: number;
  benchSize: number;
}) {
  const fmtMinClock = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}'${s.toString().padStart(2, "0")}`;
  };

  const gradeMeta: Record<FairnessReport["grade"], { label: string; tone: string; Icon: typeof ShieldCheck }> = {
    excellent: { label: "Excellent",  tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", Icon: ShieldCheck },
    good:      { label: "Good",       tone: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",  Icon: ShieldCheck },
    fair:      { label: "Fair",       tone: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",         Icon: ShieldAlert },
    poor:      { label: "Needs work", tone: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",                  Icon: ShieldAlert },
  };

  if (!report) {
    return (
      <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Fairness simulator
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {modeLabel} · {teamSize}v{teamSize} +{benchSize} — preview spread &amp; short shifts before saving.
          </p>
        </div>
        <Button
          size="sm"
          variant="default"
          className="gap-1.5 shrink-0"
          onClick={onRun}
          disabled={isSimulating}
        >
          {isSimulating
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Zap className="h-3.5 w-3.5" />}
          {isSimulating ? "Running…" : "Run simulator"}
        </Button>
      </div>
    );
  }

  const meta = gradeMeta[report.grade];
  const GradeIcon = meta.Icon;

  return (
    <div className={cn("mb-3 rounded-lg border p-3 space-y-3", meta.tone.split(" ").filter(c => c.startsWith("border-") || c.startsWith("bg-")).join(" "))}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <GradeIcon className={cn("h-4 w-4 shrink-0", meta.tone)} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Fairness: <span className={meta.tone.split(" ").filter(c => c.startsWith("text-")).join(" ")}>{meta.label}</span></span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {modeLabel} · {teamSize}v{teamSize} +{benchSize} · {report.totalSubs} subs
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 h-7 text-xs shrink-0"
          onClick={onRun}
          disabled={isSimulating}
        >
          {isSimulating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Re-run
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Spread</div>
          <div className="text-sm font-bold text-foreground tabular-nums">{fmtMinClock(report.spreadSeconds)}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">{fmtMinClock(report.minSeconds)} → {fmtMinClock(report.maxSeconds)}</div>
        </div>
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Short shifts</div>
          <div className={cn(
            "text-sm font-bold tabular-nums",
            report.totalShortShifts === 0 ? "text-foreground" : "text-red-500"
          )}>{report.totalShortShifts}</div>
          <div className="text-[10px] text-muted-foreground">&lt; 3 min on pitch</div>
        </div>
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Bounce-backs</div>
          <div className={cn(
            "text-sm font-bold tabular-nums",
            report.totalBounceBacks === 0 ? "text-foreground" : "text-purple-500"
          )}>{report.totalBounceBacks}</div>
          <div className="text-[10px] text-muted-foreground">&lt; 3 min off pitch</div>
        </div>
      </div>

      {(report.totalShortShifts > 0 || report.totalBounceBacks > 0 || report.grade === "poor" || report.grade === "fair") && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          {report.grade === "poor"
            ? "This plan has noticeable imbalance. Try a different mode, increase Max Spread, or tweak Advanced settings below."
            : report.grade === "fair"
              ? "Acceptable, but a couple of players will feel it. Check the flagged rows below."
              : "Plan is solid overall — flagged rows below show edge cases worth a glance."}
        </p>
      )}
    </div>
  );
}
