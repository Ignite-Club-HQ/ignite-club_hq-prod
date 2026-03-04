import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// In-memory cache for signed URLs (session-scoped)
const urlCache = new Map<string, { url: string; expiresAt: number }>();

// Cache duration: 50 minutes (signed URLs valid for 60 minutes)
const CACHE_DURATION_MS = 50 * 60 * 1000;

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

    const fetchSignedUrl = async () => {
      setIsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setSignedUrl(originalUrl); // Fallback to original if not authenticated
          return;
        }

        const response = await supabase.functions.invoke("get-signed-photo-url", {
          body: { paths: [originalUrl], expiresIn: 3600 },
        });

        if (response.error) {
          console.error("Error getting signed URL:", response.error);
          setSignedUrl(originalUrl);
          return;
        }

        const { signedUrls } = response.data;
        const newSignedUrl = signedUrls[originalUrl];

        if (newSignedUrl) {
          // Cache the signed URL
          urlCache.set(originalUrl, {
            url: newSignedUrl,
            expiresAt: Date.now() + CACHE_DURATION_MS,
          });
          setSignedUrl(newSignedUrl);
        } else {
          setSignedUrl(originalUrl);
        }
      } catch (error) {
        console.error("Error fetching signed URL:", error);
        setSignedUrl(originalUrl);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSignedUrl();
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
      
      const response = await supabase.functions.invoke("get-signed-photo-url", {
        body: { paths: chunk, expiresIn: 3600 },
      });

      if (response.error) {
        console.error("Error getting signed URLs:", response.error);
        // Fallback to original URLs
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
    }
  } catch (error) {
    console.error("Error batch fetching signed URLs:", error);
    // Fallback to original URLs
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
