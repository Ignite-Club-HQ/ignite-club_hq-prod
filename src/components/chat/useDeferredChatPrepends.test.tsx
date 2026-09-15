import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  markDeferredPrependUpwardMotion,
  markDeferredPrependUserInput,
  setDeferredPrependScroller,
  setDeferredPrependScrolling,
  useDeferredChatPrepends,
} from "./useDeferredChatPrepends";

type Message = { id: string; body: string };

const initial: Message[] = [
  { id: "message-2", body: "second" },
  { id: "message-3", body: "third" },
];

afterEach(() => {
  setDeferredPrependScrolling(false);
  setDeferredPrependScroller(null);
});

describe("useDeferredChatPrepends", () => {
  it("commits appends immediately", () => {
    const { result, rerender } = renderHook(
      ({ messages }) => useDeferredChatPrepends(messages),
      { initialProps: { messages: initial } },
    );

    const appended = [...initial, { id: "message-4", body: "fourth" }];
    rerender({ messages: appended });

    expect(result.current).toEqual(appended);
  });

  it("commits edits immediately without treating them as history", () => {
    const { result, rerender } = renderHook(
      ({ messages }) => useDeferredChatPrepends(messages),
      { initialProps: { messages: initial } },
    );

    const edited = [initial[0], { ...initial[1], body: "edited" }];
    rerender({ messages: edited });

    expect(result.current).toEqual(edited);
  });

  it("holds a stationary pure prepend until the next user-driven upward motion", () => {
    const { result, rerender } = renderHook(
      ({ messages }) => useDeferredChatPrepends(messages),
      { initialProps: { messages: initial } },
    );
    const prepended = [{ id: "message-1", body: "first" }, ...initial];

    rerender({ messages: prepended });
    expect(result.current).toEqual(initial);

    act(() => {
      markDeferredPrependUserInput();
      setDeferredPrependScrolling(true);
      expect(markDeferredPrependUpwardMotion({ explicitGesture: true })).toBe(true);
    });

    expect(result.current).toEqual(prepended);
  });

  it("commits a pure prepend immediately during active upward motion", () => {
    const { result, rerender } = renderHook(
      ({ messages }) => useDeferredChatPrepends(messages),
      { initialProps: { messages: initial } },
    );

    act(() => {
      markDeferredPrependUserInput();
      setDeferredPrependScrolling(true);
      markDeferredPrependUpwardMotion({ explicitGesture: true });
    });

    const prepended = [{ id: "message-1", body: "first" }, ...initial];
    rerender({ messages: prepended });

    expect(result.current).toEqual(prepended);
  });
});
