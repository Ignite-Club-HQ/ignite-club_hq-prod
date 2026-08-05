import { describe, expect, it } from "vitest";
import {
  authoritativeMessageExists,
  createSendTempId,
  restoreFailedSendComposer,
  splitPollMarkup,
  type FailedSendContext,
} from "./failedSendRestore";

const stateSetter = <T>(state: { current: T }) =>
  (update: (current: T) => T) => { state.current = update(state.current); };

describe("failed send restoration", () => {
  it("creates collision-resistant optimistic ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createSendTempId()));
    expect(ids.size).toBe(50);
    expect([...ids].every((id) => id.startsWith("temp-"))).toBe(true);
  });

  it("separates a poll chip from its caption for user-friendly restoration", () => {
    expect(splitPollMarkup("Training update [poll:poll-123]")).toEqual({
      baseText: "Training update",
      pollId: "poll-123",
    });
    expect(splitPollMarkup("[poll:poll-123]")).toEqual({ baseText: "", pollId: "poll-123" });
  });

  it("restores every still-empty composer slot", () => {
    const text = { current: "" };
    const image = { current: null as string | null };
    const reply = { current: null as { id: string } | null };
    const poll = { current: null as string | null };
    const context: FailedSendContext<{ id: string }> = {
      tempId: "temp-one",
      sentText: "Unsent caption",
      sentImageUrl: "https://local.invalid/image.png",
      previousReplyTarget: { id: "parent-one" },
      pendingPollId: "poll-one",
    };

    restoreFailedSendComposer({
      context,
      setText: stateSetter(text),
      setImage: stateSetter(image),
      setReply: stateSetter(reply),
      setPoll: stateSetter(poll),
    });

    expect({ text: text.current, image: image.current, reply: reply.current, poll: poll.current }).toEqual({
      text: "Unsent caption",
      image: "https://local.invalid/image.png",
      reply: { id: "parent-one" },
      poll: "poll-one",
    });
  });

  it("never overwrites content selected after Send", () => {
    const text = { current: "New draft" };
    const image = { current: "new-image" as string | null };
    const reply = { current: { id: "new-parent" } as { id: string } | null };
    const poll = { current: "new-poll" as string | null };

    restoreFailedSendComposer({
      context: {
        tempId: "temp-old",
        sentText: "Old draft",
        sentImageUrl: "old-image",
        previousReplyTarget: { id: "old-parent" },
        pendingPollId: "old-poll",
      },
      setText: stateSetter(text),
      setImage: stateSetter(image),
      setReply: stateSetter(reply),
      setPoll: stateSetter(poll),
    });

    expect({ text: text.current, image: image.current, reply: reply.current, poll: poll.current }).toEqual({
      text: "New draft",
      image: "new-image",
      reply: { id: "new-parent" },
      poll: "new-poll",
    });
  });

  it("recognizes only an authoritative matching message", () => {
    const args = { authorId: "author-one", text: "Sent message" };
    expect(authoritativeMessageExists([
      { id: "temp-one", author_id: "author-one", text: "Sent message" },
      { id: "queued-one", author_id: "author-one", text: "Sent message" },
    ], args)).toBe(false);
    expect(authoritativeMessageExists([
      { id: "server-one", author_id: "other-author", text: "Sent message" },
      { id: "server-two", author_id: "author-one", text: "Other text" },
    ], args)).toBe(false);
    expect(authoritativeMessageExists([
      { id: "server-three", author_id: "author-one", text: "Sent message" },
    ], args)).toBe(true);
  });
});
