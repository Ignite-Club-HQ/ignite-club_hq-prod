import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const latency = read("../frontend/src/lib/homeOpenLatency.ts");
const stages = read("../frontend/src/lib/perfStages.ts");
const home = read("../frontend/src/pages/HomePage.tsx");

test("home logs >60s samples instead of discarding them", () => {
  assert.match(latency, /export const HOME_LONG_OPEN_MS = 60_000/);
  assert.match(latency, /export const HOME_MAX_RECORDED_MS = 600_000/);
  assert.match(latency, /Math\.min\(durationMs, HOME_MAX_RECORDED_MS\)/);
  assert.match(latency, /outlier: durationMs > HOME_LONG_OPEN_MS/);
  assert.doesNotMatch(latency, /if\s*\(tap_to_paint_ms > 60_000\)\s*return/);
  assert.match(latency, /"home_open_outlier"/);
  assert.match(latency, /outlier: duration\.outlier, capped: duration\.capped/);
});
test("home can record missing-data timeout without claiming first paint", () => {
  assert.match(stages, /"home_shell_paint"/);
  assert.match(stages, /"home_first_paint"/);
  assert.match(stages, /"home_data_timeout"/);
  assert.match(stages, /stage === "carousel_loaded" \|\| stage === "home_data_timeout"/);
  assert.match(home, /requestAnimationFrame\(\(\) => markStage\("home_shell_paint"\)\)/);
  assert.match(home, /if \(!initialized \|\| !user\?\.id \|\| membershipAndEvents\) return/);
  assert.match(home, /markStage\("home_data_timeout"\)/);
  assert.match(home, /void logHomeDataTimeout\(homeOpenStartRef\.current\)/);
  assert.match(home, /}, HOME_LONG_OPEN_MS\)/);
  assert.match(home, /markStage\("home_first_paint"\)/);
  assert.match(latency, /"home_data_timeout", "membership"/);
  assert.doesNotMatch(latency.slice(latency.indexOf("export async function logHomeDataTimeout")), /coldMark\("home_first_paint"\)/);
});
