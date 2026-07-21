import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { user: { id: "admin-1" } as null | { id: string } },
  results: new Map<string, Array<{ data?: any; error?: any; count?: number | null }>>(),
  queries: [] as Array<{ table: string; chain: any }>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("react-router-dom", () => ({
  Navigate: ({ to, replace }: any) => <div data-testid="redirect" data-to={to} data-replace={replace} />,
}));

import NotificationPreferencesPage from "./NotificationPreferencesPage";

function tableQuery(table: string) {
  const result = mocks.results.get(table)?.shift() ?? { data: [], error: null };
  const chain: any = { count: result.count ?? null };
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  Object.defineProperty(chain, "then", {
    value: (resolve: any) => Promise.resolve(result).then(resolve),
  });
  mocks.queries.push({ table, chain });
  return chain;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

function adminAccess(isAdmin = true) {
  mocks.results.set("user_roles", [{ data: isAdmin ? { role: "app_admin" } : null, error: null }]);
}

function reportData(overrides: {
  total?: number;
  profiles?: any[];
  push?: any[];
  preferences?: any[];
} = {}) {
  const profiles = overrides.profiles ?? [
    { id: "user-1", display_name: "Alex" },
    { id: "user-2", display_name: "Blair" },
  ];
  const push = overrides.push ?? [];
  const preferences = overrides.preferences ?? [];
  mocks.results.set("profiles", [
    { data: null, count: overrides.total ?? profiles.length, error: null },
    { data: profiles, error: null },
  ]);
  mocks.results.set("push_subscriptions", [
    { data: push, error: null },
    { data: push, error: null },
  ]);
  mocks.results.set("notification_preferences", [
    { data: preferences, error: null },
    { data: preferences, error: null },
  ]);
}

describe("NotificationPreferencesPage admin reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results.clear();
    mocks.queries.length = 0;
    mocks.auth.user = { id: "admin-1" };
    mocks.from.mockImplementation(tableQuery);
  });

  it("redirects a signed-out visitor without querying user notification data", async () => {
    mocks.auth.user = null;
    render(<NotificationPreferencesPage />, { wrapper });

    expect(await screen.findByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("redirects a non-admin before loading sensitive reports", async () => {
    adminAccess(false);
    render(<NotificationPreferencesPage />, { wrapper });

    expect(await screen.findByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith("user_roles");
    expect(mocks.from).not.toHaveBeenCalledWith("profiles");
    expect(mocks.from).not.toHaveBeenCalledWith("push_subscriptions");
    expect(mocks.from).not.toHaveBeenCalledWith("notification_preferences");
  });

  it("fails closed when the app-admin lookup errors", async () => {
    mocks.results.set("user_roles", [{ data: null, error: { message: "role lookup denied" } }]);
    render(<NotificationPreferencesPage />, { wrapper });

    expect(await screen.findByTestId("redirect")).toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalledWith("profiles");
  });

  it("scopes the app-admin check to the current user and exact role", async () => {
    adminAccess(false);
    render(<NotificationPreferencesPage />, { wrapper });
    await screen.findByTestId("redirect");

    const roleQuery = mocks.queries.find(query => query.table === "user_roles")!.chain;
    expect(roleQuery.eq).toHaveBeenCalledWith("user_id", "admin-1");
    expect(roleQuery.eq).toHaveBeenCalledWith("role", "app_admin");
    expect(roleQuery.single).toHaveBeenCalledOnce();
  });

  it("counts unique users with push rather than device subscriptions", async () => {
    adminAccess();
    reportData({
      total: 3,
      push: [
        { user_id: "user-1", platform: "ios" },
        { user_id: "user-1", platform: "web" },
        { user_id: "user-2", platform: "android" },
      ],
    });
    render(<NotificationPreferencesPage />, { wrapper });

    await waitFor(() => expect(screen.getByText("Push Enabled").previousElementSibling).toHaveTextContent("2"));
    expect(screen.getByText("Total Users").previousElementSibling).toHaveTextContent("3");
  });

  it("deduplicates platforms shown for an individual user", async () => {
    adminAccess();
    reportData({
      push: [
        { user_id: "user-1", platform: "ios" },
        { user_id: "user-1", platform: "ios" },
        { user_id: "user-1", platform: "web" },
      ],
    });
    render(<NotificationPreferencesPage />, { wrapper });

    expect(await screen.findByText("ios, web")).toBeInTheDocument();
    expect(screen.queryByText("ios, ios, web")).not.toBeInTheDocument();
  });

  it("defaults missing preference records to enabled", async () => {
    adminAccess();
    reportData({ profiles: [{ id: "user-1", display_name: "Alex" }] });
    render(<NotificationPreferencesPage />, { wrapper });

    await screen.findByText("Alex");
    const row = screen.getByText("Alex").closest("tr")!;
    expect(row).toHaveTextContent("Off"); // no registered push device
    expect(row.querySelectorAll("[class*='bg-primary/10']").length).toBeGreaterThanOrEqual(2);
  });

  it("honours explicit disabled push preferences", async () => {
    adminAccess();
    reportData({
      profiles: [{ id: "user-1", display_name: "Alex" }],
      push: [{ user_id: "user-1", platform: "ios" }],
      preferences: [{
        user_id: "user-1",
        messages_enabled: false,
        events_enabled: false,
        media_enabled: false,
        pitch_board_enabled: false,
      }],
    });
    render(<NotificationPreferencesPage />, { wrapper });

    await screen.findByText("Alex");
    const row = screen.getByText("Alex").closest("tr")!;
    expect(row).toHaveTextContent("ios");
    expect(row.textContent?.match(/Off/g)).toHaveLength(2);
  });

  it("must count disabled email users uniquely and ignore orphan preference rows", async () => {
    adminAccess();
    reportData({
      total: 2,
      preferences: [
        { user_id: "user-1", email_messages_enabled: false },
        { user_id: "user-1", email_messages_enabled: false },
        { user_id: "deleted-user", email_messages_enabled: false },
      ],
    });
    render(<NotificationPreferencesPage />, { wrapper });

    await waitFor(() => expect(
      screen.getByText("Email Enabled").previousElementSibling?.textContent,
    ).toBe("1"));
  });
});
