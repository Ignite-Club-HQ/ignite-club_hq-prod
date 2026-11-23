import { describe, expect, it } from "vitest";
import { isNothingSentRefusal, serializeLiveSend } from "./liveSendQueue";
import { chatSendFailureReason } from "../lib/chatSendFailure";

describe("chat sends one after another", () => {
  it("starts the second send in the same chat only after the first finishes", async () => {
    const log: string[] = [];
    let release!: () => void;
    const first = serializeLiveSend("chat-a", () => new Promise<void>((r) => { log.push("1 start"); release = () => { log.push("1 end"); r(); }; }));
    const second = serializeLiveSend("chat-a", async () => { log.push("2 start"); });
    await Promise.resolve(); await Promise.resolve();
    expect(log).toEqual(["1 start"]);
    release();
    await Promise.all([first, second]);
    expect(log).toEqual(["1 start", "1 end", "2 start"]);
  });
  it("a failed send does not block the next one", async () => {
    await expect(serializeLiveSend("chat-b", async () => { throw new Error("x"); })).rejects.toThrow("x");
    await expect(serializeLiveSend("chat-b", async () => "ok")).resolves.toBe("ok");
  });
  it("recognises the nothing-sent refusal and explains it", () => {
    const err = new Error("Reject text: Club chat authority unavailable; nothing was changed");
    expect(isNothingSentRefusal(err)).toBe(true);
    expect(isNothingSentRefusal(new Error("Request timed out"))).toBe(false);
    expect(chatSendFailureReason(err)).toBe("The chat was busy, so your message wasn't sent. Please try again.");
  });
});
