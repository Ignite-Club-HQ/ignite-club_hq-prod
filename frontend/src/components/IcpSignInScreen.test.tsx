import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IcpSignInScreen, externalChromeHref } from "./IcpSignInScreen";
const chrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";
const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const props = { shellStyle: {}, onContinue: vi.fn(), busy: false, preparing: false, native: false, online: true, error: null, onUseEmail: vi.fn() };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); vi.clearAllMocks(); });
function ua(value: string) { vi.stubGlobal("navigator", { userAgent: value }); }
describe("adaptive secure sign-in controls", () => {
  it.each([chrome, safari])("calls the existing provider directly from the gesture", userAgent => {
    ua(userAgent); render(<IcpSignInScreen {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue securely" }));
    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(props.onUseEmail).not.toHaveBeenCalled();
  });
  it("offers email explicitly on an unrecognised device", () => {
    ua(chrome); render(<IcpSignInScreen {...props} showEmailOption />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with email" }));
    expect(props.onUseEmail).toHaveBeenCalledTimes(1);
    expect(props.onContinue).not.toHaveBeenCalled();
  });
  it("does not offer a competing primary email action on secure-only entry", () => {
    ua(chrome); render(<IcpSignInScreen {...props} />);
    expect(screen.queryByRole("button", { name: "Sign in with email" })).toBeNull();
  });
  it.each([{ busy: true }, { preparing: true }, { online: false }])("does not start authentication while unavailable: %j", state => {
    ua(chrome); render(<IcpSignInScreen {...props} {...state} />);
    const action = screen.getAllByRole("button")[0];
    if (!action) throw new Error("Missing sign-in action");
    fireEvent.click(action); expect(props.onContinue).not.toHaveBeenCalled();
  });
  it("retries the same provider after a failed or cancelled attempt", () => {
    ua(chrome); render(<IcpSignInScreen {...props} error="Sign-in was cancelled. Please try again." />);
    fireEvent.click(screen.getByRole("button", { name: "Continue securely" }));
    expect(props.onContinue).toHaveBeenCalledOnce();
  });
  it("preserves the invite destination in the external browser hand-off", () => {
    ua(`${chrome} FBAV/400`);
    vi.stubGlobal("window", { location: { href: "https://ignite.example/auth?auth=icp&invite=token" } });
    sessionStorage.setItem("redirectAfterAuth", "/invite/token?join=1#club");
    const href = externalChromeHref();
    expect(href).toContain("package=com.android.chrome");
    expect(href).toContain("invite=token");
    expect(href).toContain("next=%2Finvite%2Ftoken%3Fjoin%3D1%23club");
  });
});
