import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight, Trash2, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { usePinchZoom } from "@/hooks/usePinchZoom";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { ReportPhotoDialog } from "@/components/ReportPhotoDialog";

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
  translateY 
}: { 
  src: string; 
  alt: string; 
  scale: number; 
  translateX: number; 
  translateY: number;
}) {
  const { signedUrl, isLoading } = useSignedPhotoUrl(src);
  const effectiveSrc = signedUrl || src;

  if (isLoading) {
    return (
      <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin" />
    );
  }

  return (
    <img
      src={effectiveSrc}
      alt={alt}
      className="max-w-full max-h-full object-contain transition-transform duration-100"
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
    if (e.touches.length === 2) {
      pinchTouchStart(e);
    } else if (e.touches.length === 1 && scale === 1) {
      swipeHandlers.onTouchStart(e);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchTouchMove(e);
    } else if (e.touches.length === 1 && scale === 1) {
      swipeHandlers.onTouchMove(e);
    }
  };

  const handleTouchEnd = () => {
    pinchTouchEnd();
    swipeHandlers.onTouchEnd();
  };

  const handleDoubleClick = () => {
    if (scale > 1) {
      resetZoom();
    }
  };

  const photoSrc = currentPhoto.file_url || currentPhoto.image_url || '';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="max-w-[95vw] max-h-[95vh] p-0 bg-black/95 border-none [&>button]:hidden"
        onKeyDown={handleKeyDown}
      >
        <VisuallyHidden>
          <DialogTitle>Photo viewer</DialogTitle>
        </VisuallyHidden>
        <div 
          className="relative w-full h-[90vh] flex items-center justify-center touch-none overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleDoubleClick}
        >
          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20"
            onClick={onClose}
          >
            <X className="h-6 w-6" />
          </Button>

          {/* Delete button */}
          {canDelete && onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 left-4 z-50 text-destructive hover:bg-destructive/20"
              onClick={() => onDelete(currentPhoto.id)}
            >
              <Trash2 className="h-6 w-6" />
            </Button>
          )}

          {/* Report button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-16 z-50 text-white hover:bg-white/20"
            onClick={() => setReportDialogOpen(true)}
            title="Report photo"
          >
            <Flag className="h-5 w-5" />
          </Button>

          {/* Navigation */}
          {currentIndex > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-4 z-50 text-white hover:bg-white/20"
              onClick={handlePrev}
            >
              <ChevronLeft className="h-8 w-8" />
            </Button>
          )}

          {currentIndex < photos.length - 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 z-50 text-white hover:bg-white/20"
              onClick={handleNext}
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

          {/* Counter */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm">
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