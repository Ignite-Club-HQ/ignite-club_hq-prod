import { useState } from "react";

interface LogoImageProps {
  src: string;
  alt?: string;
  className?: string;
  fallback?: React.ReactNode;
}

/**
 * Image component with built-in error fallback.
 * If the image fails to load, renders the fallback or nothing.
 */
export function LogoImage({ src, alt = "", className, fallback }: LogoImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <>{fallback}</> || null;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
