import { useState, useRef, useEffect } from "react";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}

// Generate a low-quality image URL for Supabase storage
function getLqipUrl(src: string): string {
  // Check if it's a Supabase storage URL (signed or public)
  if (src.includes('/storage/v1/object/') || src.includes('/storage/v1/render/')) {
    // For signed URLs, we can't use render endpoint, so skip LQIP
    if (src.includes('token=')) {
      return src;
    }
    // Transform to render endpoint with tiny dimensions
    return src.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=20&height=20&quality=20';
  }
  // For non-Supabase URLs, return original (will use blur on load)
  return src;
}

export function LazyImage({ src, alt, className = "", priority = false }: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [lqipLoaded, setLqipLoaded] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const imgRef = useRef<HTMLImageElement>(null);
  const prevSrcRef = useRef(src);

  // Get signed URL if this is a private storage URL
  const { signedUrl, isLoading: isLoadingSignedUrl } = useSignedPhotoUrl(src);
  
  // Use signed URL if available, otherwise fall back to original
  const effectiveSrc = signedUrl || src;
  const lqipUrl = getLqipUrl(effectiveSrc);
  const hasLqip = lqipUrl !== effectiveSrc && !effectiveSrc.includes('token=');

  // Reset loading state when src changes
  useEffect(() => {
    if (prevSrcRef.current !== src) {
      setIsLoaded(false);
      setLqipLoaded(false);
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
      // Check immediately if already in viewport
      const rect = currentImg.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight + 200 && rect.bottom > -200;
      if (isVisible) {
        setIsInView(true);
      } else {
        observer.observe(currentImg);
      }
    }

    return () => observer.disconnect();
  }, [priority, src]); // Re-run when src changes to handle new images

  return (
    <>
      {/* Base placeholder - show while loading signed URL or image */}
      {(!isLoaded && !lqipLoaded) || isLoadingSignedUrl ? (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      ) : null}
      
      {/* LQIP blurred placeholder */}
      {hasLqip && isInView && !isLoaded && !isLoadingSignedUrl && (
        <img
          src={lqipUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover scale-110 blur-lg"
          onLoad={() => setLqipLoaded(true)}
        />
      )}
      
      {/* Full quality image */}
      {!isLoadingSignedUrl && (
        <img
          ref={imgRef}
          src={isInView ? effectiveSrc : undefined}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            isLoaded ? "opacity-100" : "opacity-0"
          } ${className}`}
          onLoad={() => setIsLoaded(true)}
        />
      )}
    </>
  );
}
