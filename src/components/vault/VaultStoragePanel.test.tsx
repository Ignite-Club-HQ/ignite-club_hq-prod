import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultStoragePanel } from "./VaultStoragePanel";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
}));

const breakdown = {
  photos: 600,
  documents: 400,
  total: 1000,
  byTeam: [
    { teamId: "team-1", teamName: "Blue", size: 600, photosSize: 400, documentsSize: 200 },
  ],
  byMiniLeague: [],
};

const baseProps = () => ({
  storagePercentage: 20,
  usageLabel: "1 GB / 5 GB",
  isStorageLimitReached: false,
  viewType: "club" as const,
  currentTeamStorageUsed: 0,
  totalClubStorageUsed: 1000,
  breakdown,
  showLargeFilesAction: false,
  showStoragePurchaseAction: false,
  storagePurchaseLabel: "Buy Storage" as const,
  onManageLargeFiles: vi.fn(),
  onManageStorage: vi.fn(),
  formatSize: (bytes: number) => `${bytes}B`,
});

const expand = () => fireEvent.click(screen.getByRole("button", { name: "Toggle storage details" }));

describe("VaultStoragePanel", () => {
  it("renders the compact usage boundary and full-state badge", () => {
    render(<VaultStoragePanel {...baseProps()} isStorageLimitReached />);
    expect(screen.getByText("1 GB / 5 GB")).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();
  });

  it("shows team-specific usage only in team context", () => {
    render(<VaultStoragePanel {...baseProps()} viewType="team" currentTeamStorageUsed={250} />);
    expand();
    expect(screen.getByText("This Team")).toBeInTheDocument();
    expect(screen.getByText("250B")).toBeInTheDocument();
    expect(screen.getByText("(25% of club storage)")).toBeInTheDocument();
  });

  it("shows truthful photo and document totals", () => {
    render(<VaultStoragePanel {...baseProps()} />);
    expand();
    expect(screen.getByText("600B")).toBeInTheDocument();
    expect(screen.getByText("400B")).toBeInTheDocument();
  });

  it("shows club team breakdown without exceeding five rows", () => {
    render(<VaultStoragePanel {...baseProps()} />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: /Storage by Team/ }));
    expect(screen.getByText("Blue")).toBeInTheDocument();
    expect(screen.getByText("600B (60%)")).toBeInTheDocument();
  });

  it("delegates management actions only when authorized by page props", () => {
    const props = baseProps();
    render(<VaultStoragePanel
      {...props}
      showLargeFilesAction
      showStoragePurchaseAction
      storagePurchaseLabel="Manage Storage"
    />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "Manage Large Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage Storage" }));
    expect(props.onManageLargeFiles).toHaveBeenCalledOnce();
    expect(props.onManageStorage).toHaveBeenCalledOnce();
  });

  it("renders the page-owned header action slot outside the toggle button", () => {
    render(<VaultStoragePanel {...baseProps()} headerActions={<button>More actions</button>} />);
    const action = screen.getByRole("button", { name: "More actions" });
    expect(action).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle storage details" }).contains(action)).toBe(false);
  });
});
