import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PITCH_BOARD_OPEN_KEY, PITCH_BOARD_OPEN_PATH_KEY } from "./types";

/**
 * If the pitch board was open when the app was suspended/killed (e.g. user
 * locked their phone), the WebView cold-starts back at "/" (home). This
 * component checks once on mount and redirects to the stored event route
 * with ?openPitchBoard=1 so the pitch board auto-opens again.
 */
export default function PitchBoardResumeRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    try {
      if (localStorage.getItem(PITCH_BOARD_OPEN_KEY) !== "true") return;
      const storedPath = localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY);
      if (!storedPath) return;

      const currentPath = location.pathname + location.search;
      if (currentPath === storedPath) return;

      // Only redirect from "neutral" landing routes — don't yank the user
      // away if they're already navigating somewhere intentional.
      const neutral = location.pathname === "/" || location.pathname === "/home";
      if (!neutral) return;

      const [path, query = ""] = storedPath.split("?");
      const params = new URLSearchParams(query);
      params.set("openPitchBoard", "1");
      navigate(`${path}?${params.toString()}`, { replace: true });
    } catch {
      /* ignore */
    }
    // Only run once on cold mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
