import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  checkNative: vi.fn(),
  authenticateNative: vi.fn(),
  storeNative: vi.fn(),
  deleteNative: vi.fn(),
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  setSession: vi.fn(),
  invoke: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));
vi.mock("@/lib/nativeBiometrics", () => ({
  checkNativeBiometricAvailability: mocks.checkNative,
  authenticateWithNativeBiometric: mocks.authenticateNative,
  storeCredentialsForBiometric: mocks.storeNative,
  deleteStoredCredentials: mocks.deleteNative,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      signInWithPassword: mocks.signInWithPassword,
      setSession: mocks.setSession,
    },
    functions: { invoke: mocks.invoke },
    from: mocks.from,
  },
}));

import {
  addStoredPasskeyAccount,
  getLastUsedAccount,
  getRememberMe,
  getStoredPasskeyAccounts,
  getStoredPasskeyEmail,
  isPlatformAuthenticatorAvailable,
  removeStoredPasskeyAccount,
  setLastUsedAccount,
  setRememberMe,
  setStoredPasskeyAccounts,
  syncPasskeyAccountsFromDatabase,
  usePasskey,
} from "./usePasskey";

const availability = {
  isAvailable: true,
  biometryType: "faceId" as const,
  hasCredentials: true,
};

function bytes(...values: number[]) {
  return new Uint8Array(values).buffer;
}

function webCredential(kind: "create" | "get") {
  return {
    id: "credential-1",
    rawId: bytes(1, 2, 3),
    type: "public-key",
    response: kind === "create"
      ? { clientDataJSON: bytes(4), attestationObject: bytes(5) }
      : {
          clientDataJSON: bytes(4),
          authenticatorData: bytes(5),
          signature: bytes(6),
          userHandle: bytes(7),
        },
  };
}

function registrationOptions() {
  return {
    challenge: "AQID",
    rp: { name: "Ignite", id: "test.local" },
    user: { id: "BAUG", name: "alex@example.test", displayName: "Alex" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  };
}

function authenticationOptions() {
  return {
    challenge: "AQID",
    rpId: "test.local",
    allowCredentials: [{ id: "BAUG", type: "public-key", transports: ["internal"] }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

async function readyHook() {
  const hook = renderHook(() => usePasskey());
  await waitFor(() => expect(mocks.checkNative).not.toHaveBeenCalled());
  return hook;
}

describe("passkey account storage", () => {
  beforeEach(() => localStorage.clear());

  it("returns no accounts when storage is empty or corrupted", () => {
    expect(getStoredPasskeyAccounts()).toEqual([]);
    localStorage.setItem("ignite_passkey_accounts", "not-json");
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it("rejects structurally invalid stored account data", () => {
    localStorage.setItem("ignite_passkey_accounts", JSON.stringify({ email: "not-an-array@example.test" }));
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it("stores and returns a supplied account list", () => {
    const accounts = [{ email: "alex@example.test", displayName: "Alex", addedAt: "2026-01-01" }];
    setStoredPasskeyAccounts(accounts);
    expect(getStoredPasskeyAccounts()).toEqual(accounts);
  });

  it("deduplicates email addresses case-insensitively while retaining addedAt", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    addStoredPasskeyAccount("Alex@Example.test", "Old name");
    const addedAt = getStoredPasskeyAccounts()[0].addedAt;
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    addStoredPasskeyAccount("alex@example.test", "New name");

    expect(getStoredPasskeyAccounts()).toEqual([{ email: "alex@example.test", displayName: "New name", addedAt }]);
    vi.useRealTimers();
  });

  it("removes only the matching account case-insensitively", () => {
    setStoredPasskeyAccounts([
      { email: "alex@example.test", addedAt: "1" },
      { email: "sam@example.test", addedAt: "2" },
    ]);
    removeStoredPasskeyAccount("ALEX@example.test");
    expect(getStoredPasskeyAccounts().map((account) => account.email)).toEqual(["sam@example.test"]);
  });

  it("prefers the last-used stored account and ignores an orphaned preference", () => {
    setStoredPasskeyAccounts([
      { email: "alex@example.test", addedAt: "1" },
      { email: "sam@example.test", addedAt: "2" },
    ]);
    setLastUsedAccount("SAM@example.test");
    expect(getStoredPasskeyEmail()).toBe("sam@example.test");
    setLastUsedAccount("missing@example.test");
    expect(getStoredPasskeyEmail()).toBe("alex@example.test");
  });

  it("sets and clears remember-me and last-used preferences", () => {
    setRememberMe(true);
    setLastUsedAccount("alex@example.test");
    expect(getRememberMe()).toBe(true);
    expect(getLastUsedAccount()).toBe("alex@example.test");
    setRememberMe(false);
    setLastUsedAccount(null);
    expect(getRememberMe()).toBe(false);
    expect(getLastUsedAccount()).toBeNull();
  });
});

describe("usePasskey browser authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.isNativePlatform.mockReturnValue(false);
    mocks.getSession.mockResolvedValue({ data: { session: { user: {
      email: "alex@example.test", user_metadata: { full_name: "Alex Rivers" },
    } } } });
    mocks.setSession.mockResolvedValue({ error: null });
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: class { static isUserVerifyingPlatformAuthenticatorAvailable = vi.fn().mockResolvedValue(true); },
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { create: vi.fn(), get: vi.fn() },
    });
  });

  it("reports unavailable when the browser has no WebAuthn implementation", async () => {
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });
    await expect(isPlatformAuthenticatorAvailable()).resolves.toBe(false);
  });

  it("treats an authenticator availability exception as unavailable", async () => {
    vi.mocked(PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable).mockRejectedValue(new Error("blocked"));
    await expect(isPlatformAuthenticatorAvailable()).resolves.toBe(false);
  });

  it("refuses registration without an authenticated user before invoking an Edge Function", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    const { result } = await readyHook();
    let outcome: Awaited<ReturnType<typeof result.current.registerPasskey>>;
    await act(async () => { outcome = await result.current.registerPasskey(); });
    expect(outcome!).toEqual({ success: false, error: "You must be logged in to register a passkey" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("stops when registration options fail and never opens the authenticator", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    const { result } = await readyHook();
    let outcome: any;
    await act(async () => { outcome = await result.current.registerPasskey(); });
    expect(outcome.success).toBe(false);
    expect(navigator.credentials.create).not.toHaveBeenCalled();
  });

  it("maps browser cancellation to a stable registration error", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { options: registrationOptions() }, error: null });
    vi.mocked(navigator.credentials.create).mockRejectedValue(Object.assign(new Error("cancel"), { name: "NotAllowedError" }));
    const { result } = await readyHook();
    let outcome: any;
    await act(async () => { outcome = await result.current.registerPasskey(); });
    expect(outcome).toEqual({ success: false, error: "Passkey registration was cancelled or timed out" });
    expect(result.current.loading).toBe(false);
  });

  it("does not remember an account when registration verification fails", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { options: registrationOptions() }, error: null })
      .mockResolvedValueOnce({ data: { success: false, error: "Invalid attestation" }, error: null });
    vi.mocked(navigator.credentials.create).mockResolvedValue(webCredential("create") as any);
    const { result } = await readyHook();
    await act(async () => { await result.current.registerPasskey(); });
    expect(getStoredPasskeyAccounts()).toEqual([]);
    expect(getLastUsedAccount()).toBeNull();
  });

  it("registers a verified credential and remembers the authenticated account", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { options: registrationOptions() }, error: null })
      .mockResolvedValueOnce({ data: { success: true }, error: null });
    vi.mocked(navigator.credentials.create).mockResolvedValue(webCredential("create") as any);
    const { result } = await readyHook();
    let outcome: any;
    await act(async () => { outcome = await result.current.registerPasskey(); });
    expect(outcome).toEqual({ success: true });
    expect(getStoredPasskeyAccounts()).toEqual([expect.objectContaining({
      email: "alex@example.test", displayName: "Alex Rivers",
    })]);
    expect(getLastUsedAccount()).toBe("alex@example.test");
  });

  it("does not report authentication success when verification returns no session", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { options: authenticationOptions() }, error: null })
      .mockResolvedValueOnce({ data: { success: true, userEmail: "alex@example.test" }, error: null });
    vi.mocked(navigator.credentials.get).mockResolvedValue(webCredential("get") as any);
    const { result } = await readyHook();
    let outcome: any;
    await act(async () => { outcome = await result.current.authenticateWithPasskey("alex@example.test"); });
    expect(outcome.success).toBe(false);
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("fails authentication when returned tokens cannot establish a session", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { options: authenticationOptions() }, error: null })
      .mockResolvedValueOnce({ data: { success: true, session: { access_token: "access", refresh_token: "refresh" } }, error: null });
    mocks.setSession.mockResolvedValue({ error: { message: "invalid session" } });
    vi.mocked(navigator.credentials.get).mockResolvedValue(webCredential("get") as any);
    const { result } = await readyHook();
    let outcome: any;
    await act(async () => { outcome = await result.current.authenticateWithPasskey("alex@example.test"); });
    expect(outcome).toEqual({ success: false, error: "Failed to establish session" });
  });

  it("establishes the verified session and records the selected account", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: { options: authenticationOptions() }, error: null })
      .mockResolvedValueOnce({ data: {
        success: true,
        userEmail: "alex@example.test",
        session: { access_token: "access", refresh_token: "refresh" },
      }, error: null });
    vi.mocked(navigator.credentials.get).mockResolvedValue(webCredential("get") as any);
    const { result } = await readyHook();
    let outcome: any;
    await act(async () => { outcome = await result.current.authenticateWithPasskey("alex@example.test"); });
    expect(outcome).toEqual({ success: true, userEmail: "alex@example.test" });
    expect(mocks.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    expect(getLastUsedAccount()).toBe("alex@example.test");
  });

  it("prevents concurrent authentication requests", async () => {
    const pending = deferred<any>();
    mocks.invoke.mockReturnValue(pending.promise);
    const { result } = await readyHook();
    let first!: Promise<any>;
    let second!: Promise<any>;
    act(() => {
      first = result.current.authenticateWithPasskey("alex@example.test");
      second = result.current.authenticateWithPasskey("alex@example.test");
    });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    pending.resolve({ data: null, error: { message: "stop" } });
    await act(async () => { await Promise.all([first, second]); });
  });
});

describe("usePasskey native authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.checkNative.mockResolvedValue(availability);
    mocks.deleteNative.mockResolvedValue(undefined);
    mocks.signInWithPassword.mockResolvedValue({ error: null });
  });

  it("uses only native biometrics and stored credentials on native platforms", async () => {
    mocks.authenticateNative.mockResolvedValue({ success: true, email: "alex@example.test", password: "secret" });
    const { result } = renderHook(() => usePasskey());
    await waitFor(() => expect(result.current.isAvailable).toBe(true));
    let outcome: any;
    await act(async () => { outcome = await result.current.authenticateWithPasskey(); });
    expect(outcome).toEqual({ success: true, userEmail: "alex@example.test" });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "alex@example.test", password: "secret" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("deletes invalid stored credentials after Supabase rejects them", async () => {
    mocks.authenticateNative.mockResolvedValue({ success: true, email: "alex@example.test", password: "stale" });
    mocks.signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const { result } = renderHook(() => usePasskey());
    await waitFor(() => expect(result.current.isAvailable).toBe(true));
    let outcome: any;
    await act(async () => { outcome = await result.current.authenticateWithPasskey(); });
    expect(outcome.success).toBe(false);
    expect(mocks.deleteNative).toHaveBeenCalledOnce();
  });

  it("refuses native credential storage on web without touching the native provider", async () => {
    mocks.isNativePlatform.mockReturnValue(false);
    const { result } = renderHook(() => usePasskey());
    let outcome: any;
    await act(async () => { outcome = await result.current.storeCredentialsForNativeBiometric("alex@example.test", "secret"); });
    expect(outcome).toEqual({ success: false, error: "Not on native platform" });
    expect(mocks.storeNative).not.toHaveBeenCalled();
  });

  it("clears native secure credentials and local account metadata together", async () => {
    setStoredPasskeyAccounts([{ email: "alex@example.test", addedAt: "1" }]);
    setLastUsedAccount("alex@example.test");
    const { result } = renderHook(() => usePasskey());
    await waitFor(() => expect(result.current.isAvailable).toBe(true));
    await act(async () => { await result.current.clearPasskey(); });
    expect(mocks.deleteNative).toHaveBeenCalled();
    expect(getStoredPasskeyAccounts()).toEqual([]);
    expect(getLastUsedAccount()).toBeNull();
  });
});

describe("passkey database reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  function passkeyQuery(result: any) {
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => Promise.resolve(result));
    mocks.from.mockReturnValue(chain);
    return chain;
  }

  it("restores local account metadata only when the exact user has a database passkey", async () => {
    const chain = passkeyQuery({ data: [{ id: "passkey-1" }], error: null });
    await syncPasskeyAccountsFromDatabase("user-42", "alex@example.test", "Alex");
    expect(mocks.from).toHaveBeenCalledWith("user_passkeys");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-42");
    expect(getStoredPasskeyAccounts()).toEqual([expect.objectContaining({ email: "alex@example.test" })]);
  });

  it("removes orphaned local metadata when the exact user has no database passkey", async () => {
    setStoredPasskeyAccounts([{ email: "alex@example.test", addedAt: "1" }]);
    passkeyQuery({ data: [], error: null });
    await syncPasskeyAccountsFromDatabase("user-42", "ALEX@example.test");
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it("does not mutate local metadata when reconciliation is denied", async () => {
    setStoredPasskeyAccounts([{ email: "alex@example.test", addedAt: "1" }]);
    passkeyQuery({ data: null, error: { message: "RLS denied" } });
    await syncPasskeyAccountsFromDatabase("user-42", "alex@example.test");
    expect(getStoredPasskeyAccounts()).toHaveLength(1);
  });
});
