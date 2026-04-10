import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

// In-memory cache for signed URLs (session-scoped)
const urlCache = new Map<string, { url: string; expiresAt: number }>();

// Cache duration: 50 minutes (signed URLs valid for 60 minutes)
const CACHE_DURATION_MS = 50 * 60 * 1000;
const SIGNED_URL_EXPIRES_IN_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 8000;
const PRIVATE_BUCKETS = ["photos", "chat-attachments", "avatars"] as const;

type PrivateBucket = (typeof PRIVATE_BUCKETS)[number];

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

async function createSignedUrlViaEdge(url: string): Promise<string | null> {
  const response = await withTimeout(
    supabase.functions.invoke("get-signed-photo-url", {
      body: { paths: [url], expiresIn: SIGNED_URL_EXPIRES_IN_SECONDS },
    }),
    REQUEST_TIMEOUT_MS,
    "get-signed-photo-url timed out"
  );

  if (response.error) {
    console.warn("[useSignedPhotoUrl] Edge signed URL failed:", response.error.message || response.error);
    return null;
  }

  const candidate = response.data?.signedUrls?.[url];
  return typeof candidate === "string" ? candidate : null;
}

async function resolveSignedUrl(url: string): Promise<string> {
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
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      for (const url of uncachedUrls) {
        result[url] = url;
      }
      return result;
    }

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
}
