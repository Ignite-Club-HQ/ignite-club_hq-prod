import { beforeEach, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "../featureRouter";
const m = vi.hoisted(() => ({ connect: vi.fn(), remove: vi.fn() }));
vi.mock("../domains", () => ({ connectLiveCompetitionDomain: m.connect }));
import { removeLiveCompetitionRole } from "./competitions";
const ctx = { target: { alias: "test" }, identity: {} } as FeatureBackendContext;
beforeEach(() => { vi.clearAllMocks(); m.connect.mockResolvedValue({ actor: { remove_competition_role: m.remove } }); });
it("preserves exact competition/person/role/team targeting", async () => {
  m.remove.mockResolvedValue({ Ok: null });
  const user = Principal.fromUint8Array(new Uint8Array([1, 1]));
  await removeLiveCompetitionRole(ctx, "cup", user, "admin", "team-a");
  expect(m.remove).toHaveBeenCalledExactlyOnceWith("cup", user, "admin", ["team-a"]);
});
it("does not treat server refusal as success", async () => {
  m.remove.mockResolvedValue({ Err: "Owner roles cannot be removed" });
  await expect(removeLiveCompetitionRole(ctx, "cup", Principal.anonymous(), "owner")).rejects.toThrow("Owner roles");
});