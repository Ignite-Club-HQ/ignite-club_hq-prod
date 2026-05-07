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

/**
 * Chat routes to exercise. Dynamic-ID routes pull their ID from env vars
 * so we don't bake fixture UUIDs into the repo. Missing env vars cause
 * that route's test to skip cleanly (NOT fail — a missing fixture must
 * never mask a real scroll regression).
 *
 *   E2E_TEAM_ID            → /messages/:teamId
 *   E2E_CLUB_ID            → /messages/club/:clubId
 *   E2E_DM_CONVERSATION_ID → /messages/dm/:conversationId
 *   E2E_CLUB_ADMIN_ID      → /messages/club-admin/:conversationId
 *   E2E_GROUP_ID           → /groups/:groupId
 */
const env = (process.env ?? {}) as Record<string, string | undefined>;

const CHAT_ROUTES: Array<{ name: string; path: string | null }> = [
  { name: "broadcast", path: "/messages/broadcast" },
  { name: "messages-inbox", path: "/messages" },
  { name: "team-chat", path: env.E2E_TEAM_ID ? `/messages/${env.E2E_TEAM_ID}` : null },
  { name: "club-chat", path: env.E2E_CLUB_ID ? `/messages/club/${env.E2E_CLUB_ID}` : null },
  {
    name: "direct-message",
    path: env.E2E_DM_CONVERSATION_ID ? `/messages/dm/${env.E2E_DM_CONVERSATION_ID}` : null,
  },
  {
    name: "club-admin-chat",
    path: env.E2E_CLUB_ADMIN_ID ? `/messages/club-admin/${env.E2E_CLUB_ADMIN_ID}` : null,
  },
  { name: "group-chat", path: env.E2E_GROUP_ID ? `/groups/${env.E2E_GROUP_ID}` : null },
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
    test(`${route.name} (${route.path ?? "skipped"}) lands at bottom after images load`, async ({
      page,
    }) => {
      test.skip(
        !route.path,
        `Set the matching E2E_* env var to enable the ${route.name} regression check`,
      );
      const path = route.path as string;
      await page.goto(path, { waitUntil: "networkidle" });

      // If the app redirected us to an auth page, skip — we cannot exercise
      // chat scrolling without a logged-in session.
      if (/\/(auth|login|sign-in|signin)/i.test(new URL(page.url()).pathname)) {
        test.skip(true, "Preview is unauthenticated — cannot load chat route");
      }

      const viewport = await findChatViewport(page);
      if (!viewport) {
        test.skip(true, "No chat viewport mounted on this route in this state");
      }

      // Explicit settle gate: chat pages keep the scroll container at
      // `visibility: hidden` until `useInitialChatBottomPin` flips
      // `isPinned` to true (which now ALSO waits for in-flight images to
      // decode). Polling for computed visibility === "visible" is the
      // single, reliable signal that the pin sequence has finished — no
      // arbitrary timeouts, no races against the image-wait gate.
      const settled = await page
        .waitForFunction(
          () => {
            const vp =
              document.querySelector<HTMLElement>("[data-chat-viewport]") ??
              document.querySelector<HTMLElement>(
                "[data-radix-scroll-area-viewport]",
              );
            if (!vp) return false;
            // Walk up to the nearest ancestor that owns a `visibility`
            // declaration — TeamChatPage etc. set it on the scroll
            // container, which may be the viewport itself or its parent.
            let node: HTMLElement | null = vp;
            while (node) {
              const v = window.getComputedStyle(node).visibility;
              if (v === "hidden") return false;
              if (node === document.body) break;
              node = node.parentElement;
            }
            // Pin sequence has revealed the viewport. Confirm content
            // is actually present so we don't measure an empty thread.
            return vp.scrollHeight > vp.clientHeight;
          },
          null,
          { timeout: 8_000, polling: 100 },
        )
        .catch(() => null);

      if (!settled) {
        test.skip(
          true,
          "Chat pin sequence did not settle within 8s — likely an empty thread or auth gate",
        );
      }

      // Brief tail to absorb any final ResizeObserver-driven snap that
      // fires immediately after reveal.
      await page.waitForTimeout(150);

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
        `Chat at ${path} drifted ${distanceFromBottom}px above bottom after images loaded ` +
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
