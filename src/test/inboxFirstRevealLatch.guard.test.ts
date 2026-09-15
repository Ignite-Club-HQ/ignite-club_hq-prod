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
const revealPolicy = readFileSync(
  path.resolve(__dirname, "../features/messaging/inbox/inboxRevealPolicy.ts"),
  "utf8",
);

describe("inbox first-reveal latch", () => {
  it("declares an explicit per-mount reveal latch", () => {
    expect(messages).toMatch(/hasRevealedStableInboxRef/);
    expect(messages).toMatch(/hasRevealedStableInbox/);
  });

  it("gates the skeleton on the latch, not on raw fetching state", () => {
    expect(messages).toMatch(/resolveInboxRevealPolicy/);
    expect(messages).toMatch(/hasRevealedStableInbox: hasRevealedStableInboxRef\.current/);
    expect(revealPolicy).toMatch(/!input\.hasRevealedStableInbox && initialRevealBlocked/);
  });

  it("keeps ordering readiness separate from the permanent render decision", () => {
    expect(messages).toMatch(/isLoadingFreshData,\s*\n\s*initialRevealBlocked/);
    expect(revealPolicy).toMatch(/const freshSortDataReady =/);
    expect(revealPolicy).toMatch(/const initialRevealBlocked =/);
    expect(revealPolicy).toMatch(/isLoadingFreshData \|\| !freshSortDataReady/);
  });

  it("never blocks a warm re-entry reveal (session latch, not a cache bypass)", () => {
    expect(messages).toMatch(/let sessionRevealedInboxUserId: string \| null = null;/);
    // Warm re-entry is released by the session-scoped latch. The cached-data
    // bypass must NOT appear in the first-reveal gate itself: cached rows carry
    // stale ordering timestamps, and releasing on them produced the Android
    // reload/resume stale-order jolt.
    const gate = revealPolicy.slice(
      revealPolicy.indexOf("const initialRevealBlocked ="),
      revealPolicy.indexOf("const showSkeletonLoading ="),
    );
    expect(gate).not.toMatch(/!hasCachedData/);
    expect(gate).not.toMatch(/!hasAnyDisplayData/);
    // The cache is still consulted for the *loading* half of the gate, so a
    // cached inbox never waits on query loading state.
    expect(revealPolicy).toMatch(/!input\.hasAnyDisplayData && !input\.hasCachedData/);
  });


  it("latches once and only resets on an identity change", () => {
    expect(messages).toMatch(/revealLatchIdentityRef/);
    expect(messages).toMatch(/hasRevealedStableInboxRef\.current = true/);
  });

  it("still shows the offline cached inbox immediately", () => {
    expect(revealPolicy).toMatch(/input\.isOnline && !input\.hasRevealedStableInbox/);
  });
});
