import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
const state = vi.hoisted(() => ({ provider: "email", signOut: vi.fn(), choose: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "member", app_metadata: { provider: state.provider } }, signOut: state.signOut }) }));
vi.mock("@/live/authBackendMode", () => ({ setAuthMethodChoice: state.choose }));
import { NewClubAuthGate } from "./NewClubAuthGate";
beforeEach(() => { state.provider = "email"; vi.clearAllMocks(); state.signOut.mockResolvedValue(undefined); });
function open() { render(<MemoryRouter initialEntries={["/clubs/new"]}><Routes><Route path="/clubs/new" element={<NewClubAuthGate><div>ICP creation</div></NewClubAuthGate>} /><Route path="/auth" element={<div>Secure sign-in destination</div>} /></Routes></MemoryRouter>); }
describe("new club authentication boundary", () => {
 it("does not mount new-club creation for an email account", () => { open(); expect(screen.queryByText("ICP creation")).toBeNull(); expect(state.signOut).not.toHaveBeenCalled(); });
 it("requires explicit switching and signs out before selecting ICP", async () => {
  open(); fireEvent.click(screen.getByRole("button", { name: "Continue with Internet Identity" }));
  expect(await screen.findByText("Secure sign-in destination")).toBeInTheDocument();
  expect(state.signOut).toHaveBeenCalledTimes(1); expect(state.choose).toHaveBeenCalledWith("icp");
  expect(state.signOut.mock.invocationCallOrder[0]).toBeLessThan(state.choose.mock.invocationCallOrder[0]);
 });
 it("keeps email mode when sign-out fails", async () => { state.signOut.mockRejectedValue(new Error("unavailable")); open(); fireEvent.click(screen.getByRole("button", { name: "Continue with Internet Identity" })); await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument()); expect(state.choose).not.toHaveBeenCalled(); });
 it("mounts creation only for the authenticated ICP provider", () => { state.provider="icp"; open(); expect(screen.getByText("ICP creation")).toBeInTheDocument(); expect(state.signOut).not.toHaveBeenCalled(); });
});