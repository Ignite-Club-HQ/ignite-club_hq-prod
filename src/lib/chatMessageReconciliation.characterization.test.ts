import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

describe("Realtime message query-envelope boundary", () => {
  it.each(["ClubChatPage.tsx", "BroadcastChatPage.tsx"])(
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
});
