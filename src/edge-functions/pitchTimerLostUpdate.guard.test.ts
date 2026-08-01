import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Deep-audit finding (pitch-board clock resets to 00:00):
 *
 * Both server-side writers of `active_games.timer_state` performed an
 * unguarded read-modify-write. Because each write stamps a FRESH
 * `last_event_at`, the loser of a race republishes an already-superseded
 * anchor (typically `half_started_at: null`) with a NEWER timestamp — which
 * the client guards (`shouldAcceptServerSnapshot`) then correctly accept,
 * resetting a live board to zero.
 *
 * Every write must therefore be a compare-and-swap on the snapshot it was
 * derived from. These assertions are structural on purpose: the failure mode
 * is invisible in normal single-writer testing and only reappears if someone
 * deletes the CAS filter.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("pitch timer writers must compare-and-swap on last_event_at", () => {
  it("pitch-timer-event guards its update and retries against the winner", () => {
    const src = read("supabase/functions/pitch-timer-event/index.ts");
    expect(src).toContain('filter("timer_state->>last_event_at", "eq"');
    // Legacy/empty previous state may only win while no v2 marker exists.
    expect(src).toContain('is("timer_state->>schema_version", null)');
    // Must re-apply the event to the winner's state rather than blindly retry.
    expect(src).toContain("applyEvent(attemptPrev, event, payload)");
    // Must report the committed state, not the first attempt's.
    expect(src).toContain("timer_state: attemptNext");
  });

  it("check-pending-subs guards both the halftime and full-time timer writes", () => {
    const src = read("supabase/functions/check-pending-subs/index.ts");
    const casCount = src.split("filter('timer_state->>last_event_at', 'eq'").length - 1;
    expect(casCount).toBeGreaterThanOrEqual(2);
    // The is_active notification lock must stay unconditional (it is the
    // dedup claim); only the timer publish is CAS'd.
    expect(src).toContain(".update({ is_active: false })");
  });

  it("no server writer updates timer_state with only an id predicate", () => {
    for (const p of [
      "supabase/functions/pitch-timer-event/index.ts",
      "supabase/functions/check-pending-subs/index.ts",
    ]) {
      const src = read(p);
      // `.update({ timer_state: ... }).eq('id', x)` with nothing else is the
      // exact shape of the lost-update defect.
      expect(/update\(\{\s*timer_state[\s\S]{0,120}?\}\)\s*\.eq\((['"])id\1[^)]*\)\s*;/.test(src)).toBe(false);
    }
  });
});
