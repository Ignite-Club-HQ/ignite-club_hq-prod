/**
 * Plain-English notice for setup steps that didn't finish after a club was
 * created. The club itself exists; never suggest creating it again. A logo
 * failure alone is optional and is reported separately, never as club loss.
 */
export type ClubSetupStep = "settings" | "staff_chats";
const LABELS: Record<ClubSetupStep, string> = {
  settings: "club settings",
  staff_chats: "staff chats (Coaches, Team Admins, Club Committee)",
};
export function clubSetupNotice(failed: ClubSetupStep[], logoFailed: boolean): { title: string; description: string } | null {
  const steps = [...new Set(failed)];
  if (steps.length === 0 && !logoFailed) return null;
  if (steps.length === 0) {
    return { title: "Club created", description: "Your logo didn't upload. You can add it from the club settings page." };
  }
  const parts = steps.map((s) => LABELS[s]);
  const retry = steps.includes("staff_chats")
    ? " Staff chats are retried automatically when you open Messages."
    : "";
  const settings = steps.includes("settings") ? " Check your club settings page to finish setup." : "";
  return {
    title: "Club created, setup not finished",
    description: `Your club is saved, but these steps didn't finish: ${parts.join(", ")}.${retry}${settings}${logoFailed ? " Your logo also didn't upload." : ""}`,
  };
}
