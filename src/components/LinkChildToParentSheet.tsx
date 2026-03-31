import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, UserCheck } from "lucide-react";

interface LinkChildToParentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childName: string;
  /** If the child record already exists in DB */
  existingChildId?: string;
  /** Pending invite IDs that reference this child (to mark accepted) */
  pendingInviteIds: string[];
  teamId: string;
  clubId: string;
  /** Team members grouped by user */
  members: Record<string, { profile: { id: string; display_name: string | null; avatar_url: string | null }; roles: { id: string; role: string }[] }>;
}

export default function LinkChildToParentSheet({
  open,
  onOpenChange,
  childName,
  existingChildId,
  pendingInviteIds,
  teamId,
  clubId,
  members,
}: LinkChildToParentSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

  // Get all team members as potential parents (filter to show meaningful members)
  const parentOptions = Object.entries(members)
    .filter(([_, m]) => m.profile?.display_name)
    .map(([userId, m]) => ({
      id: userId,
      name: m.profile.display_name || "Unknown",
      avatar: m.profile.avatar_url,
      roles: m.roles.map(r => r.role),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const linkMutation = useMutation({
    mutationFn: async (parentId: string) => {
      let childId = existingChildId;

      if (childId) {
        // Child exists — update parent_id to the selected parent
        const { error } = await supabase
          .from("children")
          .update({ parent_id: parentId })
          .eq("id", childId);
        if (error) throw error;
      } else {
        // Create child record owned by the selected parent
        const { data: newChild, error: createErr } = await supabase
          .from("children")
          .insert({ name: childName, parent_id: parentId })
          .select("id")
          .single();
        if (createErr) throw createErr;
        childId = newChild.id;

        // Assign child to team
        const { error: assignErr } = await supabase
          .from("child_team_assignments")
          .insert({ child_id: childId, team_id: teamId });
        if (assignErr) throw assignErr;
      }

      // Ensure parent has a parent role on this team
      const { data: existingRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", parentId)
        .eq("team_id", teamId)
        .eq("role", "parent")
        .maybeSingle();

      if (!existingRole) {
        await supabase.from("user_roles").insert({
          user_id: parentId,
          team_id: teamId,
          club_id: clubId,
          role: "parent",
        });
      }

      // Mark all related pending invites as accepted
      if (pendingInviteIds.length > 0) {
        await supabase
          .from("pending_invites")
          .update({
            status: "accepted",
            accepted_at: new Date().toISOString(),
            invited_user_id: parentId,
          })
          .in("id", pendingInviteIds);
      }
    },
    onSuccess: () => {
      toast({
        title: "Child linked",
        description: `${childName} has been linked to a parent successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: ["team-children", teamId] });
      queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId] });
      onOpenChange(false);
      setSelectedParentId(null);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to link child",
        description: err.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base">Link "{childName}" to a Parent</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Select a team member to assign as {childName}'s parent
          </p>
        </SheetHeader>

        {parentOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No team members available. Add a member to the team first.
          </p>
        ) : (
          <div className="space-y-2 pb-4">
            {parentOptions.map((parent) => (
              <button
                key={parent.id}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  selectedParentId === parent.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted/50"
                }`}
                onClick={() => setSelectedParentId(parent.id)}
                disabled={linkMutation.isPending}
              >
                <Avatar className="h-8 w-8">
                  {parent.avatar && <AvatarImage src={parent.avatar} />}
                  <AvatarFallback className="text-sm">
                    {parent.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium">{parent.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {parent.roles.join(", ")}
                  </p>
                </div>
                {selectedParentId === parent.id && (
                  <UserCheck className="h-4 w-4 text-primary" />
                )}
              </button>
            ))}
          </div>
        )}

        <div className="pt-2 pb-2">
          <Button
            className="w-full"
            disabled={!selectedParentId || linkMutation.isPending}
            onClick={() => selectedParentId && linkMutation.mutate(selectedParentId)}
          >
            {linkMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Linking...
              </>
            ) : (
              "Link to Parent"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
