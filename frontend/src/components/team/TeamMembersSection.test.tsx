import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { TeamMembersSection, type TeamMembersRecord } from "./TeamMembersSection";

function renderSection(overrides: Partial<React.ComponentProps<typeof TeamMembersSection>> = {}) {
  const props: React.ComponentProps<typeof TeamMembersSection> = {
    teamId: "team-1",
    members: {},
    teamChildren: [],
    pendingInvites: [],
    memberRoleFilter: "all",
    adultPlayerCount: 0,
    isAdmin: true,
    isClubAdmin: false,
    currentUserId: "user-1",
    isMembersLoading: false,
    isMembersFetching: false,
    isChildrenLoading: false,
    isChildrenFetching: false,
    isMembersError: false,
    membersError: null,
    refetchMembers: vi.fn(),
    refetchChildren: vi.fn(),
    isSoccerClub: false,
    onOpenHeaderInvite: vi.fn(),
    onOpenAddPlayer: vi.fn(),
    onSelectChild: vi.fn(),
    onLinkChildToParent: vi.fn(),
    onMoveToTeam: vi.fn(),
    onAddRoleMember: vi.fn(),
    onSelectMember: vi.fn(),
    onInviteParentChild: vi.fn(),
    onOpenPositionSheet: vi.fn(),
    onRemoveMember: vi.fn(),
    ...overrides,
  };
  render(
    <Accordion type="multiple" defaultValue={["members"]}>
      <TeamMembersSection {...props} />
    </Accordion>,
  );
  return props;
}

describe("TeamMembersSection", () => {
  it("shows the empty state and invokes onOpenHeaderInvite from the invite button", () => {
    const props = renderSection();
    expect(screen.getByText("No members yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Invite Members/i }));
    expect(props.onOpenHeaderInvite).toHaveBeenCalledTimes(1);
  });

  it("shows a friendly error message and lets the user retry when the member fetch fails", () => {
    const props = renderSection({
      isMembersError: true,
      membersError: new Error("boom"),
    });
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(props.refetchMembers).toHaveBeenCalledTimes(1);
  });

  it("renders role-grouped members and calls onSelectMember when a member card is clicked", () => {
    const members: TeamMembersRecord = {
      "user-2": {
        profile: { id: "user-2", display_name: "Jane Coach", avatar_url: null },
        roles: [{ id: "role-1", role: "team_admin" }],
      },
    };
    const props = renderSection({ members });
    expect(screen.getByText("Team Admins")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Jane Coach"));
    expect(props.onSelectMember).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-2", displayName: "Jane Coach" }),
    );
  });

  it("shows an immediate, single in-flight player retry and reports a failed retry", async () => {
    let complete!: (value: { isError: boolean }) => void;
    const refetchChildren = vi.fn(() => new Promise<{ isError: boolean }>(resolve => { complete = resolve; }));
    renderSection({
      members: { parent: { profile: { id: "parent", display_name: "Test", avatar_url: null }, roles: [{ id: "role", role: "parent" }] } },
      isChildrenError: true,
      childrenError: new Error("Group 2 lookup unavailable"),
      refetchChildren,
    });
    const retry = screen.getByRole("button", { name: "Retry players" });
    fireEvent.click(retry);
    expect(refetchChildren).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retrying players…" })).toBeDisabled();
    expect(screen.getByText("Checking the player list again…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retrying players…" }));
    expect(refetchChildren).toHaveBeenCalledTimes(1);
    await act(async () => { complete({ isError: true }); });
    expect(screen.getByRole("button", { name: "Retry players" })).toBeEnabled();
    expect(screen.getByText(/The retry finished, but the player list is still unavailable/)).toBeInTheDocument();
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("does not display a false failed-retry message if the request succeeds", async () => {
    const refetchChildren = vi.fn().mockResolvedValue({ isError: false });
    renderSection({ isChildrenError: true, childrenError: new Error("old failure"), refetchChildren });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry players" }));
    });
    expect(refetchChildren).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/The retry finished, but/)).not.toBeInTheDocument();
  });

  it("refreshes members and children from the refresh button", () => {
    const props = renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Refresh members list/i }));
    expect(props.refetchMembers).toHaveBeenCalledTimes(1);
    expect(props.refetchChildren).toHaveBeenCalledTimes(1);
  });
});
