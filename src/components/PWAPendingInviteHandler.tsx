import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { setInviteFlowContext, getInviteFlowContext } from "@/components/InviteFlowProgress";

/**
 * This component checks if there's a pending invite stored from a PWA installation.
 * When a user installs the PWA from an invite link, we store the invite URL in localStorage.
 * When they open the PWA (in standalone mode), this component redirects them to that invite.
 */
export function PWAPendingInviteHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Only run in standalone mode (PWA)
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (!isStandalone) return;

    // Check for pending invite
    const pendingInvite = localStorage.getItem("pwa_pending_invite");
    if (!pendingInvite) return;

    // Only redirect if we're on the home page or root
    // Don't redirect if already on the invite page or auth page
    if (location.pathname === "/" || location.pathname === "") {
      console.log("[PWA] Resuming pending invite:", pendingInvite);
      
      // Get existing invite flow context (already in localStorage)
      const existingContext = getInviteFlowContext();
      
      // Clear the pending invite so we don't redirect again
      localStorage.removeItem("pwa_pending_invite");
      
      // Only proceed if the invite flow context is still active
      // This prevents redirecting to stale/used invite links
      if (!existingContext?.active) {
        console.log("[PWA] Invite flow context is not active, skipping redirect");
        return;
      }
      
      // Set auto-join flag so after auth they join automatically
      sessionStorage.setItem("autoJoinAfterAuth", "true");
      // Signal to auth page that this is a new user flow
      sessionStorage.setItem("authDefaultTab", "signup");
      
      // Update invite flow context to continue from auth step (post-install)
      // Preserve existing context data but update the step
      setInviteFlowContext({
        ...existingContext,
        active: true,
        inviteToken: pendingInvite.split("/").pop() || undefined,
        currentStep: "auth", // Resume at auth step since install is complete
      });
      
      navigate(pendingInvite, { replace: true });
    }
  }, [navigate, location.pathname]);

  return null;
}
