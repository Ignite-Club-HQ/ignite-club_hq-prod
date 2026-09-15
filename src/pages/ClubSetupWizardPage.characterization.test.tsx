import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  toast: vi.fn(),
  inserts: [] as Array<{ table: string; payload: any }>,
  existingTeams: [] as any[],
  teamInsertError: null as any,
  roleInsertError: null as any,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/hooks/useClubProAccess", () => ({ useClubProAccess: () => ({ hasPro: false, isLoading: false }) }));
vi.mock("@/components/ClubThemeEditor", () => ({ ClubThemeEditor: () => null }));
vi.mock("@/components/club/MonogramLogoGenerator", () => ({ MonogramLogoGenerator: () => null }));
vi.mock("@/components/SponsorsManager", () => ({ SponsorsManager: () => null }));
vi.mock("@/components/subscription/ProFeatureLock", () => ({ ProFeatureLock: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/invite/TeamJoinLinkCard", () => ({ default: () => null }));
vi.mock("@/lib/inviteEmailDedupe", () => ({ lookupInvitableUserByEmail: vi.fn().mockResolvedValue(null) }));

import ClubSetupWizardPage from "./ClubSetupWizardPage";

function queryFor(table: string) {
  const query: any = {};
  let inserted = false;
  for (const method of ["select", "eq", "is", "order", "update", "upsert"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(() => query);
  query.single = vi.fn(() => query);
  query.insert = vi.fn((payload: any) => {
    inserted = true;
    mocks.inserts.push({ table, payload });
    return query;
  });
  Object.defineProperty(query, "then", {
    value: (resolve: any, reject: any) => {
      let result: any = { data: [], error: null };
      if (table === "clubs") {
        result = { data: { id: "club-1", name: "Synthetic Club", kind: "club", contact_email: null, logo_url: null }, error: null };
      } else if (table === "teams" && !inserted) {
        result = { data: mocks.existingTeams, error: null };
      } else if (table === "teams" && inserted) {
        result = mocks.teamInsertError
          ? { data: null, error: mocks.teamInsertError }
          : { data: { id: "team-created" }, error: null };
      } else if (table === "user_roles" && inserted) {
        result = { data: null, error: mocks.roleInsertError };
      }
      return Promise.resolve(result).then(resolve, reject);
    },
  });
  return query;
}

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/clubs/club-1/setup"]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/clubs/:clubId/setup" element={children} />
          <Route path="/clubs/:clubId" element={<div>Club destination</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
  render(<ClubSetupWizardPage />, { wrapper });
  return { invalidate };
}

describe("ClubSetupWizardPage characterization — multi-step setup boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.inserts = [];
    mocks.existingTeams = [];
    mocks.teamInsertError = null;
    mocks.roleInsertError = null;
    mocks.from.mockImplementation(queryFor);
    mocks.rpc.mockImplementation(async () => ({
      data: mocks.teamInsertError || mocks.roleInsertError ? null : "team-created",
      error: mocks.teamInsertError || mocks.roleInsertError,
    }));
  });

  it("persists an unsaved synthetic draft per club", async () => {
    renderWizard();
    fireEvent.change(await screen.findByPlaceholderText("e.g. U12 Lions"), { target: { value: "U10 Blue" } });
    fireEvent.change(screen.getByPlaceholderText("U12, Div 3, Seniors…"), { target: { value: "U10" } });

    await waitFor(() => expect(JSON.parse(localStorage.getItem("ignite_wizard_draft_club-1") || "{}").teams[0]).toEqual(expect.objectContaining({
      name: "U10 Blue",
      levelAge: "U10",
    })));
  });

  it("skips invitations when continuing without any team", async () => {
    renderWizard();
    fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));
    expect(await screen.findByText("Optional next steps")).toBeInTheDocument();
    expect(mocks.inserts).toEqual([]);
  });

  it("creates the team and creator role with exact scope, then opens team invitations", async () => {
    const { invalidate } = renderWizard();
    fireEvent.change(await screen.findByPlaceholderText("e.g. U12 Lions"), { target: { value: "  U10 Blue  " } });
    fireEvent.change(screen.getByPlaceholderText("U12, Div 3, Seniors…"), { target: { value: " U10 " } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("create_team_with_creator_admin", {
      p_club_id: "club-1",
      p_name: "U10 Blue",
      p_level_age: "U10",
      p_default_rsvp_audience: expect.any(String),
    }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.inserts).toEqual([]);
    expect(await screen.findByText("Invite people to your teams")).toBeInTheDocument();
    expect(screen.getByText("U10 Blue")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["club-teams", "club-1"] });
  });

  it("does not advance or create a role when team creation fails", async () => {
    mocks.teamInsertError = { message: "team insert denied" };
    renderWizard();
    fireEvent.change(await screen.findByPlaceholderText("e.g. U12 Lions"), { target: { value: "Rejected Team" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not create team",
      description: "team insert denied",
      variant: "destructive",
    })));
    expect(screen.getByText("Create your teams")).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.inserts).toEqual([]);
  });

  it("does not treat setup as successful when creator role assignment fails", async () => {
    mocks.roleInsertError = { message: "role insert denied" };
    renderWizard();
    fireEvent.change(await screen.findByPlaceholderText("e.g. U12 Lions"), { target: { value: "Orphan Risk Team" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not create team",
      description: "role insert denied",
      variant: "destructive",
    })));
    expect(screen.getByText("Create your teams")).toBeInTheDocument();
  });

  it("hydrates an existing team and makes its invitation step available", async () => {
    mocks.existingTeams = [{ id: "team-existing", name: "Existing U12", level_age: "U12" }];
    renderWizard();
    expect(await screen.findByDisplayValue("Existing U12")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(await screen.findByText("Invite people to your teams")).toBeInTheDocument();
    expect(mocks.inserts).toEqual([]);
  });
});
