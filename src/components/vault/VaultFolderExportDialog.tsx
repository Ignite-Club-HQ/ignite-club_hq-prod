import { CheckSquare, Download, FileArchive, FileText, FolderOpen, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface VaultFolderExportPhoto {
  id: string;
  file_url: string;
  title?: string | null;
}

export interface VaultFolderExportFile {
  id: string;
  name: string;
}

interface VaultFolderExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName?: string;
  loading: boolean;
  photos: VaultFolderExportPhoto[];
  files: VaultFolderExportFile[];
  selectedPhotoIds: ReadonlySet<string>;
  selectedFileIds: ReadonlySet<string>;
  onTogglePhoto: (id: string) => void;
  onToggleFile: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onExport: () => void;
}

export function VaultFolderExportDialog({
  open,
  onOpenChange,
  folderName,
  loading,
  photos,
  files,
  selectedPhotoIds,
  selectedFileIds,
  onTogglePhoto,
  onToggleFile,
  onSelectAll,
  onDeselectAll,
  onExport,
}: VaultFolderExportDialogProps) {
  const selectedCount = selectedPhotoIds.size + selectedFileIds.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export: {folderName}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Select the photos and files to include in this folder export.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center py-8" aria-label="Loading folder contents">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading folder contents...</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={onSelectAll}>
                    <CheckSquare className="h-4 w-4 mr-1" />
                    Select All
                  </Button>
                  <Button variant="outline" size="sm" onClick={onDeselectAll}>
                    <Square className="h-4 w-4 mr-1" />
                    Deselect All
                  </Button>
                </div>
                <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3">
                {photos.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-muted-foreground">Photos ({photos.length})</h3>
                    {photos.map((photo) => (
                      <div
                        key={photo.id}
                        data-testid="folder-export-photo"
                        className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-accent/50 ${
                          selectedPhotoIds.has(photo.id) ? "bg-accent/50" : ""
                        }`}
                        onClick={() => onTogglePhoto(photo.id)}
                      >
                        <Checkbox
                          aria-label={`Select ${photo.title || "Untitled photo"}`}
                          checked={selectedPhotoIds.has(photo.id)}
                          onCheckedChange={() => onTogglePhoto(photo.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <img
                          src={photo.file_url}
                          alt={photo.title || "Photo"}
                          className="h-10 w-10 object-cover rounded"
                        />
                        <span className="text-sm truncate flex-1">{photo.title || "Untitled photo"}</span>
                      </div>
                    ))}
                  </div>
                )}

                {files.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-muted-foreground">Files ({files.length})</h3>
                    {files.map((file) => (
                      <div
                        key={file.id}
                        data-testid="folder-export-file"
                        className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-accent/50 ${
                          selectedFileIds.has(file.id) ? "bg-accent/50" : ""
                        }`}
                        onClick={() => onToggleFile(file.id)}
                      >
                        <Checkbox
                          aria-label={`Select ${file.name}`}
                          checked={selectedFileIds.has(file.id)}
                          onCheckedChange={() => onToggleFile(file.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <div className="p-2 rounded-lg bg-primary/10">
                          <FileText className="h-4 w-4 text-primary" />
                        </div>
                        <span className="text-sm truncate flex-1">{file.name}</span>
                      </div>
                    ))}
                  </div>
                )}

                {photos.length === 0 && files.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p>This folder is empty</p>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t mt-4">
                <Button className="w-full" onClick={onExport} disabled={selectedCount === 0}>
                  <FileArchive className="h-4 w-4 mr-1" />
                  Export {selectedCount} Items as ZIP
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
