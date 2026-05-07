import { useEffect, useRef, useState, ReactNode } from "react";

interface LazyMountProps {
  children: ReactNode;
  /** Pixels of root margin to start mounting before the element scrolls in. */
  rootMargin?: string;
  /** Reserve space so we don't trigger CLS while waiting. */
  minHeight?: number;
  /** Force-mount after this many ms even if never scrolled into view. Defaults to 4000. */
  fallbackTimeoutMs?: number;
}

/**
 * Defers mounting children until the placeholder enters (or nears) the viewport.
 * Used for genuinely below-the-fold home page sections to keep TTI fast.
 */
export function LazyMount({
  children,
  rootMargin = "300px",
  minHeight = 80,
  fallbackTimeoutMs = 4000,
}: LazyMountProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(node);
    const t = setTimeout(() => setShown(true), fallbackTimeoutMs);
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, [shown, rootMargin, fallbackTimeoutMs]);

  if (shown) return <>{children}</>;
  return <div ref={ref} style={{ minHeight }} aria-hidden="true" />;
}
