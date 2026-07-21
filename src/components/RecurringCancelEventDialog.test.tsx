import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/hooks/useNativeKeyboardBottomInset", () => ({ useNativeKeyboardBottomInset: () => 0 }));

import { RecurringCancelEventDialog } from "./RecurringCancelEventDialog";

function queryResult(data: unknown) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.not = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data, error: null });
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  });
  return chain;
}

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  eventTitle: "Weekly Training",
  teamId: "team-1",
  clubId: "club-1",
  eventType: "training",
  onSingleAction: vi.fn(),
  onSeriesAction: vi.fn(),
};

describe("RecurringCancelEventDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    baseProps.onOpenChange = vi.fn();
    baseProps.onSingleAction = vi.fn();
    baseProps.onSeriesAction = vi.fn();
  });

  it("deduplicates team recipients and scopes cancellation to this occurrence", async () => {
    from.mockReturnValueOnce(queryResult([
      { user_id: "member-1" },
      { user_id: "member-1" },
      { user_id: "member-2" },
    ]));
    render(<RecurringCancelEventDialog {...baseProps} />);

    expect(await screen.findByText("2 members will be notified.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Custom message (optional)"), { target: { value: "  Pitch unavailable  " } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel This Training Only" }));

    expect(baseProps.onSingleAction).toHaveBeenCalledWith("Pitch unavailable", true);
    expect(baseProps.onSeriesAction).not.toHaveBeenCalled();
    expect(baseProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("selects the entire series and preserves the no-push choice", async () => {
    from.mockReturnValueOnce(queryResult([{ user_id: "member-1" }]));
    render(<RecurringCancelEventDialog {...baseProps} />);
    await screen.findByText("1 member will be notified.");
    fireEvent.click(screen.getByLabelText("Also send push notification to members"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel Entire Series" }));

    expect(baseProps.onSeriesAction).toHaveBeenCalledWith(undefined, false);
    expect(baseProps.onSingleAction).not.toHaveBeenCalled();
    expect(baseProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("counts unique mini-league parents and admins without double-notifying the same user", async () => {
    from
      .mockReturnValueOnce(queryResult({ club_id: "club-1" }))
      .mockReturnValueOnce(queryResult([
        { parent_user_id: "parent-1" },
        { parent_user_id: "parent-1" },
        { parent_user_id: "parent-2" },
      ]))
      .mockReturnValueOnce(queryResult([
        { user_id: "admin-1" },
        { user_id: "parent-1" },
      ]));
    render(<RecurringCancelEventDialog {...baseProps} teamId={null} miniLeagueId="league-1" eventType="game" />);

    expect(await screen.findByText("3 members will be notified.")).toBeInTheDocument();
    expect(screen.getByText("Message will be posted to league chat")).toBeInTheDocument();
    expect(from).toHaveBeenNthCalledWith(1, "mini_leagues");
    expect(from).toHaveBeenNthCalledWith(2, "mini_league_players");
    expect(from).toHaveBeenNthCalledWith(3, "user_roles");
  });

  it("disables both cancellation choices while recipient counting is pending", async () => {
    let resolveQuery!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveQuery = resolve; });
    const chain: any = { select: vi.fn(), eq: vi.fn() };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    Object.defineProperty(chain, "then", { value: pending.then.bind(pending) });
    from.mockReturnValueOnce(chain);
    render(<RecurringCancelEventDialog {...baseProps} />);

    expect(screen.getByRole("button", { name: "Cancel This Training Only" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel Entire Series" })).toBeDisabled();
    resolveQuery({ data: [], error: null });
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel This Training Only" })).toBeEnabled());
  });

  it("must fail closed on push delivery when series recipient discovery fails", async () => {
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    Object.defineProperty(chain, "then", {
      value: (_resolve: unknown, reject: (error: unknown) => void) =>
        Promise.reject(new Error("recipient lookup failed")).catch(reject),
    });
    from.mockReturnValueOnce(chain);
    render(<RecurringCancelEventDialog {...baseProps} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel Entire Series" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel Entire Series" }));

    expect(baseProps.onSeriesAction).toHaveBeenCalledWith(undefined, false);
  });

  it("prevents every action while a series cancellation is pending", async () => {
    from.mockReturnValueOnce(queryResult([]));
    render(<RecurringCancelEventDialog {...baseProps} isPending />);

    expect(await screen.findByRole("button", { name: "Cancelling..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel Entire Series" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep Training" })).toBeDisabled();
  });
});
