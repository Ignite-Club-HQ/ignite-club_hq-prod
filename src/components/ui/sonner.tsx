import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { Capacitor } from "@capacitor/core";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const isNative = Capacitor.isNativePlatform();

  // Position toasts in the middle of the visible area (between header and bottom nav)
  // Top header is ~64px, bottom nav is ~64px + safe area
  // Use top positioning to avoid overlap with fixed headers
  const topOffset = isNative ? "5rem" : "4rem";

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      style={{ 
        zIndex: 1000003,
        top: topOffset,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:!h-10 group-[.toast]:!px-4 group-[.toast]:!text-sm group-[.toast]:!font-medium group-[.toast]:!rounded-md group-[.toast]:!min-w-[72px] group-[.toast]:!ml-2",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:!h-10 group-[.toast]:!px-4 group-[.toast]:!text-sm group-[.toast]:!rounded-md",

        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
