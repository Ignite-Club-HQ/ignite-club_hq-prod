import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), invoke: vi.fn(), signOut: vi.fn(), toast: vi.fn(), navigate: vi.fn(),
  createObjectURL: vi.fn(), revokeObjectURL: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" }, signOut: mocks.signOut }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: mocks.getSession }, functions: { invoke: mocks.invoke },
} }));
vi.mock("@/lib/safeOpenUrl", () => ({ safeOpenUrl: vi.fn() }));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: any) => <>{children}</>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogAction: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));

import AccountPage from "./AccountPage";

describe("AccountPage destructive and export actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token-1" } }, error: null });
    mocks.invoke.mockResolvedValue({ data: { deletionDate: "2099-08-20T00:00:00Z" }, error: null });
    mocks.signOut.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: vi.fn(), blob: vi.fn().mockResolvedValue(new Blob(["export"])),
    }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: mocks.createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: mocks.revokeObjectURL });
    mocks.createObjectURL.mockReturnValue("blob:export-1");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("requires explicit confirmation before scheduling deletion", () => {
    render(<AccountPage />);
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete My Account" }));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("uses the current session token and signs out only after successful deletion scheduling", async () => {
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("delete-account", {
      headers: { Authorization: "Bearer token-1" },
    }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Account scheduled for deletion" }));
  });

  it("must not invoke deletion when there is no active session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Failed to schedule account deletion", variant: "destructive",
    })));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("does not sign out when deletion scheduling is rejected", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "Deletion denied" } });
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Failed to schedule account deletion", description: "Deletion denied", variant: "destructive",
    }));
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("exports with the current token and cleans up the temporary download URL", async () => {
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download My Data" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/functions/v1/export-user-data"), {
      method: "POST", headers: { Authorization: "Bearer token-1", "Content-Type": "application/json" },
    }));
    expect(mocks.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:export-1");
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Data exported" }));
  });

  it("must not request an export when there is no active session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download My Data" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Export failed", variant: "destructive",
    })));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an export endpoint failure without creating a download", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false, json: vi.fn().mockResolvedValue({ error: "Export unavailable" }),
    } as any);
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download My Data" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Export failed", description: "Export unavailable", variant: "destructive",
    }));
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
  });
});
