// Simulated-latency benchmark: before (copied loader) vs current loader. Not a release check.
import { describe, it, vi } from "vitest";
const LAT = () => 120 + Math.random() * 130;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let cold = true;
const trip = async <T,>(v: T) => { await sleep(LAT() + (cold ? 500 : 0)); return v; };
const teams = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, club_id: `c${i % 2}`, name: `T${i}`, deleted_at_ms: [], logo_url: [] }));
vi.mock("@/live/features/membership", () => ({ getLiveMyRoleGrants: () => trip(teams.map(t => ({ team: [t.id], club: [t.club_id], role: "player" }))) }));
vi.mock("@/live/features/club", () => ({
  getLiveTeam: (_: unknown, id: string) => trip([teams.find(t => t.id === id)]),
  getLiveClubProfile: () => trip([{ name: "C", logo_url: [], sport: null }]),
  getLiveTeamSubscription: () => trip(null),
}));
vi.mock("@/live/features/miniLeagues", () => ({ listMyLiveMiniLeagues: () => trip([]), listLiveMiniLeaguesByClub: () => trip([]), getLiveMiniLeague: () => trip(null) }));
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
describe("carousel benchmark", () => {
  it("before vs after", async () => {
    const before = (await import("/tmp/icpCarouselItems.before.ts")).fetchIcpCarouselItems;
    const after = (await import("./icpCarouselItems")).fetchIcpCarouselItems;
    for (const [label, fn] of [["before", before], ["after", after]] as const) {
      for (const mode of ["cold", "warm"]) {
        cold = mode === "cold"; const t: number[] = [];
        for (let i = 0; i < 25; i++) { const s = performance.now(); await fn({} as never, null); t.push(performance.now() - s); }
        console.log(`BENCH ${label} ${mode} median=${q(t, .5).toFixed(0)}ms p95=${q(t, .95).toFixed(0)}ms`);
      }
    }
  }, 120_000);
});
