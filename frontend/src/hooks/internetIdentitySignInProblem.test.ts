import { describe, it, expect } from "vitest";
import { internetIdentitySignInProblem } from "./useAuth";
describe("internetIdentitySignInProblem", () => {
  it("explains a removed identity", () => {
    expect(internetIdentitySignInProblem(new Error("Identity revoked; surviving-account relink required"))).toMatch(/removed from Ignite/);
  });
  it("gives a retry message otherwise", () => {
    expect(internetIdentitySignInProblem(new Error("timeout"))).toMatch(/try again/);
  });
});
