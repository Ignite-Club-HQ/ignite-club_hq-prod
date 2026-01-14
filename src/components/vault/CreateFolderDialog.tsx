import { useState } from "react";
import { FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateFolder: (name: string) => void;
  isCreating?: boolean;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  onCreateFolder,
  isCreating = false,
}: CreateFolderDialogProps) {
  const [folderName, setFolderName] = useState("");

  const handleCreate = () => {
    if (folderName.trim()) {
      onCreateFolder(folderName.trim());
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setFolderName("");
    }
    onOpenChange(newOpen);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Create New Folder</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="py-6 space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center">
              <FolderPlus className="h-10 w-10 text-primary" />
            </div>
          </div>

          {/* Input */}
          <div className="space-y-2">
            <Input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Enter folder name"
              className="text-center text-lg h-12"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && folderName.trim() && !isCreating) {
                  handleCreate();
                }
              }}
            />
            <p className="text-sm text-muted-foreground text-center">
              Organize your files with folders
            </p>
          </div>
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
            onClick={handleCreate}
            disabled={!folderName.trim() || isCreating}
            className="flex-1 sm:flex-none"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Folder"
            )}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
