// Persists a lightweight "does this user see content in a given header strip"
// hint per (strip, user, club) tuple. Used to decide whether to reserve
// vertical space on cold load before the strip's async queries resolve —
// eliminates the ~40px content jump on Schedule / Media pages when the
// sponsor/ad strip finally mounts.
//
// Values:
//   true  → user previously saw a strip here → reserve space on next cold load
//   false → resolved with no content → don't reserve (no jump anyway)
//   null  → unknown (first ever visit)

const PREFIX = "ignite_strip_hint_";

const key = (strip: string, userId: string | undefined, clubId: string | null | undefined) =>
  `${PREFIX}${strip}_${userId || "anon"}_${clubId || "none"}`;

export function readStripHint(
  strip: string,
  userId: string | undefined,
  clubId: string | null | undefined,
): boolean | null {
  try {
    const raw = localStorage.getItem(key(strip, userId, clubId));
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeStripHint(
  strip: string,
  userId: string | undefined,
  clubId: string | null | undefined,
  hasContent: boolean,
): void {
  try {
    localStorage.setItem(key(strip, userId, clubId), hasContent ? "1" : "0");
  } catch {
    /* noop */
  }
}
