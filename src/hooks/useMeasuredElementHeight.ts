import { type DependencyList, useLayoutEffect, useRef, useState } from "react";

export function useMeasuredElementHeight<T extends HTMLElement>(deps: DependencyList = [], minHeight = 56) {
  const elementRef = useRef<T>(null);
  const [height, setHeight] = useState(minHeight);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const measure = () => {
      const nextHeight = Math.max(minHeight, Math.ceil(element.getBoundingClientRect().height));
      setHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(measure);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [minHeight, ...deps]);

  return { elementRef, height };
}