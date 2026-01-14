import { useState, useRef } from "react";
import { Upload, Image, FileText, Loader2, X, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
  onUpload: (file: File, type: "photo" | "file", fileName?: string) => void;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
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
    }
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
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      onUpload(selectedFile, uploadType, uploadType === "file" ? fileName : undefined);
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
              className="block cursor-pointer"
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
                  <Upload className="h-8 w-8 text-primary" />
                </div>
                <div className="text-center px-4">
                  <p className="font-medium">
                    {isDragging
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
                accept={uploadType === "photo" ? "image/*" : "*"}
                className="hidden"
                onChange={handleInputChange}
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
                    <File className="h-16 w-16 text-muted-foreground" />
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
            disabled={!selectedFile || isUploading}
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
