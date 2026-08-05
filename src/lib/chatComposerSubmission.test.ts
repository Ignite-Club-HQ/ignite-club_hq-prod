import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareChatComposerSubmission } from "./chatComposerSubmission";

describe("prepareChatComposerSubmission", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("does nothing when composition was already flushed", () => {
    const retry = vi.fn();
    const dispatch = vi.spyOn(window, "dispatchEvent");

    expect(prepareChatComposerSubmission(true, retry)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it("announces a send without deferring when no text input is active", () => {
    const retry = vi.fn();
    const sent = vi.fn();
    window.addEventListener("chat:message-sent", sent, { once: true });

    expect(prepareChatComposerSubmission(false, retry)).toBe(false);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("blurs an active composer, retries once, and restores focus without scrolling", () => {
    vi.useFakeTimers();
    const composer = document.createElement("textarea");
    document.body.append(composer);
    composer.focus();
    const blur = vi.spyOn(composer, "blur");
    const focus = vi.spyOn(composer, "focus");
    const retry = vi.fn();

    expect(prepareChatComposerSubmission(false, retry)).toBe(true);
    expect(blur).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(retry).toHaveBeenCalledExactlyOnceWith(true);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });
});
