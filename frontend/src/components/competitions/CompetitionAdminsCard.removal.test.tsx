import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "self" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => false }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: unknown, handlers: {supabase:()=>unknown}) => handlers.supabase() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: m.from, rpc: m.rpc } }));
vi.mock("./CompetitionAdminInboxCard", () => ({ CompetitionAdminInboxCard: () => null }));
import { CompetitionAdminsCard } from "./CompetitionAdminsCard";
const roles = [{ id: "admin", user_id: "self", role: "admin" }, { id: "owner", user_id: "self", role: "owner" }];
beforeEach(() => {
  vi.clearAllMocks();
  m.from.mockImplementation((table: string) => {
    const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: roles, error: null }), in: async () => ({ data: [{id:"self",display_name:"Test",avatar_url:null}], error:null }) };
    return chain;
  });
});
function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry:false } } });
  render(<QueryClientProvider client={qc}><CompetitionAdminsCard competitionId="cup" competitionName="Cup" organizerClubId="club" /></QueryClientProvider>);
}
it("requires confirmation and only submits the selected non-owner role", async () => {
  m.rpc.mockResolvedValue({data:true,error:null}); open();
  fireEvent.click(await screen.findByRole("button", {name:"Leave"}));
  expect(m.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Leave role"}));
  await waitFor(() => expect(m.rpc).toHaveBeenCalledExactlyOnceWith("remove_exact_competition_role", {p_id:"admin",p_competition_id:"cup",p_user_id:"self",p_role:"admin"}));
});
it("failed removal keeps the row and does not announce success", async () => {
  m.rpc.mockResolvedValue({data:false,error:null}); open();
  fireEvent.click(await screen.findByRole("button", {name:"Leave"}));
  fireEvent.click(screen.getByRole("button", {name:"Leave role"}));
  await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({variant:"destructive"})));
  expect(screen.getByRole("button", {name:"Leave"})).toBeInTheDocument();
  expect(m.toast).not.toHaveBeenCalledWith(expect.objectContaining({title:"Competition role left"}));
});