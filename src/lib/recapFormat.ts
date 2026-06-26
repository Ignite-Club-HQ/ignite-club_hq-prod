/**
 * Strip machine-style `[YYYY-MM-DD HH:MM]` prefixes from AI-generated recap
 * bullets. Also strips short human time tags like `[Today 9:30am]`,
 * `[Yesterday 6pm]`, `[Mon 21 Jun 6pm]` that the backend adds for the
 * timeline view — used by surfaces that don't render the timeline chip.
 */
export function stripRecapDatePrefix(text: string): string {
  if (!text) return text;
  let out = text.replace(/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/, "").trim();
  // Strip short bracketed time tags (max ~30 chars, no nested brackets)
  out = out.replace(/^\[[^\[\]]{1,30}\]\s*/, "").trim();
  return out;
}

/**
 * Parse a leading short bracket time tag (e.g. "[Today 9:30am] Coach asked …")
 * and split it from the bullet text. Used by the cross-thread recap timeline.
 */
export function parseRecapTimeTag(text: string): { time: string | null; text: string } {
  if (!text) return { time: null, text: "" };
  // Skip machine timestamps — those are noise we strip elsewhere.
  const machine = text.match(/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/);
  if (machine) return { time: null, text: text.slice(machine[0].length).trim() };
  const m = text.match(/^\[([^\[\]]{1,30})\]\s*/);
  if (!m) return { time: null, text: text.trim() };
  return { time: m[1].trim(), text: text.slice(m[0].length).trim() };
}
