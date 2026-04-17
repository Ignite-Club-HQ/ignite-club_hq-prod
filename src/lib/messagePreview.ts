// Shared utilities for formatting chat message previews in inbox/list views.
// Replaces raw tokens like @[Name](id), [event:uuid], [poll:uuid] with
// human-readable text so previews never expose internal IDs.

import { isVideoUrl } from "./videoUtils";

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;
const EVENT_TOKEN_RE = /\[event:[0-9a-f-]{36}\]/gi;
const POLL_TOKEN_RE = /\[poll:[0-9a-f-]{36}\]/gi;
const BOARD_TOKEN_RE = /\[board:[0-9a-f-]{36}\]/gi;
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

  out = out.replace(EVENT_TOKEN_RE, "📅 Event");
  out = out.replace(POLL_TOKEN_RE, "📊 Poll");
  out = out.replace(BOARD_TOKEN_RE, "🏟️ Live board");
  out = out.replace(MD_LINK_RE, "$1");
  out = stripMentionFormatting(out);
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
  if (imageUrl) return isVideoUrl(imageUrl) ? "🎬 Video" : "Image";
  return "";
}
