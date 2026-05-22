/**
 * Plan validator.
 *
 * Asserts the invariants the auto-sub state machine relies on. Called by
 * `autoSubReducer` before any transition that produces a new plan.
 *
 * Returns null when the plan is valid, or a `PlanError` describing the first
 * invariant violation. In dev mode the reducer additionally throws so issues
 * surface loudly during development.
 */
import type { Player, SubstitutionEvent } from "../types";
import { getSubKey } from "../autoSubHelpers";
import type { PlanError } from "./planEvents";

export interface ValidatePlanCtx {
  players: Player[];
  /** Previous plan to compare `executed` entries against (immutability check). */
  previousPlan?: SubstitutionEvent[];
  /** Currently locked player ids; remaining subs must not sub these players off. */
  lockedIds?: Set<string>;
}

export function assertValidPlan(
  plan: SubstitutionEvent[],
  ctx: ValidatePlanCtx
): PlanError | null {
  const { players, previousPlan, lockedIds } = ctx;

  // ── 1. Duplicate sub keys ──
  const seen = new Set<string>();
  for (const sub of plan) {
    const key = getSubKey(sub);
    if (seen.has(key)) {
      return {
        code: "duplicate-sub",
        message: `Duplicate sub ${key} in plan`,
      };
    }
    seen.add(key);
  }

  // ── 2. Executed entries are append-only (never mutated, never removed) ──
  if (previousPlan) {
    const prevExecuted = previousPlan.filter((s) => s.executed);
    for (const prev of prevExecuted) {
      const key = getSubKey(prev);
      const match = plan.find((s) => getSubKey(s) === key);
      if (!match) {
        return {
          code: "mutated-executed",
          message: `Executed sub ${key} was removed from plan`,
        };
      }
      if (!match.executed) {
        return {
          code: "mutated-executed",
          message: `Executed sub ${key} was reverted to pending`,
        };
      }
    }
  }

  // ── 3. Player references are present in the current roster ──
  const playerIds = new Set(players.map((p) => p.id));
  for (const sub of plan) {
    if (sub.executed) continue; // executed entries can reference players who later left
    if (!playerIds.has(sub.playerIn.id) || !playerIds.has(sub.playerOut.id)) {
      return {
        code: "orphan-player",
        message: `Sub ${getSubKey(sub)} references a player no longer on the roster`,
      };
    }
  }

  // ── 4. Locked players are never subbed off in remaining entries ──
  if (lockedIds && lockedIds.size > 0) {
    for (const sub of plan) {
      if (sub.executed) continue;
      if (lockedIds.has(sub.playerOut.id)) {
        return {
          code: "locked-player",
          message: `Remaining sub ${getSubKey(sub)} would sub off locked player ${sub.playerOut.id}`,
        };
      }
    }
  }

  return null;
}
