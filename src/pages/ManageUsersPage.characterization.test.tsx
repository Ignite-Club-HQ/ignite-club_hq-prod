import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  invoke: vi.fn(),
  from: vi.fn(),
  toast: vi.fn(),
  invalidateRolesCache: vi.fn(),
  releaseDelete: null as null | (() => void),
  writes: [] as Array<{ table: string; operation: string; payload?: any; filters: any[] }>,
  writeError: null as null | { table: string; operation: string; message: string },
  profiles: [
    { id: "admin-1", display_name: "Current Admin", avatar_url: null, scheduled_deletion_at: null },
    { id: "member-1", display_name: "Synthetic Member", avatar_url: null, scheduled_deletion_at: null },
  ],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    rpc: vi.fn(),
    functions: { invoke: mocks.invoke },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/rolesCache", () => ({ invalidateRolesCache: mocks.invalidateRolesCache }));
vi.mock("@/lib/pointsHistory", () => ({ recordPointsHistory: vi.fn() }));
vi.mock("@/components/GenerateDemoDataButton", () => ({ GenerateDemoDataButton: () => null }));
vi.mock("@/components/admin/UserAnalyticsTab", () => ({ default: () => null }));

import ManageUsersPage from "./ManageUsersPage";

function queryFor(table: string) {
  const filters: Array<[string, ...any[]]> = [];
  const query: any = {};
  let operation = "read";
  for (const method of ["select", "order", "limit"]) query[method] = vi.fn(() => query);
  for (const method of ["eq", "in", "ilike"]) {
    query[method] = vi.fn((...args: any[]) => {
      filters.push([method, ...args]);
      return query;
    });
  }
  query.maybeSingle = vi.fn(() => query);
  query.insert = vi.fn((payload: any) => {
    operation = "insert";
    mocks.writes.push({ table, operation, payload, filters });
    return query;
  });
  query.update = vi.fn(() => query);
  query.delete = vi.fn(() => {
    operation = "delete";
    mocks.writes.push({ table, operation, filters });
    return query;
  });
  Object.defineProperty(query, "then", {
    value: (resolve: any, reject: any) => {
      const isAdminCheck = table === "user_roles"
        && filters.some(([, column, value]) => column === "user_id" && value === "admin-1")
        && filters.some(([, column, value]) => column === "role" && value === "app_admin");
      let data: any = [];
      if (isAdminCheck) data = mocks.isAdmin ? { id: "admin-role" } : null;
      else if (table === "clubs") data = [{ id: "club-1", name: "Synthetic Club" }];
      else if (table === "teams") data = [{ id: "team-1", name: "Synthetic Team", club_id: "club-1" }];
      else if (table === "profiles" && filters.some(([method]) => method === "ilike")) data = mocks.profiles;
      else if (table === "user_roles" && filters.some(([method, column]) => method === "in" && column === "user_id")) {
        data = [{ id: "player-role", user_id: "member-1", role: "player", club_id: "club-1", team_id: "team-1", clubs: { name: "Synthetic Club" }, teams: { name: "Synthetic Team" } }];
      }
      const configuredError = mocks.writeError?.table === table && mocks.writeError.operation === operation
        ? { message: mocks.writeError.message }
        : null;
      return Promise.resolve({ data, error: configuredError }).then(resolve, reject);
    },
  });
  return query;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  render(<ManageUsersPage />, { wrapper });
  return { invalidate };
}

async function findSyntheticMember() {
  await screen.findByRole("heading", { name: "User Management" });
  fireEvent.change(screen.getByPlaceholderText("Search users by name..."), { target: { value: "Synthetic" } });
  await screen.findByText("Synthetic Member");
}

async function openDeleteDialog() {
  await findSyntheticMember();
  const memberCard = screen.getByText("Synthetic Member").closest("div.flex-1")?.parentElement;
  const buttons = memberCard?.querySelectorAll("button");
  if (!buttons?.length) throw new Error("Synthetic member actions were not rendered");
  fireEvent.click(buttons[buttons.length - 1]);
  await screen.findByText(/delete the account for/i);
}

async function selectSyntheticMember() {
  await findSyntheticMember();
  const memberCard = screen.getByText("Synthetic Member").closest("div.flex-1")?.parentElement;
  const checkbox = memberCard?.querySelector('[role="checkbox"]');
  if (!(checkbox instanceof HTMLElement)) throw new Error("Synthetic member checkbox was not rendered");
  fireEvent.click(checkbox);
  await screen.findByText("1 selected");
}

describe("ManageUsersPage characterization — privileged membership removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdmin = true;
    mocks.profiles = [
      { id: "admin-1", display_name: "Current Admin", avatar_url: null, scheduled_deletion_at: null },
      { id: "member-1", display_name: "Synthetic Member", avatar_url: null, scheduled_deletion_at: null },
    ];
    mocks.from.mockImplementation(queryFor);
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
    mocks.releaseDelete = null;
    mocks.writes = [];
    mocks.writeError = null;
  });

  it("denies the page to a user without the app_admin role", async () => {
    mocks.isAdmin = false;
    renderPage();
    expect(await screen.findByRole("heading", { name: "Access Denied" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "User Management" })).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalledWith("profiles");
  });

  it("excludes the current administrator from user search results", async () => {
    renderPage();
    await findSyntheticMember();
    expect(screen.queryByText("Current Admin")).not.toBeInTheDocument();
  });

  it("requires typed confirmation and sends the exact scheduled-deletion request", async () => {
    const { invalidate } = renderPage();
    await openDeleteDialog();
    const action = screen.getByRole("button", { name: "Schedule Deletion" });
    expect(action).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Type 'delete' to confirm"), { target: { value: "DELETE" } });
    expect(action).toBeEnabled();
    fireEvent.click(action);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("admin-delete-account", {
      body: { userId: "member-1", immediate: false, gdprRequest: false },
    }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["search-users-manage"] }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Account scheduled for deletion" }));
  });

  it("uses explicit irreversible flags for a confirmed GDPR deletion", async () => {
    renderPage();
    await openDeleteDialog();
    fireEvent.click(screen.getByText("🔒 GDPR Data Request"));
    fireEvent.change(screen.getByPlaceholderText("Type 'GDPR DELETE' to confirm"), { target: { value: "GDPR DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "GDPR Delete All Data" }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("admin-delete-account", {
      body: { userId: "member-1", immediate: true, gdprRequest: true },
    }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "GDPR data deletion complete" }));
  });

  it("does not report or cache a deletion when the Edge Function rejects it", async () => {
    mocks.invoke.mockResolvedValue({ data: { error: "permission denied" }, error: null });
    const { invalidate } = renderPage();
    await openDeleteDialog();
    fireEvent.change(screen.getByPlaceholderText("Type 'delete' to confirm"), { target: { value: "delete" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule Deletion" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Failed to delete account",
      description: "permission denied",
      variant: "destructive",
    })));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["search-users-manage"] });
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Account scheduled for deletion" }));
  });

  it("cancels deletion without invoking the privileged Edge Function", async () => {
    renderPage();
    await openDeleteDialog();
    fireEvent.change(screen.getByPlaceholderText("Type 'delete' to confirm"), { target: { value: "delete" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText(/delete the account for/i)).not.toBeInTheDocument());
    expect(mocks.invoke).not.toHaveBeenCalledWith("admin-delete-account", expect.anything());
  });

  it("requires the stronger phrase and sends exact flags for immediate deletion", async () => {
    renderPage();
    await openDeleteDialog();
    fireEvent.click(screen.getByRole("radio", { name: /Delete immediately/ }));

    const action = screen.getByRole("button", { name: "Delete Permanently" });
    fireEvent.change(screen.getByPlaceholderText("Type 'DELETE PERMANENTLY' to confirm"), { target: { value: "delete" } });
    expect(action).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Type 'DELETE PERMANENTLY' to confirm"), { target: { value: "DELETE PERMANENTLY" } });
    fireEvent.click(action);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("admin-delete-account", {
      body: { userId: "member-1", immediate: true, gdprRequest: false },
    }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Account permanently deleted" }));
  });

  it("prevents duplicate destructive requests while deletion is pending", async () => {
    mocks.invoke.mockImplementation(() => new Promise(resolve => {
      mocks.releaseDelete = () => resolve({ data: { success: true }, error: null });
    }));
    renderPage();
    await openDeleteDialog();
    fireEvent.change(screen.getByPlaceholderText("Type 'delete' to confirm"), { target: { value: "delete" } });
    const action = screen.getByRole("button", { name: "Schedule Deletion" });
    fireEvent.click(action);

    await waitFor(() => expect(action).toBeDisabled());
    fireEvent.click(action);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    await act(async () => mocks.releaseDelete?.());
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Account scheduled for deletion" })));
  });

  it("keeps the confirmation open and permits retry after a transport failure", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Edge Function unavailable"));
    renderPage();
    await openDeleteDialog();
    fireEvent.change(screen.getByPlaceholderText("Type 'delete' to confirm"), { target: { value: "delete" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule Deletion" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Failed to delete account",
      description: "Edge Function unavailable",
      variant: "destructive",
    })));
    expect(screen.getByText(/delete the account for/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule Deletion" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Schedule Deletion" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Account scheduled for deletion" })));
  });
});

describe("ManageUsersPage characterization — scoped bulk role operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    mocks.isAdmin = true;
    mocks.profiles = [
      { id: "admin-1", display_name: "Current Admin", avatar_url: null, scheduled_deletion_at: null },
      { id: "member-1", display_name: "Synthetic Member", avatar_url: null, scheduled_deletion_at: null },
    ];
    mocks.from.mockImplementation(queryFor);
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
    mocks.writes = [];
    mocks.writeError = null;
  });

  it("requires both club and team before continuing with a team-scoped role", async () => {
    renderPage();
    await selectSyntheticMember();
    fireEvent.click(screen.getByRole("button", { name: "Assign Role" }));
    fireEvent.click(screen.getByText("Select a role").closest("button")!);
    fireEvent.click(await screen.findByRole("option", { name: "Coach (requires team)" }));

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByText("Select a club").closest("button")!);
    fireEvent.click(await screen.findByRole("option", { name: "Synthetic Club" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByText("Select a team").closest("button")!);
    fireEvent.click(await screen.findByRole("option", { name: "Synthetic Team" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(mocks.writes).toEqual([]);
  });

  it("assigns a global role with null scope and sends one matching notification", async () => {
    const { invalidate } = renderPage();
    await selectSyntheticMember();
    fireEvent.click(screen.getByRole("button", { name: "Assign Role" }));
    fireEvent.click(screen.getByText("Select a role").closest("button")!);
    fireEvent.click(await screen.findByRole("option", { name: "App Admin (global)" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Assignment" }));

    await waitFor(() => expect(mocks.writes.filter(write => write.table === "user_roles" && write.operation === "insert")).toHaveLength(1));
    expect(mocks.writes.find(write => write.table === "user_roles")?.payload).toEqual([{
      user_id: "member-1", role: "app_admin", club_id: null, team_id: null,
    }]);
    expect(mocks.writes.find(write => write.table === "notifications")?.payload).toEqual([expect.objectContaining({
      user_id: "member-1", type: "membership", message: "You have been assigned the app admin role",
    })]);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["search-users-manage"] }));
    expect(mocks.invalidateRolesCache).toHaveBeenCalledTimes(1);
  });

  it("does not notify, invalidate or report success when role assignment is denied", async () => {
    mocks.writeError = { table: "user_roles", operation: "insert", message: "RLS denied role assignment" };
    const { invalidate } = renderPage();
    await selectSyntheticMember();
    fireEvent.click(screen.getByRole("button", { name: "Assign Role" }));
    fireEvent.click(screen.getByText("Select a role").closest("button")!);
    fireEvent.click(await screen.findByRole("option", { name: "Basic User (global)" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Assignment" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Failed to assign roles",
      description: "RLS denied role assignment",
      variant: "destructive",
    })));
    expect(mocks.writes.some(write => write.table === "notifications")).toBe(false);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["search-users-manage"] });
    expect(mocks.invalidateRolesCache).not.toHaveBeenCalled();
  });

  it("removes only the selected role within its exact club and team scope", async () => {
    renderPage();
    await selectSyntheticMember();
    fireEvent.click(screen.getByRole("button", { name: "Remove Role" }));
    const matchingRoles = await screen.findAllByText(/player.*Synthetic Team/i);
    fireEvent.click(matchingRoles[matchingRoles.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Removal" }));

    await waitFor(() => expect(mocks.writes.filter(write => write.table === "user_roles" && write.operation === "delete")).toHaveLength(1));
    const removal = mocks.writes.find(write => write.table === "user_roles" && write.operation === "delete")!;
    expect(removal.filters).toEqual(expect.arrayContaining([
      ["in", "user_id", ["member-1"]],
      ["eq", "role", "player"],
      ["eq", "club_id", "club-1"],
      ["eq", "team_id", "team-1"],
    ]));
    expect(mocks.writes.find(write => write.table === "notifications")?.payload).toEqual([expect.objectContaining({
      user_id: "member-1", message: "Your player role has been removed",
    })]);
  });
});
