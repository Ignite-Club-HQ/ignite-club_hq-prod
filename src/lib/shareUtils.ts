const APP_URL = "https://igniteclubhq.app";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * Generates a share URL that serves OG meta tags for rich previews,
 * then redirects to the actual app page.
 */
export function getShareUrl(type: "photo" | "event" | "folder", id: string): string {
  const shareBaseUrl = SUPABASE_URL
    ? `${SUPABASE_URL}/functions/v1/share-page`
    : `${APP_URL}/share`;

  return `${shareBaseUrl}?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}

/**
 * The deep link URL that opens the content directly in the app.
 * Used for clipboard fallback where we want the direct link.
 */
export function getDeepLink(type: "photo" | "event" | "folder", id: string): string {
  switch (type) {
    case "photo": return `${APP_URL}/media/${id}`;
    case "event": return `${APP_URL}/events/${id}`;
    case "folder": return `${APP_URL}/vault/folder/${id}`;
  }
}
