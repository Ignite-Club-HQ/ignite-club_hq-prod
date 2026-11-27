/** Plain-English reason an admin sees under "Name unavailable".
 * Raw server text is logged by the caller, never shown. */
export function adminNameReason(raw: string | undefined | null): string {
  const text = (raw ?? "").toLowerCase();
  if (!text) return "Couldn't unlock this name.";
  if (text.includes("timed out")) return "Unlocking took too long. Tap refresh to try again.";
  if (text.includes("app admin required") || text.includes("deletion pending")) return "Your admin access couldn't be confirmed for names.";
  if (text.includes("admission")) return "Your sign-in isn't admitted to the name store yet.";
  if (text.includes("membership directory unconfigured") || text.includes("directory is unavailable") || text.includes("directory is empty")) return "The member directory isn't set up for names yet.";
  if (text.includes("not been approved") || text.includes("configuration changed") || text.includes("outside the") || text.includes("pinned shared deployment") || text.includes("inventory")) return "The name store setup doesn't match the approved setup.";
  if (text.includes("private-name service") || text.includes("registered group") || text.includes("authority is not registered") || text.includes("not released") || text.includes("fenced or not configured")) return "This name store isn't connected for admin name reading yet.";
  if (text.includes("profile not found") || text.includes("private name not found") || text.includes("binding changed") || text.includes("reference changed") || text.includes("owner changed") || text.includes("does not match this member")) return "This member's saved name doesn't match their account. They need to save their name again.";
  if (text.includes("keys were not authorized") || text.includes("vetkey") || text.includes("key")) return "The name store refused the unlock key.";
  if (text.includes("not shared yet") || text.includes("not yet shared")) return "This member hasn't finished saving their name yet.";
  return "Couldn't unlock this name.";
}
