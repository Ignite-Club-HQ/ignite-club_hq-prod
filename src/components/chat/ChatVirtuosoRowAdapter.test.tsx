import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ChatVirtuosoRowAdapter,
  type ChatRowAdapterMessage,
  type ChatRowRender,
} from "./ChatVirtuosoRowAdapter";

vi.mock("./chatVirtDebug", () => ({
  classifyChatRow: vi.fn(() => "text"),
  isChatVirtDebugEnabled: vi.fn(() => false),
}));

vi.mock("./ChatCachedMeasureRow", () => ({
  ChatCachedMeasureRow: ({ children, messageId }: { children: React.ReactNode; messageId: string }) => (
    <div data-row-id={messageId}>{children}</div>
  ),
}));

const refs = (messages: ChatRowAdapterMessage[], renderItem: ChatRowRender) => ({
  renderItemRef: { current: renderItem },
  uniqueMessagesRef: { current: messages },
  indexByIdRef: { current: new Map(messages.map((message, index) => [message.id, index])) },
  currentUserIdRef: { current: "viewer" as string | null | undefined },
});

describe("ChatVirtuosoRowAdapter", () => {
  it("renders the indexed row through the current render function", () => {
    const message = { id: "message-1" };
    const renderItem = vi.fn(() => <span>Rendered message</span>);
    render(<ChatVirtuosoRowAdapter message={message} signature="one" {...refs([message], renderItem)} />);
    expect(screen.getByText("Rendered message")).toBeInTheDocument();
    expect(renderItem).toHaveBeenCalledWith(message, 0, [message]);
  });

  it("ignores parent object churn while ID and layout signature are stable", () => {
    const original = { id: "message-1" };
    const replacement = { id: "message-1" };
    const renderItem = vi.fn(() => <span>Stable row</span>);
    const stableRefs = refs([original], renderItem);
    const { rerender } = render(
      <ChatVirtuosoRowAdapter message={original} signature="same" {...stableRefs} />,
    );
    stableRefs.uniqueMessagesRef.current = [replacement];
    rerender(<ChatVirtuosoRowAdapter message={replacement} signature="same" {...stableRefs} />);
    expect(renderItem).toHaveBeenCalledOnce();
  });

  it("rerenders when the layout signature changes", () => {
    const message = { id: "message-1" };
    const renderItem = vi.fn(() => <span>Changing row</span>);
    const stableRefs = refs([message], renderItem);
    const { rerender } = render(
      <ChatVirtuosoRowAdapter message={message} signature="before" {...stableRefs} />,
    );
    rerender(<ChatVirtuosoRowAdapter message={message} signature="after" {...stableRefs} />);
    expect(renderItem).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when the immutable ID is absent from the live index", () => {
    const renderItem = vi.fn(() => <span>Unexpected</span>);
    const missingRefs = refs([], renderItem);
    const { container } = render(
      <ChatVirtuosoRowAdapter message={{ id: "missing" }} signature="one" {...missingRefs} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(renderItem).not.toHaveBeenCalled();
  });
});
