import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  reset: vi.fn(),
  needsRevalidation: vi.fn(),
  needsRenewal: vi.fn(),
  permissionRevoked: vi.fn(),
  markRenewed: vi.fn(),
  verifyHealth: vi.fn(),
  cleanup: vi.fn(),
  handleRevoked: vi.fn(),
  resilientSubscribe: vi.fn(),
  logPush: vi.fn(),
}));

vi.mock("@/lib/pushNotifications", () => ({
  subscribeToPushNotifications: mocks.subscribe,
  checkPushSubscription: vi.fn(),
  resetPushNotifications: mocks.reset,
}));
vi.mock("@/lib/pushReliability", () => ({
  logPush: mocks.logPush,
  generateCorrelationId: () => "correlation-1",
  needsRevalidation: mocks.needsRevalidation,
  needsIOSProactiveRenewal: mocks.needsRenewal,
  markSubscriptionValidated: vi.fn(),
  markSubscriptionRenewed: mocks.markRenewed,
  checkServiceWorkerUpdate: vi.fn().mockResolvedValue(false),
  activateWaitingServiceWorker: vi.fn(),
  permissionWasRevoked: mocks.permissionRevoked,
  getPlatformInfo: () => ({ platform: "web", reliabilityRating: "high" }),
}));
vi.mock("@/lib/pushSubscriptionSync", () => ({
  verifySubscriptionHealth: mocks.verifyHealth,
  cleanupStaleSubscriptions: mocks.cleanup,
  handlePermissionRevoked: mocks.handleRevoked,
  processOfflineQueue: vi.fn(),
  resilientSubscribe: mocks.resilientSubscribe,
}));

import { usePushSubscriptionHealth } from "./usePushSubscriptionHealth";

describe("usePushSubscriptionHealth recovery decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needsRevalidation.mockReturnValue(true);
    mocks.needsRenewal.mockReturnValue(false);
    mocks.permissionRevoked.mockReturnValue(false);
    mocks.verifyHealth.mockResolvedValue({
      healthy: true,
      reason: null,
      dbHasSubscription: true,
      endpointsMatch: true,
    });
    mocks.resilientSubscribe.mockResolvedValue({ success: true, queued: false });
    mocks.subscribe.mockResolvedValue({ success: true });
    mocks.reset.mockResolvedValue(undefined);
    mocks.cleanup.mockResolvedValue(undefined);
    mocks.handleRevoked.mockResolvedValue(undefined);
  });

  it("does nothing without a user identity", async () => {
    const { result } = renderHook(() => usePushSubscriptionHealth(undefined));

    await expect(result.current.validateSubscription()).resolves.toBe(false);
    await expect(result.current.validateAndResubscribe()).resolves.toBe(false);
    expect(mocks.verifyHealth).not.toHaveBeenCalled();
    expect(mocks.resilientSubscribe).not.toHaveBeenCalled();
  });

  it("returns healthy without resetting or resubscribing", async () => {
    const { result } = renderHook(() => usePushSubscriptionHealth("user-1"));

    await expect(result.current.validateSubscription()).resolves.toBe(true);
    expect(mocks.verifyHealth).toHaveBeenCalledWith("user-1");
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.resilientSubscribe).not.toHaveBeenCalled();
  });

  it("cleans server-side state immediately when device permission was revoked", async () => {
    mocks.permissionRevoked.mockReturnValue(true);
    const { result } = renderHook(() => usePushSubscriptionHealth("user-1"));

    await expect(result.current.validateSubscription()).resolves.toBe(false);
    expect(mocks.handleRevoked).toHaveBeenCalledWith("user-1");
    expect(mocks.verifyHealth).not.toHaveBeenCalled();
    expect(mocks.resilientSubscribe).not.toHaveBeenCalled();
  });

  it("cleans stale endpoints before resilient resubscription", async () => {
    mocks.verifyHealth.mockResolvedValue({
      healthy: false,
      reason: "endpoint mismatch",
      dbHasSubscription: true,
      endpointsMatch: false,
    });
    const { result } = renderHook(() => usePushSubscriptionHealth("user-1"));

    await expect(result.current.validateSubscription()).resolves.toBe(true);
    expect(mocks.cleanup).toHaveBeenCalledWith("user-1");
    expect(mocks.resilientSubscribe).toHaveBeenCalledWith(
      "user-1",
      expect.any(Function),
    );
    expect(mocks.cleanup.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resilientSubscribe.mock.invocationCallOrder[0],
    );
  });

  it("prevents overlapping validation attempts for the same hook instance", async () => {
    let release!: (value: any) => void;
    mocks.verifyHealth.mockReturnValue(
      new Promise((resolve) => { release = resolve; }),
    );
    const { result } = renderHook(() => usePushSubscriptionHealth("user-1"));

    let first!: Promise<boolean>;
    act(() => { first = result.current.validateSubscription(); });
    await vi.waitFor(() => expect(mocks.verifyHealth).toHaveBeenCalledOnce());
    await expect(result.current.validateSubscription()).resolves.toBe(false);

    release({ healthy: true, reason: null, dbHasSubscription: true, endpointsMatch: true });
    await expect(first).resolves.toBe(true);
    expect(mocks.verifyHealth).toHaveBeenCalledOnce();
  });

  it("performs proactive renewal and records success for an iOS-style expiry", async () => {
    mocks.needsRenewal.mockReturnValue(true);
    const { result } = renderHook(() => usePushSubscriptionHealth("user-1"));

    await expect(result.current.validateSubscription()).resolves.toBe(true);
    expect(mocks.reset).toHaveBeenCalledWith("user-1", false);
    expect(mocks.subscribe).toHaveBeenCalledWith("user-1", true);
    expect(mocks.markRenewed).toHaveBeenCalledOnce();
    expect(mocks.verifyHealth).not.toHaveBeenCalled();
  });

  it("manual resubscription returns only the resilient operation's success state", async () => {
    mocks.resilientSubscribe.mockResolvedValue({ success: false, queued: true });
    const { result } = renderHook(() => usePushSubscriptionHealth("user-1"));

    await expect(result.current.validateAndResubscribe()).resolves.toBe(false);
    expect(mocks.resilientSubscribe).toHaveBeenCalledWith(
      "user-1",
      mocks.subscribe,
    );
  });
});
