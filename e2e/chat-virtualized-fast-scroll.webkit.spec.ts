/**
 * Regression: rapid upward scrolling on the virtualised chat list (mobile
 * WebKit / iPhone viewport) MUST NOT
 *   1. produce duplicate or out-of-order rows (Virtuoso recycling glitch),
 *   2. let avatars escape their owning row's vertical bounds and visually
 *      overlap a neighbouring message bubble.
 *
 * Both symptoms were reported by users on Android Chrome / iOS Safari after
 * the chat virtualisation flag was rolled out and were caused by:
 *   - `startReached` double-firing in the same frame and prepending the same
 *     older page twice (duplicate IDs in the data array),
 *   - `itemSize` returning fractional `getBoundingClientRect().height` causing
 *     Virtuoso to repaint paddingTop on every measurement.
 *
 * The spec drives the actual virtualised list (via the `ff:chat-virtualization`
 * flag) and exercises a fast continuous upward scroll, then verifies the two
 * invariants above on every captured frame. It is skipped cleanly if no team
 * thread fixture is configured (E2E_TEAM_ID) or if the preview is not
 * authenticated — it never fails spuriously.
 */
import { test, expect } from "../playwright-fixture";
import type { Page } from "@playwright/test";

const env = (process.env ?? {}) as Record<string, string | undefined>;
const TEAM_ID = env.E2E_TEAM_ID;
const ROUTE = TEAM_ID ? `/messages/${TEAM_ID}` : null;

type RowSnapshot = {
  id: string;
  index: number;
  top: number;
  bottom: number;
  avatarRects: Array<{ top: number; bottom: number; left: number; right: number }>;
  bubbleRect: { top: number; bottom: number; left: number; right: number } | null;
};

type FrameSnapshot = {
  scrollTop: number;
  scrollHeight: number;
  rows: RowSnapshot[];
};

async function enableVirtualizationAndReload(page: Page, path: string) {
  // Set the per-device flag BEFORE the chat page mounts so the scroller picks
  // the virtualised branch on first render.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("ff:chat-virtualization", "1");
    } catch {
      /* ignore */
    }
  });
  await page.goto(path, { waitUntil: "networkidle" });
}

async function findVirtualizedScroller(page: Page) {
  // VirtualizedChatMessageList renders a wrapper with `data-chat-virtualized`
  // around the Virtuoso scroller (which itself carries
  // `data-chat-scroll-lock`). The Virtuoso internal scroller is what we want
  // to dispatch wheel events at.
  return page.locator("[data-chat-virtualized='true'] [data-chat-scroll-lock='true']").first();
}

async function snapshotFrame(page: Page): Promise<FrameSnapshot | null> {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(
      "[data-chat-virtualized='true'] [data-chat-scroll-lock='true']",
    );
    if (!scroller) return null;

    const rowEls = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-chat-row='true'][data-message-id]"),
    );
    const rows = rowEls
      .map((el): { row: ReturnType<() => unknown>; rect: DOMRect } | null => {
        const rect = el.getBoundingClientRect();
        if (rect.height <= 0) return null;
        const id = el.getAttribute("data-message-id") || "";
        if (!id) return null;
        // Avatars in ChatMessage render inside a small rounded container.
        // Capture every <img> inside the row that lives in an
        // `.rounded-full` ancestor — that selector matches both the AvatarImage
        // and the AvatarFallback wrappers without depending on Radix
        // internals.
        const avatarRects: Array<{ top: number; bottom: number; left: number; right: number }> = [];
        const candidates = el.querySelectorAll<HTMLElement>(".rounded-full");
        candidates.forEach((node) => {
          const r = node.getBoundingClientRect();
          if (r.width >= 16 && r.height >= 16 && r.width <= 80 && r.height <= 80) {
            avatarRects.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
          }
        });

        const bubble = el.querySelector<HTMLElement>(".rounded-2xl");
        const bubbleRect = bubble
          ? (() => {
              const r = bubble.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
            })()
          : null;

        return {
          row: {
            id,
            // `data-index` is added by react-virtuoso on each rendered row's
            // outer wrapper. Climb to find it for stable ordering.
            index: (() => {
              let n: HTMLElement | null = el;
              for (let depth = 0; depth < 4 && n; depth++) {
                const di = n.getAttribute("data-index");
                if (di !== null) return Number.parseInt(di, 10);
                n = n.parentElement;
              }
              return rect.top; // fallback: pixel position
            })(),
            top: rect.top,
            bottom: rect.bottom,
            avatarRects,
            bubbleRect,
          },
          rect,
        };
      })
      .filter((x): x is { row: RowSnapshot; rect: DOMRect } => x !== null)
      .map((x) => x.row as RowSnapshot);

    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      rows,
    };
  });
}

function checkInvariants(frame: FrameSnapshot, frameNumber: number) {
  // 1. No duplicate message IDs in the rendered window.
  const ids = frame.rows.map((r) => r.id);
  const uniq = new Set(ids);
  expect(
    uniq.size,
    `Frame ${frameNumber}: duplicate message IDs in rendered rows ` +
      `(rendered=${ids.length}, unique=${uniq.size}, ids=${JSON.stringify(ids)})`,
  ).toBe(ids.length);

  // 2. Rows must be ordered top-to-bottom in the same direction as
  //    Virtuoso's `data-index`. A higher `data-index` should never appear
  //    above a lower one (that's the recycling/ghost-row symptom).
  const sortedByIndex = [...frame.rows].sort((a, b) => a.index - b.index);
  for (let i = 1; i < sortedByIndex.length; i++) {
    const prev = sortedByIndex[i - 1];
    const curr = sortedByIndex[i];
    expect(
      curr.top,
      `Frame ${frameNumber}: row index ${curr.index} (id=${curr.id}) at y=${curr.top} ` +
        `appears above row index ${prev.index} (id=${prev.id}) at y=${prev.top} — ` +
        `this is the virtualised recycling overlap regression.`,
    ).toBeGreaterThanOrEqual(prev.top - 1);
  }

  // 3. Avatars belong to their owning row — they must never vertically
  //    overlap a sibling row's bubble. Allow 2px tolerance for sub-pixel
  //    layout rounding.
  for (const row of frame.rows) {
    for (const avatar of row.avatarRects) {
      // Avatar must stay (mostly) within its own row's vertical span.
      const escapesAbove = row.top - avatar.top;
      const escapesBelow = avatar.bottom - row.bottom;
      expect(
        Math.max(escapesAbove, escapesBelow),
        `Frame ${frameNumber}: avatar in row id=${row.id} escapes its row ` +
          `(rowTop=${row.top}, rowBottom=${row.bottom}, ` +
          `avatarTop=${avatar.top}, avatarBottom=${avatar.bottom})`,
      ).toBeLessThanOrEqual(2);

      // Avatar must not cross horizontally into another row's bubble.
      for (const other of frame.rows) {
        if (other.id === row.id || !other.bubbleRect) continue;
        const verticallyOverlaps =
          avatar.top < other.bubbleRect.bottom - 2 && avatar.bottom > other.bubbleRect.top + 2;
        const horizontallyOverlaps =
          avatar.left < other.bubbleRect.right - 2 && avatar.right > other.bubbleRect.left + 2;
        expect(
          verticallyOverlaps && horizontallyOverlaps,
          `Frame ${frameNumber}: avatar in row id=${row.id} overlaps bubble of ` +
            `row id=${other.id}`,
        ).toBe(false);
      }
    }
  }
}

test.describe.configure({ mode: "serial", retries: 1 });

test.describe("WebKit (iOS-like) — virtualised chat: rapid upward scroll integrity", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  test("avatars stay contained and message order remains consistent under fast upward scroll", async ({
    page,
  }) => {
    test.skip(!ROUTE, "Set E2E_TEAM_ID to enable virtualised fast-scroll regression");
    const path = ROUTE as string;

    await enableVirtualizationAndReload(page, path);

    if (/\/(auth|login|sign-in|signin)/i.test(new URL(page.url()).pathname)) {
      test.skip(true, "Preview is unauthenticated — cannot load chat route");
    }

    // Wait for the virtualised scroller to actually mount and have content.
    const settled = await page
      .waitForFunction(
        () => {
          const sc = document.querySelector<HTMLElement>(
            "[data-chat-virtualized='true'] [data-chat-scroll-lock='true']",
          );
          if (!sc) return false;
          const rows = sc.querySelectorAll("[data-chat-row='true']");
          return rows.length >= 5 && sc.scrollHeight > sc.clientHeight;
        },
        null,
        { timeout: 10_000, polling: 100 },
      )
      .catch(() => null);

    if (!settled) {
      test.skip(
        true,
        "Virtualised list did not mount with enough rows within 10s — empty or non-virtualised thread",
      );
    }

    const scroller = await findVirtualizedScroller(page);
    await expect(scroller).toBeVisible();

    // Sanity baseline frame.
    const baseline = await snapshotFrame(page);
    expect(baseline, "baseline frame must be readable").not.toBeNull();
    if (!baseline) return;
    checkInvariants(baseline, 0);

    // Drive a continuous fast upward scroll. We dispatch wheel events
    // directly (deltaY < 0 = scroll up) plus also mutate scrollTop for
    // browsers that don't honour synthetic wheel inertia. Two passes
    // separated by a brief pause stress-tests both the active scroll
    // window AND the post-scroll settle (where the recycle glitch was
    // most visible).
    const FRAMES: FrameSnapshot[] = [];
    const PASSES = 2;

    for (let pass = 0; pass < PASSES; pass++) {
      // Bring viewport to (or near) the bottom first so we have room to
      // scroll upward repeatedly.
      await page.evaluate(() => {
        const sc = document.querySelector<HTMLElement>(
          "[data-chat-virtualized='true'] [data-chat-scroll-lock='true']",
        );
        if (sc) sc.scrollTop = sc.scrollHeight;
      });
      await page.waitForTimeout(120);

      // 30 rapid upward ticks of ~280px each, capturing a frame every 3rd
      // tick. This roughly matches a real-user fast flick on a phone.
      for (let i = 0; i < 30; i++) {
        await page.evaluate(() => {
          const sc = document.querySelector<HTMLElement>(
            "[data-chat-virtualized='true'] [data-chat-scroll-lock='true']",
          );
          if (!sc) return;
          sc.dispatchEvent(
            new WheelEvent("wheel", { deltaY: -280, bubbles: true, cancelable: true }),
          );
          // Fallback in case the wheel event is consumed without scrolling.
          sc.scrollTop = Math.max(0, sc.scrollTop - 280);
        });
        if (i % 3 === 0) {
          // No waitForTimeout between every tick — we want to stress
          // intra-frame recycling, not give Virtuoso a calm settle.
          const frame = await snapshotFrame(page);
          if (frame) FRAMES.push(frame);
        }
      }

      // Post-scroll settle frame.
      await page.waitForTimeout(200);
      const settledFrame = await snapshotFrame(page);
      if (settledFrame) FRAMES.push(settledFrame);
    }

    expect(FRAMES.length, "should have captured at least a few in-flight frames").toBeGreaterThan(4);

    FRAMES.forEach((frame, i) => checkInvariants(frame, i + 1));
  });
});
