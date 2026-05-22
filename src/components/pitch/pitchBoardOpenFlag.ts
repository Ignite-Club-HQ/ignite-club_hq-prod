import {
  PITCH_BOARD_OPEN_KEY,
  PITCH_BOARD_OPEN_PATH_KEY,
  PITCH_BOARD_LAST_CONTEXT_KEY,
} from "./types";

/**
 * Clear the persisted pitch-board "open" flag + restore context.
 *
 * Call this from EXPLICIT user-initiated close paths (modal `onClose`, back
 * button, etc.). Do NOT call it from React unmount cleanup — a pitch-board
 * unmount can happen for many transient reasons (re-render due to a parent
 * query refetch, iOS WebView suspend, low-memory remount). If unmount cleared
 * the flag, `PitchBoardResumeRedirect` would have nothing to restore on
 * warm/cold resume, and the user would land on the team page with the board
 * gone — which is exactly the bug we're fixing.
 */
export function clearPitchBoardOpenFlag() {
  try {
    localStorage.removeItem(PITCH_BOARD_OPEN_KEY);
    localStorage.removeItem(PITCH_BOARD_OPEN_PATH_KEY);
    localStorage.removeItem(PITCH_BOARD_LAST_CONTEXT_KEY);
  } catch {
    /* ignore */
  }
}
