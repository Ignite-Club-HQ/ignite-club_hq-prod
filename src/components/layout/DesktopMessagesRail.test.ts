import { describe, expect, it, vi } from "vitest";
import { formatRailActivity } from "./DesktopMessagesRail";

describe("formatRailActivity", () => {
  it("formats a valid conversation timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));

    expect(formatRailActivity("2026-09-04T11:55:00.000Z")).toBe("5 minutes ago");

    vi.useRealTimers();
  });

  it.each([undefined, null, "", "not-a-date"])(
    "renders no relative time for an invalid timestamp (%s)",
    (activityAt) => {
      expect(() => formatRailActivity(activityAt)).not.toThrow();
      expect(formatRailActivity(activityAt)).toBe("");
    },
  );
});
