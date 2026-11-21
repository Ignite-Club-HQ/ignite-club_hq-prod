import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { acceptLegacyClubInvite } from "./legacyClubInvite";
const expected = { clubId: "966bdaec-ebf1-46da-b2b3-cc53bf05c422", role: "parent" };
beforeEach(() => { rpc.mockReset(); });
describe("legacy club acceptance receipt", () => {
 it.each([false,true])("confirms only the exact club and role (already joined: %s)", async already_member => { rpc.mockResolvedValue({ data: { club_id: expected.clubId, role: "parent", already_member }, error: null }); await expect(acceptLegacyClubInvite("bearer-token",expected)).resolves.toEqual({ ...expected, alreadyMember: already_member }); expect(rpc).toHaveBeenCalledExactlyOnceWith("accept_legacy_club_invite",{_token:"bearer-token"}); });
 it.each([{club_id:"other",role:"parent",already_member:false},{club_id:expected.clubId,role:"app_admin",already_member:false},{club_id:expected.clubId,role:"parent",already_member:"false"},null])("does not confirm a mismatched receipt %#", async data => { rpc.mockResolvedValue({data,error:null}); await expect(acceptLegacyClubInvite("token",expected)).rejects.toThrow(); expect(rpc).toHaveBeenCalledTimes(1); });
 it("never repeats an uncertain acceptance", async () => { rpc.mockRejectedValue(new Error("connection lost")); await expect(acceptLegacyClubInvite("token",expected)).rejects.toThrow(); expect(rpc).toHaveBeenCalledTimes(1); });
});