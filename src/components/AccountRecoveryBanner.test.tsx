import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSession: vi.fn(),
  invoke: vi.fn(),
  toast: vi.fn(),
  profileResult: { data: null as any, error: null as any },
  profileChain: undefined as any,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    auth: { getSession: mocks.getSession },
    functions: { invoke: mocks.invoke },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

import { AccountRecoveryBanner } from "./AccountRecoveryBanner";

function profileQuery() {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(mocks.profileResult));
  mocks.profileChain = chain;
  return chain;
}

describe("AccountRecoveryBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileResult = { data: null, error: null };
    mocks.from.mockImplementation(profileQuery);
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token-1" } }, error: null });
    mocks.invoke.mockResolvedValue({ data: { recovered: true }, error: null });
  });

  it("scopes deletion-status lookup to the exact user", async () => {
    render(<AccountRecoveryBanner userId="user-42" onRecovered={vi.fn()} />);
    await waitFor(() => expect(mocks.profileChain.single).toHaveBeenCalled());

    expect(mocks.from).toHaveBeenCalledWith("profiles");
    expect(mocks.profileChain.select).toHaveBeenCalledWith("scheduled_deletion_at");
    expect(mocks.profileChain.eq).toHaveBeenCalledWith("id", "user-42");
  });

  it("renders nothing when the account is not scheduled for deletion", async () => {
    const { container } = render(<AccountRecoveryBanner userId="user-1" onRecovered={vi.fn()} />);
    await waitFor(() => expect(mocks.profileChain.single).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing rather than inventing status when lookup fails", async () => {
    mocks.profileResult = { data: null, error: { message: "profile denied" } };
    const { container } = render(<AccountRecoveryBanner userId="user-1" onRecovered={vi.fn()} />);
    await waitFor(() => expect(mocks.profileChain.single).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the scheduled deletion warning and recovery action", async () => {
    mocks.profileResult = { data: { scheduled_deletion_at: "2099-08-20T00:00:00Z" }, error: null };
    render(<AccountRecoveryBanner userId="user-1" onRecovered={vi.fn()} />);

    expect(await screen.findByText("Account Scheduled for Deletion")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recover My Account/i })).toBeEnabled();
    expect(screen.getByText(/days remaining/i)).toBeInTheDocument();
  });

  it("recovers using the current session token and calls the completion callback", async () => {
    mocks.profileResult = { data: { scheduled_deletion_at: "2099-08-20T00:00:00Z" }, error: null };
    const onRecovered = vi.fn();
    render(<AccountRecoveryBanner userId="user-1" onRecovered={onRecovered} />);
    fireEvent.click(await screen.findByRole("button", { name: /Recover My Account/i }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("recover-account", {
      headers: { Authorization: "Bearer token-1" },
    }));
    expect(onRecovered).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Account recovered!" }));
    expect(screen.queryByText("Account Scheduled for Deletion")).not.toBeInTheDocument();
  });

  it("must not call recovery with an absent session", async () => {
    mocks.profileResult = { data: { scheduled_deletion_at: "2099-08-20T00:00:00Z" }, error: null };
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<AccountRecoveryBanner userId="user-1" onRecovered={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Recover My Account/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Recovery failed",
      variant: "destructive",
    })));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps the warning visible and reports a backend recovery failure", async () => {
    mocks.profileResult = { data: { scheduled_deletion_at: "2099-08-20T00:00:00Z" }, error: null };
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "Recovery denied" } });
    const onRecovered = vi.fn();
    render(<AccountRecoveryBanner userId="user-1" onRecovered={onRecovered} />);
    fireEvent.click(await screen.findByRole("button", { name: /Recover My Account/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Recovery failed", description: "Recovery denied", variant: "destructive",
    }));
    expect(onRecovered).not.toHaveBeenCalled();
    expect(screen.getByText("Account Scheduled for Deletion")).toBeInTheDocument();
  });

  it("rechecks deletion status when the authenticated user changes", async () => {
    const { rerender } = render(<AccountRecoveryBanner userId="user-1" onRecovered={vi.fn()} />);
    await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(1));
    rerender(<AccountRecoveryBanner userId="user-2" onRecovered={vi.fn()} />);
    await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(2));
    expect(mocks.profileChain.eq).toHaveBeenCalledWith("id", "user-2");
  });
});
