// Shared utilities for formatting chat message previews in inbox/list views.
// Replaces raw tokens like @[Name](id), [event:uuid], [poll:uuid] with
// human-readable text so previews never expose internal IDs.

import { isVideoUrl } from "./videoUtils";

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;
const EVENT_TOKEN_RE = /\[event:([0-9a-f-]{36})\]/gi;
const POLL_TOKEN_RE = /\[poll:([0-9a-f-]{36})\]/gi;
const BOARD_TOKEN_RE = /\[board:([0-9a-f-]{36})\]/gi;
const VAULT_FILE_TOKEN_RE = /\[vault:([0-9a-f-]{36})\]/gi;
const VAULT_FOLDER_TOKEN_RE = /\[vaultfolder:([0-9a-f-]{36})\]/gi;
const VAULT_ROOT_TOKEN_RE = /\[vaultroot:(team|club):([0-9a-f-]{36})\]/gi;
// Markdown-style links: [label](url)
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

/**
 * Replace mention tokens "@[Name](id)" with "@Name".
 */
export function stripMentionFormatting(text: string): string {
  return text.replace(MENTION_RE, "@$1");
}

/**
 * Extract all event UUIDs referenced in a message body.
 * Useful for prefetching event titles before rendering a preview.
 */
export function extractEventIds(text: string | null | undefined): string[] {
  if (!text) return [];
  const ids: string[] = [];
  const re = new RegExp(EVENT_TOKEN_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) ids.push(m[1].toLowerCase());
  }
  return ids;
}

/**
 * Convert a raw chat message body into a clean single-line preview suitable
 * for inbox / conversation list rows. Removes raw IDs and replaces tokens
 * with friendly placeholders.
 *
 * Optionally pass an `eventTitles` map (id -> title) so event references
 * render as "📅 <Title>" instead of the generic "📅 Event" placeholder.
 */
export function formatMessagePreview(
  text: string | null | undefined,
  eventTitles?: Map<string, string> | Record<string, string>,
): string {
  if (!text) return "";
  let out = text;

  const lookup = (id: string): string | undefined => {
    if (!eventTitles) return undefined;
    if (eventTitles instanceof Map) return eventTitles.get(id.toLowerCase());
    return eventTitles[id.toLowerCase()] ?? eventTitles[id];
  };

  out = out.replace(EVENT_TOKEN_RE, (_match, id: string) => {
    const title = lookup(id);
    return title ? `📅 ${title}` : "📅 Event";
  });
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
  imageUrl?: string | null,
  eventTitles?: Map<string, string> | Record<string, string>,
): string {
  const formatted = formatMessagePreview(text, eventTitles);
  if (formatted) return formatted;
  if (imageUrl) return isVideoUrl(imageUrl) ? "🎬 Video" : "Image";
  return "";
}
