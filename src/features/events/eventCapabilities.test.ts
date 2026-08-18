import { describe, expect, it } from "vitest";
import { resolveEventCapabilities } from "@/features/events/eventCapabilities";

describe("event capability policy", () => {
  it.each([
    ["scoped event manager", { isEventManager: true }, true, true],
    ["app-admin override", { isAppAdmin: true }, true, true],
    ["exact-event Subs Manager", { isSubsManagerForEvent: true }, false, true],
    ["ordinary attendee", {}, false, false],
  ] as const)("resolves %s", (_label, input, canManageEvent, canOperateMatch) => {
    expect(resolveEventCapabilities(input)).toEqual({ canManageEvent, canOperateMatch });
  });

  it("does not give a Subs Manager full event administration", () => {
    const result = resolveEventCapabilities({ isSubsManagerForEvent: true });
    expect(result.canOperateMatch).toBe(true);
    expect(result.canManageEvent).toBe(false);
  });

  it("fails closed while role queries remain unresolved", () => {
    expect(resolveEventCapabilities({
      isEventManager: undefined,
      isAppAdmin: null,
      isSubsManagerForEvent: undefined,
    })).toEqual({ canManageEvent: false, canOperateMatch: false });
  });
});
