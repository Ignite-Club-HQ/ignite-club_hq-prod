import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "icp" as "icp" | "supabase",
  live: vi.fn(),
  anonymous: vi.fn(),
}));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => mocks.mode }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: async (_feature: string, providers: { icp: (ctx: unknown) => unknown; supabase: () => unknown }) =>
    mocks.mode === "icp" ? providers.icp({ target: { alias: "test" }, identity: {} }) : providers.supabase(),
}));
vi.mock("@/live/features/messaging", () => ({
  fetchLiveLinkPreview: mocks.live,
  fetchAnonymousLinkPreview: mocks.anonymous,
}));
vi.mock("@/lib/chatScrollActivity", () => ({ runWhenChatScrollIdle: (fn: () => void) => { fn(); return () => {}; } }));
vi.mock("@/lib/linkPreviewJumpDefer", () => ({ deferIfJumpActive: () => null }));
vi.mock("@/lib/safeOpenUrl", () => ({ safeOpenUrl: vi.fn() }));
vi.mock("@/lib/reactionInteractionGuard", () => ({ preventIfReactionInteractionGuarded: () => false }));

import { LinkPreview } from "./LinkPreview";

const metadata = (title: string) => ({ title: [title], description: [], image: [], site_name: [] });

describe("link-preview transport isolation", () => {
  beforeEach(() => {
    mocks.mode = "icp";
    mocks.live.mockReset().mockResolvedValue(metadata("On-chain preview"));
    mocks.anonymous.mockReset().mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ title: "External preview" }) }));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("ICP retrieves metadata from the canister without calling the external helper", async () => {
    const view = render(<LinkPreview url="https://example.org/icp-success" />);
    await waitFor(() => expect(view.getByRole("link")).toBeTruthy());
    expect(mocks.live).toHaveBeenCalledWith(expect.anything(), "https://example.org/icp-success");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.anonymous).not.toHaveBeenCalled();
  });

  it("ICP outcall failure keeps a usable link without an external fallback", async () => {
    mocks.live.mockRejectedValue(new Error("Outcall unavailable"));
    const view = render(<LinkPreview url="https://example.org/icp-failure" />);
    await waitFor(() => expect(view.getByRole("link")).toBeTruthy());
    expect(mocks.live).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.anonymous).not.toHaveBeenCalled();
  });

  it("email keeps its existing anonymous-canister then external-helper fallback", async () => {
    mocks.mode = "supabase";
    const view = render(<LinkPreview url="https://example.org/email-fallback" />);
    await waitFor(() => expect(view.getByRole("link")).toBeTruthy());
    expect(mocks.anonymous).toHaveBeenCalledWith("https://example.org/email-fallback");
    expect(fetch).toHaveBeenCalledWith("/api/fetch-link-preview", expect.objectContaining({ method: "POST" }));
    expect(mocks.live).not.toHaveBeenCalled();
  });

  it("email canister success does not call its fallback", async () => {
    mocks.mode = "supabase";
    mocks.anonymous.mockResolvedValue(metadata("Email canister preview"));
    const view = render(<LinkPreview url="https://example.org/email-success" />);
    await waitFor(() => expect(view.getByRole("link")).toBeTruthy());
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.live).not.toHaveBeenCalled();
  });

  it("an email-mode cached preview cannot skip the ICP request after switching modes", async () => {
    mocks.mode = "supabase";
    const email = render(<LinkPreview url="https://example.org/switch-mode" />);
    await waitFor(() => expect(email.getByRole("link")).toBeTruthy());
    email.unmount();
    mocks.mode = "icp";
    const icp = render(<LinkPreview url="https://example.org/switch-mode" />);
    await waitFor(() => expect(mocks.live).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(icp.getByRole("link")).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});