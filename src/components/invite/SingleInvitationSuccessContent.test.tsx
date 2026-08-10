import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { SingleInvitationSuccessContent } from "./SingleInvitationSuccessContent";

function renderContent(overrides = {}) {
  const props = {
    memberName: "Parent A", isParent: true, childNames: ["Child A"], teamName: "Under 8 Blue",
    invitedEmail: "parent@example.test", phone: "+61 412 345 678", shareMessage: " Join the team ", isAndroid: true,
    onPhoneChange: vi.fn(), onOpenSms: vi.fn(), onOpenWhatsApp: vi.fn(), onMoreShare: vi.fn(),
    onCopyLink: vi.fn(), onAddAnother: vi.fn(), onDone: vi.fn(), ...overrides,
  };
  render(<Sheet open><SingleInvitationSuccessContent {...props} /></Sheet>);
  return props;
}

describe("SingleInvitationSuccessContent", () => {
  it("renders exact parent, child, team and email outcomes", () => {
    renderContent();
    expect(screen.getByText("Parent A")).toBeInTheDocument();
    expect(screen.getByText("Child A added to Under 8 Blue")).toBeInTheDocument();
    expect(screen.getByText("Invite sent to parent@example.test")).toBeInTheDocument();
  });

  it("renders multiple children and link-only delivery without inventing an email", () => {
    renderContent({ childNames: ["Child A", "Child B"], invitedEmail: "" });
    expect(screen.getByText("Child A, Child B added to Under 8 Blue")).toBeInTheDocument();
    expect(screen.getByText("Invite link created — share it with them")).toBeInTheDocument();
  });

  it("delegates sanitized Android SMS and WhatsApp destinations", () => {
    const props = renderContent();
    fireEvent.click(screen.getByRole("button", { name: "SMS" }));
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
    expect(props.onOpenSms).toHaveBeenCalledWith("sms:+61412345678?body=Join%20the%20team");
    expect(props.onOpenWhatsApp).toHaveBeenCalledWith("https://wa.me/61412345678?text=Join%20the%20team");
  });

  it("uses the established iOS SMS separator and phone-less fallbacks", () => {
    const withPhone = renderContent({ isAndroid: false });
    fireEvent.click(screen.getByRole("button", { name: "SMS" }));
    expect(withPhone.onOpenSms).toHaveBeenCalledWith("sms:+61412345678&body=Join%20the%20team");
  });

  it("delegates editing, sharing, copying, reset and completion independently", () => {
    const props = renderContent();
    fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: "0400" } });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Link" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Another" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onPhoneChange).toHaveBeenCalledWith("0400");
    expect(props.onMoreShare).toHaveBeenCalledOnce();
    expect(props.onCopyLink).toHaveBeenCalledOnce();
    expect(props.onAddAnother).toHaveBeenCalledOnce();
    expect(props.onDone).toHaveBeenCalledOnce();
  });
});
