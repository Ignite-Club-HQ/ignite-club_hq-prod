import { useState } from "react";
import { Plus, MessageCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NewMessageMenuProps {
  onNewDM: () => void;
  onNewGroup: () => void;
  canCreateGroups: boolean;
}

export function NewMessageMenu({ onNewDM, onNewGroup, canCreateGroups }: NewMessageMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="default">
          <Plus className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onNewDM();
          }}
          className="gap-2 cursor-pointer"
        >
          <MessageCircle className="h-4 w-4" />
          New Message
        </DropdownMenuItem>
        {canCreateGroups && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              onNewGroup();
            }}
            className="gap-2 cursor-pointer"
          >
            <Users className="h-4 w-4" />
            New Group
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
