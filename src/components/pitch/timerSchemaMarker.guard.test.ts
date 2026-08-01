import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isServerTimerEligibleTeamId } from "@/lib/serverTimer";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Regression guard for the "pitch board timer resets to 0" defect class.
 *
 * The localStorage marker `schema_version: 2` is the ONLY signal that stops
 * `useActiveGameSync` and `GlobalSubMonitor` from writing the legacy v1 shape
 * (`{ elapsedSeconds, lastUpdateTime }`) over the authoritative server-anchored
 * `active_games.timer_state`. Any writer that drops the marker silently
 * downgrades the board and the next resume / button press hydrates at 00:00.
 */
describe("timer localStorage schema marker", () => {
  it("GameTimer stamps schema_version on every save", () => {
    const src = read("src/components/pitch/GameTimer.tsx");
    const save = src.slice(src.indexOf("const saveTimerState"), src.indexOf("const loadTimerState"));
    expect(save).toMatch(/schema_version:\s*2/);
  });

  it("GameTimerWidget stamps schema_version on every save", () => {
    const src = read("src/components/pitch/GameTimerWidget.tsx");
    const save = src.slice(src.indexOf("const saveTimerState"), src.indexOf("const serverToTimerState"));
    expect(save).toMatch(/schema_version:\s*2/);
    // The stamped object — not the raw argument — must be what gets persisted.
    expect(save).not.toMatch(/setItem\(ACTIVE_TIMER_KEY,\s*JSON\.stringify\(state\)\)/);
  });

  it("both legacy DB syncs still gate on the marker", () => {
    for (const p of ["src/hooks/useActiveGameSync.ts", "src/components/pitch/GlobalSubMonitor.tsx"]) {
      expect(read(p)).toMatch(/schema_version\?\s*:\s*number.*\|\s*null\)\?\.schema_version === 2/s);
    }
  });
});

describe("pitch-timer-event previous-state resolution", () => {
  const src = read("supabase/functions/pitch-timer-event/index.ts");

  it("does not trust a naive schema_version check for prev state", () => {
    expect(src).not.toMatch(/existing\?\.timer_state\?\.schema_version === 2/);
    expect(src).toMatch(/isServerAnchored\(existing\?\.timer_state\)/);
  });

  it("migrates a legacy/clobbered row instead of zeroing the clock", () => {
    expect(src).toMatch(/function fromLegacyTimerState/);
    expect(src).toMatch(/fromLegacyTimerState\(existing\?\.timer_state, initialMinutes\) \?\? emptyTimer/);
  });

  it("validates the full anchored shape server-side", () => {
    const fn = src.slice(src.indexOf("function isServerAnchored"), src.indexOf("function fromLegacyTimerState"));
    expect(fn).toMatch(/half_started_at/);
    expect(fn).toMatch(/last_event_at/);
    expect(fn).toMatch(/minutes_per_half/);
  });
});

describe("isServerTimerEligibleTeamId", () => {
  it("allows real team uuids and the personal (null) board", () => {
    expect(isServerTimerEligibleTeamId(null)).toBe(true);
    expect(isServerTimerEligibleTeamId("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
  });

  it("rejects synthetic event-group board ids that can never match a uuid column", () => {
    expect(isServerTimerEligibleTeamId("event-group-3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(false);
    expect(isServerTimerEligibleTeamId("not-a-uuid")).toBe(false);
  });
});
