import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ icp: false, queries: [] as any[], from: vi.fn(), rpc: vi.fn() }));
vi.mock("@tanstack/react-query", async original => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: (options: any) => { state.queries.push(options); return { data: undefined }; },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "paul" }, initialized: true }) }));
vi.mock("@/hooks/useClubTheme", () => ({ useClubTheme: () => ({ activeClubFilter: "club-1", activeClubTeamIds: [] }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => state.icp }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: state.from, rpc: state.rpc } }));
import { DesktopMessagesRail } from "./DesktopMessagesRail";
beforeEach(() => { vi.clearAllMocks(); state.icp = false; state.queries = []; });
afterEach(cleanup);
describe("queued desktop inbox reads during secure sign-in restoration", () => {
  it.each(["desktop-rail-dms", "desktop-rail-groups", "desktop-rail-teams", "desktop-rail-clubs", "desktop-rail-club-scope"])(
    "retires %s before legacy storage access", async key => {
      render(<DesktopMessagesRail />);
      state.icp = true;
      const options = state.queries.find(q => q.queryKey[0] === key);
      expect(options).toBeDefined();
      await expect(options.queryFn()).rejects.toThrow("Your sign-in changed");
      expect(state.from).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
    },
  );
});