import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), toast: vi.fn(), exchange: vi.fn(), getSession: vi.fn(),
  onAuthStateChange: vi.fn(), unsubscribe: vi.fn(), updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(), verifyOtp: vi.fn(), getUser: vi.fn(),
  authCallback: undefined as any,
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } }));
vi.mock("@capacitor/keyboard", () => ({ Keyboard: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) } }));
vi.mock("@/lib/passwordResetRedirect", () => ({ getPasswordResetRedirectUrl: (email: string) => `https://test.local/verify-reset-code?email=${encodeURIComponent(email)}` }));
vi.mock("@/components/ui/input-otp", () => ({
  InputOTP: ({ value, onChange, disabled }: any) => <input aria-label="Recovery code" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />,
  InputOTPGroup: ({ children }: any) => <>{children}</>, InputOTPSlot: () => null,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {
  exchangeCodeForSession: mocks.exchange, getSession: mocks.getSession,
  onAuthStateChange: mocks.onAuthStateChange, updateUser: mocks.updateUser,
  resetPasswordForEmail: mocks.resetPasswordForEmail, verifyOtp: mocks.verifyOtp,
  getUser: mocks.getUser,
} } }));

import ResetPasswordPage from "./ResetPasswordPage";

async function renderAndResolveSession(session: any = { user: { id: "user-42" } }) {
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
  render(<ResetPasswordPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}

function fillPasswords(password = "StrongPass1", confirm = password) {
  fireEvent.change(screen.getByLabelText("New Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: confirm } });
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    window.history.replaceState({}, "", "/reset-password");
    mocks.exchange.mockResolvedValue({ error: null });
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-42" } } }, error: null });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { email: "alex@example.test" } } });
    mocks.onAuthStateChange.mockImplementation((callback) => {
      mocks.authCallback = callback;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
  });
  afterEach(() => vi.useRealTimers());

  it("does not expose an actionable password reset before recovery session validation completes", () => {
    mocks.getSession.mockReturnValue(new Promise(() => {}));
    render(<ResetPasswordPage />);
    expect(screen.queryByRole("button", { name: "Reset Password" })).not.toBeInTheDocument();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("shows an expired-link recovery state when no session exists", async () => {
    await renderAndResolveSession(null);
    expect(screen.getByText(/Invalid or expired reset link/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use a 6-digit code instead" })).toBeInTheDocument();
  });

  it("exchanges a PKCE code before checking the resulting session and cleans the URL", async () => {
    window.history.replaceState({}, "", "/reset-password?code=pkce-code");
    await renderAndResolveSession();
    expect(mocks.exchange).toHaveBeenCalledWith("pkce-code");
    expect(window.location.pathname).toBe("/reset-password");
    expect(window.location.search).toBe("");
  });

  it("fails closed when PKCE exchange is rejected", async () => {
    window.history.replaceState({}, "", "/reset-password?code=bad-code");
    mocks.exchange.mockResolvedValue({ error: { message: "expired" } });
    render(<ResetPasswordPage />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText(/Invalid or expired reset link/i)).toBeInTheDocument();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("clears an expired-link error when PASSWORD_RECOVERY establishes a session", async () => {
    await renderAndResolveSession(null);
    expect(screen.getByText(/Invalid or expired reset link/i)).toBeInTheDocument();
    act(() => mocks.authCallback("PASSWORD_RECOVERY"));
    expect(screen.getByRole("button", { name: "Reset Password" })).toBeInTheDocument();
  });

  it("rejects weak and mismatched passwords without updating the user", async () => {
    await renderAndResolveSession();
    fillPasswords("weak", "different");
    fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Please check your password" }));
  });

  it("updates only the password after local validation succeeds", async () => {
    await renderAndResolveSession();
    fillPasswords();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reset Password" })); });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "StrongPass1" });
  });

  it("prevents duplicate password updates while the first update is pending", async () => {
    let resolve!: (value: any) => void;
    mocks.updateUser.mockReturnValue(new Promise((res) => { resolve = res; }));
    await renderAndResolveSession(); fillPasswords();
    const submit = screen.getByRole("button", { name: "Reset Password" });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(mocks.updateUser).toHaveBeenCalledOnce();
    await act(async () => resolve({ error: { message: "expired" } }));
  });

  it("does not show success when the recovery session expires during update", async () => {
    mocks.updateUser.mockResolvedValue({ error: { message: "Auth session missing" } });
    await renderAndResolveSession(); fillPasswords();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reset Password" })); });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Unable to reset password", description: "Auth session missing",
    });
    expect(screen.queryByText("Password reset successful!")).not.toBeInTheDocument();
  });

  it("shows success and redirects only after the password update succeeds", async () => {
    await renderAndResolveSession(); fillPasswords();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reset Password" })); });
    expect(screen.getByText("Password reset successful!")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("validates fallback email before requesting a recovery code", async () => {
    await renderAndResolveSession(null);
    fireEvent.click(screen.getByRole("button", { name: "Use a 6-digit code instead" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("does not claim a fallback code was sent when delivery fails", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { message: "Network failed" } });
    await renderAndResolveSession(null);
    fireEvent.click(screen.getByRole("button", { name: "Use a 6-digit code instead" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.test" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send code" })); });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Code sent" }));
  });

  it("does not verify a recovery code until a valid email is supplied", async () => {
    await renderAndResolveSession(null);
    fireEvent.click(screen.getByRole("button", { name: "Use a 6-digit code instead" }));
    await act(async () => { fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "123456" } }); });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies fallback OTP with exact recovery scope and reveals the password form on success", async () => {
    await renderAndResolveSession(null);
    fireEvent.click(screen.getByRole("button", { name: "Use a 6-digit code instead" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.test" } });
    await act(async () => { fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "123456" } }); });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "alex@example.test", token: "123456", type: "recovery" });
    expect(screen.getByRole("button", { name: "Reset Password" })).toBeInTheDocument();
  });

  it("unsubscribes from auth recovery events on unmount", () => {
    const { unmount } = render(<ResetPasswordPage />);
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
