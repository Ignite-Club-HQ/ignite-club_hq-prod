import { describe, expect, it, vi } from "vitest";
import {
  acceptShareableInviteWithRetry,
  assertShareableInvitePrincipal,
  isTransientAccountAuthorityError,
  shareableInviteJoinErrorMessage,
} from "./acceptShareableInviteWithRetry";

describe("ICP shareable-invitation authority retry boundary", () => {
  const principal = "test-principal";

  it("refuses a Test2 session trying to redeem a Test principal's invitation", () => {
    expect(() => assertShareableInvitePrincipal("test-principal", "test-principal")).not.toThrow();
    expect(() => assertShareableInvitePrincipal("test-principal", "test2-principal"))
      .toThrow("Internet Identity changed during joining");
    expect(() => assertShareableInvitePrincipal("", "test2-principal")).toThrow();
    expect(() => assertShareableInvitePrincipal("test-principal", "")).toThrow();
  });

  it("retries exactly once after the specific account-epoch rejection", async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error("The replica returned a rejection error: Reject text: Account authority changed; retry"))
      .mockResolvedValueOnce({ Ok: { role: "parent" } });
    await expect(acceptShareableInviteWithRetry(submit, () => principal))
      .resolves.toEqual({ Ok: { role: "parent" } });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("stops after a second account-epoch rejection instead of looping", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("Account authority changed; retry"));
    await expect(acceptShareableInviteWithRetry(submit, () => principal))
      .rejects.toThrow("Account authority changed; retry");
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it.each([
    "Account admission denied or unavailable",
    "Invite authorization changed",
    "Invite link revoked",
    "Forbidden",
    "Actor communication error",
  ])("does not retry unrelated failure: %s", async (message) => {
    const submit = vi.fn().mockRejectedValue(new Error(message));
    await expect(acceptShareableInviteWithRetry(submit, () => principal))
      .rejects.toThrow(message);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("refuses to retry when the principal changes between attempts", async () => {
    let current = principal;
    const submit = vi.fn(async () => {
      current = "different-principal";
      throw new Error("Account authority changed; retry");
    });
    await expect(acceptShareableInviteWithRetry(submit, () => current))
      .rejects.toThrow("Your sign-in changed during joining");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("formats only the exact documented failure as a short user message", () => {
    const raw = new Error("The replica returned a rejection error: Reject text: Account authority changed; retry; Canister ID: g2");
    expect(isTransientAccountAuthorityError(raw)).toBe(true);
    const friendly = shareableInviteJoinErrorMessage(raw);
    expect(friendly).toMatch(/Check whether you are already a member/);
    expect(friendly).not.toMatch(/Canister ID|replica returned/);
    expect(shareableInviteJoinErrorMessage(new Error("Invitation revoked"))).toBe("Invitation revoked");
  });
});
