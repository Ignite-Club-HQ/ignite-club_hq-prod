// Shared utilities for formatting chat message previews in inbox/list views.
// Replaces raw tokens like @[Name](id), [event:uuid], [poll:uuid] with
// human-readable text so previews never expose internal IDs.

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;
const EVENT_TOKEN_RE = /\[event:[0-9a-f-]{36}\]/gi;
const POLL_TOKEN_RE = /\[poll:[0-9a-f-]{36}\]/gi;
// Markdown-style links: [label](url)
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

/**
 * Replace mention tokens "@[Name](id)" with "@Name".
 */
export function stripMentionFormatting(text: string): string {
  return text.replace(MENTION_RE, "@$1");
}

/**
 * Convert a raw chat message body into a clean single-line preview suitable
 * for inbox / conversation list rows. Removes raw IDs and replaces tokens
 * with friendly placeholders.
 */
export function formatMessagePreview(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;

  // Replace event tokens with friendly label
  out = out.replace(EVENT_TOKEN_RE, "📅 Event");
  // Replace poll tokens with friendly label
  out = out.replace(POLL_TOKEN_RE, "📊 Poll");
  // Markdown links → just the label
  out = out.replace(MD_LINK_RE, "$1");
  // Mentions → @Name
  out = stripMentionFormatting(out);
  // Collapse whitespace
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

/**
 * Returns a preview string, falling back to "Image" if the message is image-only.
 */
export function getMessagePreviewText(
  text: string | null | undefined,
  imageUrl?: string | null
): string {
  const formatted = formatMessagePreview(text);
  if (formatted) return formatted;
  if (imageUrl) return "Image";
  return "";
}
