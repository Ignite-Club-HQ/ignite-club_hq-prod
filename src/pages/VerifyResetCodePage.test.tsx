import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(), navigate: vi.fn(), toast: vi.fn(),
  verifyOtp: vi.fn(), resetPasswordForEmail: vi.fn(), pageTitle: vi.fn(),
  redirect: vi.fn((email: string) => `https://test.local/verify-reset-code?email=${encodeURIComponent(email)}`),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [mocks.params], useNavigate: () => mocks.navigate,
  Link: ({ to, children }: any) => <a href={to}>{children}</a>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: mocks.pageTitle }));
vi.mock("@/lib/passwordResetRedirect", () => ({ getPasswordResetRedirectUrl: mocks.redirect }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {
  verifyOtp: mocks.verifyOtp, resetPasswordForEmail: mocks.resetPasswordForEmail,
} } }));
vi.mock("@/components/ui/input-otp", () => ({
  InputOTP: ({ value, onChange, disabled }: any) => <input aria-label="6-digit code" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />,
  InputOTPGroup: ({ children }: any) => <>{children}</>, InputOTPSlot: () => null,
}));

import VerifyResetCodePage from "./VerifyResetCodePage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("VerifyResetCodePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.params = new URLSearchParams();
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it("sets the recovery-specific page title", () => {
    render(<VerifyResetCodePage />);
    expect(mocks.pageTitle).toHaveBeenCalledWith("Verify Reset Code");
  });

  it("prefills email from the URL without starting verification by itself", () => {
    mocks.params = new URLSearchParams("email=alex%40example.test");
    render(<VerifyResetCodePage />);
    expect(screen.getByLabelText("Email")).toHaveValue("alex@example.test");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("auto-verifies only a six-digit numeric URL code", async () => {
    mocks.params = new URLSearchParams("email=alex%40example.test&code=123456");
    render(<VerifyResetCodePage />);
    await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: "alex@example.test", token: "123456", type: "recovery",
    }));
  });

  it.each(["12345", "1234567", "ABC123"])('does not auto-verify malformed URL code "%s"', (code) => {
    mocks.params = new URLSearchParams(`email=alex%40example.test&code=${code}`);
    render(<VerifyResetCodePage />);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("validates email before manual OTP verification", async () => {
    render(<VerifyResetCodePage />);
    await act(async () => fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } }));
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Invalid email", description: "Please enter a valid email address" });
  });

  it("does not submit incomplete manual codes", () => {
    render(<VerifyResetCodePage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.test" } });
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "12345" } });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects non-numeric six-character manual codes before Supabase", async () => {
    render(<VerifyResetCodePage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.test" } });
    await act(async () => fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "ABC123" } }));
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("navigates to reset only after successful recovery verification", async () => {
    render(<VerifyResetCodePage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.test" } });
    await act(async () => fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } }));
    expect(mocks.navigate).toHaveBeenCalledWith("/reset-password");
  });

  it("clears an invalid code and remains on the verification page", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    render(<VerifyResetCodePage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.test" } });
    await act(async () => fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } }));
    expect(screen.getByLabelText("6-digit code")).toHaveValue("");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invalid or expired code" }));
  });

  it("prevents concurrent manual OTP verification", async () => {
    const pending = deferred<any>();
    mocks.verifyOtp.mockReturnValue(pending.promise);
    render(<VerifyResetCodePage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.test" } });
    const code = screen.getByLabelText("6-digit code");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.change(code, { target: { value: "654321" } });
    expect(mocks.verifyOtp).toHaveBeenCalledOnce();
    pending.resolve({ error: { message: "expired" } });
    await act(async () => { await pending.promise; });
  });

  it("validates email before resend and constructs the exact redirect", async () => {
    render(<VerifyResetCodePage />);
    fireEvent.click(screen.getByRole("button", { name: "Resend code to this email" }));
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.test" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resend code to this email" })));
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("alex@example.test", {
      redirectTo: "https://test.local/verify-reset-code?email=alex%40example.test",
    });
  });

  it("uses the same non-enumerating resend response for a returned Supabase error", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { message: "account not found" } });
    render(<VerifyResetCodePage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "unknown@example.test" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resend code to this email" })));
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Code sent", description: "Check your email for a 6-digit code." });
  });

  it("links back to sign in without initiating an auth operation", () => {
    render(<VerifyResetCodePage />);
    expect(screen.getByRole("link", { name: /Back to sign in/ })).toHaveAttribute("href", "/auth");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
