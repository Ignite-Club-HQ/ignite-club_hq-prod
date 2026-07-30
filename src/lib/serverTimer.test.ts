import { describe, expect, it, vi } from "vitest";
import {
  computeClockSkewMs,
  deriveElapsedSeconds,
  type ServerTimer,
} from "./serverTimer";

const START = Date.UTC(2026, 6, 25, 9, 0, 0);

const timer = (overrides: Partial<ServerTimer> = {}): ServerTimer => ({
  schema_version: 2,
  current_half: 1,
  minutes_per_half: 40,
  half_started_at: new Date(START).toISOString(),
  half_paused_at: null,
  accumulated_pause_ms: 0,
  is_running: true,
  is_game_finished: false,
  half_ended_at: null,
  last_event_at: new Date(START).toISOString(),
  ...overrides,
});

describe("server-anchored pitch timer arithmetic", () => {
  it("derives elapsed time from timestamps instead of interval count", () => {
    expect(deriveElapsedSeconds(timer(), START + 16 * 60 * 1000)).toBe(16 * 60);
  });

  it("uses the pause timestamp so elapsed time cannot advance while locked and paused", () => {
    const pausedAt = START + 16 * 60 * 1000;
    expect(deriveElapsedSeconds(timer({
      is_running: false,
      half_paused_at: new Date(pausedAt).toISOString(),
    }), START + 60 * 60 * 1000)).toBe(16 * 60);
  });

  it("subtracts accumulated pauses across repeated lock and resume cycles", () => {
    expect(deriveElapsedSeconds(timer({
      accumulated_pause_ms: 7 * 60 * 1000,
    }), START + 23 * 60 * 1000)).toBe(16 * 60);
  });

  it("clamps impossible negative elapsed time to zero", () => {
    expect(deriveElapsedSeconds(timer({
      accumulated_pause_ms: 20 * 60 * 1000,
    }), START + 10 * 60 * 1000)).toBe(0);
  });

  it("clamps an overdue running timer to the configured half duration", () => {
    expect(deriveElapsedSeconds(timer(), START + 90 * 60 * 1000)).toBe(40 * 60);
  });

  it("returns zero when the half has not been started", () => {
    expect(deriveElapsedSeconds(timer({ half_started_at: null }), START + 1000)).toBe(0);
    expect(deriveElapsedSeconds(null, START + 1000)).toBe(0);
  });

  it("supports a second-half timer independently of first-half duration", () => {
    expect(deriveElapsedSeconds(timer({
      current_half: 2,
      half_started_at: new Date(START + 45 * 60 * 1000).toISOString(),
    }), START + 61 * 60 * 1000)).toBe(16 * 60);
  });

  it("computes positive and negative device clock skew", () => {
    vi.spyOn(Date, "now").mockReturnValue(START);
    expect(computeClockSkewMs(new Date(START + 90_000).toISOString())).toBe(90_000);
    expect(computeClockSkewMs(new Date(START - 45_000).toISOString())).toBe(-45_000);
  });

  it("never mutates the timer snapshot while deriving elapsed time", () => {
    const value = timer({ accumulated_pause_ms: 15_000 });
    const before = structuredClone(value);
    deriveElapsedSeconds(value, START + 60_000);
    expect(value).toEqual(before);
  });
});
