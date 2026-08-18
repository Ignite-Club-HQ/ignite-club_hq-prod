import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

describe("Realtime message query-envelope boundary", () => {
  it.each(["ClubChatPage.tsx", "BroadcastChatPage.tsx", "TeamChatPage.tsx"])(
    "%s records reconciliation before updating query and local stores",
    (name) => {
      const source = page(name);
      const record = source.indexOf("const outcome = recordRealtimeMutation(reconcileScope, updated)");
      const queryUpdate = source.indexOf("applyMessageUpdateToQueryEnvelope<Message>(old, updated)", record);
      const localUpdate = source.indexOf("applyMessageUpdate(prev, updated)", queryUpdate);

      expect(record).toBeGreaterThan(-1);
      expect(queryUpdate).toBeGreaterThan(record);
      expect(localUpdate).toBeGreaterThan(queryUpdate);
      expect(source).toContain("removeMessageFromQueryEnvelope<Message>(old, deletedId)");
      expect(source).toContain("removeMessageFromQueryEnvelope<Message>(old, updated.id)");
      expect(source).toContain("removeMessage(prev, deletedId)");
      expect(source).toContain("removeMessage(prev, updated.id)");
    },
  );

  it("GroupChatPage preserves its reactions fallback while sharing message envelope updates", () => {
    const source = page("GroupChatPage.tsx");
    const record = source.indexOf("const outcome = recordRealtimeMutation(reconcileScope, updated)");
    const queryUpdate = source.indexOf(
      "applyMessageUpdateToQueryEnvelope<GroupMessage>(old, updated)",
      record,
    );
    const localUpdate = source.indexOf("applyMessageUpdate(prev, updated)", queryUpdate);

    expect(record).toBeGreaterThan(-1);
    expect(queryUpdate).toBeGreaterThan(record);
    expect(localUpdate).toBeGreaterThan(queryUpdate);
    expect(source).toContain("if (!old) return { messages: [], reactions: [] }");
    expect(source).toContain("removeMessageFromQueryEnvelope<GroupMessage>(old, deletedId)");
    expect(source).toContain("removeMessageFromQueryEnvelope<GroupMessage>(old, updated.id)");
    expect(source).toContain("removeMessage(prev, deletedId)");
    expect(source).toContain("removeMessage(prev, updated.id)");
  });

  it("DirectMessagePage preserves an absent cache while sharing message envelope updates", () => {
    const source = page("DirectMessagePage.tsx");
    const record = source.indexOf("const outcome = recordRealtimeMutation(reconcileScope, updated)");
    const queryUpdate = source.indexOf(
      "applyMessageUpdateToQueryEnvelope<DirectMessage>(old, updated)",
      record,
    );
    const localUpdate = source.indexOf("applyMessageUpdate(prev, updated)", queryUpdate);

    expect(record).toBeGreaterThan(-1);
    expect(queryUpdate).toBeGreaterThan(record);
    expect(localUpdate).toBeGreaterThan(queryUpdate);
    expect(source).toContain("if (!old) return old");
    expect(source).toContain("removeMessageFromQueryEnvelope<DirectMessage>(old, deletedId)");
    expect(source).toContain("removeMessageFromQueryEnvelope<DirectMessage>(old, updated.id)");
  });

  it("ClubAdminChatPage preserves an absent cache while sharing soft-delete and edit updates", () => {
    const source = page("ClubAdminChatPage.tsx");
    const record = source.indexOf("const outcome = recordRealtimeMutation(reconcileScope, updated)");
    const queryUpdate = source.indexOf(
      "applyMessageUpdateToQueryEnvelope<ClubAdminMessage>(old, updated)",
      record,
    );
    const localUpdate = source.indexOf("applyMessageUpdate(prev, updated)", queryUpdate);

    expect(record).toBeGreaterThan(-1);
    expect(queryUpdate).toBeGreaterThan(record);
    expect(localUpdate).toBeGreaterThan(queryUpdate);
    expect(source).toContain("removeMessageFromQueryEnvelope<ClubAdminMessage>(old, updated.id)");
    expect(source).toContain(
      "old ? applyMessageUpdateToQueryEnvelope<ClubAdminMessage>(old, updated) : old",
    );
  });
});
