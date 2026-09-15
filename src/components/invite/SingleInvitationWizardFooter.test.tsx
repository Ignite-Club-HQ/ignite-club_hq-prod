import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SingleInvitationWizardFooter } from "./SingleInvitationWizardFooter";

function renderFooter(overrides = {}) {
  const props = {
    wizardStep: 1 as const,
    hasMemberIdentity: false,
    hasMemberName: false,
    selectedRole: "player" as const,
    hasNamedChild: false,
    deliveryMethod: "email" as const,
    email: "",
    isPending: false,
    onBack: vi.fn(),
    onNext: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  render(<SingleInvitationWizardFooter {...props} />);
  return props;
}

describe("SingleInvitationWizardFooter", () => {
  it("blocks an empty first step without showing an unnecessary warning", () => {
    renderFooter();
    expect(screen.getByRole("button", { name: "Enter a name to continue" })).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("advances a named member to role selection", () => {
    const props = renderFooter({ hasMemberName: true });
    fireEvent.click(screen.getByRole("button", { name: "Next: Choose role" }));
    expect(props.onNext).toHaveBeenCalledOnce();
  });

  it("requires a named child for a parent and delegates back navigation", () => {
    const props = renderFooter({ wizardStep: 2, hasMemberName: true, selectedRole: "parent" });
    expect(screen.getByRole("status")).toHaveTextContent("Add at least one child's name to continue.");
    expect(screen.getByRole("button", { name: "Add a child to continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it("allows an existing non-parent member to be added directly from step two", () => {
    const props = renderFooter({ wizardStep: 2, hasMemberIdentity: true });
    fireEvent.click(screen.getByRole("button", { name: "Add to Team" }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("requires a valid email for a new member's email invitation", () => {
    const missing = renderFooter({ wizardStep: 3, hasMemberName: true });
    expect(screen.getByRole("status")).toHaveTextContent("Enter an email address to send the invite.");
    expect(screen.getByRole("button", { name: "Create Invite" })).toBeDisabled();
    expect(missing.onSubmit).not.toHaveBeenCalled();
  });

  it("rejects malformed email but permits link delivery without an email", () => {
    const invalid = renderFooter({ wizardStep: 3, hasMemberName: true, email: "invalid" });
    expect(screen.getByRole("status")).toHaveTextContent("That email doesn't look right");
    expect(screen.getByRole("button", { name: "Create Invite" })).toBeDisabled();

    const link = renderFooter({ wizardStep: 3, hasMemberName: true, deliveryMethod: "share" });
    const buttons = screen.getAllByRole("button", { name: "Create Invite" });
    fireEvent.click(buttons[1]);
    expect(link.onSubmit).toHaveBeenCalledOnce();
    expect(invalid.onSubmit).not.toHaveBeenCalled();
  });

  it("disables final actions while a mutation is pending", () => {
    renderFooter({ wizardStep: 3, hasMemberName: true, email: "member@example.test", isPending: true });
    expect(screen.getByRole("button", { name: "Create Invite" })).toBeDisabled();
  });
});
