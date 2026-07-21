import { describe, expect, it } from "vitest";
import { buildEqualTimePlan, type EqualTimePlayer } from "./equalTime";

const player = (id: string, onPitch: boolean): EqualTimePlayer => ({
  id,
  name: `Player ${id}`,
  position: onPitch ? { x: 50, y: 50 } : null,
  currentPitchPosition: onPitch ? "MID" : undefined,
});

const squad = (playerCount: number, teamSize: number) =>
  Array.from({ length: playerCount }, (_, index) =>
    player(String(index + 1), index < teamSize),
  );

describe("buildEqualTimePlan fairness", () => {
  it("reaches equal playing time when a perfectly equal allocation is achievable", () => {
    const chunkSec = 30;
    const result = buildEqualTimePlan({
      players: squad(5, 4),
      teamSize: 4,
      halfDurationSec: 20 * 60,
      chunkSec,
      minShiftSec: 2 * 60,
      noSubAfterSec: 30,
    });

    expect(result.perfectFloorSec).toBe(0);
    expect(result.spreadSec).toBeLessThanOrEqual(chunkSec);
    expect(result.maxDeviationSec).toBeLessThanOrEqual(chunkSec);

    const projected = [...result.projectedSec.values()];
    expect(projected).toHaveLength(5);
    expect(projected.reduce((total, seconds) => total + seconds, 0)).toBe(
      4 * 40 * 60,
    );
  });

  it.each([
    { players: 7, teamSize: 5, halfMinutes: 25 },
    { players: 9, teamSize: 7, halfMinutes: 30 },
    { players: 11, teamSize: 9, halfMinutes: 35 },
  ])(
    "keeps a $players-player squad within one rotation chunk of the mathematical optimum",
    ({ players, teamSize, halfMinutes }) => {
      const chunkSec = 30;
      const result = buildEqualTimePlan({
        players: squad(players, teamSize),
        teamSize,
        halfDurationSec: halfMinutes * 60,
        chunkSec,
        minShiftSec: 2 * 60,
        noSubAfterSec: 30,
      });

      // Equality is quantised by the planner's substitution interval. The
      // achieved max-to-min spread should therefore be no more than one
      // chunk above the theoretical integer-second floor.
      expect(result.spreadSec).toBeLessThanOrEqual(
        result.perfectFloorSec + chunkSec,
      );

      const projected = [...result.projectedSec.values()];
      expect(Math.min(...projected)).toBeGreaterThan(0);
      expect(projected.reduce((total, seconds) => total + seconds, 0)).toBe(
        teamSize * halfMinutes * 2 * 60,
      );
    },
  );
});
