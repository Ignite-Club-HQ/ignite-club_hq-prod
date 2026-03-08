import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * Generates a share URL that serves OG meta tags for rich previews,
 * then redirects to the actual app page.
 */
export function getShareUrl(type: "photo" | "event" | "folder", id: string): string {
  return `https://igniteclubhq.app/share?type=${type}&id=${encodeURIComponent(id)}`;
}

/**
 * The deep link URL that opens the content directly in the app.
 * Used for clipboard fallback where we want the direct link.
 */
export function getDeepLink(type: "photo" | "event" | "folder", id: string): string {
  const BASE = "https://igniteclubhq.app";
  switch (type) {
    case "photo": return `${BASE}/media/${id}`;
    case "event": return `${BASE}/events/${id}`;
    case "folder": return `${BASE}/vault/folder/${id}`;
  }
}
