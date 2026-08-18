import { useState } from "react";
import { CheckSquare, Download, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";

export interface VaultPhotoPresentationItem {
  id: string;
  title?: string | null;
  file_url?: string | null;
  image_url?: string | null;
  [key: string]: unknown;
}

interface VaultPhotoItemProps {
  photo: VaultPhotoPresentationItem;
  index: number;
  onPhotoClick: (index: number) => void;
  canDelete: boolean;
  onDelete: (id: string) => void;
  onDownload?: (url: string, filename: string) => void;
  canRename?: boolean;
  onRename?: (photo: VaultPhotoPresentationItem) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (id: string) => void;
}

export function VaultPhotoItem({
  photo,
  index,
  onPhotoClick,
  canDelete,
  onDelete,
  onDownload,
  canRename,
  onRename,
  selectionMode = false,
  isSelected = false,
  onToggleSelection,
}: VaultPhotoItemProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const rawPhotoUrl = photo.file_url || photo.image_url;
  const { signedUrl, isLoading: isLoadingSignedUrl } = useSignedPhotoUrl(rawPhotoUrl);
  const photoUrl = signedUrl || rawPhotoUrl;

  if (!rawPhotoUrl) {
    return (
      <div className="aspect-square rounded-lg bg-muted flex items-center justify-center">
        <span className="text-xs text-muted-foreground">No image</span>
      </div>
    );
  }

  if (isLoadingSignedUrl || (!isLoaded && !hasError)) {
    return (
      <>
        {!isLoadingSignedUrl && photoUrl && (
          <img
            src={photoUrl}
            alt=""
            className="absolute -left-[9999px] h-px w-px"
            onLoad={() => setIsLoaded(true)}
            onError={() => {
              console.error("[VaultPhotoItem] Failed to load image:", photoUrl);
              setHasError(true);
            }}
          />
        )}
        <div className="aspect-square rounded-lg bg-muted animate-pulse" data-testid="vault-photo-skeleton" />
      </>
    );
  }

  if (hasError) {
    return (
      <div className="aspect-square rounded-lg bg-muted flex items-center justify-center">
        <span className="text-xs text-muted-foreground text-center px-2">Failed to load</span>
      </div>
    );
  }

  const hasActions = onDownload || (canRename && onRename) || canDelete;

  return (
    <div className={`relative group ${selectionMode && isSelected ? "ring-2 ring-primary rounded-lg" : ""}`}>
      <img
        src={photoUrl}
        alt={photo.title || "Photo"}
        className={`aspect-square object-cover rounded-lg cursor-pointer transition-opacity select-none hover:opacity-90 ${selectionMode && isSelected ? "opacity-75" : ""}`}
        draggable={false}
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => selectionMode ? onToggleSelection?.(photo.id) : onPhotoClick(index)}
      />
      {selectionMode && (
        <div
          className="absolute top-1.5 left-1.5 z-10"
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelection?.(photo.id);
          }}
        >
          <span className={`h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors ${
            isSelected
              ? "bg-primary border-primary text-primary-foreground"
              : "bg-background/80 border-muted-foreground/50"
          }`}>
            {isSelected && <CheckSquare className="h-3.5 w-3.5" />}
          </span>
        </div>
      )}
      {!selectionMode && hasActions && (
        <div className="absolute top-1 right-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(event) => event.stopPropagation()}
                aria-label="Photo actions"
              >
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              {onDownload && (
                <DropdownMenuItem onClick={(event) => {
                  event.stopPropagation();
                  onDownload(photoUrl, photo.title || `photo-${photo.id}.jpg`);
                }}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </DropdownMenuItem>
              )}
              {canRename && onRename && (
                <DropdownMenuItem onClick={(event) => {
                  event.stopPropagation();
                  onRename(photo);
                }}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Rename
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(photo.id);
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
