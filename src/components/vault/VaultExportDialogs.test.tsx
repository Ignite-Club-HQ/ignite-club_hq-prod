import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultExportDialogs } from "./VaultExportDialogs";

const baseProps = () => ({
  previewOpen: false,
  onPreviewOpenChange: vi.fn(),
  previewLoading: false,
  previewPhotoCount: 2,
  previewFileCount: 1,
  folderBreakdown: [{ path: "Teams/Blue", photoCount: 2, fileCount: 1 }],
  excludedFolders: new Set<string>(),
  onToggleFolderExclusion: vi.fn(),
  onConfirmPreview: vi.fn(),
  confirmOpen: false,
  onConfirmOpenChange: vi.fn(),
  summary: { photoCount: 2, fileCount: 1, isSelection: false },
  pendingType: "zip" as const,
  onCancelConfirmation: vi.fn(),
  onConfirmExport: vi.fn(),
});

describe("VaultExportDialogs", () => {
  it("shows scan loading without exposing stale preview actions", () => {
    const props = baseProps();
    render(<VaultExportDialogs {...props} previewOpen previewLoading />);
    expect(screen.getByText("Scanning folders...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export ZIP" })).not.toBeInTheDocument();
  });

  it("renders filtered counts and delegates folder exclusion", () => {
    const props = baseProps();
    render(<VaultExportDialogs {...props} previewOpen />);
    expect(screen.getAllByText("3 items")).toHaveLength(2);
    fireEvent.click(screen.getByText("Teams/Blue"));
    expect(props.onToggleFolderExclusion).toHaveBeenCalledWith("Teams/Blue");
  });

  it("disables recursive export when every item is excluded", () => {
    render(<VaultExportDialogs {...baseProps()} previewOpen previewPhotoCount={0} previewFileCount={0} />);
    expect(screen.getByRole("button", { name: "Export ZIP" })).toBeDisabled();
  });

  it("uses selected-item confirmation wording and delegates confirmation", () => {
    const props = baseProps();
    render(<VaultExportDialogs
      {...props}
      confirmOpen
      summary={{ photoCount: 1, fileCount: 1, isSelection: true }}
    />);
    expect(screen.getByText("You are about to export 2 selected items.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(props.onConfirmExport).toHaveBeenCalledOnce();
  });

  it("uses recursive wording and clears pending state on cancel", () => {
    const props = baseProps();
    render(<VaultExportDialogs {...props} confirmOpen pendingType="zipAll" />);
    expect(screen.getByText(/current folder and its subfolders/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancelConfirmation).toHaveBeenCalledOnce();
  });
});
