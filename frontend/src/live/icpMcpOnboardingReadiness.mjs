/**
 * Pure, fail-closed readiness checklist for ICP MCP first-time club onboarding.
 * Does not write, infer legal consent, or alter group service admission.
 * Callers must supply verified server responses; unknown is not success.
 */
export function evaluateIcpMcpOnboarding(state = {}) {
  const steps = [
    ["account", state.accountActive === true, "Register or activate the user's own Ignite account with explicit permission."],
    ["profile", state.profileComplete === true, "Finish the protected display-name/profile setup in Ignite."],
    ["terms", state.currentTermsAccepted === true, "Show current legal terms and obtain the customer's explicit acceptance in Ignite."],
    ["club", state.clubVerified === true, "Create or verify an existing club under the customer's principal."],
    ["admin", state.clubAdminVerified === true, "Verify the caller's actual club_admin grant."],
    ["sport", state.sportVerified === true, "Ask the customer for their sport and verify the saved club sport."],
    ["country", state.countryVerified === true, "Confirm home country before the irreversible set-once update and verify readback."],
    ["settings", state.clubSettingsVerified === true, "Verify club defaults; don't infer success from best-effort background calls."],
    ["team", state.teamVerified === true, "Verify the team belongs to the club and can be read back."],
    ["chats", state.defaultChatsVerified === true, "Check default conversations in Ignite; don't assume the club-domain create provisioned them."],
  ];
  const missing = steps.filter(([, ok]) => !ok).map(([id, , action]) => ({ id, action }));
  const groupLink = state.groupLocalLinkVerified === true ? "verified"
    : state.groupLinkBlockedByAdmission === true ? "admission_blocked" : "unverified";
  return {
    complete: missing.length === 0 && groupLink === "verified",
    missing,
    groupLink,
    next: missing[0]?.action ??
      (groupLink === "admission_blocked"
        ? "Group service admission is not released; request a reviewed backend rollout. Never override the guard."
        : groupLink === "unverified"
          ? "Verify the group account link; don't equate club_admin with local account synchronization."
          : null),
  };
}
