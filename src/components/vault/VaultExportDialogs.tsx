import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { FileArchive, FolderOpen, Loader2 } from "lucide-react";
import type { VaultExportSummary } from "@/features/vault/vaultExportSelection";

export interface VaultExportFolderBreakdown {
  path: string;
  photoCount: number;
  fileCount: number;
}

export type VaultPendingExportType = "zip" | "download" | "zipAll";

interface VaultExportDialogsProps {
  previewOpen: boolean;
  onPreviewOpenChange: (open: boolean) => void;
  previewLoading: boolean;
  previewPhotoCount: number;
  previewFileCount: number;
  folderBreakdown: VaultExportFolderBreakdown[];
  excludedFolders: ReadonlySet<string>;
  onToggleFolderExclusion: (path: string) => void;
  onConfirmPreview: () => void;
  confirmOpen: boolean;
  onConfirmOpenChange: (open: boolean) => void;
  summary: VaultExportSummary;
  pendingType: VaultPendingExportType | null;
  onCancelConfirmation: () => void;
  onConfirmExport: () => void;
}

const confirmationDescription = (
  summary: VaultExportSummary,
  pendingType: VaultPendingExportType | null,
) => {
  const total = summary.photoCount + summary.fileCount;
  if (summary.isSelection) {
    return `You are about to export ${total} selected item${total !== 1 ? "s" : ""}.`;
  }
  if (pendingType === "zipAll") {
    return "This will export all files in the current folder and its subfolders as a ZIP file.";
  }
  return `You are about to export ${summary.photoCount} photo${summary.photoCount !== 1 ? "s" : ""} and ${summary.fileCount} file${summary.fileCount !== 1 ? "s" : ""} from the current folder.`;
};

export function VaultExportDialogs({
  previewOpen,
  onPreviewOpenChange,
  previewLoading,
  previewPhotoCount,
  previewFileCount,
  folderBreakdown,
  excludedFolders,
  onToggleFolderExclusion,
  onConfirmPreview,
  confirmOpen,
  onConfirmOpenChange,
  summary,
  pendingType,
  onCancelConfirmation,
  onConfirmExport,
}: VaultExportDialogsProps) {
  const previewTotal = previewPhotoCount + previewFileCount;
  const summaryTotal = summary.photoCount + summary.fileCount;

  return (
    <>
      <Dialog open={previewOpen} onOpenChange={onPreviewOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Export All Folders</DialogTitle>
            <DialogDescription className="sr-only">
              Review included folders and item counts before creating the ZIP export.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {previewLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Scanning folders...</span>
              </div>
            ) : (
              <>
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Photos to export:</span>
                    <span className="font-medium">{previewPhotoCount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Files to export:</span>
                    <span className="font-medium">{previewFileCount}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t pt-2 mt-2">
                    <span className="font-medium">Total:</span>
                    <span className="font-medium">{previewTotal} items</span>
                  </div>
                </div>

                {folderBreakdown.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Select folders to include</h4>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {folderBreakdown.map((folder) => {
                        const isExcluded = excludedFolders.has(folder.path);
                        return (
                          <div
                            key={folder.path}
                            className={`flex items-center justify-between text-sm py-1.5 px-2 rounded cursor-pointer transition-colors ${
                              isExcluded ? "bg-muted/20 opacity-60" : "bg-muted/30 hover:bg-muted/50"
                            }`}
                            onClick={() => onToggleFolderExclusion(folder.path)}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <Checkbox
                                aria-label={`Include ${folder.path}`}
                                checked={!isExcluded}
                                onCheckedChange={() => onToggleFolderExclusion(folder.path)}
                                onClick={(event) => event.stopPropagation()}
                              />
                              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className={`truncate ${isExcluded ? "line-through" : ""}`}>{folder.path}</span>
                            </div>
                            <span className="text-muted-foreground shrink-0 ml-2">
                              {folder.photoCount + folder.fileCount} items
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => onPreviewOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button className="flex-1" onClick={onConfirmPreview} disabled={previewTotal === 0}>
                    <FileArchive className="h-4 w-4 mr-1" />
                    Export ZIP
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Export</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmationDescription(summary, pendingType)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Photos:</span>
              <span className="font-medium">{summary.photoCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Files:</span>
              <span className="font-medium">{summary.fileCount}</span>
            </div>
            <div className="flex justify-between border-t pt-1 mt-1">
              <span className="font-medium">Total:</span>
              <span className="font-medium">{summaryTotal} items</span>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelConfirmation}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmExport}>
              <FileArchive className="h-4 w-4 mr-1" />
              Export
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
