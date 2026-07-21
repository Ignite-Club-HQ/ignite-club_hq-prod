import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toast, navigate, from, invalidateQueries } = vi.hoisted(() => ({
  toast: vi.fn(),
  navigate: vi.fn(),
  from: vi.fn(),
  invalidateQueries: vi.fn(),
}));

const queryData: Record<string, unknown> = {
  "user-admin-clubs": [{ id: "club-1", name: "Test Club", allow_guests_default: false, max_guests_per_member_default: 2 }],
  "is-club-admin-for-event": true,
  "club-pro-football": false,
  "club-mini-leagues": [],
  "user-team-memberships": ["team-1"],
  "club-teams-for-event": [{ id: "team-1", name: "First Team", club_id: "club-1" }],
  "event-members-for-duty": [],
  "saved-locations": [],
  "favorite-event-titles": [],
};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate, useSearchParams: () => [new URLSearchParams()] };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0];
    return { data: queryData[String(key)], isLoading: false };
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/hooks/useClubTheme", () => ({ useClubTheme: () => ({ activeClubFilter: "club-1" }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/MobileCardSelect", () => ({
  MobileCardSelect: ({ label, value, onValueChange, options, disabled }: any) => (
    <label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Select</option>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
  ),
}));
vi.mock("@/components/AddressAutocomplete", () => ({
  AddressAutocomplete: ({ value, onChange }: any) => <input aria-label="Event address" value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("@/components/GoogleMapEmbed", () => ({ GoogleMapEmbed: () => null }));
vi.mock("@/components/OpponentInput", () => ({ OpponentInput: () => null }));
vi.mock("@/components/DutyMemberSelect", () => ({ DutyMemberSelect: () => null }));
vi.mock("@/components/event/RsvpAudienceSelect", () => ({ RsvpAudienceSelect: () => null }));
vi.mock("@/components/event/EventRoleAudienceSelect", () => ({ EventRoleAudienceSelect: () => null }));

import CreateEventPage from "./CreateEventPage";

function eventInsertResult(error: unknown = null) {
  const chain: any = {};
  chain.insert = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data: error ? null : { id: "event-1" }, error });
  return chain;
}

async function fillRequiredGameFields(arrival: string) {
  fireEvent.change(screen.getByLabelText("Event Title"), { target: { value: "League Match" } });
  await waitFor(() => expect(screen.getByLabelText("Club")).toHaveValue("club-1"));
  fireEvent.change(screen.getByLabelText("Team"), { target: { value: "team-1" } });
  fireEvent.change(screen.getByLabelText("Event address"), { target: { value: "Synthetic Sports Ground" } });
  fireEvent.change(screen.getByLabelText("Arrive before kickoff (optional)"), { target: { value: arrival } });
}

describe("CreateEventPage validation", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("lastEventType", "game");
    vi.clearAllMocks();
    queryData["club-teams-for-event"] = [{ id: "team-1", name: "First Team", club_id: "club-1" }];
  });

  it.each(["0", "481", "1.5"])("rejects invalid arrival minutes %s before any mutation", async (arrival) => {
    render(<CreateEventPage />);
    await fillRequiredGameFields(arrival);

    fireEvent.click(screen.getByRole("button", { name: "Create Event" }));

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Invalid arrival time",
      variant: "destructive",
    }));
    expect(from).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("accepts the lower arrival boundary and writes a trimmed event payload", async () => {
    const query = eventInsertResult();
    from.mockReturnValueOnce(query);
    render(<CreateEventPage />);
    await fillRequiredGameFields("1");

    fireEvent.click(screen.getByRole("button", { name: "Create Event" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/events/event-1"));
    expect(from).toHaveBeenCalledWith("events");
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      title: "League Match",
      club_id: "club-1",
      team_id: "team-1",
      type: "game",
      address: "Synthetic Sports Ground",
      arrival_minutes_before: 1,
      created_by: "user-1",
    }));
  });

  it("reports an event insert failure and does not navigate or report success", async () => {
    const query = eventInsertResult({ message: "event creation denied" });
    from.mockReturnValueOnce(query);
    render(<CreateEventPage />);
    await fillRequiredGameFields("15");

    fireEvent.click(screen.getByRole("button", { name: "Create Event" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Error",
        description: expect.stringContaining("event creation denied"),
        variant: "destructive",
      })),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Event Title")).toHaveValue("League Match");
    expect(screen.getByLabelText("Team")).toHaveValue("team-1");
    expect(screen.getByLabelText("Event address")).toHaveValue("Synthetic Sports Ground");
  });

  it("rejects a stale cross-club team option before creating an event", async () => {
    const query = eventInsertResult({ message: "cross-club event scope must be rejected before insertion" });
    from.mockReturnValueOnce(query);
    queryData["club-teams-for-event"] = [
      { id: "team-1", name: "First Team", club_id: "club-1" },
      { id: "team-foreign", name: "Foreign Team", club_id: "club-2" },
    ];
    render(<CreateEventPage />);
    fireEvent.change(screen.getByLabelText("Event Title"), { target: { value: "Cross-club Match" } });
    await waitFor(() => expect(screen.getByLabelText("Club")).toHaveValue("club-1"));
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "team-foreign" } });
    fireEvent.change(screen.getByLabelText("Event address"), { target: { value: "Synthetic Ground" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Event" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    expect(from).not.toHaveBeenCalledWith("events");
    expect(navigate).not.toHaveBeenCalled();
  });
});
