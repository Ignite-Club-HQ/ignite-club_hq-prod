import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ code: "ABC123", rpc: vi.fn() }));
vi.mock("react-router-dom", () => ({
  useParams: () => ({ code: mocks.code }),
  Navigate: ({ to, replace }: any) => <div data-testid="navigate" data-replace={String(replace)}>{to}</div>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/assets/ignite-icon.png", () => ({ default: "ignite.png" }));

import ShortInviteRedirect from "./ShortInviteRedirect";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((res) => { resolve = res; }); return { promise, resolve }; }

describe("ShortInviteRedirect", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.code = "ABC123"; });

  it("resolves the exact short code and shows a neutral loading state", () => {
    mocks.rpc.mockReturnValue(new Promise(() => {}));
    render(<ShortInviteRedirect />);
    expect(mocks.rpc).toHaveBeenCalledWith("resolve_invite_short_code", { _code: "ABC123" });
    expect(screen.getByText("Loading invite...")).toBeInTheDocument();
  });

  it("redirects a resolved token into the pending-invite join route", async () => {
    mocks.rpc.mockResolvedValue({ data: "invite-token-42", error: null });
    render(<ShortInviteRedirect />);
    expect(await screen.findByTestId("navigate")).toHaveTextContent("/join/p/invite-token-42");
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-replace", "true");
  });

  it.each([
    [{ data: null, error: null }],
    [{ data: null, error: { message: "not found" } }],
  ])("fails safely to authentication when resolution returns no token", async (result) => {
    mocks.rpc.mockResolvedValue(result);
    render(<ShortInviteRedirect />);
    expect(await screen.findByTestId("navigate")).toHaveTextContent("/auth");
  });

  it("does not call the resolver when the route code is absent", async () => {
    mocks.code = "";
    render(<ShortInviteRedirect />);
    expect(await screen.findByTestId("navigate")).toHaveTextContent("/auth");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("ignores a stale response after the route changes to a newer short code", async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    mocks.rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<ShortInviteRedirect />);
    mocks.code = "NEW456";
    view.rerender(<ShortInviteRedirect />);
    await act(async () => second.resolve({ data: "new-token", error: null }));
    expect(screen.getByTestId("navigate")).toHaveTextContent("/join/p/new-token");
    await act(async () => first.resolve({ data: "stale-token", error: null }));
    expect(screen.getByTestId("navigate")).toHaveTextContent("/join/p/new-token");
  });

  it("encodes a resolved token before placing it in a route path", async () => {
    mocks.rpc.mockResolvedValue({ data: "token/../auth?x=1", error: null });
    render(<ShortInviteRedirect />);
    const redirect = await screen.findByTestId("navigate");
    expect(redirect).toHaveTextContent("/join/p/token%2F..%2Fauth%3Fx%3D1");
  });
});
