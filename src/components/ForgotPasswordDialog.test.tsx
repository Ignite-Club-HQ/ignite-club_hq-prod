import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
  redirectUrl: vi.fn(() => "https://test.local/reset-password?email=alex%40example.test"),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { resetPasswordForEmail: mocks.resetPasswordForEmail, verifyOtp: mocks.verifyOtp } },
}));
vi.mock("@/lib/passwordResetRedirect", () => ({ getPasswordResetRedirectUrl: mocks.redirectUrl }));
vi.mock("@/components/ui/input-otp", () => ({
  InputOTP: ({ value, onChange, disabled }: any) => (
    <input aria-label="6-digit code" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  ),
  InputOTPGroup: ({ children }: any) => <>{children}</>,
  InputOTPSlot: () => null,
}));

import { ForgotPasswordDialog } from "./ForgotPasswordDialog";

function renderDialog(defaultEmail = "") {
  const onOpenChange = vi.fn();
  render(<ForgotPasswordDialog open onOpenChange={onOpenChange} defaultEmail={defaultEmail} />);
  return { onOpenChange };
}

describe("ForgotPasswordDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({ error: null });
  });

  it("prefills a supplied account email", () => {
    renderDialog("alex@example.test");
    expect(screen.getByLabelText("Email Address")).toHaveValue("alex@example.test");
  });

  it("rejects an invalid email without requesting a reset", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Invalid email", description: "Please enter a valid email address",
    });
  });

  it("requests a recovery code with the exact email and approved redirect", async () => {
    renderDialog("alex@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
    await waitFor(() => expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      "alex@example.test",
      { redirectTo: "https://test.local/reset-password?email=alex%40example.test" },
    ));
    expect(mocks.redirectUrl).toHaveBeenCalledWith("alex@example.test");
    expect(await screen.findByText("alex@example.test")).toBeInTheDocument();
  });

  it("does not make duplicate reset requests while the first is pending", async () => {
    let resolve!: (value: any) => void;
    mocks.resetPasswordForEmail.mockReturnValue(new Promise((res) => { resolve = res; }));
    renderDialog("alex@example.test");
    const send = screen.getByRole("button", { name: "Send Code" });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledOnce();
    resolve({ error: null });
    await screen.findByLabelText("6-digit code");
  });

  it("does not advance to code entry when reset delivery fails", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { message: "Network request failed" } });
    renderDialog("alex@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
    await waitFor(() => expect(mocks.resetPasswordForEmail).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Send Code" })).toBeInTheDocument();
    expect(screen.queryByLabelText("6-digit code")).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/unable|failed/i) }));
  });

  it("allows a user who already has a code to enter it", () => {
    renderDialog("alex@example.test");
    fireEvent.click(screen.getByRole("button", { name: /Enter Code/ }));
    expect(screen.getByLabelText("6-digit code")).toBeInTheDocument();
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("does not verify incomplete codes", () => {
    renderDialog("alex@example.test");
    fireEvent.click(screen.getByRole("button", { name: /Enter Code/ }));
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "12345" } });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies a complete code as a recovery OTP for the exact email", async () => {
    renderDialog("alex@example.test");
    fireEvent.click(screen.getByRole("button", { name: /Enter Code/ }));
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: "alex@example.test", token: "123456", type: "recovery",
    }));
  });

  it("clears an invalid code, explains failure and remains in recovery", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    renderDialog("alex@example.test");
    fireEvent.click(screen.getByRole("button", { name: /Enter Code/ }));
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Invalid or expired code", description: "Double-check the code or request a new one.",
    }));
    expect(screen.getByLabelText("6-digit code")).toHaveValue("");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("closes and navigates to password reset only after successful OTP verification", async () => {
    const { onOpenChange } = renderDialog("alex@example.test");
    fireEvent.click(screen.getByRole("button", { name: /Enter Code/ }));
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/reset-password"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("starts a resend cooldown and does not claim resend success after delivery failure", async () => {
    renderDialog("alex@example.test");
    fireEvent.click(screen.getByRole("button", { name: /Enter Code/ }));
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { message: "Network request failed" } });
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(mocks.resetPasswordForEmail).toHaveBeenCalled());
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Code resent" }));
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("lets the user return and correct the email without verifying stale code", () => {
    renderDialog("old@example.test");
    fireEvent.click(screen.getByRole("button", { name: /Enter Code/ }));
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: /Use a different email/ }));
    expect(screen.getByRole("button", { name: "Send Code" })).toBeInTheDocument();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
