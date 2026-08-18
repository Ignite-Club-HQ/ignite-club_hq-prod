import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getTeamRoleOptions } from "@/features/membership/invitationPolicy";
import { SingleInvitationRoleStep } from "./SingleInvitationRoleStep";

function renderStep(overrides = {}) {
  const props = {
    wizardStep: 2 as const,
    personName: "Parent A",
    isExistingUser: false,
    selectedRole: "parent" as const,
    roleOptions: getTeamRoleOptions("junior"),
    onEditPerson: vi.fn(),
    onEditRole: vi.fn(),
    onRoleChange: vi.fn(),
    ...overrides,
  };
  const ref = createRef<HTMLDivElement>();
  render(<SingleInvitationRoleStep ref={ref} {...props} />);
  return { props, ref };
}

describe("SingleInvitationRoleStep", () => {
  it("shows a new-person recap and delegates editing the person", () => {
    const { props } = renderStep();
    expect(screen.getByText("Parent A")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit selected person" }));
    expect(props.onEditPerson).toHaveBeenCalledOnce();
  });

  it("does not label an existing user as new", () => {
    renderStep({ isExistingUser: true });
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("renders only policy-provided roles and exposes the current selection", () => {
    renderStep();
    expect(screen.getByRole("radio", { name: "Role: Parent" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Role: Coach" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Role: Team Admin" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Role: Adult Player" })).not.toBeInTheDocument();
  });

  it("delegates role selection and preserves the parent child hint", () => {
    const { props } = renderStep();
    expect(screen.getByText("adds child player")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Role: Coach" }));
    expect(props.onRoleChange).toHaveBeenCalledWith("coach");
  });

  it("forwards the role section ref used by wizard scrolling", () => {
    const { ref } = renderStep();
    expect(ref.current).toHaveTextContent("Select role");
  });

  it("shows the chosen role recap only on step three and delegates editing it", () => {
    const { props } = renderStep({ wizardStep: 3, selectedRole: "team_admin" });
    expect(screen.queryByText("Select role")).not.toBeInTheDocument();
    expect(screen.getByText("Team Admin")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit selected role" }));
    expect(props.onEditRole).toHaveBeenCalledOnce();
  });

  it("renders no recap or role controls on the person step", () => {
    renderStep({ wizardStep: 1 });
    expect(screen.queryByRole("button", { name: "Edit selected person" })).not.toBeInTheDocument();
    expect(screen.queryByText("Select role")).not.toBeInTheDocument();
  });
});
