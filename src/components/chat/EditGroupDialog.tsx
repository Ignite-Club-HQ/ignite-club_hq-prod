import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "league_admin", label: "League Admins" },
  { value: "committee_member", label: "Committee Members" },
  { value: "team_admin", label: "Team Admins" },
  { value: "coach", label: "Coaches" },
  { value: "parent", label: "Parents" },
  { value: "player", label: "Players" },
  { value: "club_admin", label: "Club Admins" },
];

interface EditGroupDialogProps {
  group: {
    id: string;
    name: string;
    allowed_roles: AppRole[];
    membership_mode?: string | null;
    category?: string | null;
    club_id?: string | null;
    team_id?: string | null;
    mini_league_id?: string | null;
    join_policy?: string | null;
  };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function EditGroupDialog({ group, open: controlledOpen, onOpenChange }: EditGroupDialogProps) {
  const isManual = group.membership_mode === "manual";
  const qualifiesForOpenJoin =
    isManual &&
    !!group.club_id &&
    !group.team_id &&
    !group.mini_league_id &&
    (group.category === "Operations" || group.category === "Volunteers");
  const [internalOpen, setInternalOpen] = useState(false);
  const [name, setName] = useState(group.name);
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>(group.allowed_roles);
  const [openToClub, setOpenToClub] = useState<boolean>(group.join_policy === "open_to_club");
  const queryClient = useQueryClient();
  
  // Support both controlled and uncontrolled modes
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (onOpenChange || (() => {})) : setInternalOpen;

  const updateGroupMutation = useMutation({
    mutationFn: async () => {
      const updates: { name: string; allowed_roles?: AppRole[]; join_policy?: string } = { name };
      if (!isManual) updates.allowed_roles = selectedRoles;
      if (qualifiesForOpenJoin) {
        updates.join_policy = openToClub ? "open_to_club" : "invite_only";
      }
      const { error } = await supabase
        .from("chat_groups")
        .update(updates as any)
        .eq("id", group.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Group updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      setOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error updating group",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleRole = (role: AppRole) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const handleUpdate = () => {
    if (!name.trim()) {
      toast({ title: "Please enter a group name", variant: "destructive" });
      return;
    }
    if (!isManual && selectedRoles.length === 0) {
      toast({ title: "Please select at least one role", variant: "destructive" });
      return;
    }
    updateGroupMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => e.stopPropagation()}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Edit Chat Group</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="edit-group-name">Group Name</Label>
            <Input
              id="edit-group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter group name"
            />
          </div>

          {!isManual && (
            <div className="space-y-2">
              <Label>Allowed Roles</Label>
              <div className="space-y-2">
                {ROLE_OPTIONS.map((role) => (
                  <div key={role.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-role-${role.value}`}
                      checked={selectedRoles.includes(role.value)}
                      onCheckedChange={() => toggleRole(role.value)}
                    />
                    <label
                      htmlFor={`edit-role-${role.value}`}
                      className="text-sm cursor-pointer"
                    >
                      {role.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isManual && (
            <p className="text-sm text-muted-foreground">
              This group is managed by invitation. Add or remove members from the group details screen.
            </p>
          )}

          {qualifiesForOpenJoin && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="edit-group-open-join"
                  checked={openToClub}
                  onCheckedChange={(v) => setOpenToClub(v === true)}
                />
                <div className="space-y-0.5">
                  <label htmlFor="edit-group-open-join" className="text-sm font-medium cursor-pointer">
                    Let any club member join
                  </label>
                  <p className="text-xs text-muted-foreground">
                    This group appears under "Discover groups" so club members can join without being added by an admin.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateGroupMutation.isPending}
            >
              {updateGroupMutation.isPending ? "Updating..." : "Update Group"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
