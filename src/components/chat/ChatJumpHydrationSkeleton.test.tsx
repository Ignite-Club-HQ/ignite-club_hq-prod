import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatJumpHydrationSkeleton } from "./ChatJumpHydrationSkeleton";

describe("ChatJumpHydrationSkeleton", () => {
  it("covers unsettled content without intercepting user input", () => {
    const { container } = render(<ChatJumpHydrationSkeleton />);
    const overlay = container.querySelector<HTMLElement>("[data-chat-jump-hydration='true']")!;
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveClass("pointer-events-none", "absolute", "inset-0");
    expect(overlay.style.opacity).toBe("1");
    expect(overlay.style.transition).toBe("opacity 260ms ease-out");
    expect(overlay.getAttribute("style")).toContain("--background");
    expect(overlay.getAttribute("style")).not.toContain("backdrop");
  });

  it("keeps stable alternating skeleton geometry", () => {
    const { container } = render(<ChatJumpHydrationSkeleton />);
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-chat-jump-skeleton-row='true']"),
    );
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.style.justifyContent)).toEqual([
      "flex-start", "flex-end", "flex-start", "flex-end", "flex-start", "flex-end", "flex-start",
    ]);
    expect(rows.map((row) => row.firstElementChild?.getAttribute("style"))).toEqual([
      "width: 82%; max-width: 75%;",
      "width: 64%; max-width: 75%;",
      "width: 96%; max-width: 75%;",
      "width: 72%; max-width: 75%;",
      "width: 88%; max-width: 75%;",
      "width: 60%; max-width: 75%;",
      "width: 78%; max-width: 75%;",
    ]);
  });

  it("fades without remounting its rows", () => {
    const { container, rerender } = render(<ChatJumpHydrationSkeleton />);
    const overlay = container.querySelector<HTMLElement>("[data-chat-jump-hydration='true']")!;
    const firstRow = overlay.firstElementChild;
    rerender(<ChatJumpHydrationSkeleton visible={false} />);
    expect(container.querySelector("[data-chat-jump-hydration='true']")).toBe(overlay);
    expect(overlay.firstElementChild).toBe(firstRow);
    expect(overlay.style.opacity).toBe("0");
  });
});
