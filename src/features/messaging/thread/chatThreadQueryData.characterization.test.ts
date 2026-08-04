import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

describe("chat query-data boundary consumption", () => {
  it.each([
    ["BroadcastChatPage.tsx", "Message"],
    ["DirectMessagePage.tsx", "DirectMessage"],
  ])("%s delegates legacy-array/envelope interpretation to the shared primitive", (name, type) => {
    const source = page(name);

    expect(source).toContain(
      'import { extractChatQueryMessages } from "@/features/messaging/thread/chatThreadQueryData"',
    );
    expect(source).toContain(`extractChatQueryMessages<${type}>(messagesData)`);
    expect(source).not.toMatch(/Array\.isArray\(messagesData\)\s*\?\s*messagesData/);
  });
});
