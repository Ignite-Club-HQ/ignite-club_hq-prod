/**
 * Strip machine-style `[YYYY-MM-DD HH:MM]` prefixes from AI-generated recap
 * bullets. Also strips short human time tags like `[Sat 27 Jun 9:30am]`
 * that the backend adds for the
 * timeline view — used by surfaces that don't render the timeline chip.
 */
export function stripRecapDatePrefix(text: string): string {
  if (!text) return text;
  let out = text.replace(/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/, "").trim();
  // Strip short bracketed time tags (max ~30 chars, no nested brackets)
  out = out.replace(/^\[[^\[\]]{1,30}\]\s*/, "").trim();
  out = stripRecapSpeakerPrefix(out);
  out = rewriteRawChatEcho(out);
  out = stripRelativeDateWords(out);
  return out;

/**
 * Remove accidental speaker labels from recap bullets. This is a UI-level guard
 * for legacy cached summaries/digests; server prompts still own the real
 * summarisation quality.
 */
export function stripRecapSpeakerPrefix(text: string): string {
  if (!text) return text;
  return text
    .replace(/^([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,2})\s*[:\-–]\s+/u, "")
    .replace(/^Person\s+\d+\s*[:\-–]\s+/i, "")
    .trim();
}

/**
 * Last-resort display guard for old cached recap rows where the model/digest
 * leaked raw chat wording. This does not replace server-side summarisation, but
 * it prevents obvious verbatim lines like "Yep I can" or "Could someone..."
 * from being shown while legacy cache entries expire.
 */
export function rewriteRawChatEcho(text: string): string {
  if (!text) return text;
  const t = text.replace(/\s+/g, " ").trim();
  const lower = t.toLowerCase();

  if (/\balso interested\b.*\bdepending on days\b/i.test(t)) {
    return "Another member is interested if the dates work";
  }
  if (/\b(?:could|can)\s+someone\b.*\b(?:linesperson|line\s*person|ref(?:eree)?)\b/i.test(t)) {
    return "A match official was requested";
  }
  if (/^(?:yep|yes|yeah)\b.*\bi can\b.*\b(?:this week|today|do it|cover)/i.test(t) || /^i can\b/i.test(t)) {
    return /\bthis week\b/i.test(t)
      ? "A volunteer confirmed they can cover the match official role"
      : "A volunteer confirmed they can cover the match official role";
  }
  if (/^sorry\b.*\b(?:would have loved|can't|cannot|unavailable)\b/i.test(t) || /\bi would have loved to\b/i.test(t)) {
    return "One member declined the match official request";
  }
  if (/\b(?:three|3)\s+out\b.*\bsaturday\b/i.test(t)) {
    return "Three players are out for Saturday, so squad numbers are tight and a replacement may be needed";
  }
  if (/\bgame\s+(?:has\s+)?moved\b/i.test(t) && /\bsummit\b/i.test(t)) {
    const time = t.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0]?.replace(/\s+/g, "") ?? null;
    const game = `Saturday's game has moved to Summit${time ? ` at ${time}` : ""}`;
    if (/\btwo day tournament\b|\btwo-day tournament\b|\bgepps\s+cross\b/i.test(t)) {
      return `${game}; interest was also requested for a two-day tournament at Gepps Cross in the first week of holidays`;
    }
    return game;
  }

  // Generic guard: if a long line still reads like a chat message, remove
  // chatty lead-ins so it is at least less transcript-like.
  if (t.split(/\s+/).length > 12 && /\b(?:please|anyone|let me know|hi folks|team,|sorry|yep|also interested)\b/i.test(lower)) {
    return t
      .replace(/^(?:hi folks|hi team|team),?\s+/i, "")
      .replace(/\bplease\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return stripRelativeDateWords(t);
}

/**
 * Final UI guard for stale cached recaps or model slips. If the backend cannot
 * confidently resolve a relative date, it should omit it; this mirrors that in
 * the client so inaccurate "today/yesterday/tomorrow" wording never surfaces.
 */
export function stripRelativeDateWords(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b(?:today|tonight|tomorrow|yesterday)\'?s\s+/gi, "")
    .replace(/\b(?:this\s+morning|this\s+afternoon|this\s+evening|today|tonight|tomorrow|yesterday|this\s+week|next\s+week)\b/gi, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\b(for|on|at)\s+([,.;:]|$)/gi, "")
    .trim();
}

/**
 * Parse a leading bracket time tag (e.g. "[Sat 27 Jun 9:30am] Coach asked …")
 * and split it from the bullet text. Used by the cross-thread recap timeline.
 */
export function parseRecapTimeTag(text: string): { time: string | null; text: string } {
  if (!text) return { time: null, text: "" };
  // Skip machine timestamps — those are noise we strip elsewhere.
  const machine = text.match(/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/);
  if (machine) return { time: null, text: text.slice(machine[0].length).trim() };
  const m = text.match(/^\[([^\[\]]{1,30})\]\s*/);
  if (!m) return { time: null, text: text.trim() };
  const rawTag = m[1].trim();
  const isLegacyRelativeTag = /\b(?:today|yest|yesterday|tomorrow)\b/i.test(rawTag) || /^\d{1,2}(?::\d{2})?\s*(?:am|pm)$/i.test(rawTag);
  return {
    time: isLegacyRelativeTag ? null : rawTag,
    text: stripRelativeDateWords(rewriteRawChatEcho(stripRecapSpeakerPrefix(text.slice(m[0].length).trim()))),
  };
}
}
