import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ board: vi.fn(), clear: vi.fn() }));
vi.mock("@/components/pitch/PitchBoard", () => ({ default: (props: unknown) => { mocks.board(props); return null; } }));
vi.mock("@/components/pitch/pitchBoardOpenFlag", () => ({ clearPitchBoardOpenFlag: mocks.clear }));
import { EventPitchBoardPortal } from "./EventPitchBoardPortal";

const props = {
  open: true, event: { team_id: "team-1", teams: { name: "Test team" } }, eventId: "selected-match",
  teamMembers: undefined, teamSubscription: null, isSoccerClub: true, accessGranted: true,
  canViewReadOnly: false, isSubsManager: false, setOpen: vi.fn(),
};

describe("event pitch-board opening recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("can retry a failed roster load without changing the selected match", () => {
    const onRetry = vi.fn();
    const screen = render(<EventPitchBoardPortal {...props} loadFailed onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(props.setOpen).not.toHaveBeenCalled();
    expect(mocks.board).not.toHaveBeenCalled();
  });

  it("can close after a failed load and clears only the open marker", () => {
    const screen = render(<EventPitchBoardPortal {...props} loadFailed />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.setOpen).toHaveBeenCalledWith(false);
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.board).not.toHaveBeenCalled();
  });

  it("opens the exact event with the existing read-only permission", async () => {
    render(<EventPitchBoardPortal {...props} teamMembers={[]} canViewReadOnly />);
    await waitFor(() => expect(mocks.board).toHaveBeenCalled());
    expect(mocks.board.mock.calls[0][0]).toMatchObject({ teamId: "team-1", initialLinkedEventId: "selected-match", readOnly: true });
  });

  it("never mounts a board without access", () => {
    render(<EventPitchBoardPortal {...props} teamMembers={[]} accessGranted={false} />);
    expect(mocks.board).not.toHaveBeenCalled();
  });
});