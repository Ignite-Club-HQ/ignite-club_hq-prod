import { expect, it, vi } from "vitest";
import { ensureIdentityAccount } from "./ensureIdentityAccount";
it("returning accounts use a query and never register", async () => {
  const client = { whoami: vi.fn().mockResolvedValue({ id: "existing" }), registerAccount: vi.fn() };
  await ensureIdentityAccount(client);
  expect(client.whoami).toHaveBeenCalledOnce();
  expect(client.registerAccount).not.toHaveBeenCalled();
});
it("first-time/unlinked accounts use the existing registration contract once", async () => {
  const client = { whoami: vi.fn().mockRejectedValue(Error("Unlinked identity")), registerAccount: vi.fn().mockResolvedValue({}) };
  await ensureIdentityAccount(client);
  expect(client.registerAccount).toHaveBeenCalledOnce();
});
it.each(["Identity revoked; surviving-account relink required", "Account erased", "Account removal pending", "Stale principal account index", "Network unavailable"])("never registers after %s", async reason => {
  const client = { whoami: vi.fn().mockRejectedValue(Error(reason)), registerAccount: vi.fn() };
  await expect(ensureIdentityAccount(client)).rejects.toThrow(reason);
  expect(client.registerAccount).not.toHaveBeenCalled();
});