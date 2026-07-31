/**
 * Guards the Messages inbox first-reveal latch.
 *
 * The initial ordering gate (which depends on `isFetching`) must apply only
 * before the first settled reveal. After the inbox has painted, ordinary
 * background/Realtime refetches must never bring the full-page skeleton back
 * or unmount conversation rows.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const messages = readFileSync(
  path.resolve(__dirname, "../pages/MessagesPage.tsx"),
  "utf8",
);

describe("inbox first-reveal latch", () => {
  it("declares an explicit per-mount reveal latch", () => {
    expect(messages).toMatch(/hasRevealedStableInboxRef/);
    expect(messages).toMatch(/hasRevealedStableInbox/);
  });

  it("gates the skeleton on the latch, not on raw fetching state", () => {
    expect(messages).toMatch(
      /const showSkeletonLoading = isOnline && !hasRevealedStableInboxRef\.current && initialRevealBlocked/,
    );
  });

  it("keeps ordering readiness separate from the permanent render decision", () => {
    expect(messages).toMatch(/const freshSortDataReady = !isOnline \|\|/);
    expect(messages).toMatch(
      /const initialRevealBlocked = isOnline && \(isLoadingFreshData \|\| !freshSortDataReady\)/,
    );
  });

  it("latches once and only resets on an identity change", () => {
    expect(messages).toMatch(/revealLatchIdentityRef/);
    expect(messages).toMatch(/hasRevealedStableInboxRef\.current = true/);
  });

  it("still shows the offline cached inbox immediately", () => {
    expect(messages).toMatch(/const showSkeletonLoading = isOnline &&/);
  });
});
