import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: m.rpc } }));
import { removeSupabaseCompetitionRole } from "./removeCompetitionRole";
const row = { id: "role-1", user_id: "self", role: "admin" };
beforeEach(() => m.rpc.mockReset());
describe("exact competition role removal", () => {
  it("binds row, competition, person and role in one server request", async () => {
    m.rpc.mockResolvedValue({ data: true, error: null });
    await removeSupabaseCompetitionRole("cup", row);
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("remove_exact_competition_role", { p_id: "role-1", p_competition_id: "cup", p_user_id: "self", p_role: "admin" });
  });
  it("rejects an unconfirmed deletion", async () => {
    m.rpc.mockResolvedValue({ data: false, error: null });
    await expect(removeSupabaseCompetitionRole("cup", row)).rejects.toThrow("not confirmed");
  });
  it("propagates server authorization failure", async () => {
    m.rpc.mockResolvedValue({ data: null, error: new Error("Owner roles cannot be removed") });
    await expect(removeSupabaseCompetitionRole("cup", row)).rejects.toThrow("Owner roles");
  });
});