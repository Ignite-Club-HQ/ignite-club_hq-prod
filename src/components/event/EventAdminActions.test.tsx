import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventAdminActions } from "./EventAdminActions";

const callbacks = () => ({ onEdit: vi.fn(), onRemind: vi.fn(), onResend: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn() });

describe("EventAdminActions", () => {
  it("renders no menu for an unauthorized user", () => {
    render(<EventAdminActions model={{ visible: false, showEdit: false, reminder: "hidden", showResend: false, showCancel: false, showDelete: false }} eventTypeLabel="Game" {...callbacks()} />);
    expect(screen.queryByRole("button", { name: "Event actions" })).not.toBeInTheDocument();
  });
  it("routes each enabled menu action to its controller callback", async () => {
    const actions = callbacks();
    render(<EventAdminActions model={{ visible: true, showEdit: true, reminder: "enabled", showResend: true, showCancel: true, showDelete: true }} eventTypeLabel="Game" {...actions} />);
    const open = () => fireEvent.pointerDown(screen.getByRole("button", { name: "Event actions" }));
    for (const [label, callback] of [
      ["Edit Game", actions.onEdit], ["Send Reminders", actions.onRemind], ["Resend Invites", actions.onResend],
      ["Cancel Game", actions.onCancel], ["Delete Game", actions.onDelete],
    ] as const) {
      open();
      fireEvent.click(await screen.findByRole("menuitem", { name: label }));
      expect(callback).toHaveBeenCalledTimes(1);
    }
  });
  it("shows a disabled Pro reminder without invoking reminder", async () => {
    const actions = callbacks();
    render(<EventAdminActions model={{ visible: true, showEdit: true, reminder: "pro-disabled", showResend: false, showCancel: true, showDelete: true }} eventTypeLabel="Event" {...actions} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Event actions" }));
    expect(await screen.findByText("Pro")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Send Reminders/ })).toHaveAttribute("data-disabled");
  });
});
