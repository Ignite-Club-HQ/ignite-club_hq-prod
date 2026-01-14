import { Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import igniteIconLight from "@/assets/ignite-icon-light.png";
import igniteIcon from "@/assets/ignite-icon.png";

interface PageLoadingProps {
  message?: string;
}

export function PageLoading({ message = "Loading..." }: PageLoadingProps) {
  const { resolvedTheme } = useTheme();
  const logo = resolvedTheme === "dark" ? igniteIcon : igniteIconLight;

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12">
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
