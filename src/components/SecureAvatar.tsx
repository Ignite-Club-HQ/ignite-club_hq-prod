import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { cn } from "@/lib/utils";
import { getGravatarUrlFromHash } from "@/lib/gravatar";

interface SecureAvatarProps {
  src?: string | null;
  fallback: string;
  className?: string;
  fallbackClassName?: string;
  emailHash?: string | null; // SHA-256 hash for Gravatar fallback
}

/**
 * Avatar component that handles signed URLs for private storage buckets.
 * Falls back to Gravatar if no custom avatar is set and emailHash is provided.
 * Use this for avatars stored in the private 'avatars' bucket.
 */
export function SecureAvatar({ 
  src, 
  fallback, 
  className,
  fallbackClassName,
  emailHash
}: SecureAvatarProps) {
  const { signedUrl, isLoading } = useSignedPhotoUrl(src);
  const [gravatarError, setGravatarError] = useState(false);
  
  // Build Gravatar URL from hash if no custom avatar
  const gravatarUrl = !src && emailHash && !gravatarError 
    ? getGravatarUrlFromHash(emailHash, 160, '404') 
    : null;
  
  // Use signed URL if available, then Gravatar, otherwise undefined
  const effectiveSrc = signedUrl || src || gravatarUrl || undefined;

  const handleImageError = () => {
    // If Gravatar returns 404, mark as error so we show fallback
    if (gravatarUrl && effectiveSrc === gravatarUrl) {
      setGravatarError(true);
    }
  };

  return (
    <Avatar className={className}>
      {isLoading ? (
        <div className="w-full h-full bg-muted animate-pulse rounded-full" />
      ) : (
        <AvatarImage src={effectiveSrc} onError={handleImageError} />
      )}
      <AvatarFallback className={cn("text-xs", fallbackClassName)}>
        {fallback}
      </AvatarFallback>
    </Avatar>
  );
}
