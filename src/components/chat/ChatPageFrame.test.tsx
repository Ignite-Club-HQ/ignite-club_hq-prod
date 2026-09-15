import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPageFrame } from "./ChatPageFrame";

describe("ChatPageFrame", () => {
  it("preserves the measured native viewport and keyboard scroll lock", () => {
    render(
      <ChatPageFrame height="640px" onTouchStart={() => undefined} onTouchEnd={() => undefined}>
        <span>Thread</span>
      </ChatPageFrame>,
    );

    const frame = screen.getByText("Thread").parentElement;
    expect(frame).toHaveStyle({ height: "640px" });
    expect(frame).toHaveAttribute("data-lock-keyboard-scroll", "true");
    expect(frame).toHaveClass("overflow-hidden", "overscroll-none", "min-h-0");
  });

  it("forwards both touch boundaries used by swipe-back navigation", () => {
    const onTouchStart = vi.fn();
    const onTouchEnd = vi.fn();
    render(
      <ChatPageFrame height={500} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <span>Thread</span>
      </ChatPageFrame>,
    );

    const frame = screen.getByText("Thread").parentElement!;
    fireEvent.touchStart(frame);
    fireEvent.touchEnd(frame);
    expect(onTouchStart).toHaveBeenCalledTimes(1);
    expect(onTouchEnd).toHaveBeenCalledTimes(1);
  });
});
