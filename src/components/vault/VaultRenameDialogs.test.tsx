import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultRenameDialogs } from "./VaultRenameDialogs";

const closedState = () => ({
  open: false,
  value: "",
  onOpenChange: vi.fn(),
  onValueChange: vi.fn(),
  onRename: vi.fn(),
});

const baseProps = () => ({
  folder: closedState(),
  file: closedState(),
  photo: closedState(),
});

describe("VaultRenameDialogs", () => {
  it.each([
    ["folder", "Rename Folder", "Folder Name", "Enter new folder name"],
    ["file", "Rename File", "File Name", "Enter new file name"],
    ["photo", "Rename Photo", "Photo Title", "Enter new photo title"],
  ] as const)("renders the %s-specific contract", (kind, title, label, placeholder) => {
    const props = baseProps();
    props[kind].open = true;
    props[kind].value = "Current name";
    render(<VaultRenameDialogs {...props} />);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue("Current name");
  });

  it("delegates value changes and rename without owning identifiers", () => {
    const props = baseProps();
    props.file.open = true;
    props.file.value = "Original.pdf";
    render(<VaultRenameDialogs {...props} />);
    fireEvent.change(screen.getByPlaceholderText("Enter new file name"), {
      target: { value: "Updated.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename File" }));
    expect(props.file.onValueChange).toHaveBeenCalledWith("Updated.pdf");
    expect(props.file.onRename).toHaveBeenCalledOnce();
  });

  it("rejects blank and whitespace-only names", () => {
    const props = baseProps();
    props.photo.open = true;
    props.photo.value = "   ";
    render(<VaultRenameDialogs {...props} />);
    expect(screen.getByRole("button", { name: "Rename Photo" })).toBeDisabled();
  });
});
