import { describe, expect, it, vi } from "vitest";

vi.mock("./features/vault", () => ({
  resolveLivePiiTextBatch: vi.fn(async () => new Map([["me", "Paul Cranwell"]])),
}));

import { resolveIcpDisplayName } from "./identityProfile";

const target = {} as never;
const identity = {} as never;

describe("resolveIcpDisplayName", () => {
  it("keeps plaintext names", async () => {
    expect(await resolveIcpDisplayName(identity, "me", "Paul", target)).toBe("Paul");
  });

  it("unlocks a private name reference instead of showing it", async () => {
    const ref = "pii-display-name:v1:iui5p-aaaaa-aaaal-qxllq-cai:mbrvi-lvde7";
    expect(await resolveIcpDisplayName(identity, "me", ref, target)).toBe("Paul Cranwell");
  });
});
