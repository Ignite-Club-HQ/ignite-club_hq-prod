import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// In-memory cache for signed URLs (session-scoped)
const urlCache = new Map<string, { url: string; expiresAt: number }>();

// Cache duration: 50 minutes (signed URLs valid for 60 minutes)
const CACHE_DURATION_MS = 50 * 60 * 1000;

// Timeout for signed URL fetch — fall back to original URL if exceeded
const FETCH_TIMEOUT_MS = 8000;

export function useSignedPhotoUrl(originalUrl: string | null | undefined) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!originalUrl) {
      setSignedUrl(null);
      return;
    }

    // Check cache first
    const cached = urlCache.get(originalUrl);
    if (cached && cached.expiresAt > Date.now()) {
      setSignedUrl(cached.url);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const fetchSignedUrl = async () => {
      setIsLoading(true);

      // Set a timeout — if the edge function takes too long, fall back to original URL
      const timeoutPromise = new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), FETCH_TIMEOUT_MS);
      });

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (!cancelled) {
            setSignedUrl(originalUrl);
            setIsLoading(false);
          }
          return;
        }

        const fetchPromise = supabase.functions.invoke("get-signed-photo-url", {
          body: { paths: [originalUrl], expiresIn: 3600 },
        });

        const result = await Promise.race([fetchPromise, timeoutPromise]);

        if (cancelled) return;

        if (result === "timeout") {
          console.warn("[useSignedPhotoUrl] Timed out fetching signed URL, using original:", originalUrl.substring(0, 80));
          setSignedUrl(originalUrl);
          setIsLoading(false);
          return;
        }

        const response = result;

        if (response.error) {
          console.error("[useSignedPhotoUrl] Error getting signed URL:", response.error);
          setSignedUrl(originalUrl);
          setIsLoading(false);
          return;
        }

        const { signedUrls } = response.data;
        const newSignedUrl = signedUrls[originalUrl];

        if (newSignedUrl) {
          urlCache.set(originalUrl, {
            url: newSignedUrl,
            expiresAt: Date.now() + CACHE_DURATION_MS,
          });
          setSignedUrl(newSignedUrl);
        } else {
          setSignedUrl(originalUrl);
        }
      } catch (error) {
        console.error("[useSignedPhotoUrl] Error fetching signed URL:", error);
        if (!cancelled) {
          setSignedUrl(originalUrl);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchSignedUrl();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [originalUrl]);

  return { signedUrl, isLoading };
}

// Batch fetch signed URLs for multiple photos
export async function getSignedPhotoUrls(
  urls: string[]
): Promise<Record<string, string>> {
  if (urls.length === 0) return {};

  // Check cache and separate cached vs uncached
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

  // If all URLs are cached, return early
  if (uncachedUrls.length === 0) return result;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      // Return original URLs if not authenticated
      for (const url of uncachedUrls) {
        result[url] = url;
      }
      return result;
    }

    // Batch fetch in chunks of 50
    for (let i = 0; i < uncachedUrls.length; i += 50) {
      const chunk = uncachedUrls.slice(i, i + 50);
      
      // Add timeout for batch fetch too
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      
      try {
        const response = await supabase.functions.invoke("get-signed-photo-url", {
          body: { paths: chunk, expiresIn: 3600 },
        });

        clearTimeout(timeoutId);

        if (response.error) {
          console.error("[getSignedPhotoUrls] Error getting signed URLs:", response.error);
          for (const url of chunk) {
            result[url] = url;
          }
          continue;
        }

        const { signedUrls } = response.data;

        // Cache and add to result
        for (const [originalUrl, signedUrl] of Object.entries(signedUrls)) {
          urlCache.set(originalUrl, {
            url: signedUrl as string,
            expiresAt: Date.now() + CACHE_DURATION_MS,
          });
          result[originalUrl] = signedUrl as string;
        }

        // For any URLs that weren't returned, use original
        for (const url of chunk) {
          if (!result[url]) {
            result[url] = url;
          }
        }
      } catch (chunkError) {
        clearTimeout(timeoutId);
        console.error("[getSignedPhotoUrls] Chunk fetch failed:", chunkError);
        for (const url of chunk) {
          result[url] = url;
        }
      }
    }
  } catch (error) {
    console.error("[getSignedPhotoUrls] Error batch fetching signed URLs:", error);
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