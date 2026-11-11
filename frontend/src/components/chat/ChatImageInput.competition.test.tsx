import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), append: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "member-1" } }) }));
vi.mock("@/hooks/useClubFreeUsage", () => ({ useClubFreeUsage: () => ({ usage: null }), notifyClubFreeUsageChanged: vi.fn() }));
vi.mock("@/hooks/useScheduleProAccess", () => ({ useScheduleProAccess: () => ({ hasAccess: true }) }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("@/live/mediaUpload", () => ({ tryUploadMediaToBlobStore: vi.fn() }));
vi.mock("@/components/chat/chatDocumentUpload", () => ({ uploadIcpCompetitionChatDocument: mocks.upload }));
vi.mock("@/components/chat/VaultPickerSheet", () => ({ VaultPickerSheet: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
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

beforeEach(() => { vi.clearAllMocks(); mocks.upload.mockResolvedValue("[vault:file-1]"); });
describe("competition chat document selection", () => {
  it("opens the document chooser without a club and appends only the registered file token", async () => {
    const { container } = mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept^=".pdf"]');
    if (!input) throw new Error("Document input missing");
    const choose = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Upload File" }));
    expect(choose).toHaveBeenCalledOnce();
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
});