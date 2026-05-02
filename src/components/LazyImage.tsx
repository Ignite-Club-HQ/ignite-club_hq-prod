import { useState, useRef, useEffect } from "react";
import { useSignedPhotoUrl, resolveSignedUrl } from "@/hooks/useSignedPhotoUrl";
import { isVideoUrl } from "@/lib/videoUtils";

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}

// Generate a low-quality image URL for Supabase storage
function getLqipUrl(src: string): string {
  if (src.includes('/storage/v1/object/') || src.includes('/storage/v1/render/')) {
    if (src.includes('token=')) {
      return src;
    }
    return src.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=20&height=20&quality=20';
  }
  return src;
}

export function LazyImage({ src, alt, className = "", priority = false }: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [lqipLoaded, setLqipLoaded] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const [retrySrc, setRetrySrc] = useState<string | null>(null);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const prevSrcRef = useRef(src);

  // Only request a signed URL once the image is actually in view (or marked priority).
  // This prevents dozens of parallel createSignedUrl calls when scrolling a long
  // gallery feed — that bottleneck was causing many of them to time out and fall
  // back to public URLs that 400 because the photos bucket is private.
  const { signedUrl, isLoading: isLoadingSignedUrl } = useSignedPhotoUrl(
    isInView || priority ? src : null,
  );

  const baseSrc = signedUrl || src;
  const effectiveSrc = retrySrc || baseSrc;
  const lqipUrl = getLqipUrl(effectiveSrc);
  const hasLqip = lqipUrl !== effectiveSrc && !effectiveSrc.includes('token=');

  // Reset loading state when src changes
  useEffect(() => {
    if (prevSrcRef.current !== src) {
      setIsLoaded(false);
      setLqipLoaded(false);
      setRetrySrc(null);
      setRetryAttempts(0);
      prevSrcRef.current = src;
    }
  }, [src]);

  useEffect(() => {
    if (priority) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px", threshold: 0 }
    );

    const currentImg = imgRef.current;
    if (currentImg) {
      const rect = currentImg.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight + 200 && rect.bottom > -200;
      if (isVisible) {
        setIsInView(true);
      } else {
        observer.observe(currentImg);
      }
    }

    return () => observer.disconnect();
  }, [priority, src]);

  const showAsVideo = isVideoUrl(src);

  // On load failure, force a fresh signed URL once. Old photos in the feed
  // sometimes render with a stale fallback URL when the initial signed-URL
  // request timed out under load.
  const handleError = async () => {
    if (retryAttempts >= 1 || !src) return;
    setRetryAttempts((n) => n + 1);
    try {
      const fresh = await resolveSignedUrl(src);
      // Cache-bust to force a new request even if URL is identical.
      const bust = `${fresh}${fresh.includes("?") ? "&" : "?"}r=${Date.now()}`;
      setRetrySrc(bust);
    } catch {
      // give up silently — placeholder will remain
    }
  };

  return (
    <>
      {(!isLoaded && !lqipLoaded) || isLoadingSignedUrl ? (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      ) : null}

      {!showAsVideo && hasLqip && isInView && !isLoaded && !isLoadingSignedUrl && (
        <img
          src={lqipUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover scale-110 blur-lg"
          onLoad={() => setLqipLoaded(true)}
        />
      )}

      {!showAsVideo && (
        <img
          ref={imgRef}
          src={isInView && !isLoadingSignedUrl ? effectiveSrc : undefined}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            isLoaded ? "opacity-100" : "opacity-0"
          } ${className}`}
          onLoad={() => setIsLoaded(true)}
          onError={handleError}
        />
      )}
      {showAsVideo && !isLoadingSignedUrl && (
        <>
          <video
            ref={imgRef as unknown as React.RefObject<HTMLVideoElement>}
            src={isInView ? effectiveSrc : undefined}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
              isLoaded ? "opacity-100" : "opacity-0"
            } ${className}`}
            preload="metadata"
            muted
            playsInline
            onLoadedData={() => setIsLoaded(true)}
            onError={handleError}
          />
          {isLoaded && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-black/60 p-3">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d="M8 5v14l11-7z" /></svg>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
