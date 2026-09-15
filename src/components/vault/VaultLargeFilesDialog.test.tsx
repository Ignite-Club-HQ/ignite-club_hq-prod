import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultLargeFilesDialog } from "./VaultLargeFilesDialog";

const items = [
  { id: "small", type: "file" as const, name: "Small.pdf", size: 10, url: "/small", teamName: "Blue", createdAt: "2026-01-01" },
  { id: "large", type: "photo" as const, name: "Large.jpg", size: 100, url: "/large", teamName: "Club-level", createdAt: "2026-03-01" },
];

const baseProps = () => ({
  open: true,
  onOpenChange: vi.fn(),
  loading: false,
  items,
  sortBy: "size" as const,
  onSortChange: vi.fn(),
  selectedIds: new Set<string>(),
  onToggleSelection: vi.fn(),
  onDeleteSelected: vi.fn(),
  deleting: false,
  formatSize: (bytes: number) => `${bytes}B`,
});

describe("VaultLargeFilesDialog", () => {
  it("shows an accessible loading state without stale rows", () => {
    render(<VaultLargeFilesDialog {...baseProps()} loading />);
    expect(screen.getByLabelText("Loading large files")).toBeInTheDocument();
    expect(screen.queryByTestId("large-file-row")).not.toBeInTheDocument();
  });

  it("shows the established empty state", () => {
    render(<VaultLargeFilesDialog {...baseProps()} items={[]} />);
    expect(screen.getByText("No files with size data found")).toBeInTheDocument();
  });

  it("renders items in the selected sort order without mutating input", () => {
    const source = [...items];
    render(<VaultLargeFilesDialog {...baseProps()} items={source} />);
    const rows = screen.getAllByTestId("large-file-row");
    expect(within(rows[0]).getByText("Large.jpg")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Small.pdf")).toBeInTheDocument();
    expect(source).toEqual(items);
  });

  it("delegates row selection once", () => {
    const props = baseProps();
    render(<VaultLargeFilesDialog {...props} />);
    fireEvent.click(screen.getByText("Small.pdf"));
    expect(props.onToggleSelection).toHaveBeenCalledOnce();
    expect(props.onToggleSelection).toHaveBeenCalledWith("small");
  });

  it("reports selected bytes and delegates permanent deletion", () => {
    const props = baseProps();
    render(<VaultLargeFilesDialog {...props} selectedIds={new Set(["small", "large"])} />);
    expect(screen.getByText("2 selected (110B)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDeleteSelected).toHaveBeenCalledOnce();
  });

  it("delegates dialog close so the page can clear selection", () => {
    const props = baseProps();
    render(<VaultLargeFilesDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
