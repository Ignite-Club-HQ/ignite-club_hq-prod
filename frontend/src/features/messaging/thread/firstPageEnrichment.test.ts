import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { firstPageWithEnrichment } from "./firstPageEnrichment";
import { retirePrivateProfileSession } from "@/live/privateProfileSession";

describe("authorised first page", () => {
  it("returns text before enrichment completes and never replaces newer text or rows", async () => {
    const qc = new QueryClient(); const key = ["messages", "account", "chat"];
    let finish: (rows: any[]) => void = () => {};
    const pending = firstPageWithEnrichment(qc, key, "chat", ready => {
      ready([{ id: "m", text: "authorised", author: null }] as any);
      return new Promise<any[]>(resolve => { finish = resolve; });
    }, messages => ({ messages }));
    const core = await pending;
    expect(core.messages).toEqual([{ id: "m", text: "authorised", author: null }]);
    qc.setQueryData(key, { messages: [{ id: "m", text: "edited", author: null }, { id: "new", text: "delivered" }] });
    finish([{ id: "m", text: "old", author: { display_name: "Member" } }]);
    await vi.waitFor(() => expect(qc.getQueryData(key)).toEqual({ messages: [
      { id: "m", text: "edited", author: { display_name: "Member" } }, { id: "new", text: "delivered" },
    ] })); qc.clear();
  });
  it("does not disclose pending enrichment after logout or revocation", async () => {
    const qc = new QueryClient(); const key = ["messages"];
    let finish: (rows: any[]) => void = () => {};
    const core = await firstPageWithEnrichment(qc, key, "chat", ready => {
      ready([{ id: "m", author: null }]); return new Promise<any[]>(resolve => { finish = resolve; });
    }, messages => ({ messages }));
    qc.setQueryData(key, core); retirePrivateProfileSession();
    finish([{ id: "m", author: { display_name: "Private" } }]);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(qc.getQueryData(key)).toEqual(core); qc.clear();
  });
});