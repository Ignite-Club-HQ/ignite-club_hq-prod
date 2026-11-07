import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  mode: "supabase",
  user: { id: "test-member" },
  upsert: vi.fn(async () => ({ error: null })),
  icpWrite: vi.fn(),
  emailChange: undefined as undefined | ((key: string, value: boolean) => void),
}));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => state.mode }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/usePWAInstall", () => ({ usePWAInstall: () => ({}) }));
vi.mock("@/hooks/usePasskey", () => ({ usePasskey: () => ({}) }));
vi.mock("@/hooks/useUserHasAnyAICatchUpClub", () => ({ useUserHasAnyAICatchUpClub: () => ({ hasAICatchUpClub: false }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@/components/DeviceStorageSettings", () => ({ DeviceStorageSettings: () => null }));
vi.mock("@/components/ClubAccessCheckCard", () => ({ ClubAccessCheckCard: () => null }));
vi.mock("@/components/ChangePasswordDialog", () => ({ ChangePasswordDialog: () => null }));
vi.mock("@/components/FeedbackDialog", () => ({ FeedbackDialog: () => null }));
vi.mock("@/components/PasskeyManagementDialog", () => ({ PasskeyManagementDialog: () => null }));
vi.mock("@/components/NotificationPreferenceList", () => ({
  NotificationPreferenceList: ({ descriptors, onChange }: { descriptors: Array<{ key: string }>; onChange: (key: string, value: boolean) => void }) => {
    if (descriptors.some(({ key }) => key.startsWith("email_"))) state.emailChange = onChange;
    return <>{descriptors.map(({ key }) => <input type="checkbox" aria-label={key} key={key} onChange={(event) => onChange(key, event.target.checked)} />)}</>;
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }), single: async () => ({ data: null }), maybeSingle: async () => ({ data: null }) }) }),
    upsert: state.upsert,
  }) },
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: async (_: string, branches: { supabase: () => Promise<unknown>; icp: (ctx: unknown) => Promise<unknown> }) =>
    state.mode === "icp" ? branches.icp({ identity: { getPrincipal: () => ({ toText: () => "test-member" }) } }) : branches.supabase(),
}));
vi.mock("@/live/features/notifications", () => ({
  getLiveNotificationPreferences: async () => ({ messagesEnabled: true, eventsEnabled: true, mediaEnabled: true }),
  upsertLiveNotificationPreferences: state.icpWrite,
}));
import SettingsPage from "./SettingsPage";

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><SettingsPage /></MemoryRouter></QueryClientProvider>);
}

describe("email notification mode availability", () => {
  beforeEach(() => { state.mode = "supabase"; state.emailChange = undefined; vi.clearAllMocks(); });
  it("offers zero email preference controls for ICP and retains push preferences", async () => {
    state.mode = "icp";
    mount();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "messages_enabled" })).toBeInTheDocument());
    expect(screen.queryAllByRole("checkbox", { name: /^email_/ })).toHaveLength(0);
    expect(state.emailChange).toBeUndefined();
  });
  it("retains all six Supabase email categories and the existing column-scoped save", async () => {
    mount();
    expect(screen.getAllByRole("checkbox", { name: /^email_/ })).toHaveLength(6);
    fireEvent.click(screen.getByRole("checkbox", { name: "email_events_enabled" }));
    await waitFor(() => expect(state.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "test-member", email_events_enabled: true }), { onConflict: "user_id" }));
    expect(state.icpWrite).not.toHaveBeenCalled();
  });
  it("blocks a retained email handler after switching to ICP", async () => {
    mount();
    const callback = state.emailChange;
    expect(callback).toBeTypeOf("function");
    state.mode = "icp";
    await act(async () => { callback?.("email_events_enabled", true); });
    expect(state.icpWrite).not.toHaveBeenCalled();
    expect(state.upsert).not.toHaveBeenCalled();
  });
});