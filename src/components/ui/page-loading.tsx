import { Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import igniteIconLight from "@/assets/ignite-icon-light.png";
import igniteIcon from "@/assets/ignite-icon.png";

interface PageLoadingProps {
  message?: string;
}

export function PageLoading({ message = "Loading..." }: PageLoadingProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch - only render theme-specific content after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reliably detect theme from multiple sources
  const getThemeIsDark = () => {
    if (typeof window === 'undefined') return true;
    // Check DOM class first (most reliable, always in sync)
    if (document.documentElement.classList.contains('dark')) return true;
    if (document.documentElement.classList.contains('light')) return false;
    // Fall back to localStorage
    const stored = localStorage.getItem('app-theme');
    if (stored) return stored === 'dark';
    // Fall back to resolvedTheme
    if (resolvedTheme) return resolvedTheme === 'dark';
    return true;
  };

  const isDark = getThemeIsDark();
  const logo = isDark ? igniteIcon : igniteIconLight;

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 bg-background">
      <div className="relative flex flex-col items-center">
        <img src={logo} alt="Ignite" className="h-32 w-32 animate-pulse rounded-[2rem]" />
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-1">{message}</p>
    </div>
  );
}
