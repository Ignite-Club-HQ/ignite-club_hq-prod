import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ icp: true, session: vi.fn() }));
vi.mock("@/live/strictIcpTransport", () => ({ strictIcpActive: () => m.icp }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: m.session } } }));
vi.mock("@/lib/refreshSessionOnce", () => ({ refreshSessionOnce: vi.fn() }));
import { requireAccessToken } from "./requireAccessToken";
import { ensureFreshSession } from "./ensureFreshSession";
import { ensureSessionApplied } from "./chatEagerInvalidate";

beforeEach(() => { m.icp = true; m.session.mockReset(); });
describe("email session helpers fail closed in ICP mode", () => {
  it("does not ask Supabase for an account-action token", async () => {
    await expect(requireAccessToken()).rejects.toThrow("email sign-in");
    expect(m.session).not.toHaveBeenCalled();
  });
  it("does not ask Supabase to establish an ICP mutation session", async () => {
    await expect(ensureFreshSession()).rejects.toThrow("email sign-in");
    expect(m.session).not.toHaveBeenCalled();
  });
  it("does not perform chat eager-invalidation email session checks", async () => {
    expect(await ensureSessionApplied()).toBe(false);
    expect(m.session).not.toHaveBeenCalled();
  });
  it("keeps valid email tokens and user IDs unchanged", async () => {
    m.icp = false;
    m.session.mockResolvedValue({ data: { session: { access_token: "synthetic", user: { id: "email-user" }, expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null });
    expect(await requireAccessToken()).toBe("synthetic");
    expect(await ensureFreshSession()).toBe("email-user");
  });
});