import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

// In-memory cache for signed URLs (hydrated from localStorage on load)
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const LS_KEY = "signed-url-cache-v1";

// Cache duration: 50 minutes (signed URLs valid for 60 minutes)
const CACHE_DURATION_MS = 50 * 60 * 1000;
const SIGNED_URL_EXPIRES_IN_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 5000;
const PRIVATE_BUCKETS = ["photos", "chat-attachments", "avatars"] as const;

type PrivateBucket = (typeof PRIVATE_BUCKETS)[number];

try {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, { url: string; expiresAt: number }>;
    const now = Date.now();
    let kept = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.url === "string" && v.expiresAt > now) {
        urlCache.set(k, v);
        if (++kept > 500) break;
      }
    }
  }
} catch {
  /* ignore */
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (typeof localStorage === "undefined" || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const obj: Record<string, { url: string; expiresAt: number }> = {};
      const now = Date.now();
      let n = 0;
      for (const [k, v] of urlCache) {
        if (v.expiresAt > now) {
          obj[k] = v;
          if (++n >= 500) break;
        }
      }
      localStorage.setItem(LS_KEY, JSON.stringify(obj));
    } catch {
      /* quota exceeded etc. — ignore */
    }
  }, 1000);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function extractPrivateStoragePath(url: string): { bucket: PrivateBucket; path: string } | null {
  const cleanUrl = url.split("#")[0];
  const urlWithoutQuery = cleanUrl.split("?")[0];

  for (const bucket of PRIVATE_BUCKETS) {
    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/authenticated/${bucket}/`,
      `/storage/v1/render/image/public/${bucket}/`,
      `/storage/v1/render/image/sign/${bucket}/`,
    ];

    for (const marker of markers) {
      if (!urlWithoutQuery.includes(marker)) continue;

      const rawPath = urlWithoutQuery.split(marker)[1] ?? "";
      if (!rawPath) return null;

      const trimmedPath = rawPath.replace(/^\/+/, "");
      const decodedPath = (() => {
        try {
          return decodeURIComponent(trimmedPath);
        } catch {
          return trimmedPath;
        }
      })();

      return decodedPath ? { bucket, path: decodedPath } : null;
    }
  }

  return null;
}

async function createSignedUrlDirect(url: string): Promise<string | null> {
  const privatePath = extractPrivateStoragePath(url);
  if (!privatePath) return null;

  const { bucket, path } = privatePath;
  const { data, error } = await withTimeout(
    supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS),
    REQUEST_TIMEOUT_MS,
    "createSignedUrl timed out"
  );

  if (error || !data?.signedUrl) {
    console.warn("[useSignedPhotoUrl] Direct signed URL failed:", error?.message || "unknown");
    return null;
  }

  return data.signedUrl;
}


export async function resolveSignedUrl(url: string): Promise<string> {
  const privatePath = extractPrivateStoragePath(url);
  if (!privatePath) {
    return url;
  }

  // Direct SDK call is fastest — skip Edge Function fallback to avoid serial waterfall
  const directSignedUrl = await createSignedUrlDirect(url);
  return directSignedUrl || url;
}

export function useSignedPhotoUrl(originalUrl: string | null | undefined) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!originalUrl) {
      setSignedUrl(null);
      setIsLoading(false);
      return;
    }

    // Check cache first
    const cached = urlCache.get(originalUrl);
    if (cached && cached.expiresAt > Date.now()) {
      setSignedUrl(cached.url);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const fetchSignedUrl = async () => {
      setIsLoading(true);

      try {
        const resolvedUrl = await resolveSignedUrl(originalUrl);

        if (resolvedUrl !== originalUrl) {
          urlCache.set(originalUrl, {
            url: resolvedUrl,
            expiresAt: Date.now() + CACHE_DURATION_MS,
          });
          schedulePersist();
        }

        if (!isCancelled) {
          setSignedUrl(resolvedUrl);
        }
      } catch (error) {
        console.error("Error fetching signed URL:", error);
        if (!isCancelled) {
          setSignedUrl(originalUrl);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchSignedUrl();

    return () => {
      isCancelled = true;
    };
  }, [originalUrl]);

  return { signedUrl, isLoading };
}

// Batch fetch signed URLs for multiple photos
export async function getSignedPhotoUrls(urls: string[]): Promise<Record<string, string>> {
  if (urls.length === 0) return {};

  const result: Record<string, string> = {};
  const uncachedUrls: string[] = [];

  for (const url of urls) {
    const cached = urlCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      result[url] = cached.url;
    } else {
      uncachedUrls.push(url);
    }
  }

  if (uncachedUrls.length === 0) return result;

  try {
    const resolved = await Promise.all(
      uncachedUrls.map(async (url) => {
        try {
          return [url, await resolveSignedUrl(url)] as const;
        } catch (error) {
          console.error("Error resolving signed URL:", error);
          return [url, url] as const;
        }
      })
    );

    for (const [originalUrl, resolvedUrl] of resolved) {
      result[originalUrl] = resolvedUrl;

      if (resolvedUrl !== originalUrl) {
        urlCache.set(originalUrl, {
          url: resolvedUrl,
          expiresAt: Date.now() + CACHE_DURATION_MS,
        });
      }
    }
    schedulePersist();
  } catch (error) {
    console.error("Error batch fetching signed URLs:", error);
    for (const url of uncachedUrls) {
      result[url] = url;
    }
  }

  return result;
}

// Clear cache (useful for logout)
export function clearSignedUrlCache() {
  urlCache.clear();
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
