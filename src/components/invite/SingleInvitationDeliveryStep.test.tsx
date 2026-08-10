import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SingleInvitationDeliveryStep } from "./SingleInvitationDeliveryStep";

function renderStep(overrides = {}) {
  const props = {
    deliveryMethod: "share" as const,
    email: "",
    showMessageEditor: false,
    customMessage: "",
    onDeliveryMethodChange: vi.fn(),
    onEmailChange: vi.fn(),
    onMessageEditorChange: vi.fn(),
    onCustomMessageChange: vi.fn(),
    ...overrides,
  };
  render(<SingleInvitationDeliveryStep {...props} />);
  return props;
}

describe("SingleInvitationDeliveryStep", () => {
  it("defaults link delivery to a selected Share Link action without exposing email", () => {
    renderStep();
    expect(screen.getByRole("button", { name: "Share Link" })).toHaveClass("border-primary");
    expect(screen.queryByPlaceholderText("e.g., john@example.com")).not.toBeInTheDocument();
  });

  it("delegates switching between email and share delivery", () => {
    const props = renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Email" }));
    fireEvent.click(screen.getByRole("button", { name: "Share Link" }));
    expect(props.onDeliveryMethodChange).toHaveBeenNthCalledWith(1, "email");
    expect(props.onDeliveryMethodChange).toHaveBeenNthCalledWith(2, "share");
  });

  it("shows and delegates the email field only for email delivery", () => {
    const props = renderStep({ deliveryMethod: "email", email: "old@example.test" });
    const input = screen.getByPlaceholderText("e.g., john@example.com");
    expect(input).toHaveValue("old@example.test");
    fireEvent.change(input, { target: { value: "new@example.test" } });
    expect(props.onEmailChange).toHaveBeenCalledWith("new@example.test");
  });

  it("opens and closes the optional message editor through delegated state", () => {
    const closed = renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Add message" }));
    expect(closed.onMessageEditorChange).toHaveBeenCalledWith(true);
  });

  it("preserves and edits a custom invitation message", () => {
    const props = renderStep({ showMessageEditor: true, customMessage: "Welcome" });
    const input = screen.getByRole("textbox", { name: "Custom Message" });
    expect(input).toHaveValue("Welcome");
    fireEvent.change(input, { target: { value: "Welcome to the team" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(props.onCustomMessageChange).toHaveBeenCalledWith("Welcome to the team");
    expect(props.onMessageEditorChange).toHaveBeenCalledWith(false);
  });
});
