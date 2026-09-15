import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const joinPage = read("src/pages/JoinTeamPage.tsx");
const autoAccept = read("src/components/PendingInviteWelcomeDialog.tsx");

describe("membership invite data ownership", () => {
  it("uses canonical keys for token, destination, profile and child-link reads", () => {
    expect(joinPage).toContain("membershipKeys.pendingInviteToken(token ?? \"\")");
    expect(joinPage).toContain("membershipKeys.teamInvite(token ?? \"\")");
    expect(joinPage).toContain("membershipKeys.inviteRoles(");
    expect(joinPage).toContain("membershipKeys.joinProfile(user?.id ?? \"\")");
    expect(joinPage).toContain("membershipKeys.teamChildrenForLinking(");
    expect(joinPage).toContain("fetchPendingInviteByToken(supabase, token!)");
    expect(joinPage).toContain("fetchTeamInviteByToken(supabase, token!)");
    expect(joinPage).not.toContain('rpc("get_pending_invite_by_token"');
    expect(joinPage).not.toContain('rpc("get_team_invite_by_token"');
  });

  it("delegates pending-list data and completion refresh to membership features", () => {
    expect(autoAccept).toContain("membershipKeys.pendingInvitesForUser(");
    expect(autoAccept).toContain("fetchPendingInvitesForUser(supabase, user.id)");
    expect(autoAccept).toContain("refreshAcceptedInviteMembership(queryClient)");

    const queryStart = autoAccept.indexOf("membershipKeys.pendingInvitesForUser(");
    const queryEnd = autoAccept.indexOf("const createChildrenFromMetadata", queryStart);
    const queryBlock = autoAccept.slice(queryStart, queryEnd);
    expect(queryBlock).not.toContain('.from("pending_invites")');
  });

  it("routes a logged-out existing invite recipient to sign-in instead of account creation", () => {
    expect(joinPage).toContain("resolveLoggedOutInviteAuthMode({");
    expect(joinPage).toContain("invitedUserId: pendingInviteData?.invited_user_id");
    expect(joinPage).toContain("mode: authMode");
    expect(joinPage).toContain('"Sign In to Join"');
  });
});
