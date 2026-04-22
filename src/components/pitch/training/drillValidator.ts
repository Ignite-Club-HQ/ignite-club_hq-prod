// Drill validator — checks tactical/coordinate semantics for seeded drills.
//
// Coordinate convention (matches the rest of the pitch board):
//   x: 0 (left) → 100 (right)
//   y: 0 (top of pitch / attacking goal) → 100 (bottom of pitch / own goal)
//   So a forward attacking pass / shot generally moves from HIGH y → LOW y.
//
// This module is pure and side-effect free so it can be reused from:
//   - the seeding scripts (CI-style audit),
//   - the editor (live "lint" panel before saving), or
//   - a one-off audit script (see scripts/validate-seeded-drills.ts).
//
// Three rule families are implemented:
//   1. Y-orientation        — attacking arrows should travel up the pitch
//   2. Arrow-direction      — multi-frame consistency + zero-length / off-pitch arrows
//   3. Overlapping entities — players/balls/cones stacked on top of each other
//
// Each rule emits an Issue with a severity:
//   "error"   — almost certainly wrong (zero-length arrow, off-pitch object)
//   "warning" — likely wrong but plausible in some setups (e.g. backward pass)
//   "info"    — worth a glance (e.g. arrow ends near a defender)

import type {
  Annotation,
  ArrowGeometry,
  DrillFrame,
  DrillObject,
} from "./types";

export type IssueSeverity = "error" | "warning" | "info";

export interface DrillIssue {
  severity: IssueSeverity;
  rule: string;
  frameIndex: number;
  /** Optional id of the offending object/annotation for editor highlighting */
  targetId?: string;
  message: string;
}

export interface DrillValidationResult {
  drillId?: string;
  drillName?: string;
  frameCount: number;
  issues: DrillIssue[];
  /** Summary counts for quick reporting */
  counts: { error: number; warning: number; info: number };
}

// ---------- Tunables ----------
const PITCH_MIN = 0;
const PITCH_MAX = 100;
/** Two objects within this distance (percent units) are considered "overlapping". */
const OVERLAP_DISTANCE = 2.5;
/** Arrows shorter than this are flagged as zero-length / accidental taps. */
const MIN_ARROW_LENGTH = 1.5;
/** Arrows whose vertical component is small are treated as "lateral", not forward/back. */
const LATERAL_DY_THRESHOLD = 4;
/** Player labels that imply "attacking" (sky-blue) — backward passes from these get warned. */
const ATTACK_LABEL_PATTERNS = [/^\d+$/, /^A\d*$/i, /^O\d*$/i, /^P\d*$/i, /^R$/i];

// ---------- Helpers ----------
function dist(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function isAttackLabel(label: string | undefined): boolean {
  if (!label) return false;
  return ATTACK_LABEL_PATTERNS.some((re) => re.test(label.trim()));
}

function isArrow(a: Annotation): a is Annotation & { geometry: ArrowGeometry } {
  return a.type === "arrow-solid" || a.type === "arrow-dashed";
}

function inBounds(v: number) {
  return v >= PITCH_MIN && v <= PITCH_MAX;
}

// ---------- Rules ----------

/** Rule 1: every object/annotation point sits inside the 0–100 pitch. */
function ruleBounds(frame: DrillFrame, frameIndex: number, push: (i: DrillIssue) => void) {
  for (const o of frame.objects) {
    if (!inBounds(o.x) || !inBounds(o.y)) {
      push({
        severity: "error",
        rule: "bounds",
        frameIndex,
        targetId: o.id,
        message: `${o.type}${o.label ? ` "${o.label}"` : ""} is off-pitch (x=${o.x.toFixed(1)}, y=${o.y.toFixed(1)})`,
      });
    }
  }
  for (const a of frame.annotations) {
    if (isArrow(a)) {
      const { from, to } = a.geometry;
      if (!inBounds(from.x) || !inBounds(from.y) || !inBounds(to.x) || !inBounds(to.y)) {
        push({
          severity: "error",
          rule: "bounds",
          frameIndex,
          targetId: a.id,
          message: `Arrow endpoints fall outside the pitch (from ${from.x.toFixed(1)},${from.y.toFixed(1)} → ${to.x.toFixed(1)},${to.y.toFixed(1)})`,
        });
      }
    }
  }
}

/** Rule 2: zero-length / accidental-tap arrows. */
function ruleZeroLengthArrows(frame: DrillFrame, frameIndex: number, push: (i: DrillIssue) => void) {
  for (const a of frame.annotations) {
    if (!isArrow(a)) continue;
    const { from, to } = a.geometry;
    const len = dist(from.x, from.y, to.x, to.y);
    if (len < MIN_ARROW_LENGTH) {
      push({
        severity: "error",
        rule: "arrow-zero-length",
        frameIndex,
        targetId: a.id,
        message: `Arrow has near-zero length (${len.toFixed(2)}). Likely an accidental tap.`,
      });
    }
  }
}

/**
 * Rule 3: y-orientation — arrows starting from a player labelled like an attacker
 * should travel UP the pitch (to.y < from.y). Lateral arrows (small |dy|) are ignored.
 * Backward arrows from attacking labels become a "warning" (could be a layoff/recycle,
 * but more often a copy-paste mistake).
 */
function ruleYOrientation(frame: DrillFrame, frameIndex: number, push: (i: DrillIssue) => void) {
  for (const a of frame.annotations) {
    if (!isArrow(a)) continue;
    const { from, to } = a.geometry;
    const dy = to.y - from.y; // negative = up the pitch (forward)
    if (Math.abs(dy) < LATERAL_DY_THRESHOLD) continue; // lateral pass — fine

    // Find the nearest object to the arrow's start to infer "who is passing".
    let nearest: DrillObject | undefined;
    let nearestD = Infinity;
    for (const o of frame.objects) {
      const d = dist(o.x, o.y, from.x, from.y);
      if (d < nearestD) {
        nearestD = d;
        nearest = o;
      }
    }
    if (!nearest || nearestD > 6) continue; // arrow not anchored to anyone identifiable

    if (nearest.type === "player" && isAttackLabel(nearest.label) && dy > 0) {
      push({
        severity: "warning",
        rule: "y-orientation",
        frameIndex,
        targetId: a.id,
        message: `Attacking player "${nearest.label}" passes BACKWARDS (dy=${dy.toFixed(1)}). Verify y-orientation: low y = attacking goal.`,
      });
    }
  }
}

/**
 * Rule 4: arrow-direction consistency across frames.
 * If frame N has the ball moving from A→B, frame N+1 should not show the ball
 * snapping back to A without an explanatory arrow. This is a common copy-paste bug.
 */
function ruleBallContinuity(frames: DrillFrame[], push: (i: DrillIssue) => void) {
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const prevBall = prev.objects.find((o) => o.type === "ball");
    const currBall = curr.objects.find((o) => o.type === "ball");
    if (!prevBall || !currBall) continue;
    // Find the arrow in the PREVIOUS frame whose start sits on the previous ball.
    const arrow = prev.annotations
      .filter(isArrow)
      .find((a) => dist(a.geometry.from.x, a.geometry.from.y, prevBall.x, prevBall.y) < 4);
    if (!arrow) continue;
    // Expected new ball position = arrow end. If actual is far from expected, flag it.
    const expectedX = arrow.geometry.to.x;
    const expectedY = arrow.geometry.to.y;
    const drift = dist(currBall.x, currBall.y, expectedX, expectedY);
    if (drift > 8) {
      push({
        severity: "warning",
        rule: "ball-continuity",
        frameIndex: i,
        targetId: currBall.id,
        message: `Ball position in frame ${i + 1} (${currBall.x.toFixed(1)},${currBall.y.toFixed(1)}) does not match the previous frame's arrow endpoint (${expectedX.toFixed(1)},${expectedY.toFixed(1)}). Drift=${drift.toFixed(1)}.`,
      });
    }
  }
}

/** Rule 5: overlapping entities — two objects sitting on top of each other. */
function ruleOverlaps(frame: DrillFrame, frameIndex: number, push: (i: DrillIssue) => void) {
  const objs = frame.objects;
  for (let i = 0; i < objs.length; i++) {
    for (let j = i + 1; j < objs.length; j++) {
      const a = objs[i];
      const b = objs[j];
      const d = dist(a.x, a.y, b.x, b.y);
      if (d >= OVERLAP_DISTANCE) continue;
      // Ball-on-player is intentional ("dribbling") — only flag if both are non-ball.
      const involvesBall = a.type === "ball" || b.type === "ball";
      if (involvesBall) continue;
      // Two cones touching (slalom) is fine if they're explicitly cones — only warn for player-on-player or player-on-goal.
      const bothCones = a.type === "cone" && b.type === "cone";
      if (bothCones) continue;
      push({
        severity: "warning",
        rule: "overlap",
        frameIndex,
        targetId: a.id,
        message: `${a.type}${a.label ? ` "${a.label}"` : ""} overlaps ${b.type}${b.label ? ` "${b.label}"` : ""} (distance=${d.toFixed(2)}).`,
      });
    }
  }
}

/**
 * Rule 7: rotation coverage — every "waiting" player (id like `w1`, `w2`, …) that
 * appears anywhere in the drill should be shown in an ACTIVE role at least once
 * across the frame sequence. "Active" = same id rendered with a non-muted color
 * (the muted bench colour is `#94a3b8`). If a waiting player never gets a turn,
 * the drill demo doesn't actually rotate them through, which is a UX bug.
 *
 * Reported once per drill (not per frame) on the first frame for editor anchoring.
 */
const MUTED_WAITING_COLOR = "#94a3b8";
function ruleRotationCoverage(frames: DrillFrame[], push: (i: DrillIssue) => void) {
  if (frames.length === 0) return;
  const waitingIds = new Set<string>();
  const activatedIds = new Set<string>();
  for (const f of frames) {
    for (const o of f.objects) {
      if (o.type !== "player" || typeof o.id !== "string" || !/^w\d+$/i.test(o.id)) continue;
      const color = (o.color ?? "").toLowerCase();
      if (color === MUTED_WAITING_COLOR) {
        waitingIds.add(o.id);
      } else {
        activatedIds.add(o.id);
        waitingIds.add(o.id); // still counts as "seen" in the rotation
      }
    }
  }
  const uncovered = [...waitingIds].filter((id) => !activatedIds.has(id)).sort();
  if (uncovered.length === 0) return;
  push({
    severity: "warning",
    rule: "rotation-coverage",
    frameIndex: 0,
    message: `Rotation gap: ${uncovered.length} waiting player(s) never demoed in an active role — ${uncovered.join(", ")}. Add cycle frames so each "W" chip takes a turn.`,
  });
}

/**
 * Rule 8: contest fairness — for drills that pit an attacker (sky-blue,
 * #0ea5e9) against a defender (red, #ef4444), the demo should NOT always
 * show the same side winning the contest across reps. As different player
 * pairs rotate through the drill, outcomes naturally vary; the seeded
 * frames should reflect that.
 *
 * Heuristic: across all frames, find the ball position relative to each
 * coloured chip. If the ball ends up consistently closer to the attacking
 * goal (low y) AND on the attacker side every "resolution" frame, with no
 * alternate frame where the defender clears it back, flag the drill.
 *
 * A drill is considered to ROTATE outcomes if at least one frame shows
 * the ball moving AWAY from the attacking goal (defender clearance:
 * arrow with dy > +20) anchored to a defender (#ef4444).
 *
 * Reported once per drill on frame 0.
 */
const ATTACKER_COLOR = "#0ea5e9";
const DEFENDER_COLOR = "#ef4444";
function ruleContestFairness(frames: DrillFrame[], push: (i: DrillIssue) => void) {
  if (frames.length < 2) return;

  // Only applies to drills where BOTH an attacker and a defender chip
  // are present in MULTIPLE frames — i.e. a sustained contest. Single
  // frame appearances (e.g. a red coach-signal chip in one frame of a
  // warm-up) are intentionally ignored to avoid false positives.
  const MIN_PRESENCE_FRAMES = 2;
  let attackerFrames = 0;
  let defenderFrames = 0;
  for (const f of frames) {
    if (f.objects.some((o) => o.type === "player" && (o.color ?? "").toLowerCase() === ATTACKER_COLOR)) {
      attackerFrames++;
    }
    if (f.objects.some((o) => o.type === "player" && (o.color ?? "").toLowerCase() === DEFENDER_COLOR)) {
      defenderFrames++;
    }
  }
  if (attackerFrames < MIN_PRESENCE_FRAMES || defenderFrames < MIN_PRESENCE_FRAMES) return;

  // Look for at least one defender clearance: an arrow anchored on a
  // defender chip whose endpoint travels meaningfully AWAY from the
  // attacking goal (dy > +20). This is the "alternate outcome" signal.
  let defenderWinsSomewhere = false;
  for (const f of frames) {
    const defenders = f.objects.filter(
      (o) => o.type === "player" && (o.color ?? "").toLowerCase() === DEFENDER_COLOR
    );
    if (defenders.length === 0) continue;
    for (const a of f.annotations) {
      if (!isArrow(a)) continue;
      const dy = a.geometry.to.y - a.geometry.from.y;
      if (dy < 20) continue;
      // arrow must originate near a defender chip
      const nearDefender = defenders.some(
        (d) => dist(d.x, d.y, a.geometry.from.x, a.geometry.from.y) < 6
      );
      if (nearDefender) {
        defenderWinsSomewhere = true;
        break;
      }
    }
    if (defenderWinsSomewhere) break;
  }

  if (defenderWinsSomewhere) return;

  push({
    severity: "warning",
    rule: "contest-fairness",
    frameIndex: 0,
    message:
      "Contest drill always resolves the same way (attacker wins every rep). Add a frame where the defender wins the duel — outcomes should rotate as different players cycle through.",
  });
}

/** Rule 6: duplicate player labels in the same frame ("two #7"s). */
function ruleDuplicateLabels(frame: DrillFrame, frameIndex: number, push: (i: DrillIssue) => void) {
  const seen = new Map<string, string>(); // label → first object id
  for (const o of frame.objects) {
    if (o.type !== "player" || !o.label) continue;
    const key = o.label.trim().toUpperCase();
    if (seen.has(key)) {
      push({
        severity: "warning",
        rule: "duplicate-label",
        frameIndex,
        targetId: o.id,
        message: `Two players share the label "${o.label}".`,
      });
    } else {
      seen.set(key, o.id);
    }
  }
}

// ---------- Public entry point ----------

export function validateDrill(input: {
  id?: string;
  name?: string;
  frames: DrillFrame[];
}): DrillValidationResult {
  const issues: DrillIssue[] = [];
  const push = (i: DrillIssue) => issues.push(i);

  input.frames.forEach((f, idx) => {
    ruleBounds(f, idx, push);
    ruleZeroLengthArrows(f, idx, push);
    ruleYOrientation(f, idx, push);
    ruleOverlaps(f, idx, push);
    ruleDuplicateLabels(f, idx, push);
  });
  ruleBallContinuity(input.frames, push);
  ruleRotationCoverage(input.frames, push);
  ruleContestFairness(input.frames, push);

  const counts = issues.reduce(
    (acc, i) => ({ ...acc, [i.severity]: acc[i.severity] + 1 }),
    { error: 0, warning: 0, info: 0 }
  );

  return {
    drillId: input.id,
    drillName: input.name,
    frameCount: input.frames.length,
    issues,
    counts,
  };
}

/** Format a single drill's result into a human-readable block. */
export function formatDrillReport(r: DrillValidationResult): string {
  const header = `▸ ${r.drillName ?? r.drillId ?? "(unnamed drill)"}  —  ${r.frameCount} frame(s)  —  ${r.counts.error} error / ${r.counts.warning} warn / ${r.counts.info} info`;
  if (r.issues.length === 0) return `${header}\n    ✓ no issues`;
  const lines = r.issues.map((i) => {
    const tag = i.severity === "error" ? "✗" : i.severity === "warning" ? "!" : "·";
    return `    ${tag} [frame ${i.frameIndex + 1}] (${i.rule}) ${i.message}`;
  });
  return [header, ...lines].join("\n");
}
