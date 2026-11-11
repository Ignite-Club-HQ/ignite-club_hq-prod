import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: true, user: { id: "admin-1" } as { id: string } | null, native: true, initialize: vi.fn(), queue: vi.fn(), follow: vi.fn(), error: vi.fn(), health: vi.fn(), settings: vi.fn(), save: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/hooks/useIsAppAdmin", () => ({ useIsAppAdmin: () => ({ isAppAdmin: m.admin, isLoading: false }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/lib/nativePush", () => ({ isNativePlatform: () => m.native, initializeNativePush: m.initialize }));
vi.mock("sonner", () => ({ toast: { error: m.error, success: vi.fn(), message: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/live/adminQueueOperations", async importOriginal => ({
  ...await importOriginal<typeof import("@/live/adminQueueOperations")>(),
  queueMyNativeTestAlert: m.queue, followMyNativeTestAlert: m.follow,
}));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: async (_: string, h: { icp: (ctx: unknown) => Promise<unknown> }, scope: { everyGroup?: boolean; merge?: (parts: unknown[]) => unknown }) => { const value = await h.icp({ target: { canisterIds: { notification_queue: "queue-1" } } }); return scope.everyGroup ? scope.merge?.([value]) : value; } }));
vi.mock("@/live/features/notifications", () => ({ getLivePushDeliveryHealth: m.health, getLivePushAlertSettings: m.settings, upsertLivePushAlertSettings: m.save, cleanupLiveStaleDeviceTokens: m.cleanup }));
import Page from "./IcpPushAnalyticsPage";
function open() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); m.admin = true; m.user = { id: "admin-1" }; m.native = true; m.initialize.mockResolvedValue({ success: true }); m.queue.mockResolvedValue("alert-1"); m.follow.mockResolvedValue("Sent to your phone."); m.health.mockResolvedValue({ total24h: 12, pending24h: 3, processing24h: 2, delivered24h: 6, failed24h: 1, deviceTokenCount: 9, generatedAtMs: 10, windowHours: 24 }); m.settings.mockResolvedValue({ failureThresholdPercent: 20, checkWindowHours: 24, minNotifications: 10, cooldownHours: 6, alertsEnabled: true }); m.save.mockResolvedValue({}); m.cleanup.mockResolvedValue(2); });
describe("ICP admin notification actions", () => {
  it("does not fetch admin data for nonadmins", () => { m.admin = false; open(); expect(m.health).not.toHaveBeenCalled(); expect(m.settings).not.toHaveBeenCalled(); });
  it("reads actual queue counts and writes alert settings", async () => {
    open(); await screen.findByText("12"); expect(screen.getByText("6", { selector: "dd" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Failure threshold (%)"), { target: { value: "30" } }); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ failureThresholdPercent: 30 })));
  });
  it("surfaces denied health instead of zero counts", async () => { m.health.mockRejectedValue(new Error("App admin required")); open(); await screen.findByRole("alert"); expect(screen.queryByText("0", { selector: "dd" })).not.toBeInTheDocument(); });
  it("links the current signed-in account before queuing and follows that alert", async () => {
    m.user = { id: "principal:account-a" };
    open();
    fireEvent.click(screen.getByRole("button", { name: "Send test alert to my phone" }));
    await waitFor(() => expect(m.follow).toHaveBeenCalledWith("alert-1"));
    expect(m.initialize).toHaveBeenCalledExactlyOnceWith("principal:account-a");
    expect(m.queue).toHaveBeenCalledTimes(1);
    expect(m.initialize.mock.invocationCallOrder[0]).toBeLessThan(m.queue.mock.invocationCallOrder[0]);
  });
  it("does not link or queue a native alert without a signed-in account", async () => {
    m.user = null;
    open();
    fireEvent.click(screen.getByRole("button", { name: "Send test alert to my phone" }));
    await waitFor(() => expect(m.error).toHaveBeenCalledTimes(1));
    expect(m.initialize).not.toHaveBeenCalled();
    expect(m.queue).not.toHaveBeenCalled();
    expect(m.follow).not.toHaveBeenCalled();
  });
  it("does not queue an alert after phone linking fails", async () => {
    m.initialize.mockResolvedValue({ success: false, error: "Account changed" });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Send test alert to my phone" }));
    await waitFor(() => expect(m.error).toHaveBeenCalledTimes(1));
    expect(m.queue).not.toHaveBeenCalled();
    expect(m.follow).not.toHaveBeenCalled();
  });
  it("does not attempt native registration from a browser", async () => {
    m.native = false;
    open();
    fireEvent.click(screen.getByRole("button", { name: "Send test alert to my phone" }));
    await waitFor(() => expect(m.follow).toHaveBeenCalledWith("alert-1"));
    expect(m.initialize).not.toHaveBeenCalled();
  });
});