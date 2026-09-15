import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultMutationConfirmationDialogs } from "./VaultMutationConfirmationDialogs";

const baseProps = () => ({
  photoDelete: { open: false, permanent: false, onOpenChange: vi.fn(), onConfirm: vi.fn() },
  fileDelete: { open: false, permanent: false, onOpenChange: vi.fn(), onConfirm: vi.fn() },
  restoreOpen: false,
  restoreItemType: "photo" as const,
  onRestoreOpenChange: vi.fn(),
  onRestore: vi.fn(),
  bulkDeleteOpen: false,
  selectedCount: 0,
  deletingSelected: false,
  onBulkDeleteOpenChange: vi.fn(),
  onBulkDelete: vi.fn(),
  folderDeleteOpen: false,
  onFolderDeleteOpenChange: vi.fn(),
  onFolderDelete: vi.fn(),
});

describe("VaultMutationConfirmationDialogs", () => {
  it("delegates soft photo deletion with trash wording", () => {
    const props = baseProps();
    props.photoDelete.open = true;
    render(<VaultMutationConfirmationDialogs {...props} />);
    expect(screen.getByText("This photo will be moved to trash.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    expect(props.photoDelete.onConfirm).toHaveBeenCalledOnce();
  });

  it("requires explicit permanent file deletion confirmation", () => {
    const props = baseProps();
    props.fileDelete = { ...props.fileDelete, open: true, permanent: true };
    render(<VaultMutationConfirmationDialogs {...props} />);
    expect(screen.getByText("Permanently Delete File")).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Permanently" }));
    expect(props.fileDelete.onConfirm).toHaveBeenCalledOnce();
  });

  it("delegates restore using the selected item type", () => {
    const props = baseProps();
    props.restoreOpen = true;
    props.restoreItemType = "file";
    render(<VaultMutationConfirmationDialogs {...props} />);
    expect(screen.getByText("Restore File")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(props.onRestore).toHaveBeenCalledOnce();
  });

  it("uses accurate singular bulk-delete wording", () => {
    const props = baseProps();
    props.bulkDeleteOpen = true;
    props.selectedCount = 1;
    render(<VaultMutationConfirmationDialogs {...props} />);
    expect(screen.getByText(/delete 1 selected item\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 Item" }));
    expect(props.onBulkDelete).toHaveBeenCalledOnce();
  });

  it("locks both bulk-delete controls while deletion is running", () => {
    const props = baseProps();
    props.bulkDeleteOpen = true;
    props.selectedCount = 3;
    props.deletingSelected = true;
    render(<VaultMutationConfirmationDialogs {...props} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Deleting/ })).toBeDisabled();
  });

  it("delegates folder deletion while preserving the move-to-parent warning", () => {
    const props = baseProps();
    props.folderDeleteOpen = true;
    render(<VaultMutationConfirmationDialogs {...props} />);
    expect(screen.getByText(/Files inside will be moved to the parent folder/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onFolderDelete).toHaveBeenCalledOnce();
  });
});
