import { describe, expect, it } from "vitest";
import { iapAccountToken } from "./iapAccountToken";

describe("iapAccountToken", () => {
  it("matches the purchase checker's derivation", async () => {
    expect(await iapAccountToken("aaaaa-aa")).toBe("7672e609-fcfd-5e38-9746-21afc967474b");
  });
  it("differs per account", async () => {
    expect(await iapAccountToken("2vxsx-fae")).not.toBe(await iapAccountToken("aaaaa-aa"));
  });
});
