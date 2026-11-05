import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ allowed: true, icp: false, fetch: vi.fn(), from: vi.fn(), session: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin" } }) }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => m.icp ? "icp" : "supabase" }));
vi.mock("@/live/targetRegistry", () => ({ getActiveSupabaseTarget: () => ({ url: "https://example.invalid", anonKey: "public-test-key" }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: m.from, auth: { getSession: m.session } } }));
import Page from "./ScoreHistoryReviewPage";
function open() { render(<MemoryRouter initialEntries={["/clubs/00000000-0000-4000-8000-000000000001/score-review"]}><Routes><Route path="/clubs/:clubId/score-review" element={<Page />} /></Routes></MemoryRouter>); }
async function fill() {
  await screen.findByLabelText("Competition identifier");
  for (const [label,value] of [["Competition identifier","comp"],["Match identifier","match"],["Home team identifier","home"],["Away team identifier","away"]]) fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.change(screen.getAllByLabelText("First score")[0],{target:{value:"0"}});
  fireEvent.change(screen.getAllByLabelText("Second score")[0],{target:{value:"2"}});
  fireEvent.change(screen.getAllByLabelText("First score")[1],{target:{value:"1"}});
  fireEvent.change(screen.getAllByLabelText("Second score")[1],{target:{value:"2"}});
  fireEvent.click(screen.getByRole("checkbox"));
}
beforeEach(() => {
  vi.clearAllMocks(); m.allowed=true; m.icp=false;
  m.from.mockImplementation(() => { const q: Record<string,unknown> = {}; q.select=()=>q; q.eq=()=>q; q.limit=()=>Promise.resolve({data:m.allowed?[{id:"role"}]:[],error:null}); return q; });
  m.session.mockResolvedValue({data:{session:{access_token:"synthetic-test-token"}}});
  vi.stubGlobal("fetch",m.fetch);
});
afterEach(() => vi.unstubAllGlobals());
describe("score review request flow (mocked session)", () => {
  it("denies a caller without the exact club role", async () => {m.allowed=false;open();await screen.findByRole("alert");expect(m.fetch).not.toHaveBeenCalled();expect(m.session).not.toHaveBeenCalled();});
  it("never uses Supabase as an Internet Identity fallback", async () => {m.icp=true;open();await screen.findByRole("alert");expect(m.from).not.toHaveBeenCalled();expect(m.fetch).not.toHaveBeenCalled();});
  it("requires consent before sending score copies", async () => {open();await screen.findByLabelText("Competition identifier");expect(screen.getByRole("button",{name:"Review discrepancies"})).toBeDisabled();expect(m.fetch).not.toHaveBeenCalled();});
  it("streams a completed review preserving zero", async () => {
    const events=[{type:"comparison",comparison:{action:"Hold for human review"}},{type:"text",text:"Record 1 is 0–2; record 2 is 1–2. Hold for verification."},{type:"done"}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join("");
    m.fetch.mockResolvedValue(new Response(events,{headers:{"Content-Type":"text/event-stream"}}));
    open();await fill();fireEvent.click(screen.getByRole("button",{name:"Review discrepancies"}));
    await screen.findByRole("button",{name:"Download review"});
    const body=JSON.parse(m.fetch.mock.calls[0][1].body);expect(body.records[0].firstScore).toBe(0);expect(body.records[1].firstScore).toBe(1);expect(body.consent).toBe(true);
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });
  it("surfaces a terminal gateway failure without retrying",async()=>{
    m.fetch.mockResolvedValue(new Response(JSON.stringify({error:"AI access is blocked."}),{status:403}));
    open();await fill();fireEvent.click(screen.getByRole("button",{name:"Review discrepancies"}));await screen.findByRole("alert");
    await waitFor(()=>expect(m.fetch).toHaveBeenCalledTimes(1));expect(screen.queryByRole("button",{name:"Download review"})).not.toBeInTheDocument();
  });
});