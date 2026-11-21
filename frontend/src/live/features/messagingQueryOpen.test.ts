import { beforeEach, describe, expect, it, vi } from "vitest";

const actor = {
  open_conversation_query: vi.fn(),
  open_conversation: vi.fn(),
  list_latest_messages_page: vi.fn(),
  send_message: vi.fn(),
  list_reactions: vi.fn(),
};
vi.mock("../domains", () => ({
  connectLiveMessagingDomain: vi.fn(async () => ({ actor })),
  connectLiveClubDomain: vi.fn(),
}));

import {
  clearWarmLiveLatestPages, listLiveLatestMessagesPage, listLiveReactions, takeBundledPollResult, noteLiveConversationWrite, QUERY_OPEN_WRITE_FENCE_MS,
} from "./messaging";
import { __resetChatOpenTrace, takeChatOpenBreakdown } from "@/lib/chatOpenTrace";

const ctxShape = { target: {}, identity: { getPrincipal: () => ({ toText: () => "me" }) } };
const ctx = ctxShape as never;
const bundle = (latest: number, id = "m1") => ({
  Ok: { page: { messages: [{ id }], next_sequence: [], latest_sequence: BigInt(latest) }, reactions: [], pins: [], polls: [] },
});

beforeEach(() => {
  vi.clearAllMocks();
  clearWarmLiveLatestPages();
  __resetChatOpenTrace();
});

describe("first-page quick read", () => {
  it('isolates reactions and poll bundles even when mainnet and engine use the same conversation ID', async () => {
    const mainnet = { ...ctxShape, target: { host: 'https://mainnet.example.com', networkKind: 'public_mainnet', canisterIds: { messaging_domain: 'mainnet-chat' } } } as never;
    const engine = { ...ctxShape, target: { host: 'https://engine.example.com', networkKind: 'cloud_engine', canisterIds: { messaging_domain: 'engine-chat' } } } as never;
    actor.open_conversation_query.mockResolvedValueOnce({ Ok: { ...bundle(1).Ok,
      reactions: [{ message_id: 'm1', emoji: 'mainnet-private' }], polls: [{ poll: { id: 'same-poll' }, private: 'mainnet' }] } });
    await listLiveLatestMessagesPage(mainnet, 'same-chat', null, 30);
    actor.list_reactions.mockResolvedValue({ Ok: [{ message_id: 'm1', emoji: 'engine-own' }] });
    expect(await listLiveReactions(engine, 'same-chat')).toEqual([{ message_id: 'm1', emoji: 'engine-own' }]);
    expect(takeBundledPollResult('same-chat', 'same-poll', engine)).toBeNull();
    expect(takeBundledPollResult('same-chat', 'same-poll')).toBeNull();
    expect(takeBundledPollResult('same-chat', 'same-poll', mainnet)).toMatchObject({ private: 'mainnet' });
    expect(await listLiveReactions(mainnet, 'same-chat')).toEqual([{ message_id: 'm1', emoji: 'mainnet-private' }]);
  });

  it('does not apply mainnet sequence history or unavailable-method flags to engine chats', async () => {
    const mainnet = { ...ctxShape, target: { canisterIds: { messaging_domain: 'mainnet-chat' } } } as never;
    const engine = { ...ctxShape, target: { canisterIds: { messaging_domain: 'engine-chat' } } } as never;
    actor.open_conversation_query.mockResolvedValueOnce(bundle(100, 'mainnet'));
    await listLiveLatestMessagesPage(mainnet, 'same-chat', null, 30);
    actor.open_conversation_query.mockResolvedValueOnce(bundle(1, 'engine'));
    expect((await listLiveLatestMessagesPage(engine, 'same-chat', null, 30)).messages[0].id).toBe('engine');
    actor.open_conversation_query.mockRejectedValueOnce(new Error('Canister has no query method'));
    actor.open_conversation.mockResolvedValue(bundle(1));
    await listLiveLatestMessagesPage(mainnet, 'older-chat', null, 30);
    actor.open_conversation_query.mockResolvedValueOnce(bundle(2, 'engine-again'));
    expect((await listLiveLatestMessagesPage(engine, 'another-chat', null, 30)).messages[0].id).toBe('engine-again');
  });

  it('a mainnet write fence does not delay a different engine chat', async () => {
    const mainnet = { ...ctxShape, target: { canisterIds: { messaging_domain: 'mainnet-chat' } } } as never;
    const engine = { ...ctxShape, target: { canisterIds: { messaging_domain: 'engine-chat' } } } as never;
    noteLiveConversationWrite('same-chat', Date.now(), mainnet);
    actor.open_conversation_query.mockResolvedValue(bundle(1, 'engine'));
    expect((await listLiveLatestMessagesPage(engine, 'same-chat', null, 30)).messages[0].id).toBe('engine');
    expect(actor.open_conversation).not.toHaveBeenCalled();
  });
  it("coalesces concurrent cold reads of the same caller, target and page", async () => {
    actor.open_conversation_query.mockResolvedValue(bundle(5));
    await Promise.all([listLiveLatestMessagesPage(ctx, 'new-thread', null, 30), listLiveLatestMessagesPage(ctx, 'new-thread', null, 30)]);
    expect(actor.open_conversation_query).toHaveBeenCalledTimes(1);
  });

  it('never shares in-flight pages across accounts or target canisters', async () => {
    actor.open_conversation_query.mockResolvedValue(bundle(5));
    const otherAccount = { target: {}, identity: { getPrincipal: () => ({ toText: () => 'other' }) } } as never;
    const otherTarget = { target: { canisterIds: { messaging_domain: 'other-service' } }, identity: { getPrincipal: () => ({ toText: () => 'me' }) } } as never;
    await Promise.all([listLiveLatestMessagesPage(ctx, 'same-thread', null, 30), listLiveLatestMessagesPage(otherAccount, 'same-thread', null, 30), listLiveLatestMessagesPage(otherTarget, 'same-thread', null, 30)]);
    expect(actor.open_conversation_query).toHaveBeenCalledTimes(3);
  });

  it('retires failed reads so a later open actually retries authorization', async () => {
    actor.open_conversation_query.mockResolvedValue({ Err: 'Forbidden' });
    actor.open_conversation.mockResolvedValue({ Err: 'Forbidden' });
    await expect(listLiveLatestMessagesPage(ctx, 'denied-thread', null, 30)).rejects.toThrow();
    actor.open_conversation_query.mockResolvedValue(bundle(5));
    await listLiveLatestMessagesPage(ctx, 'denied-thread', null, 30);
    expect(actor.open_conversation_query).toHaveBeenCalledTimes(2);
  });

  it("serves the first page from the quick read without the consensus call", async () => {
    actor.open_conversation_query.mockResolvedValue(bundle(5));
    const page = await listLiveLatestMessagesPage(ctx, "c1", null, 50);
    expect(page.messages[0].id).toBe("m1");
    expect(actor.open_conversation).not.toHaveBeenCalled();
    expect(takeChatOpenBreakdown("c1", Date.now()).read_path).toBe("query");
  });

  it("falls back to the consensus read when the quick read is refused", async () => {
    actor.open_conversation_query.mockResolvedValue({ Err: "Club chat access forbidden" });
    actor.open_conversation.mockResolvedValue({ Err: "Club chat access forbidden" });
    await expect(listLiveLatestMessagesPage(ctx, "c1", null, 50)).rejects.toThrow(/forbidden/);
    expect(actor.open_conversation).toHaveBeenCalledTimes(1);
  });

  it("falls back when the quick read traps (protected account mode)", async () => {
    actor.open_conversation_query.mockRejectedValue(new Error("Use protected consensus account read"));
    actor.open_conversation.mockResolvedValue(bundle(5, "fresh"));
    const page = await listLiveLatestMessagesPage(ctx, "c1", null, 50);
    expect(page.messages[0].id).toBe("fresh");
    expect(takeChatOpenBreakdown("c1", Date.now()).read_path).toBe("query_refused_update");
  });

  it("uses the consensus read for 8 seconds after this device sends to the chat", async () => {
    actor.open_conversation.mockResolvedValue(bundle(6));
    noteLiveConversationWrite("c1", Date.now());
    await listLiveLatestMessagesPage(ctx, "c1", null, 50);
    expect(QUERY_OPEN_WRITE_FENCE_MS).toBe(8_000);
    expect(actor.open_conversation_query).not.toHaveBeenCalled();
    expect(actor.open_conversation).toHaveBeenCalledTimes(1);
  });

  it("rejects a quick read older than a page this device already saw", async () => {
    actor.open_conversation.mockResolvedValueOnce(bundle(9));
    noteLiveConversationWrite("c1", Date.now());
    await listLiveLatestMessagesPage(ctx, "c1", null, 50); // consensus, sees 9
    noteLiveConversationWrite("c1", Date.now() - QUERY_OPEN_WRITE_FENCE_MS - 1);
    actor.open_conversation_query.mockResolvedValue(bundle(7, "stale"));
    actor.open_conversation.mockResolvedValue(bundle(9, "fresh"));
    const page = await listLiveLatestMessagesPage(ctx, "c1", null, 50);
    expect(page.messages[0].id).toBe("fresh");
  });

  it("stops trying the quick read on a service without it", async () => {
    actor.open_conversation_query.mockRejectedValue(new Error("Canister has no query method 'open_conversation_query'"));
    actor.open_conversation.mockResolvedValue(bundle(1));
    await listLiveLatestMessagesPage(ctx, "c1", null, 50);
    await listLiveLatestMessagesPage(ctx, "c2", null, 50);
    expect(actor.open_conversation_query).toHaveBeenCalledTimes(1);
  });
});
