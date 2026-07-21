import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/hooks/useNativeKeyboardBottomInset", () => ({ useNativeKeyboardBottomInset: () => 0 }));

import { CancelEventConfirmDialog } from "./CancelEventConfirmDialog";

function memberQuery(data: Array<{ user_id: string }>) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  });
  return chain;
}

describe("CancelEventConfirmDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deduplicates recipients and sends a trimmed custom reason", async () => {
    from.mockReturnValueOnce(memberQuery([
      { user_id: "member-1" },
      { user_id: "member-1" },
      { user_id: "member-2" },
    ]));
    const onConfirm = vi.fn();
    render(
      <CancelEventConfirmDialog
        open
        onOpenChange={vi.fn()}
        eventId="event-1"
        eventTitle="Saturday Training"
        teamId="team-1"
        clubId="club-1"
        eventType="training"
        onConfirm={onConfirm}
      />,
    );

    expect(await screen.findByText("2 members will be notified.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Custom message (optional)"), {
      target: { value: "  Ground is flooded  " },
    });
    expect(screen.getAllByText(/Ground is flooded/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Cancel Training" }));
    expect(onConfirm).toHaveBeenCalledWith("Ground is flooded", true);
  });

  it("supports cancelling without push and omits a blank reason", async () => {
    from.mockReturnValueOnce(memberQuery([{ user_id: "member-1" }]));
    const onConfirm = vi.fn();
    render(
      <CancelEventConfirmDialog
        open
        onOpenChange={vi.fn()}
        eventId="event-1"
        eventTitle="Club Social"
        teamId={null}
        clubId="club-1"
        eventType="social"
        onConfirm={onConfirm}
      />,
    );
    await screen.findByText("1 member will be notified.");
    fireEvent.click(screen.getByLabelText("Also send push notification to members"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel Social" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined, false);
  });

  it("keeps confirmation disabled until recipient counting finishes", async () => {
    let resolveQuery!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveQuery = resolve; });
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    Object.defineProperty(chain, "then", { value: pending.then.bind(pending) });
    from.mockReturnValueOnce(chain);

    render(
      <CancelEventConfirmDialog open onOpenChange={vi.fn()} eventId="event-1" eventTitle="Match" teamId="team-1" clubId="club-1" eventType="game" onConfirm={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Cancel Game" })).toBeDisabled();
    resolveQuery({ data: [], error: null });
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel Game" })).toBeEnabled());
  });

  it("must fail closed on push delivery when recipient discovery fails", async () => {
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    Object.defineProperty(chain, "then", {
      value: (_resolve: unknown, reject: (error: unknown) => void) =>
        Promise.reject(new Error("recipient lookup failed")).catch(reject),
    });
    from.mockReturnValueOnce(chain);
    const onConfirm = vi.fn();
    render(
      <CancelEventConfirmDialog
        open onOpenChange={vi.fn()} eventId="event-1" eventTitle="Match"
        teamId="team-1" clubId="club-1" eventType="game" onConfirm={onConfirm}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel Game" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel Game" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined, false);
  });

  it("prevents confirmation and dismissal while cancellation is pending", async () => {
    from.mockReturnValueOnce(memberQuery([]));
    render(
      <CancelEventConfirmDialog
        open onOpenChange={vi.fn()} eventId="event-1" eventTitle="Match"
        teamId="team-1" clubId="club-1" eventType="game" onConfirm={vi.fn()} isPending
      />,
    );

    expect(await screen.findByRole("button", { name: "Cancelling..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep Game" })).toBeDisabled();
  });
});
