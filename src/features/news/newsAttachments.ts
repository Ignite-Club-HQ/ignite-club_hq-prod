/**
 * Club News attachments.
 *
 * Stored on `club_news.attachments` as a JSON array so we don't need a new
 * table or bucket: files live in the existing public `club-logos` bucket under
 * `news/<clubId>/...`, the same path news header images already use.
 */
export interface NewsAttachment {
  kind: "image" | "file";
  url: string;
  name: string;
  /** Bytes, when known. */
  size?: number | null;
  mimeType?: string | null;
}

/** Defensive parse — the column is free-form jsonb. */
export function parseNewsAttachments(raw: unknown): NewsAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: NewsAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const url = typeof rec.url === "string" ? rec.url : null;
    if (!url) continue;
    const kind = rec.kind === "image" ? "image" : "file";
    out.push({
      kind,
      url,
      name: typeof rec.name === "string" && rec.name ? rec.name : kind === "image" ? "Image" : "File",
      size: typeof rec.size === "number" ? rec.size : null,
      mimeType: typeof rec.mimeType === "string" ? rec.mimeType : null,
    });
  }
  return out;
}

export function formatFileSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const NEWS_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const NEWS_MAX_IMAGES = 8;
export const NEWS_MAX_FILES = 5;
