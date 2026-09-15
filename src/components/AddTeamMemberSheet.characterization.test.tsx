import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
  toast: vi.fn(),
  inserts: [] as Array<{ table: string; payload: any }>,
  updates: [] as Array<{ table: string; payload: any }>,
  inviteError: null as any,
  writeErrors: {} as Record<string, any>,
  invitableEmailMatch: null as any,
  deferInvite: false,
  releaseInvite: null as null | (() => void),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/inviteEmailDedupe", () => ({
  lookupInvitableUserByEmail: vi.fn(async () => mocks.invitableEmailMatch),
}));
vi.mock("@/components/invite/TeamJoinLinkCard", () => ({ default: () => <div data-testid="join-link-card" /> }));

import AddTeamMemberSheet from "./AddTeamMemberSheet";

function tableQuery(table: string) {
  const query: any = {};
  const filters: any[] = [];
  for (const method of ["select", "order", "limit", "single", "maybeSingle", "head"]) {
    query[method] = vi.fn(() => query);
  }
  for (const method of ["eq", "neq", "in", "ilike", "is"]) {
    query[method] = vi.fn((...args: any[]) => { filters.push([method, ...args]); return query; });
  }
  query.insert = vi.fn((payload: any) => {
    mocks.inserts.push({ table, payload });
    return query;
  });
  query.update = vi.fn((payload: any) => {
    mocks.updates.push({ table, payload });
    return query;
  });
  Object.defineProperty(query, "then", {
    value: async (resolve: any, reject: any) => {
      if (table === "pending_invites" && mocks.inserts.some(row => row.table === table)) {
        if (mocks.deferInvite) await new Promise<void>(r => { mocks.releaseInvite = r; });
        return Promise.resolve(mocks.inviteError
          ? { data: null, error: mocks.inviteError }
          : { data: { id: "invite-1", short_code: "ABC123" }, error: null, count: 1 }).then(resolve, reject);
      }
      if (mocks.writeErrors[table] && mocks.inserts.some(row => row.table === table)) {
        return Promise.resolve({ data: null, error: mocks.writeErrors[table] }).then(resolve, reject);
      }
      const data = table === "clubs"
        ? { id: "club-1", name: "Synthetic Club", logo_url: null, contact_email: null }
        : [];
      return Promise.resolve({ data, error: null, count: 0 }).then(resolve, reject);
    },
  });
  return query;
}

function renderSheet(teamType: "junior" | "senior" | "mixed" = "senior") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/teams/team-1"]}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  render(
    <AddTeamMemberSheet
      teamId="team-1"
      teamName="Synthetic Team"
      clubId="club-1"
      teamType={teamType}
      canBulkInvite={false}
      externalOpen
      onExternalOpenChange={vi.fn()}
    />,
    { wrapper },
  );
  return { invalidate };
}

function enterNameAndAdvance(name = "New Member") {
  fireEvent.change(screen.getByPlaceholderText("Search by name or email, or enter new"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Next: Choose role" }));
}

function advanceSeniorToDelivery() {
  enterNameAndAdvance();
  fireEvent.click(screen.getByRole("button", { name: "Next: Send" }));
}

function selectEmailDelivery() {
  fireEvent.click(screen.getByRole("button", { name: /Email/ }));
}

describe("AddTeamMemberSheet characterization — membership workflow boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts = [];
    mocks.updates = [];
    mocks.inviteError = null;
    mocks.writeErrors = {};
    mocks.invitableEmailMatch = null;
    mocks.deferInvite = false;
    mocks.releaseInvite = null;
    mocks.from.mockImplementation(tableQuery);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.invoke.mockResolvedValue({ data: { success: true, verified: true }, error: null });
  });

  it("offers Parent but not Adult Player for a junior team", () => {
    renderSheet("junior");
    enterNameAndAdvance();
    expect(screen.getByRole("radio", { name: "Role: Parent" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Role: Adult Player" })).not.toBeInTheDocument();
  });

  it("offers Adult Player but not Parent for a senior team", () => {
    renderSheet("senior");
    enterNameAndAdvance();
    expect(screen.getByRole("radio", { name: "Role: Adult Player" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Role: Parent" })).not.toBeInTheDocument();
  });

  it("prevents advancing without a member identity", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Enter a name to continue" })).toBeDisabled();
    expect(mocks.inserts).toEqual([]);
  });

  it("requires a child name before a parent invitation can continue", () => {
    renderSheet("junior");
    enterNameAndAdvance("Synthetic Parent");
    expect(screen.getByRole("button", { name: "Add a child to continue" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Add at least one child's name to continue.");
  });

  it("requires a valid email when Email delivery is selected", () => {
    renderSheet("senior");
    advanceSeniorToDelivery();
    selectEmailDelivery();
    expect(screen.getByRole("button", { name: "Create Invite" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("e.g., john@example.com"), { target: { value: "not-an-email" } });
    expect(screen.getByRole("button", { name: "Create Invite" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("That email doesn't look right");
  });

  it("creates one pending invite with exact normalized identity and scope", async () => {
    const { invalidate } = renderSheet("senior");
    advanceSeniorToDelivery();
    selectEmailDelivery();
    fireEvent.change(screen.getByPlaceholderText("e.g., john@example.com"), { target: { value: "  MEMBER@EXAMPLE.COM " } });
    fireEvent.click(screen.getByRole("button", { name: "Create Invite" }));

    await waitFor(() => expect(mocks.inserts.filter(row => row.table === "pending_invites")).toHaveLength(1));
    expect(mocks.inserts.find(row => row.table === "pending_invites")?.payload).toEqual(expect.objectContaining({
      team_id: "team-1",
      club_id: "club-1",
      role: "player",
      invited_user_id: null,
      invited_by_user_id: "admin-1",
      invited_label: "New Member",
      invited_email: "member@example.com",
    }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pending-invites", "team-1", null] }));
  });

  it("reports a rejected invite without invalidating successful membership state", async () => {
    mocks.inviteError = { message: "insert denied" };
    const { invalidate } = renderSheet("senior");
    advanceSeniorToDelivery();
    fireEvent.click(screen.getByRole("button", { name: "Share Link" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Invite" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Failed to add member",
      variant: "destructive",
    })));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["pending-invites", "team-1", null] });
  });

  it("disables duplicate submission while pending and inserts exactly once", async () => {
    mocks.deferInvite = true;
    renderSheet("senior");
    advanceSeniorToDelivery();
    fireEvent.click(screen.getByRole("button", { name: "Share Link" }));
    const submit = screen.getByRole("button", { name: "Create Invite" });
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.click(submit);
    expect(mocks.inserts.filter(row => row.table === "pending_invites")).toHaveLength(1);
    await act(async () => {
      mocks.releaseInvite?.();
    });
    await waitFor(() => expect(screen.getByText("Member Added")).toBeInTheDocument());
  });

  it("adds an in-scope existing account directly without creating a duplicate pending invite", async () => {
    mocks.invitableEmailMatch = {
      user_id: "existing-user-1",
      display_name: "Existing Member",
      already_in_team: false,
    };
    const { invalidate } = renderSheet("senior");
    advanceSeniorToDelivery();
    selectEmailDelivery();
    fireEvent.change(screen.getByPlaceholderText("e.g., john@example.com"), {
      target: { value: " Existing@Example.COM " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Invite" }));

    await waitFor(() => expect(mocks.inserts.some(row => row.table === "user_roles")).toBe(true));
    expect(mocks.inserts.filter(row => row.table === "pending_invites")).toEqual([]);
    expect(mocks.inserts.find(row => row.table === "user_roles")?.payload).toEqual({
      user_id: "existing-user-1",
      team_id: "team-1",
      club_id: "club-1",
      role: "player",
    });
    expect(mocks.inserts.find(row => row.table === "notifications")?.payload).toEqual({
      user_id: "existing-user-1",
      type: "membership",
      message: "You have been added to Synthetic Team as Adult Player",
      related_id: "team-1",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["team-roles", "team-1"] }));
  });

  it("rejects an email already belonging to this team without writing a role, invite or notification", async () => {
    mocks.invitableEmailMatch = {
      user_id: "existing-user-1",
      display_name: "Existing Member",
      already_in_team: true,
    };
    renderSheet("senior");
    advanceSeniorToDelivery();
    selectEmailDelivery();
    fireEvent.change(screen.getByPlaceholderText("e.g., john@example.com"), {
      target: { value: "existing@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Invite" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Failed to add member",
      description: "Existing Member is already on this team.",
      variant: "destructive",
    })));
    expect(mocks.inserts).toEqual([]);
  });

  it("stops before notification and success state when direct role assignment is denied", async () => {
    mocks.invitableEmailMatch = {
      user_id: "existing-user-1",
      display_name: "Existing Member",
      already_in_team: false,
    };
    mocks.writeErrors.user_roles = { message: "role insert denied", code: "42501" };
    const { invalidate } = renderSheet("senior");
    advanceSeniorToDelivery();
    selectEmailDelivery();
    fireEvent.change(screen.getByPlaceholderText("e.g., john@example.com"), {
      target: { value: "existing@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Invite" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Failed to add member",
      description: "role insert denied",
      variant: "destructive",
    })));
    expect(mocks.inserts.filter(row => row.table === "notifications")).toEqual([]);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["team-roles", "team-1"] });
  });

  it("reports partial success when a direct role is saved but its membership notification fails", async () => {
    mocks.invitableEmailMatch = {
      user_id: "existing-user-1",
      display_name: "Existing Member",
      already_in_team: false,
    };
    mocks.writeErrors.notifications = { message: "notification insert denied", code: "42501" };
    const { invalidate } = renderSheet("senior");
    advanceSeniorToDelivery();
    selectEmailDelivery();
    fireEvent.change(screen.getByPlaceholderText("e.g., john@example.com"), {
      target: { value: "existing@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Invite" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Member added — notification failed",
      description: expect.stringContaining("notification insert denied"),
      variant: "destructive",
    })));
    expect(mocks.inserts.filter(row => row.table === "user_roles")).toHaveLength(1);
    expect(mocks.inserts.filter(row => row.table === "pending_invites")).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["team-roles", "team-1"] });
  });

  it("preserves a created invite and records delivery failure when the email provider rejects it", async () => {
    mocks.invoke.mockResolvedValue({
      data: { success: false, verified: false, error: "provider unavailable" },
      error: null,
    });
    const { invalidate } = renderSheet("senior");
    advanceSeniorToDelivery();
    selectEmailDelivery();
    fireEvent.change(screen.getByPlaceholderText("e.g., john@example.com"), {
      target: { value: "new.member@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Invite" }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.inserts.filter(row => row.table === "pending_invites")).toHaveLength(1);
    await waitFor(() => expect(mocks.updates).toContainEqual({
      table: "pending_invites",
      payload: expect.objectContaining({
        email_sent_at: null,
        email_id: null,
        email_error: "provider unavailable",
      }),
    }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Member added",
      description: "Could not send email, but invite has been created",
    }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pending-invites", "team-1", null] });
  });
});
