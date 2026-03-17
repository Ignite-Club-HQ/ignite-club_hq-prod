import { useState, useEffect } from "react";
import { X, Download, Flag, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { useIOSScrollLock } from "@/hooks/useIOSScrollLock";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

interface FullscreenImageViewerProps {
  src: string;
  alt?: string;
  onClose: () => void;
  onReport?: () => void;
  onBlockUser?: () => void;
  showActions?: boolean;
}

export function FullscreenImageViewer({ src, alt = "Image", onClose, onReport, onBlockUser, showActions = false }: FullscreenImageViewerProps) {
  const [loaded, setLoaded] = useState(false);

  // Lock body scroll to prevent iOS viewport shift
  useIOSScrollLock(true);

  // Force status bar to light icons on black background, restore on unmount
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    if (Capacitor.getPlatform() === 'android') {
      StatusBar.setBackgroundColor({ color: '#000000' }).catch(() => {});
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    }
    return () => {
      // Restore via centralized control
      import('@/lib/statusBarControl').then(m => m.refreshStatusBar());
      if (Capacitor.getPlatform() === 'android') {
        StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      }
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      onClick={onClose}
    >
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-4 right-4 text-white hover:bg-white/20 z-10"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <X className="h-6 w-6" />
      </Button>

      <div className="absolute top-4 left-4 flex gap-2 z-10">
        <Button
          size="icon"
          variant="ghost"
          className="text-white hover:bg-white/20"
          onClick={(e) => { e.stopPropagation(); safeOpenUrl(src); }}
        >
          <Download className="h-6 w-6" />
        </Button>
        {showActions && onReport && (
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/20"
            onClick={(e) => { e.stopPropagation(); onReport(); }}
            title="Report image"
          >
            <Flag className="h-5 w-5" />
          </Button>
        )}
        {showActions && onBlockUser && (
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/20"
            onClick={(e) => { e.stopPropagation(); onBlockUser(); }}
            title="Block user"
          >
            <ShieldAlert className="h-5 w-5" />
          </Button>
        )}
      </div>

      {!loaded && (
        <div className="animate-pulse bg-muted/20 rounded w-64 h-64" />
      )}
      <img
        src={src}
        alt={alt}
        className={`max-w-[95vw] max-h-[90vh] object-contain rounded transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
        onClick={(e) => e.stopPropagation()}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
