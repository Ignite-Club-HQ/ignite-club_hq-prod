import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { shouldSkipChatMountInvalidate } from "./chatMountInvalidate";

describe("mount refresh coalescing", () => {
  it("does not cancel an in-flight fresh read even with no cache", async () => {
    const qc = new QueryClient(); let done: (v: string) => void = () => {};
    const read = qc.fetchQuery({ queryKey: ["messages"], queryFn: () => new Promise<string>(r => { done = r; }) });
    expect(shouldSkipChatMountInvalidate(qc, ["messages"], "chat")).toBe(true);
    done("fresh"); await read;
    expect(shouldSkipChatMountInvalidate(qc, ["other"], "chat")).toBe(false); qc.clear();
  });
});