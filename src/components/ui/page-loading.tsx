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
  const [showLoader, setShowLoader] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Delay showing the loader to prevent flash on fast loads
    const timer = setTimeout(() => setShowLoader(true), 150);
    return () => clearTimeout(timer);
  }, []);

  // Reliably detect theme from multiple sources
  const getThemeIsDark = () => {
    if (typeof window === 'undefined') return true;
    if (document.documentElement.classList.contains('dark')) return true;
    if (document.documentElement.classList.contains('light')) return false;
    const stored = localStorage.getItem('app-theme');
    if (stored) return stored === 'dark';
    if (resolvedTheme) return resolvedTheme === 'dark';
    return true;
  };

  const isDark = getThemeIsDark();
  const logo = isDark ? igniteIcon : igniteIconLight;

  return (
    <div className={`flex-1 flex flex-col items-center justify-center py-12 bg-background transition-opacity duration-200 ${showLoader ? 'opacity-100' : 'opacity-0'}`}>
      <div className="relative flex flex-col items-center">
        <div className={`h-32 w-32 rounded-[2rem] bg-card shadow-lg ring-1 ring-border overflow-hidden transition-opacity duration-200 ${
            mounted ? "opacity-100" : "opacity-0"
          }`}>
          <img
            src={logo}
            alt="Ignite"
            className="h-full w-full animate-pulse object-cover"
          />
        </div>
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-1">{message}</p>
    </div>
  );
}
