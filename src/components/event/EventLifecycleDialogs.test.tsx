import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventCancellationDialog, EventDeletionDialog } from "./EventLifecycleDialogs";

vi.mock("@/components/CancelEventConfirmDialog", () => ({ CancelEventConfirmDialog: (props: any) => <button onClick={() => props.onConfirm("single message", true)}>single cancel</button> }));
vi.mock("@/components/RecurringCancelEventDialog", () => ({ RecurringCancelEventDialog: (props: any) => <><button onClick={() => props.onSingleAction("one", false)}>one cancel</button><button onClick={() => props.onSeriesAction("series", true)}>series cancel</button></> }));
vi.mock("@/components/RecurringEventActionDialog", () => ({ RecurringEventActionDialog: (props: any) => <><span>{props.keepOpenOnAction ? "kept open" : "closes"}</span><button onClick={props.onSingleAction}>one delete</button><button onClick={props.onSeriesAction}>series delete</button></> }));

const event = { id: "event-1", title: "Match", team_id: "team-1", club_id: "club-1", mini_league_id: null, type: "game" };

describe("event lifecycle dialogs", () => {
  it("routes single cancellation with its message and push choice", () => {
    const onCancel = vi.fn();
    render(<EventCancellationDialog recurring={false} open onOpenChange={vi.fn()} event={event} isPending={false} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "single cancel" }));
    expect(onCancel).toHaveBeenCalledWith("single", "single message", true);
  });
  it("routes both recurring cancellation scopes", () => {
    const onCancel = vi.fn();
    render(<EventCancellationDialog recurring open onOpenChange={vi.fn()} event={event} isPending={false} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "one cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "series cancel" }));
    expect(onCancel).toHaveBeenNthCalledWith(1, "single", "one", false);
    expect(onCancel).toHaveBeenNthCalledWith(2, "series", "series", true);
  });
  it("keeps recurring deletion open and routes both scopes", () => {
    const onDelete = vi.fn();
    render(<EventDeletionDialog recurring open onOpenChange={vi.fn()} eventTypeLabel="Game" isPending={false} onDelete={onDelete} />);
    expect(screen.getByText("kept open")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "one delete" }));
    fireEvent.click(screen.getByRole("button", { name: "series delete" }));
    expect(onDelete.mock.calls).toEqual([["single"], ["series"]]);
  });
  it("routes single deletion and disables repeat confirmation while pending", () => {
    const onDelete = vi.fn();
    const { rerender } = render(<EventDeletionDialog recurring={false} open onOpenChange={vi.fn()} eventTypeLabel="Game" isPending={false} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("single");
    rerender(<EventDeletionDialog recurring={false} open onOpenChange={vi.fn()} eventTypeLabel="Game" isPending onDelete={onDelete} />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});
