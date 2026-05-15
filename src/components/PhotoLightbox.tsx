import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2, Flag, ArrowLeft, Download, Share2, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { usePinchZoom } from "@/hooks/usePinchZoom";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { Capacitor } from "@capacitor/core";
import { applyStatusBarForViewer, refreshStatusBar } from "@/lib/statusBarControl";
import { ReportPhotoDialog } from "@/components/ReportPhotoDialog";
import { isVideoUrl } from "@/lib/videoUtils";
import { downloadImage } from "@/lib/downloadImage";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { toast } from "sonner";

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error ?? "");

interface PhotoLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  photos: { id: string; file_url?: string | null; image_url?: string | null; title?: string | null }[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onDelete?: (photoId: string) => void;
  canDelete?: boolean;
}

function LightboxImage({
  src,
  alt,
  scale,
  translateX,
  translateY,
}: {
  src: string;
  alt: string;
  scale: number;
  translateX: number;
  translateY: number;
}) {
  const { signedUrl, isLoading } = useSignedPhotoUrl(src);
  const effectiveSrc = signedUrl || src;
  const showAsVideo = isVideoUrl(effectiveSrc);

  if (isLoading) {
    return (
      <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin" />
    );
  }

  if (showAsVideo) {
    return (
      <video
        src={effectiveSrc}
        className="max-w-[100vw] max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] object-contain"
        controls
        autoPlay
        playsInline
      />
    );
  }

  return (
    <img
      src={effectiveSrc}
      alt={alt}
      className="max-w-[100vw] max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] object-contain transition-transform duration-100"
      style={{
        transform: `scale(${scale}) translate(${translateX / scale}px, ${translateY / scale}px)`,
      }}
      draggable={false}
    />
  );
}

export function PhotoLightbox({
  isOpen,
  onClose,
  photos,
  currentIndex,
  onNavigate,
  onDelete,
  canDelete,
}: PhotoLightboxProps) {
  const currentPhoto = photos[currentIndex];
  const [reportPhotoId, setReportPhotoId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  
  const {
    scale,
    translateX,
    translateY,
    onTouchStart: pinchTouchStart,
    onTouchMove: pinchTouchMove,
    onTouchEnd: pinchTouchEnd,
    resetZoom,
    isPanningOrPinching,
  } = usePinchZoom(1, 4);

  const handlePrev = () => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  };

  const handleNext = () => {
    if (currentIndex < photos.length - 1) onNavigate(currentIndex + 1);
  };

  // All hooks must be called before any early returns
  const swipeHandlers = useSwipeGesture({
    onSwipeLeft: scale === 1 ? handleNext : undefined,
    onSwipeRight: scale === 1 ? handlePrev : undefined,
    threshold: 50,
  });

  // Reset zoom when navigating to a different photo
  useEffect(() => {
    resetZoom();
  }, [currentIndex, resetZoom]);

  // Force white status-bar icons on the black viewer chrome while open,
  // restore the app theme's status bar on close. Without this, light-mode
  // users get dark icons that disappear against the black lightbox bg.
  useEffect(() => {
    if (!isOpen) return;
    if (!Capacitor.isNativePlatform()) return;
    applyStatusBarForViewer();
    return () => {
      refreshStatusBar();
    };
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") handlePrev();
    if (e.key === "ArrowRight") handleNext();
    if (e.key === "Escape") onClose();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    // Always let pinch zoom handle 2-finger and 1-finger-when-zoomed
    pinchTouchStart(e);
    // Only pass to swipe if not zoomed
    if (e.touches.length === 1 && scale <= 1) {
      swipeHandlers.onTouchStart(e);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    pinchTouchMove(e);
    if (e.touches.length === 1 && scale <= 1) {
      swipeHandlers.onTouchMove(e);
    }
  };

  const handleTouchEnd = () => {
    pinchTouchEnd();
    // Only trigger swipe navigation if not zoomed
    if (scale <= 1) {
      swipeHandlers.onTouchEnd();
    }
  };

  const handleDoubleClick = () => {
    if (scale > 1) {
      resetZoom();
    }
  };

  const photoSrc = currentPhoto?.file_url || currentPhoto?.image_url || '';
  const { signedUrl: downloadSignedUrl } = useSignedPhotoUrl(photoSrc);

  if (!currentPhoto) return null;

  const handleDownload = async () => {
    const url = downloadSignedUrl || photoSrc;
    if (!url) return;
    try {
      await downloadImage(url, "ignite-photo");
    } catch (err) {
      console.warn("Download failed:", err);
      toast.error("Could not download photo");
    }
  };

  const handleShare = async () => {
    if (!currentPhoto?.id) {
      toast.error("Nothing to share");
      return;
    }
    // Always share the branded /share URL (rich preview + redirect),
    // never the raw Supabase signed storage URL.
    const { getShareUrl } = await import("@/lib/shareUtils");
    const url = getShareUrl("photo", currentPhoto.id);
    const title = currentPhoto.title || "Photo";

    // Native share via Capacitor
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import("@capacitor/share");
        await Share.share({ title, text: title, url, dialogTitle: "Share photo" });
        return;
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if (/cancel|abort/i.test(message)) return;
      console.warn("Native share failed:", err);
    }

    // Web Share API
    try {
      const webNavigator = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (typeof navigator !== "undefined" && typeof webNavigator.share === "function") {
        await webNavigator.share({ title, text: title, url });
        return;
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if ((err instanceof DOMException && err.name === "AbortError") || /cancel|abort/i.test(message)) return;
      console.warn("Web share failed:", err);
    }

    // Clipboard fallback (modern API + legacy execCommand)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied to clipboard");
        return;
      }
    } catch (err) {
      console.warn("Clipboard write failed:", err);
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast.success("Link copied to clipboard");
      return;
    } catch (err) {
      console.warn("execCommand copy failed:", err);
    }

    // Last resort
    safeOpenUrl(url);
  };

  const confirmDelete = () => {
    if (onDelete && currentPhoto) {
      onDelete(currentPhoto.id);
    }
    setDeleteConfirmOpen(false);
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        className="!max-w-none !max-h-none !w-screen !h-[100dvh] p-0 bg-black border-none rounded-none [&>button]:hidden !translate-x-[-50%] !translate-y-[-50%]"
        onKeyDown={handleKeyDown}
      >
        <VisuallyHidden>
          <DialogTitle>Photo viewer</DialogTitle>
        </VisuallyHidden>
        <div 
          className="relative w-full h-full flex items-center justify-center overflow-hidden pb-[env(safe-area-inset-bottom)]"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1.75rem)", touchAction: 'none' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleDoubleClick}
        >
          {/* Top toolbar with dark background for visibility.
              Uses max(safe-area, 1.75rem) so the toolbar always clears the
              Android status bar even inside in-app browsers (Messenger, etc.)
              where env(safe-area-inset-top) reports 0. */}
          <div
            className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-4 pb-3 bg-gradient-to-b from-black/70 to-transparent"
            style={{ paddingTop: "calc(max(env(safe-area-inset-top), 1.75rem) + 0.5rem)" }}
          >
            {/* Left side - Back navigation only */}
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 bg-black/40 rounded-full h-11 w-11"
                onClick={onClose}
                aria-label="Back"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </div>

            {/* Right side - Primary Share + overflow menu */}
            <div
              className="flex items-center gap-2 touch-auto"
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 bg-white/15 ring-1 ring-white/20 rounded-full h-11 w-11"
                onClick={handleShare}
                aria-label="Share photo"
                title="Share"
              >
                <Share2 className="h-5 w-5" />
              </Button>
              <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/20 bg-black/40 rounded-full h-11 w-11"
                    aria-label="More options"
                  >
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8} className="z-[1000002] min-w-[180px]">
                  <DropdownMenuItem onSelect={() => { setMenuOpen(false); handleDownload(); }}>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setMenuOpen(false);
                      setReportPhotoId(currentPhoto.id);
                      onClose();
                    }}
                  >
                    <Flag className="h-4 w-4 mr-2" />
                    Report
                  </DropdownMenuItem>
                  {canDelete && onDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => { setMenuOpen(false); setDeleteConfirmOpen(true); }}
                        className="text-destructive focus:text-destructive focus:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Navigation buttons with dark backgrounds */}
          {currentIndex > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-4 z-50 text-white hover:bg-white/20 bg-black/40 rounded-full touch-auto"
              onClick={(e) => { e.stopPropagation(); handlePrev(); }}
              onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); handlePrev(); }}
            >
              <ChevronLeft className="h-8 w-8" />
            </Button>
          )}

          {currentIndex < photos.length - 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 z-50 text-white hover:bg-white/20 bg-black/40 rounded-full touch-auto"
              onClick={(e) => { e.stopPropagation(); handleNext(); }}
              onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); handleNext(); }}
            >
              <ChevronRight className="h-8 w-8" />
            </Button>
          )}

          {/* Image with signed URL */}
          <LightboxImage
            src={photoSrc}
            alt={currentPhoto.title || "Photo"}
            scale={scale}
            translateX={translateX}
            translateY={translateY}
          />

          {/* Counter with dark background */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm px-3 py-1 bg-black/50 rounded-full">
            {currentIndex + 1} / {photos.length}
          </div>
        </div>
      </DialogContent>

    </Dialog>

    {/* Report Dialog */}
    <ReportPhotoDialog
      isOpen={!!reportPhotoId}
      onClose={() => setReportPhotoId(null)}
      photoId={reportPhotoId || ""}
    />

    {/* Delete confirmation */}
    <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this photo? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}