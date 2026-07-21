import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNative: vi.fn(() => false),
  user: { id: "user-42", email: "alex@example.test" } as any,
  toast: vi.fn(),
  registerPasskey: vi.fn(),
  removeAccount: vi.fn(),
  storeNative: vi.fn(),
  registerLoading: false,
  from: vi.fn(),
  signInWithPassword: vi.fn(),
  listResult: { data: [] as any[], error: null as any },
  deleteResult: { error: null as any },
  listChain: undefined as any,
  deleteChain: undefined as any,
  deleteCall: vi.fn(),
  deleteEq: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: mocks.isNative } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/usePasskey", () => ({
  usePasskey: () => ({
    registerPasskey: mocks.registerPasskey,
    removeAccount: mocks.removeAccount,
    storeCredentialsForNativeBiometric: mocks.storeNative,
    loading: mocks.registerLoading,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    auth: { signInWithPassword: mocks.signInWithPassword },
  },
}));

import { PasskeyManagementDialog } from "./PasskeyManagementDialog";

const passkeys = [
  { id: "pk-ios", device_type: "ios", created_at: "2026-01-02T00:00:00Z", last_used_at: "2026-02-03T00:00:00Z" },
  { id: "pk-web", device_type: "windows", created_at: "2026-01-01T00:00:00Z", last_used_at: null },
];

function listQuery() {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => Promise.resolve(mocks.listResult));
  mocks.listChain = chain;
  return chain;
}

function deleteQuery() {
  const chain: any = {};
  mocks.deleteCall.mockImplementation(() => chain);
  mocks.deleteEq.mockImplementation(() => chain);
  chain.delete = mocks.deleteCall;
  chain.eq = mocks.deleteEq;
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.deleteResult).then(resolve),
  });
  mocks.deleteChain = chain;
  return chain;
}

function passkeyTable() {
  const list = listQuery();
  const deletion = deleteQuery();
  return {
    select: list.select,
    delete: deletion.delete,
  };
}

function renderDialog(props: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <PasskeyManagementDialog open={props.open ?? true} onOpenChange={props.onOpenChange ?? vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient, invalidate };
}

describe("PasskeyManagementDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: "user-42", email: "alex@example.test" };
    mocks.isNative.mockReturnValue(false);
    mocks.registerLoading = false;
    mocks.listResult = { data: [], error: null };
    mocks.deleteResult = { error: null };
    mocks.registerPasskey.mockResolvedValue({ success: true });
    mocks.removeAccount.mockResolvedValue(undefined);
    mocks.storeNative.mockResolvedValue({ success: true });
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.from.mockImplementation(() => passkeyTable());
  });

  it("loads passkeys for the exact authenticated user in newest-first order", async () => {
    mocks.listResult = { data: passkeys, error: null };
    renderDialog();
    expect(await screen.findByText("iPhone")).toBeInTheDocument();
    expect(screen.getByText("Windows PC")).toBeInTheDocument();
    expect(mocks.from).toHaveBeenCalledWith("user_passkeys");
    expect(mocks.listChain.select).toHaveBeenCalledWith("id, device_type, created_at, last_used_at");
    expect(mocks.listChain.eq).toHaveBeenCalledWith("user_id", "user-42");
    expect(mocks.listChain.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("does not query passkeys while the dialog is closed", () => {
    renderDialog({ open: false });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not allow passkey registration without an authenticated user", async () => {
    mocks.user = null;
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Add New Passkey" }));
    expect(mocks.registerPasskey).not.toHaveBeenCalled();
  });

  it("shows an explicit error rather than claiming there are no passkeys when loading is denied", async () => {
    mocks.listResult = { data: [], error: { message: "RLS denied" } };
    renderDialog();
    expect(await screen.findByText(/unable to load passkeys/i)).toBeInTheDocument();
    expect(screen.queryByText("No passkeys registered yet.")).not.toBeInTheDocument();
  });

  it("registers a browser passkey, reports success and refreshes the list", async () => {
    const { invalidate } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Add New Passkey" }));
    await waitFor(() => expect(mocks.registerPasskey).toHaveBeenCalledOnce());
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Passkey added!" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["user-passkeys"] });
  });

  it("keeps the list unchanged and reports registration failure", async () => {
    mocks.registerPasskey.mockResolvedValue({ success: false, error: "Authenticator unavailable" });
    const { invalidate } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Add New Passkey" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Failed to add passkey", description: "Authenticator unavailable", variant: "destructive",
    }));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("disables browser registration while the passkey hook is busy", async () => {
    mocks.registerLoading = true;
    renderDialog();
    expect(await screen.findByRole("button", { name: "Setting up..." })).toBeDisabled();
  });

  it("requires confirmation and scopes deletion to both passkey and current user", async () => {
    mocks.listResult = { data: [passkeys[0]], error: null };
    renderDialog();
    await screen.findByText("iPhone");
    fireEvent.click(screen.getByRole("button", { name: "" }));
    expect(screen.getByText("Remove Passkey?")).toBeInTheDocument();
    expect(mocks.deleteCall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocks.deleteCall).toHaveBeenCalledOnce());
    expect(mocks.deleteEq).toHaveBeenNthCalledWith(1, "id", "pk-ios");
    expect(mocks.deleteEq).toHaveBeenNthCalledWith(2, "user_id", "user-42");
  });

  it("removes local account metadata only after deleting the user's last passkey", async () => {
    mocks.listResult = { data: [passkeys[0]], error: null };
    renderDialog();
    await screen.findByText("iPhone");
    fireEvent.click(screen.getByRole("button", { name: "" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocks.removeAccount).toHaveBeenCalledWith("alex@example.test"));
  });

  it("retains local account metadata when another passkey remains", async () => {
    mocks.listResult = { data: passkeys, error: null };
    renderDialog();
    await screen.findByText("iPhone");
    fireEvent.click(screen.getAllByRole("button", { name: "" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Passkey removed" })));
    expect(mocks.removeAccount).not.toHaveBeenCalled();
  });

  it("does not remove local metadata and explains the backend error when deletion fails", async () => {
    mocks.listResult = { data: [passkeys[0]], error: null };
    mocks.deleteResult = { error: { message: "Delete denied" } };
    renderDialog();
    await screen.findByText("iPhone");
    fireEvent.click(screen.getByRole("button", { name: "" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Failed to remove passkey", description: "Delete denied", variant: "destructive",
    }));
    expect(mocks.removeAccount).not.toHaveBeenCalled();
  });

  it("requires the current password before enabling native biometric login", async () => {
    mocks.isNative.mockReturnValue(true);
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Add New Passkey" }));
    const enable = screen.getByRole("button", { name: "Enable" });
    expect(enable).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(enable);
    await waitFor(() => expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "alex@example.test", password: "correct-password",
    }));
    expect(mocks.storeNative).toHaveBeenCalledWith("alex@example.test", "correct-password");
  });

  it("never stores native credentials when password verification fails", async () => {
    mocks.isNative.mockReturnValue(true);
    mocks.signInWithPassword.mockResolvedValue({ error: { message: "invalid" } });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Add New Passkey" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Failed to enable biometrics", description: "Incorrect password", variant: "destructive",
    }));
    expect(mocks.storeNative).not.toHaveBeenCalled();
  });

  it("clears the native password when the prompt is cancelled", async () => {
    mocks.isNative.mockReturnValue(true);
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Add New Passkey" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "do-not-retain" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add New Passkey" }));
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });
});
