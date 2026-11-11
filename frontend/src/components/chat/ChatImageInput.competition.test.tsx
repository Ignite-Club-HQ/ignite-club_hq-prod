import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), append: vi.fn(), error: vi.fn(), mode: "icp", from: vi.fn(), storage: vi.fn(), allowance: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "member-1" } }) }));
vi.mock("@/hooks/useClubFreeUsage", () => ({ useClubFreeUsage: () => ({ usage: null }), notifyClubFreeUsageChanged: vi.fn() }));
vi.mock("@/hooks/useScheduleProAccess", () => ({ useScheduleProAccess: () => ({ hasAccess: true }) }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => mocks.mode }));
vi.mock("@/live/mediaUpload", () => ({ tryUploadMediaToBlobStore: vi.fn() }));
vi.mock("@/components/chat/chatDocumentUpload", () => ({ uploadIcpCompetitionChatDocument: mocks.upload }));
vi.mock("@/components/chat/VaultPickerSheet", () => ({ VaultPickerSheet: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, storage: { from: mocks.storage } } }));
vi.mock("@/features/vault/clubMediaAllowance", () => ({ uploadWithinClubMediaAllowance: mocks.allowance }));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open }: any) => <div data-open={open}>{children}</div>,
  PopoverTrigger: ({ children }: any) => children,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn(), info: vi.fn() } }));
import { ChatImageInput } from "./ChatImageInput";

function mount() {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ChatImageInput competitionId="competition-1" showFileUpload imageUrl={null} onImageUploaded={vi.fn()} onAppendToken={mocks.append} />
  </QueryClientProvider></MemoryRouter>);
}

beforeEach(() => { vi.clearAllMocks(); mocks.mode = "icp"; mocks.upload.mockResolvedValue("[vault:file-1]"); });
describe("competition chat document selection", () => {
  it("opens the document chooser without a club and appends only the registered file token", async () => {
    const { container } = mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept^=".pdf"]');
    if (!input) throw new Error("Document input missing");
    const choose = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: /File or Folder/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Upload from device" }));
    expect(choose).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Choose from vault" })).toBeDisabled();
    const file = new File(["competition rules"], "rules.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mocks.append).toHaveBeenCalledWith("[vault:file-1]"));
    expect(mocks.upload).toHaveBeenCalledWith(file, "competition-1");
  });
  it("never adds a message attachment after upload refusal", async () => {
    mocks.upload.mockRejectedValue(new Error("Only competition organisers can upload competition files. Ask an organiser to share this file."));
    const { container } = mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept^=".pdf"]');
    if (!input) throw new Error("Document input missing");
    fireEvent.change(input, { target: { files: [new File(["rules"], "rules.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("uploads an email competition document to its host and registers it before attaching", async () => {
    mocks.mode = "supabase";
    const insert = vi.fn().mockResolvedValue({ error: null });
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), single: vi.fn().mockResolvedValue({ data: { organizer_club_id: "host-club" }, error: null }) };
    mocks.from.mockImplementation(table => table === "competitions" ? query : { insert });
    const transfer = vi.fn().mockResolvedValue({ error: null });
    mocks.storage.mockReturnValue({ upload: transfer });
    mocks.allowance.mockImplementation((_club, _bytes, upload) => upload());
    const { container } = mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept^=".pdf"]');
    if (!input) throw new Error("Document input missing");
    const file = new File(["rules"], "rules.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mocks.append).toHaveBeenCalledOnce());
    expect(mocks.storage).toHaveBeenCalledWith("competition-vault");
    expect(transfer).toHaveBeenCalledWith(expect.stringMatching(/^clubs\/host-club\/competitions\/competition-1\/member-1\//), file, expect.objectContaining({ upsert: false }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ competition_id: "competition-1", club_id: "host-club", uploaded_by: "member-1" }));
    expect(mocks.append).toHaveBeenCalledWith(expect.stringMatching(/^\[vault:/));
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});