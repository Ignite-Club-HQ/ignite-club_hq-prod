import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/**
 * This component checks if there's a pending invite stored from a PWA installation.
 * When a user installs the PWA from an invite link, we store the invite URL.
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
    // Don't redirect if already on the invite page
    if (location.pathname === "/" || location.pathname === "") {
      console.log("[PWA] Resuming pending invite:", pendingInvite);
      // Clear the pending invite so we don't redirect again
      localStorage.removeItem("pwa_pending_invite");
      navigate(pendingInvite, { replace: true });
    }
  }, [navigate, location.pathname]);

  return null;
}
