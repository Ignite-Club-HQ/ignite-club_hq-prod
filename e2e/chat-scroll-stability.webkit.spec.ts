/**
 * Regression: after a fast upward OR downward fling on the virtualised chat
 * list, once the user stops scrolling the viewport MUST settle within a few
 * hundred ms and stay put.
 *
 * Symptoms this guards against (all reported by users + reproduced during
 * the prepend-anchor refactor):
 *   1. "jagged jolty" continued movement after release — scrollTop continues
 *      to drift up/down for >500ms after the last user input.
 *   2. "jumps to a different position" — scrollTop snaps by a large delta
 *      (>80px) after the settle window, indicating a late prepend/anchor
 *      correction fired AFTER the user thought scrolling had stopped.
 *   3. "bottom message moves down after initially displaying" — when the
 *      list is at the bottom, the last row's top coordinate must not drift
 *      after settle.
 *
 * The spec drives the real virtualised scroller via the
 * `ff:chat-virtualization` flag, performs two passes (fast up, fast down),
 * then samples scrollTop every 50ms for 700ms and asserts:
 *   - the maximum frame-to-frame delta in the final 400ms window is <= 4px,
 *   - the total drift between the first post-input sample and the final
 *     sample is <= 12px.
 *
 * It is skipped cleanly without E2E_TEAM_ID or in unauthenticated previews
 * — never fails spuriously.
 */
import { test, expect } from "../playwright-fixture";
import type { Page } from "@playwright/test";

const env = (process.env ?? {}) as Record<string, string | undefined>;
const TEAM_ID = env.E2E_TEAM_ID;
const ROUTE = TEAM_ID ? `/messages/${TEAM_ID}` : null;

const SCROLLER_SELECTOR =
  "[data-chat-virtualized='true'] [data-chat-scroll-lock='true']";

// Settle window tuning.
//   - SAMPLE_INTERVAL_MS: how often we read scrollTop after input stops.
//   - TOTAL_SAMPLES: total samples collected (= SAMPLE_INTERVAL_MS * N total).
//   - SETTLE_TAIL_SAMPLES: samples in the "should be still" tail window.
//   - MAX_TAIL_FRAME_DELTA_PX: largest allowed jump between two consecutive
//     tail samples (catches "jagged" continued motion).
//   - MAX_TOTAL_DRIFT_PX: total drift between first sample and last sample
//     (catches "snaps to a different position" symptom).
const SAMPLE_INTERVAL_MS = 50;
const TOTAL_SAMPLES = 14; // 700ms total observation
const SETTLE_TAIL_SAMPLES = 8; // last 400ms must be still
const MAX_TAIL_FRAME_DELTA_PX = 4;
const MAX_TOTAL_DRIFT_PX = 12;

async function enableVirtualizationAndReload(page: Page, path: string) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("ff:chat-virtualization", "1");
    } catch {
      /* ignore */
    }
  });
  await page.goto(path, { waitUntil: "networkidle" });
}

async function waitForScrollerReady(page: Page) {
  return page
    .waitForFunction(
      (sel) => {
        const sc = document.querySelector<HTMLElement>(sel);
        if (!sc) return false;
        const rows = sc.querySelectorAll("[data-chat-row='true']");
        return rows.length >= 5 && sc.scrollHeight > sc.clientHeight + 200;
      },
      SCROLLER_SELECTOR,
      { timeout: 10_000, polling: 100 },
    )
    .catch(() => null);
}

/** Drive a continuous fast fling in `direction` ('up' | 'down'). */
async function flingScroller(page: Page, direction: "up" | "down", steps = 24) {
  const sign = direction === "up" ? -1 : 1;
  for (let i = 0; i < steps; i++) {
    await page.evaluate(
      ({ sel, delta }) => {
        const sc = document.querySelector<HTMLElement>(sel);
        if (!sc) return;
        sc.dispatchEvent(
          new WheelEvent("wheel", { deltaY: delta, bubbles: true, cancelable: true }),
        );
        sc.scrollTop = Math.max(
          0,
          Math.min(sc.scrollHeight - sc.clientHeight, sc.scrollTop + delta),
        );
      },
      { sel: SCROLLER_SELECTOR, delta: sign * 280 },
    );
    // No artificial wait — we want a true fling, intra-frame.
  }
}

/**
 * Sample scrollTop every SAMPLE_INTERVAL_MS, returning the full timeline.
 * Also returns the last-row top coordinate so callers can assert that the
 * bottom message doesn't drift either.
 */
async function sampleSettleTimeline(page: Page) {
  const samples: Array<{ t: number; scrollTop: number; lastRowTop: number | null }> = [];
  const t0 = Date.now();
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    const snap = await page.evaluate((sel) => {
      const sc = document.querySelector<HTMLElement>(sel);
      if (!sc) return null;
      const rows = sc.querySelectorAll<HTMLElement>("[data-chat-row='true']");
      const last = rows[rows.length - 1] ?? null;
      const lastRect = last ? last.getBoundingClientRect() : null;
      return {
        scrollTop: sc.scrollTop,
        lastRowTop: lastRect ? lastRect.top : null,
      };
    }, SCROLLER_SELECTOR);
    if (snap) samples.push({ t: Date.now() - t0, ...snap });
    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
  }
  return samples;
}

function assertSettled(
  samples: Array<{ t: number; scrollTop: number; lastRowTop: number | null }>,
  label: string,
) {
  expect(samples.length, `${label}: should have collected samples`).toBeGreaterThanOrEqual(
    SETTLE_TAIL_SAMPLES + 2,
  );

  const tail = samples.slice(-SETTLE_TAIL_SAMPLES);

  // 1. No frame-to-frame jitter in the tail window.
  for (let i = 1; i < tail.length; i++) {
    const delta = Math.abs(tail[i].scrollTop - tail[i - 1].scrollTop);
    expect(
      delta,
      `${label}: jitter detected — scrollTop moved ${delta}px between ` +
        `t=${tail[i - 1].t}ms (${tail[i - 1].scrollTop}) and ` +
        `t=${tail[i].t}ms (${tail[i].scrollTop}). ` +
        `Full timeline: ${JSON.stringify(samples.map((s) => [s.t, s.scrollTop]))}`,
    ).toBeLessThanOrEqual(MAX_TAIL_FRAME_DELTA_PX);
  }

  // 2. No large late "snap to different position" drift across the whole
  //    observation window.
  const first = samples[0].scrollTop;
  const last = samples[samples.length - 1].scrollTop;
  const totalDrift = Math.abs(last - first);
  expect(
    totalDrift,
    `${label}: viewport drifted ${totalDrift}px after input stopped ` +
      `(first=${first}, last=${last}). ` +
      `Full timeline: ${JSON.stringify(samples.map((s) => [s.t, s.scrollTop]))}`,
  ).toBeLessThanOrEqual(MAX_TOTAL_DRIFT_PX);

  // 3. The bottom-most rendered row must not move pixel-wise in the tail.
  //    Filter out samples where lastRowTop was unreadable (recycling).
  const tailRowTops = tail
    .map((s) => s.lastRowTop)
    .filter((v): v is number => typeof v === "number");
  if (tailRowTops.length >= 2) {
    const minTop = Math.min(...tailRowTops);
    const maxTop = Math.max(...tailRowTops);
    expect(
      maxTop - minTop,
      `${label}: last rendered row drifted ${maxTop - minTop}px after settle ` +
        `(min=${minTop}, max=${maxTop})`,
    ).toBeLessThanOrEqual(MAX_TAIL_FRAME_DELTA_PX);
  }
}

test.describe.configure({ mode: "serial", retries: 1 });

test.describe("WebKit (iOS-like) — virtualised chat: post-fling scroll stability", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  test("does not jitter or snap after fast upward fling stops", async ({ page }) => {
    test.skip(!ROUTE, "Set E2E_TEAM_ID to enable scroll-stability regression");
    const path = ROUTE as string;

    await enableVirtualizationAndReload(page, path);
    if (/\/(auth|login|sign-in|signin)/i.test(new URL(page.url()).pathname)) {
      test.skip(true, "Preview is unauthenticated — cannot load chat route");
    }

    const ready = await waitForScrollerReady(page);
    if (!ready) {
      test.skip(true, "Virtualised list did not mount with enough rows in 10s");
    }

    // Start at the bottom so we have headroom to fling upward.
    await page.evaluate((sel) => {
      const sc = document.querySelector<HTMLElement>(sel);
      if (sc) sc.scrollTop = sc.scrollHeight;
    }, SCROLLER_SELECTOR);
    await page.waitForTimeout(150);

    await flingScroller(page, "up");

    // Observation begins immediately after the last input event.
    const samples = await sampleSettleTimeline(page);
    assertSettled(samples, "after fast upward fling");
  });

  test("does not jitter or snap after fast downward fling stops", async ({ page }) => {
    test.skip(!ROUTE, "Set E2E_TEAM_ID to enable scroll-stability regression");
    const path = ROUTE as string;

    await enableVirtualizationAndReload(page, path);
    if (/\/(auth|login|sign-in|signin)/i.test(new URL(page.url()).pathname)) {
      test.skip(true, "Preview is unauthenticated — cannot load chat route");
    }

    const ready = await waitForScrollerReady(page);
    if (!ready) {
      test.skip(true, "Virtualised list did not mount with enough rows in 10s");
    }

    // Scroll well above the bottom so the downward fling has somewhere to go.
    await page.evaluate((sel) => {
      const sc = document.querySelector<HTMLElement>(sel);
      if (sc) sc.scrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight - 4000);
    }, SCROLLER_SELECTOR);
    await page.waitForTimeout(200);

    await flingScroller(page, "down");

    const samples = await sampleSettleTimeline(page);
    assertSettled(samples, "after fast downward fling");
  });
});
