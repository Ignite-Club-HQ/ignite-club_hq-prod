import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

const mocks = vi.hoisted(() => ({
  auth: {
    user: null as any,
    profile: null as any,
    loading: false,
    profileLoading: false,
    profileError: null as any,
    initialized: true,
    profileResolved: true,
    refreshProfile: vi.fn(),
  },
  isNative: false,
  isThemeReady: true,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({ isThemeReady: mocks.isThemeReady }),
}));
vi.mock("@/hooks/useChatRouteOverscrollLock", () => ({
  useChatRouteOverscrollLock: vi.fn(),
}));
vi.mock("@/hooks/useUserPresence", () => ({ useTrackPresence: vi.fn() }));
vi.mock("@/hooks/useAdMob", () => ({ useAdMobInit: vi.fn() }));
vi.mock("@/hooks/useActivityTracking", () => ({ useActivityTracking: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.isNative },
}));
vi.mock("@/lib/coldStartMarks", () => ({ mark: vi.fn() }));
vi.mock("@/assets/ignite-icon.png", () => ({ default: "ignite.png" }));

vi.mock("./AppHeader", () => ({ AppHeader: () => <header>header</header> }));
vi.mock("./BottomNav", () => ({ BottomNav: () => <nav>bottom navigation</nav> }));
vi.mock("@/components/OfflineIndicator", () => ({ OfflineIndicator: () => null }));
vi.mock("@/components/SkipToContent", () => ({ SkipToContent: () => null }));
vi.mock("@/components/NativeNotificationPrompt", () => ({
  NativeNotificationPrompt: () => null,
}));
vi.mock("@/components/PendingInviteWelcomeDialog", () => ({
  PendingInviteWelcomeDialog: () => null,
}));

import { AppLayout } from "./AppLayout";

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}

function renderRoute(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/auth" element={<div>authentication page</div>} />
        <Route path="/complete-profile" element={<div>complete profile page</div>} />
        <Route element={<AppLayout />}>
          <Route path="*" element={<div>protected destination</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppLayout routing boundaries", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    Object.assign(mocks.auth, {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      profileError: null,
      initialized: true,
      profileResolved: true,
      refreshProfile: vi.fn(),
    });
    mocks.isNative = false;
    mocks.isThemeReady = true;
  });

  it.each([
    "/events/event-42?tab=attendance#player-7",
    "/messages/club/club-9?thread=latest",
    "/vault/folder/folder-3#document-2",
    "/clubs/club-4/engagement?period=season",
  ])("redirects a signed-out protected entry and preserves its exact internal destination: %s", async (entry) => {
    renderRoute(entry);

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/auth");
    });
    expect(screen.getByText("authentication page")).toBeInTheDocument();
    expect(sessionStorage.getItem("redirectAfterAuth")).toBe(entry);
  });

  it("does not create a return destination for the protected home route", async () => {
    renderRoute("/");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/auth");
    });
    expect(sessionStorage.getItem("redirectAfterAuth")).toBeNull();
  });

  it("renders a direct protected deep link unchanged for an authenticated member", () => {
    mocks.auth.user = { id: "user-1" };
    mocks.auth.profile = { display_name: "Alex Member" };

    renderRoute("/events/event-42?tab=attendance#player-7");

    expect(screen.getByText("protected destination")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/events/event-42?tab=attendance#player-7",
    );
    expect(sessionStorage.getItem("redirectAfterAuth")).toBeNull();
  });

  it("waits for authentication initialization instead of making a premature route decision", () => {
    mocks.auth.initialized = false;

    renderRoute("/events/event-42");

    expect(screen.getByText("Checking authentication...")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/events/event-42");
    expect(sessionStorage.getItem("redirectAfterAuth")).toBeNull();
  });

  it("waits for authenticated profile resolution instead of flashing profile completion", () => {
    mocks.auth.user = { id: "user-1" };
    mocks.auth.profileLoading = true;
    mocks.auth.profileResolved = false;

    renderRoute("/events/event-42");

    expect(screen.getByText("Loading your profile...")).toBeInTheDocument();
    expect(screen.queryByText("complete profile page")).not.toBeInTheDocument();
  });

  it("sends a resolved incomplete profile to profile completion", async () => {
    mocks.auth.user = { id: "user-1" };
    mocks.auth.profile = { display_name: "" };

    renderRoute("/events/event-42");

    await waitFor(() => {
      expect(screen.getByText("complete profile page")).toBeInTheDocument();
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/complete-profile");
  });

  it("sends a pending Google Drive OAuth callback to the vault using replace navigation", async () => {
    mocks.auth.user = { id: "user-1" };
    mocks.auth.profile = { display_name: "Alex Member" };
    sessionStorage.setItem("googleDriveOAuthCode", "synthetic-code");

    renderRoute("/events/event-42");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/vault");
    });
  });

  it.each([
    "/messages",
    "/messages/welcome",
    "/messages/broadcast",
    "/messages/team-7",
    "/messages/club/club-3",
    "/messages/club-admin/conversation-8",
    "/messages/dm/conversation-9",
    "/groups/group-2",
  ])("keeps authenticated messaging routes routable: %s", (entry) => {
    mocks.auth.user = { id: "user-1" };
    mocks.auth.profile = { display_name: "Alex Member" };

    renderRoute(entry);

    expect(screen.getByText("protected destination")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(entry);
  });
});
