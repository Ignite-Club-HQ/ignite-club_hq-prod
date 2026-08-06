import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { debugLogMeasure, debugTrackRender } from "./chatVirtDebug";
import { ChatVirtuosoDebugProbe } from "./ChatVirtuosoDebugProbe";

vi.mock("./chatVirtDebug", () => ({
  debugLogMeasure: vi.fn(),
  debugTrackRender: vi.fn(),
}));

describe("ChatVirtuosoDebugProbe", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records render identity and measured geometry without changing its child", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(123);
    render(
      <ChatVirtuosoDebugProbe messageId="message-1" estimated={120} rowType="text">
        <span>Message content</span>
      </ChatVirtuosoDebugProbe>,
    );
    const probe = screen.getByText("Message content").parentElement;
    expect(probe).toHaveAttribute("data-debug-probe", "message-1");
    expect(probe).toHaveAttribute("data-row-type", "text");
    expect(debugTrackRender).toHaveBeenCalledWith("message-1");
    expect(debugLogMeasure).toHaveBeenCalledWith("message-1", 120, 123, "text");
  });

  it("re-measures when estimator inputs change", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80);
    const { rerender } = render(
      <ChatVirtuosoDebugProbe messageId="message-1" estimated={76} rowType="event">
        Event
      </ChatVirtuosoDebugProbe>,
    );
    vi.mocked(debugLogMeasure).mockClear();
    rerender(
      <ChatVirtuosoDebugProbe messageId="message-1" estimated={96} rowType="preview">
        Event
      </ChatVirtuosoDebugProbe>,
    );
    expect(debugLogMeasure).toHaveBeenCalledOnce();
    expect(debugLogMeasure).toHaveBeenCalledWith("message-1", 96, 80, "preview");
  });
});
