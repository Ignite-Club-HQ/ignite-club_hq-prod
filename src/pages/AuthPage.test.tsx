import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as any,
  profile: null as any,
  initialized: true,
  profileLoading: false,
  profileResolved: true,
  profileError: null as any,
  authLoading: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signInWithGoogle: vi.fn(),
  toast: vi.fn(),
  isOnline: true,
  isNative: false,
  isPlatformAvailable: vi.fn(),
  authenticatePasskey: vi.fn(),
  storeNative: vi.fn(),
  passkeyLoading: false,
  clearInvite: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => ({ isOnline: mocks.isOnline }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mocks.user,
    profile: mocks.profile,
    initialized: mocks.initialized,
    profileLoading: mocks.profileLoading,
    profileResolved: mocks.profileResolved,
    profileError: mocks.profileError,
    signIn: mocks.signIn,
    signUp: mocks.signUp,
    signInWithGoogle: mocks.signInWithGoogle,
    loading: mocks.authLoading,
  }),
}));
vi.mock("@/hooks/usePasskey", () => ({
  isPlatformAuthenticatorAvailable: mocks.isPlatformAvailable,
  usePasskey: () => ({
    isAvailable: true,
    isRegistered: true,
    nativeBiometricInfo: mocks.isNative ? { isAvailable: true, biometryType: "faceId", hasCredentials: true } : null,
    loading: mocks.passkeyLoading,
    authenticateWithPasskey: mocks.authenticatePasskey,
    storeCredentialsForNativeBiometric: mocks.storeNative,
  }),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.isNative } }));
vi.mock("@capacitor/keyboard", () => ({ Keyboard: { hide: vi.fn().mockResolvedValue(undefined), addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) } }));
vi.mock("@/components/ForgotPasswordDialog", () => ({ ForgotPasswordDialog: () => null }));
vi.mock("@/components/InviteFlowProgress", () => ({
  InviteFlowProgress: () => <div>Invite progress</div>,
  getInviteFlowContext: () => null,
  clearInviteFlowContext: mocks.clearInvite,
}));
vi.mock("@/lib/nativeBiometrics", () => ({ checkNativeBiometricAvailability: vi.fn() }));

import AuthPage from "./AuthPage";

function fillSignIn(email = "alex@example.test", password = "secret12") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}

function enterSignup() {
  fireEvent.click(screen.getByRole("button", { name: "Sign up here" }));
}

function fillSignup(password = "StrongPass1", confirm = password) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: confirm } });
}

describe("AuthPage critical journeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
    sessionStorage.clear();
    localStorage.clear();
    mocks.user = null;
    mocks.profile = null;
    mocks.initialized = true;
    mocks.profileLoading = false;
    mocks.profileResolved = true;
    mocks.profileError = null;
    mocks.authLoading = false;
    mocks.isOnline = true;
    mocks.isNative = false;
    mocks.passkeyLoading = false;
    mocks.signIn.mockResolvedValue({ error: null });
    mocks.signUp.mockResolvedValue({ error: null });
    mocks.signInWithGoogle.mockResolvedValue({ error: null });
    mocks.isPlatformAvailable.mockReturnValue(new Promise(() => {}));
    mocks.authenticatePasskey.mockResolvedValue({ success: true });
  });

  it("rejects malformed email before calling password sign-in", () => {
    render(<AuthPage />);
    fillSignIn("not-an-email", "secret12");
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Please enter a valid email" }));
  });

  it("rejects a too-short sign-in password before authentication", () => {
    render(<AuthPage />);
    fillSignIn("alex@example.test", "short");
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("submits the exact email and password once", async () => {
    render(<AuthPage />);
    fillSignIn();
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith("alex@example.test", "secret12"));
    expect(mocks.signIn).toHaveBeenCalledOnce();
  });

  it("does not submit duplicate password authentication on rapid clicks", async () => {
    let resolve!: (value: any) => void;
    mocks.signIn.mockReturnValue(new Promise((res) => { resolve = res; }));
    render(<AuthPage />);
    fillSignIn();
    const submit = screen.getByRole("button", { name: "Sign In" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(mocks.signIn).toHaveBeenCalledOnce();
    await act(async () => { resolve({ error: null }); });
  });

  it("uses a non-enumerating message for invalid credentials", async () => {
    mocks.signIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<AuthPage />);
    fillSignIn();
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Unable to sign in", description: "Invalid email or password. Please try again.",
    }));
  });

  it("translates network failures into a safe connection message", async () => {
    mocks.signIn.mockResolvedValue({ error: { message: "Network request failed" } });
    render(<AuthPage />);
    fillSignIn();
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Connection issue", description: "We couldn't reach the server. Check your connection and try again.",
    }));
  });

  it("shows an offline warning before a user attempts authentication", () => {
    mocks.isOnline = false;
    render(<AuthPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("You're offline");
  });

  it("requires signup password strength, confirmation and terms before signup", () => {
    render(<AuthPage />);
    enterSignup();
    fillSignup("weakpass", "different");
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Password not strong enough" }));
  });

  it("rejects mismatched strong signup passwords", () => {
    render(<AuthPage />);
    enterSignup();
    fillSignup("StrongPass1", "StrongPass2");
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Passwords don't match" }));
  });

  it("requires explicit terms acceptance before account creation", () => {
    render(<AuthPage />);
    enterSignup();
    fillSignup();
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Terms & Privacy Policy" }));
  });

  it("creates an account after all local validation succeeds", async () => {
    render(<AuthPage />);
    enterSignup();
    fillSignup();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith("alex@example.test", "StrongPass1"));
  });

  it("holds authenticated redirect until profile resolution completes", () => {
    mocks.user = { id: "user-42" };
    mocks.profileResolved = false;
    render(<AuthPage />);
    expect(screen.getByText("Finishing sign in...")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });

  it("sends incomplete profiles to profile completion", () => {
    mocks.user = { id: "user-42" };
    mocks.profile = { display_name: "" };
    render(<AuthPage />);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/complete-profile");
  });

  it("honours and consumes a pending post-authentication redirect", () => {
    mocks.user = { id: "user-42" };
    mocks.profile = { display_name: "Alex" };
    sessionStorage.setItem("redirectAfterAuth", "/invite/team-1");
    render(<AuthPage />);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/invite/team-1");
    expect(sessionStorage.getItem("redirectAfterAuth")).toBeNull();
  });
});
