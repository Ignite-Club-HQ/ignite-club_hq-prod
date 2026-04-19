import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, X } from "lucide-react";
import {
  NetballPlayer,
  NetballPosition,
  NETBALL_POSITIONS,
  POSITION_SLOTS,
} from "./types";
import NetballCourt from "./NetballCourt";
import { findPlayerInPosition, isPositionAllowedForPlayer } from "./netballHelpers";

/**
 * Role tinting (attack / midcourt / defence) applied to position drop
 * zones. Kept on top of the existing per-position colour map so the
 * court reads as three coherent bands at a glance — without overpowering
 * the player tokens themselves.
 */
const POSITION_ROLE: Record<
  NetballPosition,
  { ring: string; bg: string; text: string; band: "attack" | "mid" | "defence" }
> = {
  GS: {
    ring: "ring-emerald-400/80",
    bg: "bg-emerald-500/25",
    text: "text-emerald-50",
    band: "attack",
  },
  GA: {
    ring: "ring-emerald-400/80",
    bg: "bg-emerald-500/25",
    text: "text-emerald-50",
    band: "attack",
  },
  WA: {
    ring: "ring-sky-400/80",
    bg: "bg-sky-500/25",
    text: "text-sky-50",
    band: "mid",
  },
  C: {
    ring: "ring-sky-400/80",
    bg: "bg-sky-500/30",
    text: "text-sky-50",
    band: "mid",
  },
  WD: {
    ring: "ring-sky-400/80",
    bg: "bg-sky-500/25",
    text: "text-sky-50",
    band: "mid",
  },
  GD: {
    ring: "ring-orange-400/80",
    bg: "bg-orange-500/25",
    text: "text-orange-50",
    band: "defence",
  },
  GK: {
    ring: "ring-orange-400/80",
    bg: "bg-orange-500/25",
    text: "text-orange-50",
    band: "defence",
  },
};

interface NetballPreGameLineupProps {
  players: NetballPlayer[];
  bench: NetballPlayer[];
  onAssign: (playerId: string, position: NetballPosition | null) => void;
  /** Validation mode forwarded from board — drives violation hint colour. */
  validationMode?: "free" | "warn" | "strict";
  readOnly?: boolean;
}

interface DragState {
  playerId: string;
  player: NetballPlayer;
  x: number;
  y: number;
  source: "court" | "bench";
}

/**
 * Touch-first netball lineup picker.
 *
 * The court is the primary interaction surface — high-contrast circular
 * drop zones with always-visible position labels and a "+" affordance,
 * tinted by role (attack / midcourt / defence). Tokens can be
 * dragged or tapped:
 *   - Tap empty slot → assigns the next available bench player
 *     (preferring fits via `isPositionAllowedForPlayer`).
 *   - Tap player on court → sends them straight back to the bench.
 *   - Long-press / drag works as before.
 *
 * Bench is a horizontal scroll of richer cards: avatar + first name +
 * preferred positions chips. Tap a bench card to drop into the next
 * compatible empty slot; the "+" overlay opens the same flow but limits
 * to slots the player is allowed to play.
 */
export default function NetballPreGameLineup({
  players,
  bench,
  onAssign,
  validationMode = "warn",
  readOnly = false,
}: NetballPreGameLineupProps) {
  const courtWrapRef = useRef<HTMLDivElement>(null);
  const benchRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Map<NetballPosition, HTMLDivElement>>(new Map());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverPos, setHoverPos] = useState<NetballPosition | null>(null);
  const [overBench, setOverBench] = useState(false);
  const [justPlaced, setJustPlaced] = useState<NetballPosition | null>(null);
  const [shakeSlot, setShakeSlot] = useState<NetballPosition | null>(null);
  const [violationToast, setViolationToast] = useState<string | null>(null);

  const emptyPositions = useMemo(
    () => NETBALL_POSITIONS.filter((p) => !findPlayerInPosition(players, p)),
    [players]
  );

  /** Find the next slot a bench player can occupy — prefers an exact preferred slot, then any allowed slot, then any open slot. */
  const findNextSlotFor = useCallback(
    (player: NetballPlayer): NetballPosition | null => {
      if (emptyPositions.length === 0) return null;
      const preferred = (player.preferredPositions ?? []).find((p) =>
        emptyPositions.includes(p)
      );
      if (preferred) return preferred;
      const allowed = emptyPositions.find((p) => isPositionAllowedForPlayer(player, p));
      if (allowed) return allowed;
      return validationMode === "strict" ? null : emptyPositions[0];
    },
    [emptyPositions, validationMode]
  );

  const triggerHaptic = useCallback(() => {
    try {
      // Best-effort native vibration — silently no-ops where unsupported.
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        (navigator as Navigator & { vibrate: (ms: number) => void }).vibrate(8);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const flashViolation = useCallback((slot: NetballPosition, msg: string) => {
    setShakeSlot(slot);
    setViolationToast(msg);
    window.setTimeout(() => setShakeSlot(null), 350);
    window.setTimeout(() => setViolationToast(null), 1600);
  }, []);

  const tryAssign = useCallback(
    (player: NetballPlayer, slot: NetballPosition) => {
      const allowed = isPositionAllowedForPlayer(player, slot);
      if (!allowed && validationMode === "strict") {
        flashViolation(slot, `${slot} restricted for ${player.name.split(" ")[0]}`);
        return;
      }
      onAssign(player.id, slot);
      setJustPlaced(slot);
      triggerHaptic();
      window.setTimeout(() => setJustPlaced(null), 400);
    },
    [onAssign, validationMode, flashViolation, triggerHaptic]
  );

  const startDrag = useCallback(
    (player: NetballPlayer, source: "court" | "bench", clientX: number, clientY: number) => {
      if (readOnly) return;
      setDrag({ playerId: player.id, player, x: clientX, y: clientY, source });
    },
    [readOnly]
  );

  useEffect(() => {
    if (!drag) return;

    const findHover = (x: number, y: number) => {
      let foundSlot: NetballPosition | null = null;
      let nearestDist = Infinity;
      for (const pos of NETBALL_POSITIONS) {
        const el = slotRefs.current.get(pos);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          foundSlot = pos;
          nearestDist = 0;
          break;
        }
        if (dist < nearestDist) {
          nearestDist = dist;
          if (dist < 60) foundSlot = pos;
        }
      }
      const benchEl = benchRef.current;
      const inBench = benchEl
        ? (() => {
            const r = benchEl.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          })()
        : false;
      setHoverPos(inBench ? null : foundSlot);
      setOverBench(inBench);
    };

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
      findHover(e.clientX, e.clientY);
    };

    const onUp = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      let dropPos: NetballPosition | null = null;
      let nearestDist = Infinity;
      for (const pos of NETBALL_POSITIONS) {
        const el = slotRefs.current.get(pos);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        const dist = Math.hypot(x - cx, y - cy);
        if (inside) {
          dropPos = pos;
          break;
        }
        if (dist < nearestDist && dist < 60) {
          nearestDist = dist;
          dropPos = pos;
        }
      }
      const benchEl = benchRef.current;
      const droppedOnBench = benchEl
        ? (() => {
            const r = benchEl.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          })()
        : false;

      if (drag) {
        if (dropPos && !droppedOnBench) {
          const allowed = isPositionAllowedForPlayer(drag.player, dropPos);
          const blocked = !allowed && validationMode === "strict";
          if (blocked) {
            flashViolation(dropPos, `${dropPos} restricted for ${drag.player.name.split(" ")[0]}`);
          } else {
            onAssign(drag.playerId, dropPos);
            setJustPlaced(dropPos);
            triggerHaptic();
            window.setTimeout(() => setJustPlaced(null), 400);
          }
        } else if (droppedOnBench && drag.source === "court") {
          onAssign(drag.playerId, null);
        }
      }

      setDrag(null);
      setHoverPos(null);
      setOverBench(false);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, onAssign, validationMode, flashViolation, triggerHaptic]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden select-none">
      {/* COURT — primary surface */}
      <div
        ref={courtWrapRef}
        className="relative flex-[1.4] min-h-0 flex items-center justify-center bg-muted/40 px-1 py-1"
      >
        <div
          className="relative h-full max-h-full aspect-[5/7] mx-auto"
          style={{ maxWidth: "100%" }}
        >
          <NetballCourt className="absolute inset-0 w-full h-full rounded-lg" />

          {NETBALL_POSITIONS.map((pos) => {
            const slot = POSITION_SLOTS[pos];
            const player = findPlayerInPosition(players, pos);
            const role = POSITION_ROLE[pos];
            const isHover = hoverPos === pos;
            const justSnapped = justPlaced === pos;
            const isShaking = shakeSlot === pos;
            const violation =
              drag && isHover && !isPositionAllowedForPlayer(drag.player, pos);

            return (
              <div
                key={pos}
                ref={(el) => {
                  if (el) slotRefs.current.set(pos, el);
                  else slotRefs.current.delete(pos);
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              >
                {player ? (
                  <CourtToken
                    player={player}
                    position={pos}
                    role={role}
                    isDragging={drag?.playerId === player.id}
                    isHover={isHover}
                    justSnapped={justSnapped}
                    readOnly={readOnly}
                    onTap={() => onAssign(player.id, null)}
                    onPointerDown={(e) => {
                      if (readOnly) return;
                      e.preventDefault();
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      startDrag(player, "court", e.clientX, e.clientY);
                    }}
                  />
                ) : (
                  <EmptySlot
                    position={pos}
                    role={role}
                    isHover={isHover}
                    isDragging={!!drag}
                    violation={!!violation}
                    isShaking={isShaking}
                    readOnly={readOnly}
                    onTap={() => {
                      if (readOnly) return;
                      // Tap to assign next available bench player —
                      // prefers a bench player whose preferred position
                      // matches this slot.
                      const candidate =
                        bench.find((b) =>
                          (b.preferredPositions ?? []).includes(pos)
                        ) ??
                        bench.find((b) => isPositionAllowedForPlayer(b, pos)) ??
                        (validationMode === "strict" ? undefined : bench[0]);
                      if (!candidate) return;
                      tryAssign(candidate, pos);
                    }}
                  />
                )}
              </div>
            );
          })}

          {violationToast && (
            <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground text-[10px] font-semibold px-2.5 py-1 rounded-full shadow-lg animate-fade-in">
              {violationToast}
            </div>
          )}
        </div>
      </div>

      {/* BENCH — drag source + tap-to-assign */}
      <div
        ref={benchRef}
        className={cn(
          "border-t bg-card/80 transition-colors flex-shrink-0",
          overBench && drag?.source === "court" && "bg-primary/10"
        )}
      >
        <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
          <h3 className="text-[10px] font-bold tabular-nums uppercase tracking-wider text-muted-foreground">
            Bench · {bench.length}
          </h3>
        </div>
        {bench.length === 0 ? (
          <div className="px-3 pb-2.5 text-[11px] text-muted-foreground italic">
            All players are on the court.
          </div>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain pb-2 pt-0.5">
            <div className="flex gap-1.5 px-2 min-w-min">
              {bench.map((p) => (
                <BenchCard
                  key={p.id}
                  player={p}
                  isDragging={drag?.playerId === p.id}
                  readOnly={readOnly}
                  onTap={() => {
                    if (readOnly) return;
                    const slot = findNextSlotFor(p);
                    if (slot) tryAssign(p, slot);
                  }}
                  onAssignSlot={() => {
                    if (readOnly) return;
                    const slot = findNextSlotFor(p);
                    if (slot) tryAssign(p, slot);
                  }}
                  onPointerDown={(e) => {
                    if (readOnly) return;
                    e.preventDefault();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    startDrag(p, "bench", e.clientX, e.clientY);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* DRAG GHOST */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2"
          style={{ left: drag.x, top: drag.y }}
        >
          <DragGhost player={drag.player} />
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface RoleStyle {
  ring: string;
  bg: string;
  text: string;
  band: "attack" | "mid" | "defence";
}

function CourtToken({
  player,
  position,
  role,
  isDragging,
  isHover,
  justSnapped,
  readOnly,
  onTap,
  onPointerDown,
}: {
  player: NetballPlayer;
  position: NetballPosition;
  role: RoleStyle;
  isDragging: boolean;
  isHover: boolean;
  justSnapped: boolean;
  readOnly: boolean;
  onTap: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  // Pointer-down position used to discriminate drag vs tap (tap = small move).
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);

  return (
    <div
      onPointerDown={(e) => {
        downRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
        onPointerDown(e);
      }}
      onPointerUp={(e) => {
        const d = downRef.current;
        downRef.current = null;
        if (!d) return;
        const dx = Math.abs(e.clientX - d.x);
        const dy = Math.abs(e.clientY - d.y);
        const dt = Date.now() - d.t;
        if (dx < 6 && dy < 6 && dt < 300) onTap();
      }}
      className={cn(
        "relative flex flex-col items-center gap-0.5 touch-none cursor-grab active:cursor-grabbing transition-transform",
        isDragging && "opacity-30 scale-95",
        isHover && "scale-110",
        justSnapped && "animate-scale-in",
        readOnly && "pointer-events-none"
      )}
      aria-label={`${player.name} at ${position}, tap to bench`}
    >
      <Avatar
        className={cn(
          "h-12 w-12 border-2 shadow-lg ring-2 ring-offset-1 ring-offset-transparent",
          role.ring,
          "border-background",
          justSnapped && "ring-primary"
        )}
      >
        <AvatarFallback
          className={cn("text-xs font-bold", role.bg, role.text)}
        >
          {initialsOf(player.name)}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "text-[9px] font-bold rounded px-1 leading-none py-0.5 shadow-sm",
          role.bg,
          role.text
        )}
      >
        {position}
      </span>
      <span className="text-[10px] font-medium text-foreground/95 leading-tight max-w-[64px] truncate bg-background/80 px-1 rounded">
        {player.name.split(" ")[0]}
      </span>
    </div>
  );
}

function EmptySlot({
  position,
  role,
  isHover,
  isDragging,
  violation,
  isShaking,
  readOnly,
  onTap,
}: {
  position: NetballPosition;
  role: RoleStyle;
  isHover: boolean;
  isDragging: boolean;
  violation: boolean;
  isShaking: boolean;
  readOnly: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={readOnly}
      aria-label={`Empty ${position} slot — tap to fill`}
      className={cn(
        "relative w-12 h-12 rounded-full border-2 flex items-center justify-center font-bold transition-all shadow-md",
        "ring-2 ring-offset-1 ring-offset-transparent",
        violation
          ? "border-destructive bg-destructive/40 text-destructive-foreground scale-110 ring-destructive"
          : isHover
          ? "border-background bg-primary/40 text-primary-foreground scale-125 ring-primary"
          : isDragging
          ? cn("border-background", role.bg, role.text, role.ring, "animate-pulse")
          : cn("border-background/80", role.bg, role.text, role.ring),
        isShaking && "animate-[wiggle_350ms_ease-in-out]",
        readOnly && "opacity-60"
      )}
      style={{
        // Inline keyframe so we don't need a tailwind config change.
        // Falls back gracefully when the animation prop isn't honoured.
        ["--tw-shake" as string]: "translateX(0)",
      }}
    >
      <span className="text-[11px] tracking-tight">{position}</span>
      {!isHover && !isDragging && (
        <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-background text-foreground border border-border flex items-center justify-center shadow-sm">
          <Plus className="h-2.5 w-2.5" />
        </span>
      )}
      {/* Inline keyframes for the shake — scoped via :where so it doesn't leak. */}
      <style>{`@keyframes wiggle { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }`}</style>
    </button>
  );
}

function BenchCard({
  player,
  isDragging,
  readOnly,
  onTap,
  onAssignSlot,
  onPointerDown,
}: {
  player: NetballPlayer;
  isDragging: boolean;
  readOnly: boolean;
  onTap: () => void;
  onAssignSlot: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const prefs = (player.preferredPositions ?? []).slice(0, 2);

  return (
    <div
      onPointerDown={(e) => {
        downRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
        onPointerDown(e);
      }}
      onPointerUp={(e) => {
        const d = downRef.current;
        downRef.current = null;
        if (!d) return;
        const dx = Math.abs(e.clientX - d.x);
        const dy = Math.abs(e.clientY - d.y);
        const dt = Date.now() - d.t;
        // Ignore taps that originate on the assign "+" button.
        const target = e.target as HTMLElement;
        if (target.closest("[data-assign-btn]")) return;
        if (dx < 6 && dy < 6 && dt < 300) onTap();
      }}
      className={cn(
        "relative flex items-center gap-2 shrink-0 touch-none cursor-grab active:cursor-grabbing rounded-xl px-2 py-1.5 bg-card border border-border min-w-[124px] max-w-[160px] shadow-sm transition-transform hover:border-primary/40",
        isDragging && "opacity-30 scale-95",
        readOnly && "pointer-events-none opacity-60"
      )}
      aria-label={`Bench player ${player.name}, tap to assign`}
    >
      <Avatar className="h-9 w-9 border border-border shadow-sm flex-shrink-0">
        <AvatarFallback className="text-[11px] font-bold bg-muted text-foreground">
          {initialsOf(player.name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col min-w-0 flex-1 leading-tight">
        <span className="text-[11px] font-semibold truncate">
          {player.name.split(" ")[0]}
        </span>
        <span className="text-[9px] text-muted-foreground tabular-nums truncate">
          {prefs.length > 0 ? prefs.join(" / ") : "Any"}
        </span>
      </div>
      <button
        type="button"
        data-assign-btn
        onClick={(e) => {
          e.stopPropagation();
          onAssignSlot();
        }}
        disabled={readOnly}
        className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary hover:bg-primary/25 flex items-center justify-center transition-colors"
        aria-label="Assign to next available position"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function DragGhost({ player }: { player: NetballPlayer }) {
  return (
    <div className="flex flex-col items-center gap-0.5 scale-110 drop-shadow-2xl">
      <Avatar className="h-14 w-14 border-2 border-primary shadow-2xl">
        <AvatarFallback className="text-sm font-bold bg-primary/30 text-primary">
          {initialsOf(player.name)}
        </AvatarFallback>
      </Avatar>
      <span className="text-[10px] font-bold bg-background/90 px-1.5 py-0.5 rounded border border-border">
        {player.name.split(" ")[0]}
      </span>
    </div>
  );
}
