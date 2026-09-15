import { Loader2 } from "lucide-react";
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

type VaultItemType = "photo" | "file";

interface ItemDeleteConfirmation {
  open: boolean;
  permanent: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

interface VaultMutationConfirmationDialogsProps {
  photoDelete: ItemDeleteConfirmation;
  fileDelete: ItemDeleteConfirmation;
  restoreOpen: boolean;
  restoreItemType: VaultItemType;
  onRestoreOpenChange: (open: boolean) => void;
  onRestore: () => void;
  bulkDeleteOpen: boolean;
  selectedCount: number;
  deletingSelected: boolean;
  onBulkDeleteOpenChange: (open: boolean) => void;
  onBulkDelete: () => void;
  folderDeleteOpen: boolean;
  onFolderDeleteOpenChange: (open: boolean) => void;
  onFolderDelete: () => void;
}

function ItemDeleteDialog({
  itemType,
  confirmation,
}: {
  itemType: VaultItemType;
  confirmation: ItemDeleteConfirmation;
}) {
  const titleType = itemType === "photo" ? "Photo" : "File";
  return (
    <AlertDialog open={confirmation.open} onOpenChange={confirmation.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirmation.permanent ? `Permanently Delete ${titleType}` : `Delete ${titleType}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmation.permanent
              ? `Are you sure you want to permanently delete this ${itemType}? This cannot be undone.`
              : `This ${itemType} will be moved to trash.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmation.onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmation.permanent ? "Delete Permanently" : "Move to Trash"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function VaultMutationConfirmationDialogs({
  photoDelete,
  fileDelete,
  restoreOpen,
  restoreItemType,
  onRestoreOpenChange,
  onRestore,
  bulkDeleteOpen,
  selectedCount,
  deletingSelected,
  onBulkDeleteOpenChange,
  onBulkDelete,
  folderDeleteOpen,
  onFolderDeleteOpenChange,
  onFolderDelete,
}: VaultMutationConfirmationDialogsProps) {
  const restoreTitleType = restoreItemType === "photo" ? "Photo" : "File";
  const plural = selectedCount !== 1 ? "s" : "";

  return (
    <>
      <ItemDeleteDialog itemType="photo" confirmation={photoDelete} />
      <ItemDeleteDialog itemType="file" confirmation={fileDelete} />

      <AlertDialog open={restoreOpen} onOpenChange={onRestoreOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {restoreTitleType}</AlertDialogTitle>
            <AlertDialogDescription>
              This {restoreItemType} will be restored to its original location.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onRestore}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={onBulkDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Selected Items</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedCount} selected item{plural}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSelected}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onBulkDelete}
              disabled={deletingSelected}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingSelected ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Deleting...
                </>
              ) : `Delete ${selectedCount} Item${plural}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={folderDeleteOpen} onOpenChange={onFolderDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this folder? Files inside will be moved to the parent folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onFolderDelete}
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
