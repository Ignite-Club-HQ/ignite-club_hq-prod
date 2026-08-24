import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  getParentInviteErrorMessage,
  isNotChildParentInviteError,
} from "@/features/membership/acceptParentInvite";

const joinTeamPage = readFileSync("src/pages/JoinTeamPage.tsx", "utf8");
const welcomeDialog = readFileSync("src/components/PendingInviteWelcomeDialog.tsx", "utf8");
const completeProfilePage = readFileSync("src/pages/CompleteProfilePage.tsx", "utf8");

/**
 * A parent invitation that carries child metadata must be accepted atomically.
 * These guards keep both acceptance entry points on the transactional RPC so a
 * failed child creation/assignment can never leave a consumed invite behind.
 */
describe("parent invite atomic acceptance", () => {
  it("JoinTeamPage accepts child-carrying parent invites through the RPC", () => {
    // Shared helper used by both the named-invite and shareable-link paths.
    expect(joinTeamPage).toContain("provisionChildrenFromInviteMetadata");
    expect(joinTeamPage).toContain("acceptParentTeamInvite({ inviteId })");
  });

  it("JoinTeamPage surfaces a retryable error instead of continuing on failure", () => {
    const branch = joinTeamPage.slice(
      joinTeamPage.indexOf("acceptParentTeamInvite({ inviteId })"),
      joinTeamPage.indexOf("if (metadata.child_id) {")
    );
    expect(branch).toContain("throw new Error(getParentInviteErrorMessage(rpcError))");
    // The old flow logged child failures and kept going.
    expect(branch).not.toContain("continue;");
    expect(branch).not.toContain("createChildForParentOrReuse");
    expect(branch).not.toContain("child_team_assignments");
  });

  it("PendingInviteWelcomeDialog routes child metadata invites to the RPC", () => {
    expect(welcomeDialog).toContain("acceptParentTeamInvite({ inviteId: invite.id })");
    expect(welcomeDialog).toContain("hasChildMetadata");
  });

  it("CompleteProfilePage uses one authoritative path for standard parent invites", () => {
    const branch = completeProfilePage.slice(
      completeProfilePage.indexOf("if (isStandardParentChildInvite)"),
      completeProfilePage.indexOf("// Check if role already exists")
    );
    expect(branch).toContain('if (invite.status === "pending")');
    expect(branch).toContain("acceptParentTeamInvite({ inviteId: invite.id })");
    expect(branch).toContain("provisionInviteChildren({");
    expect(branch).toContain("continue;");
    expect(branch).not.toContain("createChildForParentOrReuse");
    expect(branch).not.toContain("child_team_assignments");
  });

  it("PendingInviteWelcomeDialog leaves the invite pending when the RPC fails", () => {
    const branch = welcomeDialog.slice(
      welcomeDialog.indexOf("if (hasChildMetadata)"),
      welcomeDialog.indexOf("// Non-guardian path")
    );
    expect(branch).toContain("continue; // no partial membership, no acceptance");
    expect(branch).not.toContain('.update({ status: "accepted"');
  });

  it("does not mark reusable join links as consumed by the parent RPC", () => {
    expect(welcomeDialog).toContain("mini_league_parent_join_link");
    expect(welcomeDialog).toContain("league_admin_join_link");
  });

  it("maps RPC failures to non-technical, retryable messages", () => {
    expect(getParentInviteErrorMessage({ message: "invite_not_for_this_user" })).toContain(
      "different email address"
    );
    expect(getParentInviteErrorMessage({ message: "child_team_assignment_failed" })).toContain(
      "Nothing was saved"
    );
    expect(getParentInviteErrorMessage({ message: "referenced_child_out_of_scope" })).toContain(
      "no longer matches this team"
    );
    // Never leaks raw SQL / personal data.
    expect(getParentInviteErrorMessage({ message: "boom: child Sam Smith" })).not.toContain("Sam");
  });

  it("recognises invites that are not child-carrying parent invites", () => {
    expect(isNotChildParentInviteError({ message: "not_a_child_parent_invite" })).toBe(true);
    expect(isNotChildParentInviteError({ message: "child_create_failed" })).toBe(false);
  });

  it("keeps non-parent invitation journeys on their existing paths", () => {
    expect(joinTeamPage).toContain("claim_mini_league_invite");
    expect(welcomeDialog).toContain("accept_guardian_parent_invite");
    expect(joinTeamPage).toContain('metadata?.kind === "mini_league_parent_join_link"');
  });
});
