/**
 * Turns a raw "message the competition organisers" refusal into plain English.
 *
 * Both backends refuse this action with their own terse technical sentence —
 * Supabase raises "You are an admin of this competition" / "You are not part of
 * this competition", the messaging canister raises "Competition membership
 * required" / "Invalid competition". None of those tell a person on a phone what
 * actually happened or what to do next, so every known refusal is mapped here to
 * a short title plus an actionable description.
 *
 * The original text is returned as `technicalMessage` (and logged by the call
 * sites) so support can still see what the backend really said.
 */

export type CompetitionContactError = {
  title: string;
  description: string;
  /**
   * "destructive" = something genuinely went wrong (red card).
   * "default" = a plain note: nothing failed, the action simply isn't needed.
   */
  variant: "destructive" | "default";
  technicalMessage: string;
};

/** Network-shaped failures never carry a refusal sentence, so check them last. */
const OFFLINE = /failed to fetch|network ?error|load failed|err_internet|timed? ?out|aborted/i;

const COPY: Array<{
  match: RegExp;
  title: string;
  description: string;
  variant: "destructive" | "default";
}> = [
  {
    // The caller organises the competition, so there is nobody above them to message.
    match: /you are an admin of this competition/i,
    title: "You run this competition",
    variant: "default",
    description:
      "You're one of the organisers here, so there's nobody above you to message — you can manage teams, fixtures and settings right here on this page.",
  },
  {
    // Nobody holds an organiser role, so the inbox has nobody to deliver to.
    match: /competition admins are not configured/i,
    title: "This competition has no organiser yet",
    variant: "destructive",
    description:
      "Nobody is listed as an organiser to message, so there's no inbox to open. Let your club know so they can set one up.",
  },
  {
    // The caller is outside the competition entirely (or their access has lapsed).
    match: /not part of this competition|competition membership required|membership required/i,
    title: "This inbox is for competition members",
    variant: "destructive",
    description:
      "Only people taking part in this competition can message its organisers. If you should have access, ask your club to add you to a team or give you a competition role.",
  },
  {
    // Sign-in missing or expired before the request left the app.
    match: /not signed in|authentication required|sign(ed)? in/i,
    title: "Please sign in first",
    variant: "destructive",
    description: "You need to be signed in to message a competition's organisers. Sign in, then tap the button again.",
  },
  {
    // Bad or stale competition id.
    match: /competition not found|invalid competition/i,
    title: "We couldn't find this competition",
    variant: "destructive",
    description: "It may have been removed, or this link is out of date. Go back to the competitions list and open it again.",
  },
  {
    // Canister-side plumbing/limit faults the person can't act on.
    match: /canister not configured|too many entries to verify membership|only the thread member can open/i,
    title: "We couldn't open this inbox just now",
    variant: "destructive",
    description:
      "The service that checks competition access is temporarily unavailable. Please try again in a few minutes — if it keeps happening, let your club organiser know.",
  },
];

export function competitionContactError(error: unknown): CompetitionContactError {
  const technicalMessage = String(
    (error as { message?: string })?.message ||
      (error as { details?: string })?.details ||
      (error as { hint?: string })?.hint ||
      error ||
      "",
  );

  const known = COPY.find((entry) => entry.match.test(technicalMessage));
  if (known) {
    return { ...known, technicalMessage };
  }

  if (OFFLINE.test(technicalMessage)) {
    return {
      title: "You appear to be offline",
      description: "We couldn't open your conversation with the competition organisers. Check your connection and try again.",
      variant: "destructive",
      technicalMessage,
    };
  }

  return {
    title: "We couldn't open this inbox",
    description:
      "Something went wrong while opening your conversation with the competition organisers. Please try again in a moment — if it keeps happening, let your club organiser know.",
    variant: "destructive",
    technicalMessage,
  };
}
