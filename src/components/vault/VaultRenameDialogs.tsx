import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RenameDialogState {
  open: boolean;
  value: string;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  onRename: () => void;
}

interface VaultRenameDialogsProps {
  folder: RenameDialogState;
  file: RenameDialogState;
  photo: RenameDialogState;
}

function RenameDialog({
  state,
  title,
  label,
  placeholder,
}: {
  state: RenameDialogState;
  title: string;
  label: string;
  placeholder: string;
}) {
  return (
    <Dialog open={state.open} onOpenChange={state.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Enter a new name and confirm to rename this Vault item.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{label}</Label>
            <Input
              value={state.value}
              onChange={(event) => state.onValueChange(event.target.value)}
              placeholder={placeholder}
            />
          </div>
          <Button
            onClick={state.onRename}
            disabled={!state.value.trim()}
            className="w-full"
          >
            {title}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VaultRenameDialogs({ folder, file, photo }: VaultRenameDialogsProps) {
  return (
    <>
      <RenameDialog
        state={folder}
        title="Rename Folder"
        label="Folder Name"
        placeholder="Enter new folder name"
      />
      <RenameDialog
        state={file}
        title="Rename File"
        label="File Name"
        placeholder="Enter new file name"
      />
      <RenameDialog
        state={photo}
        title="Rename Photo"
        label="Photo Title"
        placeholder="Enter new photo title"
      />
    </>
  );
}
