import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ChatVirtuosoFooter,
  ChatVirtuosoHeader,
  ChatVirtuosoItem,
  ChatVirtuosoScroller,
} from "./ChatVirtuosoChrome";

describe("Virtuoso chat chrome", () => {
  it("uses context padding without changing header/footer component identity", () => {
    const { container, rerender } = render(
      <ChatVirtuosoHeader context={{ topPadding: 24, bottomPadding: "12px" }} />,
    );
    const header = container.firstElementChild;
    expect(header).toHaveStyle({ height: "24px", overflowAnchor: "none" });
    rerender(<ChatVirtuosoHeader context={{ topPadding: 40, bottomPadding: "12px" }} />);
    expect(container.firstElementChild).toBe(header);
    expect(header).toHaveStyle({ height: "40px" });

    rerender(<ChatVirtuosoFooter context={{ topPadding: 0, bottomPadding: 32 }} />);
    expect(container.firstElementChild).toHaveStyle({ height: "32px" });
  });

  it("pins the native-safe scroller attributes and forwards its ref", () => {
    const ref = createRef<HTMLDivElement>();
    render(<ChatVirtuosoScroller ref={ref} role="log" className="custom" style={{ color: "red" }} />);
    const scroller = screen.getByRole("log");
    expect(ref.current).toBe(scroller);
    expect(scroller).toHaveAttribute("data-chat-scroll-lock", "true");
    expect(scroller).toHaveAttribute("data-chat-virtualized", "true");
    expect(scroller).toHaveClass("custom", "scrollbar-hide");
    expect(scroller.style.color).toBe("red");
    expect(scroller.style.overscrollBehaviorY).toBe("contain");
    expect(scroller.style.WebkitOverflowScrolling).toBe("touch");
  });

  it("keeps layout containment without enabling paint containment", () => {
    render(<ChatVirtuosoItem role="listitem" style={{ minHeight: 50 }} />);
    const item = screen.getByRole("listitem");
    expect(item).toHaveAttribute("data-chat-virtuoso-item", "true");
    expect(item).toHaveStyle({ minHeight: "50px", contain: "layout style" });
    expect(item.style.contain).not.toContain("paint");
  });
});
