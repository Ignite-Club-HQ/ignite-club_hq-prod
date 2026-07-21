import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: { data: [] as any[], isLoading: false, isError: false, error: null as any, refetch: vi.fn() },
  mutateAsync: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/hooks/useScheduledMessages", () => ({
  useThreadScheduledMessages: () => mocks.query,
  useCancelScheduledMessage: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("./ScheduleMessageDialog", () => ({
  localTimezoneLabel: () => "Australia/Sydney",
  ScheduleMessageDialog: ({ open, editingRow }: any) => open
    ? <div data-testid="edit-dialog">Editing {editingRow?.id}</div>
    : null,
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogAction: ({ children, onClick, disabled }: any) => <button onClick={onClick} disabled={disabled}>{children}</button>,
}));

import { ScheduledMessagesBanner } from "./ScheduledMessagesBanner";

const target = { chat_type: "team" as const, team_id: "team-1" };
const baseRow = {
  id: "scheduled-1",
  author_id: "user-1",
  chat_type: "team",
  team_id: "team-1",
  club_id: null,
  group_id: null,
  conversation_id: null,
  text: "Bring the blue kit",
  image_url: null,
  reply_to_id: null,
  scheduled_for: "2030-08-01T10:00:00.000Z",
  status: "pending",
  sent_message_id: null,
  error_message: null,
  attempted_at: null,
  recurrence: "none",
  recurrence_until: null,
  recurrence_parent_id: null,
  created_at: "2030-07-01T10:00:00.000Z",
  updated_at: "2030-07-01T10:00:00.000Z",
};

function expand() {
  fireEvent.click(screen.getByRole("button", { name: /scheduled message/i }));
}

describe("ScheduledMessagesBanner management behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.data = [];
    mocks.query.isLoading = false;
    mocks.query.isError = false;
    mocks.query.error = null;
    mocks.mutateAsync.mockResolvedValue(undefined);
  });

  it("renders nothing after a successful genuinely empty result", () => {
    const { container } = render(<ScheduledMessagesBanner target={target} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the exact count and next-send summary while collapsed", () => {
    mocks.query.data = [baseRow, { ...baseRow, id: "scheduled-2" }];
    render(<ScheduledMessagesBanner target={target} />);

    expect(screen.getByText("2 scheduled messages")).toBeInTheDocument();
    expect(screen.getByText(/next in/i)).toBeInTheDocument();
    expect(screen.queryByText("Bring the blue kit")).not.toBeInTheDocument();
  });

  it("expands to show message text, time and timezone", () => {
    mocks.query.data = [baseRow];
    render(<ScheduledMessagesBanner target={target} />);
    expand();

    expect(screen.getByText("Bring the blue kit")).toBeInTheDocument();
    expect(screen.getByText("Times shown in Australia/Sydney")).toBeInTheDocument();
    const toggle = screen.getAllByRole("button").find(button => button.hasAttribute("aria-expanded"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("labels an attachment-only schedule instead of displaying a blank row", () => {
    mocks.query.data = [{ ...baseRow, text: "", image_url: "https://example.test/photo.jpg" }];
    render(<ScheduledMessagesBanner target={target} />);
    expand();
    expect(screen.getByText("(Image only)")).toBeInTheDocument();
  });

  it("shows the recurrence cadence", () => {
    mocks.query.data = [{ ...baseRow, recurrence: "weekly" }];
    render(<ScheduledMessagesBanner target={target} />);
    expand();
    expect(screen.getByText("weekly")).toBeInTheDocument();
  });

  it("opens editing for only the selected scheduled row", () => {
    mocks.query.data = [baseRow, { ...baseRow, id: "scheduled-2", text: "Second" }];
    render(<ScheduledMessagesBanner target={target} />);
    expand();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit scheduled message" })[1]);
    expect(screen.getByTestId("edit-dialog")).toHaveTextContent("Editing scheduled-2");
  });

  it("requires confirmation and cancels only the selected row", async () => {
    mocks.query.data = [baseRow, { ...baseRow, id: "scheduled-2" }];
    render(<ScheduledMessagesBanner target={target} />);
    expand();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel scheduled message" })[1]);

    expect(screen.getByText("Cancel scheduled message?")).toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel message" }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith("scheduled-2"));
    expect(mocks.success).toHaveBeenCalledWith("Scheduled message cancelled");
  });

  it("reports a cancellation failure without reporting success", async () => {
    mocks.query.data = [baseRow];
    mocks.mutateAsync.mockRejectedValue(new Error("Cancellation denied"));
    render(<ScheduledMessagesBanner target={target} />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "Cancel scheduled message" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel message" }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Cancellation denied"));
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("must show a loading state rather than pretending there are no schedules", () => {
    mocks.query.isLoading = true;
    render(<ScheduledMessagesBanner target={target} />);
    expect(screen.getByText(/Loading scheduled messages/i)).toBeInTheDocument();
  });

  it("must warn that existing schedules may still send when loading fails", () => {
    mocks.query.isError = true;
    mocks.query.error = new Error("Schedule lookup unavailable");
    render(<ScheduledMessagesBanner target={target} />);

    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/may still send/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(mocks.query.refetch).toHaveBeenCalledOnce();
  });

  it("must prevent duplicate cancellation requests while the first is pending", async () => {
    let release!: () => void;
    mocks.query.data = [baseRow];
    mocks.mutateAsync.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    render(<ScheduledMessagesBanner target={target} />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "Cancel scheduled message" }));
    const confirm = screen.getByRole("button", { name: "Cancel message" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  });
});
