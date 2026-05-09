import { useEffect, useState } from "react";

interface LogoImageProps {
  src: string;
  alt?: string;
  className?: string;
  fallback?: React.ReactNode;
}

// Module-level cache of logo URLs that have already decoded successfully.
// Warmed by `preloadLogo()` so that when the AppHeader mounts after login,
// the club logo paints synchronously instead of flashing in after a
// network round-trip + decode. Survives unmounts within the same tab.
// Cap so long sessions (multi-club admins switching repeatedly) don't
// accumulate unbounded decoded HTMLImageElements. Map insertion order
// gives us LRU semantics — touching an entry re-inserts it at the tail.
const MAX_PRELOADED_LOGOS = 24;
const decodedLogoUrls = new Set<string>();
const preloadedImages = new Map<string, HTMLImageElement>();

function touchPreloadedLogo(src: string) {
  const existing = preloadedImages.get(src);
  if (!existing) return;
  preloadedImages.delete(src);
  preloadedImages.set(src, existing);
}

function evictPreloadedLogos() {
  while (preloadedImages.size > MAX_PRELOADED_LOGOS) {
    const oldest = preloadedImages.keys().next().value as string | undefined;
    if (!oldest) break;
    preloadedImages.delete(oldest);
    decodedLogoUrls.delete(oldest);
  }
}

export function preloadLogo(src: string | null | undefined) {
  if (!src) return;
  if (preloadedImages.has(src)) {
    touchPreloadedLogo(src);
    return;
  }
  const img = new Image();
  img.decoding = "sync";
  img.fetchPriority = "high" as HTMLImageElement["fetchPriority"];
  img.src = src;
  preloadedImages.set(src, img);
  evictPreloadedLogos();
  img.decode?.().then(() => {
    if (preloadedImages.has(src)) decodedLogoUrls.add(src);
  }).catch(() => {
    /* ignore — onError on the visible <img> handles the fallback */
  });
}

// Synchronous module-init warm-up: as soon as this module is parsed (well before
// React mounts the AppHeader / ClubThemeProvider), scan localStorage for any
// cached club theme and start fetching+decoding its logo. This eliminates the
// "logo loads in after a beat" flash on cold home-page loads — by the time the
// header renders, the bytes are already in the HTTP cache (and usually decoded).
if (typeof window !== "undefined") {
  try {
    const PREFIX = "ignite-club-theme-data-";
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { logoUrl?: string | null };
        if (parsed?.logoUrl) preloadLogo(parsed.logoUrl);
      } catch {
        /* ignore malformed entry */
      }
    }
  } catch {
    /* localStorage unavailable — ignore */
  }
}

/**
 * Image component with built-in error fallback. Eager-loaded so the club
 * logo never appears as a "loading later" element in the top nav after
 * login — the URL is also pushed into a module-level decode cache so a
 * second mount (e.g. route change) paints instantly.
 */
export function LogoImage({ src, alt = "", className, fallback }: LogoImageProps) {
  const [failed, setFailed] = useState(false);

  // Warm cache on every render so navigation between routes keeps the
  // decoded entry hot.
  useEffect(() => {
    preloadLogo(src);
  }, [src]);

  if (failed) {
    return <>{fallback}</> || null;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="eager"
      decoding="sync"
      fetchPriority="high"
      onError={() => setFailed(true)}
    />
  );
}
