import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pitchProps: null as any,
  canEdit: true,
  isSubsManager: false,
  hasPro: true,
  players: [] as any[],
}));

vi.mock("@/components/pitch/PitchBoard", () => ({
  default: (props: any) => { mocks.pitchProps = props; return <div data-testid="mini-league-pitchboard">Pitch board mounted</div>; },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfilesByIds: vi.fn(async () => ({ data: [], error: null })) }));
vi.mock("@/components/AddDutySheet", () => ({ AddDutySheet: () => null }));
vi.mock("@/components/AssignDutySheet", () => ({ AssignDutySheet: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0];
    const base = { isLoading: false, isError: false, status: "success", fetchStatus: "idle", isFetching: false, refetch: vi.fn() };
    if (key === "event-group") return { ...base, data: {
      id: "group-1", name: "Grand Final", ability_band: "Balanced", pitch_name: "Pitch 1",
      team_a_color: "#aa0000", team_b_color: "#0000aa",
      event: { id: "event-1", title: "Final", event_date: new Date().toISOString(), mini_league_id: "league-1" },
    } };
    if (key === "event-group-players-with-teams") return { ...base, data: mocks.players };
    if (key === "event-group-duties") return { ...base, data: [] };
    if (key === "mini-league-pitch-settings") return { ...base, data: { minutes_per_half: 18, max_spread_minutes: 3, club_id: "club-1", clubs: { sport: "football" } } };
    if (key === "club-pro-football") return { ...base, data: mocks.hasPro };
    if (key === "mini-league-edit-permission") return { ...base, data: { canEdit: mocks.canEdit, isSubsManager: mocks.isSubsManager } };
    if (key === "mini-league-duty-assignees") return { ...base, data: [] };
    throw new Error(`Unhandled query ${String(key)}`);
  },
}));

import EventGroupPitchPage from "./EventGroupPitchPage";

function mount() {
  return render(
    <MemoryRouter initialEntries={["/events/event-1/groups/group-1/pitch"]}>
      <Routes><Route path="/events/:id/groups/:groupId/pitch" element={<EventGroupPitchPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe("mini-league pitchboard journey", () => {
  beforeEach(() => {
    mocks.pitchProps = null;
    mocks.canEdit = true;
    mocks.isSubsManager = false;
    mocks.hasPro = true;
    mocks.players = [
      { id: "a1", name: "Alpha One", ability_rating: 4, team: "a" },
      { id: "a2", name: "Alpha Two", ability_rating: 3, team: "a" },
      { id: "b1", name: "Bravo One", ability_rating: 4, team: "b" },
      { id: "b2", name: "Bravo Two", ability_rating: 2, team: "b" },
    ];
  });

  it("opens one isolated event-group board with exact Team A/Team B identities and league settings", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open Pitch Board" }));
    await screen.findByTestId("mini-league-pitchboard");
    expect(mocks.pitchProps).toMatchObject({
      teamId: "event-group-group-1",
      teamName: "Grand Final",
      disableAutoSubs: false,
      initialMinutesPerHalf: 18,
      initialMaxSpreadMinutes: 3,
      initialTeamSize: 4,
      initialLinkedEventId: null,
      initialShowMatchHeader: false,
      readOnly: false,
      miniLeagueTeams: {
        teamAPlayerIds: ["a1", "a2"],
        teamBPlayerIds: ["b1", "b2"],
        teamAColor: "#aa0000",
        teamBColor: "#0000aa",
        teamAName: "Team A",
        teamBName: "Team B",
      },
    });
    expect(mocks.pitchProps.members.map((member: any) => member.user_id)).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("gives the match-specific Subs Manager edit access without granting a broader role", async () => {
    mocks.canEdit = true;
    mocks.isSubsManager = true;
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open Pitch Board" }));
    await waitFor(() => expect(mocks.pitchProps).not.toBeNull());
    expect(mocks.pitchProps).toMatchObject({ readOnly: false, isSubsManager: true });
  });

  it("mounts the same match roster read-only for a viewer without edit permission", async () => {
    mocks.canEdit = false;
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open Pitch Board" }));
    await waitFor(() => expect(mocks.pitchProps).not.toBeNull());
    expect(mocks.pitchProps).toMatchObject({ readOnly: true, isSubsManager: false });
  });
});
