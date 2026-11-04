/**
 * Regression tests for the shared NotificationListCard, extracted from
 * NotificationsPage's duplicated "Unread" and "Earlier" section markup.
 *
 * Covers the only real behavioral differences between the two variants:
 *   - "unread" shows the mark-as-read action; "earlier" does not.
 *   - Both variants still surface the event-link action, join-request
 *     approve/deny actions, and forward click/delete callbacks.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  NotificationListCard,
  type NotificationListItem,
} from "./NotificationListCard";

const baseNotification: NotificationListItem = {
  id: "notif-1",
  type: "message",
  message: "Hello there",
  read: false,
  created_at: new Date().toISOString(),
  related_id: null,
};

function renderCard(card: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(card, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe("NotificationListCard", () => {
  it("shows the mark-as-read action only for the unread variant", () => {
    const onMarkAsRead = vi.fn();
    const { rerender } = renderCard(
      <NotificationListCard
        notification={baseNotification}
        variant="unread"
        onClick={vi.fn()}
        onDelete={vi.fn()}
        onViewEvent={vi.fn()}
        onMarkAsRead={onMarkAsRead}
        onApproveJoinRequest={vi.fn()}
        onDenyJoinRequest={vi.fn()}
        joinRequestActionsDisabled={false}
      />,
    );
    expect(screen.getByRole("button", { name: "" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "" }));
    expect(onMarkAsRead).toHaveBeenCalledTimes(1);

    rerender(
      <NotificationListCard
        notification={baseNotification}
        variant="earlier"
        onClick={vi.fn()}
        onDelete={vi.fn()}
        onViewEvent={vi.fn()}
        onMarkAsRead={onMarkAsRead}
        onApproveJoinRequest={vi.fn()}
        onDenyJoinRequest={vi.fn()}
        joinRequestActionsDisabled={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "" })).toBeNull();
  });

  it("wires the event-link action for event-related notification types", () => {
    const onViewEvent = vi.fn();
    renderCard(
      <NotificationListCard
        notification={{ ...baseNotification, type: "event_reminder", related_id: "event-1" }}
        variant="unread"
        onClick={vi.fn()}
        onDelete={vi.fn()}
        onViewEvent={onViewEvent}
        onMarkAsRead={vi.fn()}
        onApproveJoinRequest={vi.fn()}
        onDenyJoinRequest={vi.fn()}
        joinRequestActionsDisabled={false}
      />,
    );
    fireEvent.click(screen.getByText("View event →"));
    expect(onViewEvent).toHaveBeenCalledTimes(1);
  });

  it("wires join-request approve/deny actions and respects the disabled flag", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const { rerender } = renderCard(
      <NotificationListCard
        notification={{ ...baseNotification, type: "join_request", related_id: "req-1" }}
        variant="earlier"
        onClick={vi.fn()}
        onDelete={vi.fn()}
        onViewEvent={vi.fn()}
        onMarkAsRead={vi.fn()}
        onApproveJoinRequest={onApprove}
        onDenyJoinRequest={onDeny}
        joinRequestActionsDisabled={true}
      />,
    );
    const approveButton = screen.getByRole("button", { name: "Approve" });
    const denyButton = screen.getByRole("button", { name: "Deny" });
    expect(approveButton).toBeDisabled();
    expect(denyButton).toBeDisabled();
    fireEvent.click(approveButton);
    fireEvent.click(denyButton);
    expect(onApprove).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
    rerender(
      <NotificationListCard
        notification={{ ...baseNotification, type: "join_request", related_id: "req-1" }}
        variant="earlier"
        onClick={vi.fn()}
        onDelete={vi.fn()}
        onViewEvent={vi.fn()}
        onMarkAsRead={vi.fn()}
        onApproveJoinRequest={onApprove}
        onDenyJoinRequest={onDeny}
        joinRequestActionsDisabled={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("forwards the card click and delete callbacks", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    renderCard(
      <NotificationListCard
        notification={baseNotification}
        variant="unread"
        onClick={onClick}
        onDelete={onDelete}
        onViewEvent={vi.fn()}
        onMarkAsRead={vi.fn()}
        onApproveJoinRequest={vi.fn()}
        onDenyJoinRequest={vi.fn()}
        joinRequestActionsDisabled={false}
      />,
    );
    fireEvent.click(screen.getByText("Hello there"));
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("button", { name: /Notification\. Press Enter/ }), { key: "Delete" });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
