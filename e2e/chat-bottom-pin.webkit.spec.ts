/**
 * iOS-like (WebKit) regression: every chat page should open pinned to the
 * bottom of its scroll viewport and STAY there after late-loading images
 * (avatars, attachments) finish decoding — i.e. no upward jolt.
 *
 * Run via Playwright with the WebKit project, which best approximates
 * iOS Safari / Capacitor WKWebView behavior.
 *
 * The test:
 *   1. Navigates to each chat route.
 *   2. Waits for the chat scroll viewport to mount (the element with the
 *      `[data-radix-scroll-area-viewport]` attribute used across all
 *      chat pages, falling back to a generic `[data-chat-viewport]`).
 *   3. Records scrollTop immediately after the viewport stabilises.
 *   4. Forces all pending images inside the viewport to decode and waits.
 *   5. Asserts scrollTop is still at the bottom (within 2px).
 *
 * If the route requires auth and the preview is logged out, the spec
 * skips with a clear message — it does not fail spuriously.
 */
import { test, expect } from "../playwright-fixture";
import type { Page } from "@playwright/test";

const CHAT_ROUTES: Array<{ name: string; path: string }> = [
  { name: "broadcast", path: "/messages/broadcast" },
  { name: "team", path: "/messages" },
  { name: "club-admin-list", path: "/messages" },
];

async function findChatViewport(page: Page) {
  // All chat pages render a Radix ScrollArea viewport. Some also tag a
  // generic [data-chat-viewport] for direct discovery.
  const candidates = [
    "[data-chat-viewport]",
    "[data-radix-scroll-area-viewport]",
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.count()) return el;
  }
  return null;
}

async function waitForImagesAndMeasure(page: Page) {
  return page.evaluate(async () => {
    const vp =
      document.querySelector<HTMLElement>("[data-chat-viewport]") ??
      document.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!vp) return null;

    const images = Array.from(vp.querySelectorAll("img"));
    await Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalHeight > 0) {
              resolve();
              return;
            }
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            // Cap the wait so a stalled signed-URL doesn't hang the test.
            setTimeout(done, 1500);
          }),
      ),
    );

    // Allow the layout to settle after image decode.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 100));

    return {
      scrollTop: vp.scrollTop,
      scrollHeight: vp.scrollHeight,
      clientHeight: vp.clientHeight,
      maxScrollTop: Math.max(0, vp.scrollHeight - vp.clientHeight),
    };
  });
}

test.describe("WebKit (iOS-like) — chat opens at bottom with no jolt", () => {
  test.use({
    // 375x812 ≈ iPhone X. WebKit project is configured at the
    // playwright config layer; this just sizes the viewport.
    viewport: { width: 375, height: 812 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  for (const route of CHAT_ROUTES) {
    test(`${route.name} (${route.path}) lands at bottom after images load`, async ({
      page,
    }) => {
      await page.goto(route.path, { waitUntil: "networkidle" });

      // If the app redirected us to an auth page, skip — we cannot exercise
      // chat scrolling without a logged-in session.
      if (/\/(auth|login|sign-in|signin)/i.test(new URL(page.url()).pathname)) {
        test.skip(true, "Preview is unauthenticated — cannot load chat route");
      }

      const viewport = await findChatViewport(page);
      if (!viewport) {
        test.skip(true, "No chat viewport mounted on this route in this state");
      }

      // Give the initial-pin sequence and image-wait gate a moment to run.
      await page.waitForTimeout(800);

      const before = await waitForImagesAndMeasure(page);
      expect(before, "viewport metrics should be readable").not.toBeNull();
      if (!before) return;

      // Re-measure once more after a second image-settle pass to catch
      // any post-reveal hydration that might shift content upward.
      await page.waitForTimeout(400);
      const after = await waitForImagesAndMeasure(page);
      expect(after).not.toBeNull();
      if (!after) return;

      const distanceFromBottom = after.maxScrollTop - after.scrollTop;
      expect(
        distanceFromBottom,
        `Chat at ${route.path} drifted ${distanceFromBottom}px above bottom after images loaded ` +
          `(scrollTop=${after.scrollTop}, max=${after.maxScrollTop}). This is the iOS first-install jolt regression.`,
      ).toBeLessThanOrEqual(2);

      // Sanity: scroll position must not have moved upward between the two
      // measurements (that's exactly what the user perceives as "jolt").
      const upwardDrift = before.scrollTop - after.scrollTop;
      expect(
        upwardDrift,
        `Chat scrollTop drifted upward by ${upwardDrift}px between settle passes`,
      ).toBeLessThanOrEqual(2);
    });
  }
});
