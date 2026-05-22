/**
 * Auto-sub plan events.
 *
 * Discriminated union covering every legal way the auto-sub plan can change.
 * Dispatched into `autoSubReducer`. NEVER mutate plan state outside the
 * reducer — always dispatch one of these events.
 */
import type { SubstitutionEvent } from "../types";

export type ReplaceReason = "regenerate" | "repair" | "injury" | "edit-dialog";

export type PlanEvent =
  | { type: "START"; plan: SubstitutionEvent[] }
  | { type: "CANCEL" }
  | { type: "PAUSE_TOGGLE" }
  | { type: "EXECUTE"; subKey: string }
  | { type: "CONFIRM_BATCH"; subKeys: string[] }
  | { type: "SKIP"; subKey: string }
  | {
      type: "REPLACE_REMAINING";
      remaining: SubstitutionEvent[];
      reason: ReplaceReason;
    }
  | { type: "LOCK_TOGGLE"; playerId: string }
  | { type: "TICK"; elapsed: number; half: 1 | 2 };

export type PlanErrorCode =
  | "orphan-player"
  | "locked-player"
  | "invalid-position"
  | "cooldown"
  | "no-such-sub"
  | "duplicate-sub"
  | "mutated-executed";

export interface PlanError {
  code: PlanErrorCode;
  message: string;
}
