import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Trash2, Flag, ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { usePinchZoom } from "@/hooks/usePinchZoom";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { ReportPhotoDialog } from "@/components/ReportPhotoDialog";
import { isVideoUrl } from "@/lib/videoUtils";
import { downloadImage } from "@/lib/downloadImage";
import { toast } from "sonner";

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
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  
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

  if (!currentPhoto) return null;

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

  const photoSrc = currentPhoto.file_url || currentPhoto.image_url || '';
  const { signedUrl: downloadSignedUrl } = useSignedPhotoUrl(photoSrc);

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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
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
            {/* Left side - Back button + Delete */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 bg-black/40 rounded-full"
                onClick={onClose}
                aria-label="Back"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              {canDelete && onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20 bg-black/40 rounded-full"
                  onClick={() => onDelete(currentPhoto.id)}
                >
                  <Trash2 className="h-5 w-5" />
                </Button>
              )}
            </div>
            
            {/* Right side - Report and Close buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 bg-black/40 rounded-full"
                onClick={() => setReportDialogOpen(true)}
                title="Report photo"
              >
                <Flag className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 bg-black/40 rounded-full"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </Button>
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

      {/* Report Dialog */}
      <ReportPhotoDialog
        isOpen={reportDialogOpen}
        onClose={() => setReportDialogOpen(false)}
        photoId={currentPhoto.id}
      />
    </Dialog>
  );
}