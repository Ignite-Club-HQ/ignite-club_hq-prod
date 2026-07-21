import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toast, navigate, from, invalidateQueries } = vi.hoisted(() => ({
  toast: vi.fn(), navigate: vi.fn(), from: vi.fn(), invalidateQueries: vi.fn(),
}));

const eventFixture = {
  id: "event-1",
  title: "Original Match",
  type: "game",
  event_date: "2026-08-01T10:00:00.000Z",
  start_time: "2026-08-01T10:00:00.000Z",
  end_time: "2026-08-01T12:00:00.000Z",
  club_id: "club-1",
  team_id: "team-1",
  address: "Synthetic Ground",
  description: null,
  reminder_hours_before: null,
  amount: null,
  opponent: "Test United",
  arrival_minutes_before: 30,
  is_bye: false,
  is_recurring: false,
  parent_event_id: null,
  allow_guests: null,
  max_guests_per_member: null,
  clubs: { name: "Test Club" },
  teams: { name: "First Team", default_match_arrival_minutes: 30, default_rsvp_audience: "players_only" },
};

const queryData: Record<string, unknown> = {
  "event-edit": eventFixture,
  "can-edit-event": true,
  "club-subscription-edit": null,
  "event-duties": [],
  "event-members-for-duty": [],
  "saved-locations": [],
  "user-clubs-for-edit": [{ id: "club-1", name: "Test Club" }],
  "user-teams-for-edit": [{ id: "team-1", name: "First Team", club_id: "club-1", default_match_arrival_minutes: 30 }],
};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ id: "event-1" }),
    useSearchParams: () => [new URLSearchParams()],
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    return { data: queryData[String(queryKey[0])], isLoading: false };
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/MobileCardSelect", () => ({ MobileCardSelect: () => null }));
vi.mock("@/components/AddressAutocomplete", () => ({ AddressAutocomplete: () => null }));
vi.mock("@/components/GoogleMapEmbed", () => ({ GoogleMapEmbed: () => null }));
vi.mock("@/components/OpponentInput", () => ({ OpponentInput: () => null }));
vi.mock("@/components/DutyMemberSelect", () => ({ DutyMemberSelect: () => null }));
vi.mock("@/components/EventSponsorSelector", () => ({ EventSponsorSelector: () => null }));
vi.mock("@/components/event/RsvpAudienceSelect", () => ({ RsvpAudienceSelect: () => null }));
vi.mock("@/components/event/EventRoleAudienceSelect", () => ({ EventRoleAudienceSelect: () => null }));

import EditEventPage from "./EditEventPage";

function updateResult(error: unknown = null) {
  const chain: any = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn().mockResolvedValue({ error });
  return chain;
}

function thenableUpdateResult(error: unknown = null) {
  const chain: any = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: unknown) => unknown) => Promise.resolve({ error }).then(resolve),
  });
  return chain;
}

function useRecurringChildFixture() {
  queryData["event-edit"] = {
    ...eventFixture,
    is_recurring: true,
    parent_event_id: "parent-1",
  };
}

describe("EditEventPage validation and single-event updates", () => {
  beforeEach(() => {
    queryData["event-edit"] = eventFixture;
    queryData["user-clubs-for-edit"] = [{ id: "club-1", name: "Test Club" }];
    queryData["user-teams-for-edit"] = [{ id: "team-1", name: "First Team", club_id: "club-1", default_match_arrival_minutes: 30 }];
    vi.clearAllMocks();
  });

  it.each(["0", "481", "1.5"])("rejects invalid arrival minutes %s before any mutation", async (arrival) => {
    render(<EditEventPage />);
    await waitFor(() => expect(screen.getByLabelText("Event Title")).toHaveValue("Original Match"));
    fireEvent.change(screen.getByLabelText("Arrive before kickoff"), { target: { value: arrival } });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invalid arrival time", variant: "destructive" }));
    expect(from).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("updates only the selected event and preserves its two-hour duration", async () => {
    const query = updateResult();
    from.mockReturnValueOnce(query);
    render(<EditEventPage />);
    await waitFor(() => expect(screen.getByLabelText("Event Title")).toHaveValue("Original Match"));
    fireEvent.change(screen.getByLabelText("Event Title"), { target: { value: "  Updated Match  " } });
    fireEvent.change(screen.getByLabelText("Date & Time"), { target: { value: "2026-08-02T15:00" } });
    fireEvent.change(screen.getByLabelText("Arrive before kickoff"), { target: { value: "480" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/events/event-1"));
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("events");
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      title: "Updated Match",
      event_date: "2026-08-02T15:00:00.000Z",
      start_time: "2026-08-02T15:00:00.000Z",
      end_time: "2026-08-02T17:00:00.000Z",
      arrival_minutes_before: 480,
      club_id: "club-1",
      team_id: "team-1",
    }));
    expect(query.eq).toHaveBeenCalledWith("id", "event-1");
  });

  it("rejects an existing event whose selected team is not in its club", async () => {
    const query = updateResult({ message: "cross-club event scope must be rejected before update" });
    from.mockReturnValueOnce(query);
    queryData["event-edit"] = { ...eventFixture, team_id: "team-foreign", teams: { name: "Foreign Team" } };
    queryData["user-teams-for-edit"] = [
      { id: "team-foreign", name: "Foreign Team", club_id: "club-2", default_match_arrival_minutes: 30 },
    ];
    render(<EditEventPage />);
    await waitFor(() => expect(screen.getByLabelText("Event Title")).toHaveValue("Original Match"));

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    expect(from).not.toHaveBeenCalledWith("events");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("EditEventPage recurring-series updates", () => {
  beforeEach(() => {
    useRecurringChildFixture();
    vi.clearAllMocks();
  });

  it("updates only the selected occurrence when the user chooses This Event Only", async () => {
    const selected = thenableUpdateResult();
    from.mockReturnValueOnce(selected);
    render(<EditEventPage />);
    await waitFor(() => expect(screen.getByLabelText("Event Title")).toHaveValue("Original Match"));
    fireEvent.change(screen.getByLabelText("Event Title"), { target: { value: "One-off title" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "This Event Only" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/events/event-1"));
    expect(from).toHaveBeenCalledTimes(1);
    expect(selected.update).toHaveBeenCalledWith(expect.objectContaining({
      title: "One-off title",
      event_date: "2026-08-01T10:00:00.000Z",
      start_time: "2026-08-01T10:00:00.000Z",
      end_time: "2026-08-01T12:00:00.000Z",
    }));
    expect(selected.eq).toHaveBeenCalledWith("id", "event-1");
  });

  it("updates the selected child plus parent and siblings without overwriting sibling dates", async () => {
    const selected = thenableUpdateResult();
    const parent = thenableUpdateResult();
    const siblings = thenableUpdateResult();
    from.mockReturnValueOnce(selected).mockReturnValueOnce(parent).mockReturnValueOnce(siblings);
    render(<EditEventPage />);
    await waitFor(() => expect(screen.getByLabelText("Event Title")).toHaveValue("Original Match"));
    fireEvent.change(screen.getByLabelText("Event Title"), { target: { value: "Series title" } });
    fireEvent.change(screen.getByLabelText("Date & Time"), { target: { value: "2026-08-03T14:00" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Entire Series" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/events/event-1"));
    expect(from).toHaveBeenCalledTimes(3);
    expect(selected.update).toHaveBeenCalledWith(expect.objectContaining({
      title: "Series title",
      event_date: "2026-08-03T14:00:00.000Z",
      start_time: "2026-08-03T14:00:00.000Z",
      end_time: "2026-08-03T16:00:00.000Z",
    }));
    expect(parent.update).toHaveBeenCalledWith(expect.not.objectContaining({ event_date: expect.anything() }));
    expect(parent.update).toHaveBeenCalledWith(expect.not.objectContaining({ start_time: expect.anything() }));
    expect(parent.eq).toHaveBeenCalledWith("id", "parent-1");
    expect(siblings.update).toHaveBeenCalledWith(expect.not.objectContaining({ event_date: expect.anything() }));
    expect(siblings.eq).toHaveBeenCalledWith("parent_event_id", "parent-1");
    expect(siblings.neq).toHaveBeenCalledWith("id", "event-1");
  });

  it("reports a selected-occurrence mutation failure and does not navigate", async () => {
    const selected = thenableUpdateResult({ message: "write rejected" });
    from.mockReturnValueOnce(selected);
    render(<EditEventPage />);
    await waitFor(() => expect(screen.getByLabelText("Event Title")).toHaveValue("Original Match"));

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "This Event Only" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Failed to update event. Please try again.",
    })));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not report success or navigate when the selected series update fails", async () => {
    const selected = thenableUpdateResult({ message: "series write rejected" });
    const parent = thenableUpdateResult();
    const siblings = thenableUpdateResult();
    from.mockReturnValueOnce(selected).mockReturnValueOnce(parent).mockReturnValueOnce(siblings);
    render(<EditEventPage />);
    await waitFor(() => expect(screen.getByLabelText("Event Title")).toHaveValue("Original Match"));

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Entire Series" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Failed to update event. Please try again.",
    })));
    expect(navigate).not.toHaveBeenCalled();
  });
});
