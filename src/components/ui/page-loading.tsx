import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import igniteIcon from "@/assets/ignite-icon.png";

interface PageLoadingProps {
  message?: string;
}

export function PageLoading({ message = "Loading..." }: PageLoadingProps) {
  const [mounted, setMounted] = useState(false);
  const [showLoader, setShowLoader] = useState(false);

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => setShowLoader(true), 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`flex-1 flex flex-col items-center justify-center py-12 bg-background transition-opacity duration-200 ${showLoader ? 'opacity-100' : 'opacity-0'}`}>
      <div className="relative flex flex-col items-center">
        <div className={`transition-opacity duration-200 ${
          mounted ? "opacity-100" : "opacity-0"
        }`}>
          <img
            src={igniteIcon}
            alt="Ignite"
            className="h-32 w-32 rounded-[2rem] animate-pulse object-cover"
          />
        </div>
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
