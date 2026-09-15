import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ChatHeaderShell } from "./ChatHeaderShell";

function SearchableHeader({ onSearch = vi.fn() }: { onSearch?: (query: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <ChatHeaderShell
      type="team"
      name="Riverside"
      search={{ onSearch, isOpen, onOpenChange: setIsOpen }}
      rightSlot={<button type="button">Menu action</button>}
    />
  );
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <SearchableHeader />
    </MemoryRouter>,
  );
}

describe("ChatHeaderShell search composition", () => {
  it("places the shared search trigger before page-owned actions", () => {
    renderHeader();
    const search = screen.getByRole("button", { name: "Search messages" });
    const menu = screen.getByRole("button", { name: "Menu action" });
    expect(search.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens and closes the shared search overlay without replacing the header API", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Search messages" }));
    const input = screen.getByPlaceholderText("Search messages...");
    expect(input).toBeInTheDocument();
    const overlay = input.closest("div.absolute");
    fireEvent.click(overlay!.querySelector("button")!);
    expect(screen.queryByPlaceholderText("Search messages...")).not.toBeInTheDocument();
  });
});
