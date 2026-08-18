import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultFolderExportDialog } from "./VaultFolderExportDialog";

const baseProps = () => ({
  open: true,
  onOpenChange: vi.fn(),
  folderName: "Season Photos",
  loading: false,
  photos: [{ id: "photo-1", file_url: "/photo.jpg", title: "Team photo" }],
  files: [{ id: "file-1", name: "Roster.pdf" }],
  selectedPhotoIds: new Set(["photo-1"]),
  selectedFileIds: new Set(["file-1"]),
  onTogglePhoto: vi.fn(),
  onToggleFile: vi.fn(),
  onSelectAll: vi.fn(),
  onDeselectAll: vi.fn(),
  onExport: vi.fn(),
});

describe("VaultFolderExportDialog", () => {
  it("shows loading without stale selection controls", () => {
    render(<VaultFolderExportDialog {...baseProps()} loading />);
    expect(screen.getByLabelText("Loading folder contents")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select All" })).not.toBeInTheDocument();
  });

  it("shows the folder name, selected count and item sections", () => {
    render(<VaultFolderExportDialog {...baseProps()} />);
    expect(screen.getByText("Export: Season Photos")).toBeInTheDocument();
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByText("Photos (1)")).toBeInTheDocument();
    expect(screen.getByText("Files (1)")).toBeInTheDocument();
  });

  it("delegates photo and file row selection", () => {
    const props = baseProps();
    render(<VaultFolderExportDialog {...props} />);
    fireEvent.click(screen.getByText("Team photo"));
    fireEvent.click(screen.getByText("Roster.pdf"));
    expect(props.onTogglePhoto).toHaveBeenCalledWith("photo-1");
    expect(props.onToggleFile).toHaveBeenCalledWith("file-1");
  });

  it("delegates select-all and deselect-all", () => {
    const props = baseProps();
    render(<VaultFolderExportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    fireEvent.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(props.onSelectAll).toHaveBeenCalledOnce();
    expect(props.onDeselectAll).toHaveBeenCalledOnce();
  });

  it("shows the empty state and disables export with no selected items", () => {
    render(<VaultFolderExportDialog
      {...baseProps()}
      photos={[]}
      files={[]}
      selectedPhotoIds={new Set()}
      selectedFileIds={new Set()}
    />);
    expect(screen.getByText("This folder is empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export 0 Items as ZIP" })).toBeDisabled();
  });

  it("delegates export and dialog close", () => {
    const props = baseProps();
    render(<VaultFolderExportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Export 2 Items as ZIP" }));
    expect(props.onExport).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
