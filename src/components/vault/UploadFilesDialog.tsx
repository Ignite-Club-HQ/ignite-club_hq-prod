import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Image, FileText, Loader2, X, File as FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Keyboard } from "@capacitor/keyboard";
import { StatusBar } from "@capacitor/status-bar";
import { toast } from "sonner";
import { cameraPhotoToBlob, hasCameraPhotoSource } from "@/lib/binaryUtils";
import { getReadableUploadError, isCancelledSelectionError } from "@/lib/uploadErrorUtils";
import {
  emitIOSLayoutReset as dispatchIOSLayoutReset,
  emitIOSNavGuard as dispatchIOSNavGuard,
} from "@/lib/iosLayoutStability";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";

interface UploadFilesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File, type: "photo" | "file", fileName?: string) => void | Promise<void>;
  isUploading?: boolean;
  targetName: string;
}

export function UploadFilesDialog({
  open,
  onOpenChange,
  onUpload,
  isUploading = false,
  targetName,
}: UploadFilesDialogProps) {
  const [uploadType, setUploadType] = useState<"photo" | "file">("photo");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPickingNativePhoto, setIsPickingNativePhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const platform = Capacitor.getPlatform();
  const isNativeIOS = Capacitor.isNativePlatform() && platform === "ios";
  const isIOSEnvironment =
    isNativeIOS ||
    (typeof navigator !== "undefined" &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)));
  const shouldStabilizeIOSLayout = isIOSEnvironment;
  const shouldUseNativePhotoPicker = uploadType === "photo" && isNativeIOS;
  const navGuardRetryTimeoutRef = useRef<number | null>(null);

  const dismissIOSKeyboardAccessory = useCallback(() => {
    if (!isNativeIOS) return;
    (document.activeElement as HTMLElement | null)?.blur();
  }, [isNativeIOS]);

  const restoreNativeStatusBarOverlay = useCallback(async () => {
    if (!isNativeIOS) return;

    try {
      await StatusBar.setOverlaysWebView({ overlay: false });
    } catch (error) {
      console.warn("[UploadFilesDialog] Failed to restore status bar overlay:", error);
    }
  }, [isNativeIOS]);

  const emitIOSLayoutReset = useCallback(() => {
    if (!shouldStabilizeIOSLayout) return;
    dispatchIOSLayoutReset();
  }, [shouldStabilizeIOSLayout]);

  const emitIOSNavGuard = useCallback((durationMs = 900) => {
    if (!shouldStabilizeIOSLayout) return;
    dispatchIOSNavGuard(durationMs);
  }, [shouldStabilizeIOSLayout]);

  const clearNavGuardRetryTimeout = useCallback(() => {
    if (typeof window === "undefined") return;
    if (navGuardRetryTimeoutRef.current !== null) {
      window.clearTimeout(navGuardRetryTimeoutRef.current);
      navGuardRetryTimeoutRef.current = null;
    }
  }, []);

  const restoreNativeLayout = useCallback(() => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined") return;

    emitIOSLayoutReset();
    emitIOSNavGuard(900);
    clearNavGuardRetryTimeout();

    navGuardRetryTimeoutRef.current = window.setTimeout(() => {
      emitIOSNavGuard(1500);

      navGuardRetryTimeoutRef.current = window.setTimeout(() => {
        emitIOSNavGuard(1800);
        navGuardRetryTimeoutRef.current = null;
      }, 1200);
    }, 320);
  }, [clearNavGuardRetryTimeout, emitIOSLayoutReset, emitIOSNavGuard, shouldStabilizeIOSLayout]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      clearNavGuardRetryTimeout();
    };
  }, [clearNavGuardRetryTimeout]);

  const handleFileSelect = (file: File) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);

    // Create preview for images
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }

    // Set default filename for files
    if (uploadType === "file" && !fileName) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
      setFileName(nameWithoutExt);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
      requestAnimationFrame(restoreNativeLayout);
    }
  };

  useEffect(() => {
    if (!open) {
      restoreNativeLayout();
    }
  }, [open, restoreNativeLayout]);

  const handleNativePhotoPick = async () => {
    if (!shouldUseNativePhotoPicker || isUploading || isPickingNativePhoto) return;

    setIsPickingNativePhoto(true);
    console.log("[UploadFilesDialog] handleNativePhotoPick START");
    try {
      // Let Camera.getPhoto handle permissions natively on iOS to preserve
      // the gesture-chain context. Explicit checkPermissions/requestPermissions
      // before getPhoto breaks the gesture on first attempt.
      let photo: Awaited<ReturnType<typeof Camera.getPhoto>>;
      const isLoadingError = (err: unknown) => {
        const msg = getReadableUploadError(err).toLowerCase();
        return msg.includes("error loading image") || msg.includes("loading image");
      };

      try {
        console.log("[UploadFilesDialog] calling getPhoto (Base64 mode, attempt 1)...");
        photo = await Camera.getPhoto({
          resultType: CameraResultType.Base64,
          source: CameraSource.Photos,
          allowEditing: false,
          quality: 80,
        });
      } catch (firstAttemptError: unknown) {
        if (isCancelledSelectionError(firstAttemptError)) {
          throw firstAttemptError;
        }

        if (isLoadingError(firstAttemptError)) {
          console.warn("[UploadFilesDialog] Base64 mode failed with loading error, retrying with URI mode:", firstAttemptError);
          photo = await Camera.getPhoto({
            resultType: CameraResultType.Uri,
            source: CameraSource.Photos,
            allowEditing: false,
            quality: 80,
          });
        } else {
          console.warn("[UploadFilesDialog] getPhoto attempt 1 failed, retrying:", firstAttemptError);
          try {
            photo = await Camera.getPhoto({
              resultType: CameraResultType.Base64,
              source: CameraSource.Photos,
              allowEditing: false,
              quality: 80,
            });
          } catch (secondAttemptError: unknown) {
            if (!isCancelledSelectionError(secondAttemptError) && isLoadingError(secondAttemptError)) {
              console.warn("[UploadFilesDialog] Base64 retry also failed, falling back to URI:", secondAttemptError);
              photo = await Camera.getPhoto({
                resultType: CameraResultType.Uri,
                source: CameraSource.Photos,
                allowEditing: false,
                quality: 80,
              });
            } else {
              throw secondAttemptError;
            }
          }
        }
      }
      console.log("[UploadFilesDialog] getPhoto OK", {
        webPath: photo.webPath,
        path: photo.path,
        format: photo.format,
        hasBase64: !!photo.base64String,
      });

      // Stabilize BottomNav immediately once picker returns, before blob work.
      requestAnimationFrame(() => {
        restoreNativeLayout();
      });

      if (!hasCameraPhotoSource(photo)) {
        throw new Error("No photo selected (missing base64String/webPath/path)");
      }

      console.log("[UploadFilesDialog] calling cameraPhotoToBlob...");
      const result = await cameraPhotoToBlob(photo);
      const blobResult: { blob: Blob; mimeType: string; extension: string } = {
        blob: result.blob,
        mimeType: result.mimeType,
        extension: result.extension,
      };
      const { blob, mimeType, extension } = blobResult;
      console.log("[UploadFilesDialog] blob ready, size:", blob.size, "mime:", mimeType);
      const file = new File([blob], `photo-${Date.now()}.${extension}`, {
        type: mimeType,
        lastModified: Date.now(),
      });

      handleFileSelect(file);
      requestAnimationFrame(() => {
        restoreNativeLayout();
      });
    } catch (error) {
      if (!isCancelledSelectionError(error)) {
        const errMsg = getReadableUploadError(error);
        console.warn("[UploadFilesDialog] Native picker failed:", errMsg, error);
        toast.error(`Could not load photo: ${errMsg || "Unknown error"}`);
      } else {
        console.log("[UploadFilesDialog] user cancelled");
      }
    } finally {
      await restoreNativeStatusBarOverlay();
      restoreNativeLayout();
      setIsPickingNativePhoto(false);
    }
  };

  const handleUploadAreaClick = (e: React.MouseEvent<HTMLLabelElement>) => {
    if (!shouldUseNativePhotoPicker) return;

    e.preventDefault();
    void handleNativePhotoPick();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      // Update type based on dropped file
      if (file.type.startsWith("image/")) {
        setUploadType("photo");
      } else {
        setUploadType("file");
      }
      handleFileSelect(file);
      requestAnimationFrame(restoreNativeLayout);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    restoreNativeLayout();

    try {
      await onUpload(selectedFile, uploadType, uploadType === "file" ? fileName : undefined);
    } finally {
      restoreNativeLayout();
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Cleanup
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setSelectedFile(null);
      setPreviewUrl(null);
      setFileName("");
      setUploadType("photo");
      restoreNativeLayout();
    }
    onOpenChange(newOpen);
  };

  const clearSelection = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setFileName("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Upload to {targetName}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="py-4 space-y-4">
          {/* Type Selector */}
          <div className="flex gap-2">
            <Button
              variant={uploadType === "photo" ? "default" : "outline"}
              onClick={() => {
                setUploadType("photo");
                clearSelection();
              }}
              className="flex-1"
            >
              <Image className="h-4 w-4 mr-2" /> Photo
            </Button>
            <Button
              variant={uploadType === "file" ? "default" : "outline"}
              onClick={() => {
                setUploadType("file");
                clearSelection();
              }}
              className="flex-1"
            >
              <FileText className="h-4 w-4 mr-2" /> File
            </Button>
          </div>

          {/* Upload Area */}
          {!selectedFile ? (
            <label
              className={cn("block cursor-pointer", (isUploading || isPickingNativePhoto) && "pointer-events-none opacity-70")}
              onClick={handleUploadAreaClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div
                className={cn(
                  "aspect-[4/3] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-4 transition-all",
                  isDragging
                    ? "border-primary bg-primary/5 scale-[1.02]"
                    : "border-muted-foreground/25 bg-muted/50 hover:border-muted-foreground/50 hover:bg-muted"
                )}
              >
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  {isPickingNativePhoto ? (
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  ) : (
                    <Upload className="h-8 w-8 text-primary" />
                  )}
                </div>
                <div className="text-center px-4">
                  <p className="font-medium">
                    {isPickingNativePhoto
                      ? "Opening photo library..."
                      : isDragging
                        ? `Drop ${uploadType === "photo" ? "photo" : "file"} here`
                        : `Tap to select ${uploadType === "photo" ? "photo" : "file"}`}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    or drag and drop
                  </p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={
                  uploadType === "photo"
                    ? "image/png,image/jpeg,image/jpg,image/gif,image/webp,image/heic,image/heif,image/svg+xml,image/bmp,image/tiff"
                    : Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios"
                      ? "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,application/zip,application/x-rar-compressed,application/json,application/xml,text/xml,text/yaml,application/x-yaml,text/markdown"
                      : Capacitor.isNativePlatform()
                        ? ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.mp4,.mp3,.wav,.mov,.json,.xml,.yaml,.md"
                        : "*"
                }
                className="hidden"
                onChange={handleInputChange}
                disabled={isUploading || isPickingNativePhoto}
              />
            </label>
          ) : (
            <div className="space-y-4">
              {/* Preview */}
              <div className="relative rounded-2xl overflow-hidden bg-muted">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-full aspect-[4/3] object-cover"
                  />
                ) : (
                  <div className="w-full aspect-[4/3] flex flex-col items-center justify-center gap-3">
                    <FileIcon className="h-16 w-16 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground font-medium">
                      {selectedFile.name}
                    </p>
                  </div>
                )}
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
                  onClick={clearSelection}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* File Info */}
              <div className="flex items-center justify-between text-sm px-1">
                <span className="text-muted-foreground truncate max-w-[60%]">
                  {selectedFile.name}
                </span>
                <span className="text-muted-foreground">
                  {formatFileSize(selectedFile.size)}
                </span>
              </div>

              {/* File Name Input (for files only) */}
              {uploadType === "file" && (
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="Enter file name"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading || isPickingNativePhoto}
            className="flex-1 sm:flex-none"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </>
            )}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
