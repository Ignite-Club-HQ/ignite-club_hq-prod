import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventReminderDialog, EventResendInvitesDialog } from "./EventNotificationDialogs";

describe("event notification dialogs", () => {
  it("routes reminder share and send actions to the page controller", () => {
    const onShare = vi.fn(); const onSend = vi.fn();
    render(<EventReminderDialog open onOpenChange={vi.fn()} onShare={onShare} onSend={onSend} isPending={false} actionsDisabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Share via..." }));
    fireEvent.click(screen.getByRole("button", { name: "Send In-App" }));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it.each([
    [true, false], [false, true],
  ])("disables reminder send for pending=%s safety-disabled=%s", (isPending, actionsDisabled) => {
    render(<EventReminderDialog open onOpenChange={vi.fn()} onShare={vi.fn()} onSend={vi.fn()} isPending={isPending} actionsDisabled={actionsDisabled} />);
    expect(screen.getByRole("button", { name: isPending ? "Sending..." : "Send In-App" })).toBeDisabled();
  });
  it("routes resend and retains its pending state", () => {
    const onSend = vi.fn();
    const { rerender } = render(<EventResendInvitesDialog open onOpenChange={vi.fn()} onSend={onSend} isPending={false} actionsDisabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Send Invites" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    rerender(<EventResendInvitesDialog open onOpenChange={vi.fn()} onSend={onSend} isPending actionsDisabled={false} />);
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
  });
  it("renders no dialog content while controlled closed", () => {
    render(<><EventReminderDialog open={false} onOpenChange={vi.fn()} onShare={vi.fn()} onSend={vi.fn()} isPending={false} actionsDisabled={false} />
      <EventResendInvitesDialog open={false} onOpenChange={vi.fn()} onSend={vi.fn()} isPending={false} actionsDisabled={false} /></>);
    expect(screen.queryByText("Send RSVP Reminders?")).not.toBeInTheDocument();
    expect(screen.queryByText("Resend Event Invites?")).not.toBeInTheDocument();
  });
});
