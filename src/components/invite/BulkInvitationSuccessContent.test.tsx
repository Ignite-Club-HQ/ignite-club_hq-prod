import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { BulkInvitationSuccessContent } from "./BulkInvitationSuccessContent";

const results = [
  { name: "Sent Member", email: "sent@example.test", link: "/join/p/sent", sent: true },
  { name: "Failed Member", email: "failed@example.test", link: "/join/p/failed", sent: false },
  { name: "Link Member", email: "", link: "/join/p/link", sent: false },
];

function renderContent(overrides: Partial<ComponentProps<typeof BulkInvitationSuccessContent>> = {}) {
  const props = {
    results,
    onCopyLink: vi.fn(),
    onAddMore: vi.fn(),
    onDone: vi.fn(),
    ...overrides,
  };
  render(<Sheet open><BulkInvitationSuccessContent {...props} /></Sheet>);
  return props;
}

describe("BulkInvitationSuccessContent", () => {
  it("reports the exact successful count and every recipient", () => {
    renderContent();
    expect(screen.getByText("3 Members Added")).toBeInTheDocument();
    expect(screen.getByText("Sent Member")).toBeInTheDocument();
    expect(screen.getByText("Failed Member")).toBeInTheDocument();
    expect(screen.getByText("Link Member")).toBeInTheDocument();
  });

  it("distinguishes sent, failed-email and link-only outcomes", () => {
    renderContent();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Link only")).toBeInTheDocument();
  });

  it("delegates the exact selected result when its link is copied", () => {
    const props = renderContent();
    fireEvent.click(screen.getAllByRole("button", { name: "Copy link" })[1]);
    expect(props.onCopyLink).toHaveBeenCalledOnce();
    expect(props.onCopyLink).toHaveBeenCalledWith(results[1]);
  });

  it("delegates Add More and Done independently", () => {
    const props = renderContent();
    fireEvent.click(screen.getByRole("button", { name: "Add More" }));
    expect(props.onAddMore).toHaveBeenCalledOnce();
    expect(props.onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onDone).toHaveBeenCalledOnce();
  });
});
