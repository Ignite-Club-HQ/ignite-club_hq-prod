import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, X, UserCheck, Copy, Send, MoreHorizontal, Trash2, Check, Pencil, Mail, MailX, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface PendingInviteCardProps {
  invite: {
    id: string;
    role: string;
    invited_user_id: string | null;
    invited_label: string | null;
    invited_email?: string | null;
    created_at: string;
    status: string;
    email_sent_at?: string | null;
    email_id?: string | null;
    email_error?: string | null;
    profiles?: {
      id: string;
      display_name: string | null;
      avatar_url: string | null;
    } | null;
  };
  teamId?: string;
  clubId?: string;
}

type AppRole = "player" | "parent" | "coach" | "team_admin" | "club_admin";

const roleLabels: Record<string, string> = {
  player: "Player",
  parent: "Parent",
  coach: "Coach",
  team_admin: "Team Admin",
  club_admin: "Club Admin",
};

const roleColors: Record<string, string> = {
  player: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30",
  parent: "bg-pink-500/20 text-pink-600 dark:text-pink-400 border-pink-500/30",
  coach: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  team_admin: "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30",
  club_admin: "bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30",
};

const editableRoles: AppRole[] = ["player", "parent", "coach", "team_admin"];

export default function PendingInviteCard({ invite, teamId, clubId }: PendingInviteCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editName, setEditName] = useState(invite.invited_label || "");
  const [editRole, setEditRole] = useState<AppRole>(invite.role as AppRole);

  // Fetch existing invite link for this role
  const { data: inviteLink } = useQuery({
    queryKey: ["team-invite-link", teamId, invite.role],
    queryFn: async () => {
      if (!teamId) return null;
      const { data } = await supabase
        .from("team_invites")
        .select("token")
        .eq("team_id", teamId)
        .eq("role", invite.role as any)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data?.token) {
        return `${window.location.origin}/join/${data.token}`;
      }
      return null;
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("pending_invites")
        .delete()
        .eq("id", invite.id);
      if (error) throw error;
    },
    onMutate: async () => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["pending-invites", teamId, clubId] });
      
      // Snapshot the previous value
      const previousInvites = queryClient.getQueryData(["pending-invites", teamId, clubId]);
      
      // Optimistically update to remove the deleted invite
      queryClient.setQueryData(["pending-invites", teamId, clubId], (old: any[] | undefined) => {
        if (!old) return old;
        return old.filter((inv: any) => inv.id !== invite.id);
      });
      
      return { previousInvites };
    },
    onSuccess: () => {
      toast({ title: "Pending invite revoked" });
      setShowDeleteDialog(false);
    },
    onError: (error, _, context) => {
      // Rollback to the previous value on error
      if (context?.previousInvites) {
        queryClient.setQueryData(["pending-invites", teamId, clubId], context.previousInvites);
      }
      toast({ title: "Failed to revoke invite", variant: "destructive" });
    },
    onSettled: () => {
      // Refetch to ensure we have the latest data
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, clubId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("pending_invites")
        .update({
          invited_label: editName.trim() || null,
          role: editRole as any,
        })
        .eq("id", invite.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, clubId] });
      toast({ title: "Pending invite updated" });
      setShowEditDialog(false);
    },
    onError: () => {
      toast({ title: "Failed to update invite", variant: "destructive" });
    },
  });

  const handleCopyLink = async () => {
    if (!inviteLink) {
      toast({ 
        title: "No invite link available", 
        description: "Generate a new invite link from the team page",
        variant: "destructive" 
      });
      return;
    }
    
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast({ title: "Invite link copied!" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy link", variant: "destructive" });
    }
  };

  const handleOpenEdit = () => {
    setEditName(invite.invited_label || "");
    setEditRole(invite.role as AppRole);
    setShowEditDialog(true);
  };

  // Prioritize invited_label (manual entry) over profile name to avoid showing the inviter's name
  // Only use profile display_name if there's no label AND profiles match indicates a real user match
  const displayName = invite.invited_label || invite.profiles?.display_name || "Unknown";
  const avatarUrl = invite.invited_label ? undefined : invite.profiles?.avatar_url;
  // Only show "Existing" badge if there's no manual label (indicating profile was auto-matched, not placeholder)
  const isExistingUser = !invite.invited_label && !!invite.profiles?.id;
  const roleColor = roleColors[invite.role] || "bg-muted text-muted-foreground";
  const roleLabel = roleLabels[invite.role] || invite.role.replace("_", " ");
  const timeAgo = formatDistanceToNow(new Date(invite.created_at), { addSuffix: true });

  return (
    <>
      <Card className="border-2 border-dashed border-orange-500/40 bg-gradient-to-r from-orange-500/5 to-amber-500/5">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10 ring-2 ring-orange-500/30 ring-offset-2 ring-offset-background">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="bg-orange-500/20 text-orange-600 dark:text-orange-400">
                {displayName[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-orange-500 shadow-lg">
              <Clock className="h-2.5 w-2.5 text-white" />
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{displayName}</span>
              {isExistingUser && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">
                  <UserCheck className="h-2.5 w-2.5 mr-0.5" />
                  Existing
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              <Badge variant="outline" className={`${roleColor} text-xs`}>
                {roleLabel}
              </Badge>
              <Badge className="bg-orange-500/90 hover:bg-orange-500 text-white text-xs font-medium px-2">
                <Clock className="h-3 w-3 mr-1" />
                Pending
              </Badge>
              {/* Email status indicator */}
              {invite.invited_email && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {invite.email_sent_at ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
                          <Mail className="h-2.5 w-2.5 mr-0.5" />
                          Sent
                        </Badge>
                      ) : invite.email_error ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30">
                          <MailX className="h-2.5 w-2.5 mr-0.5" />
                          Failed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-muted text-muted-foreground">
                          <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                          Not sent
                        </Badge>
                      )}
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        {invite.email_sent_at 
                          ? `Email sent to ${invite.invited_email}` 
                          : invite.email_error 
                            ? `Failed: ${invite.email_error}`
                            : `No email sent to ${invite.invited_email}`
                        }
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <span className="text-xs text-muted-foreground hidden sm:inline">
                • {timeAgo}
              </span>
            </div>
          </div>

          {/* Quick action buttons */}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 gap-1 text-xs hidden sm:flex"
              onClick={handleCopyLink}
              disabled={!inviteLink}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-green-500" />
                  Copied
                </>
              ) : (
                <>
                  <Send className="h-3 w-3" />
                  Resend
                </>
              )}
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleOpenEdit}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit name/role
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyLink} disabled={!inviteLink}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy invite link
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Revoke invite
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Pending Invite</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Enter name"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <div className="grid grid-cols-2 gap-2">
                {editableRoles.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setEditRole(role)}
                    className={`p-2 rounded-lg text-left transition-all border-2 ${
                      editRole === role
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <Badge variant="outline" className={`${roleColors[role]} text-xs`}>
                      {roleLabels[role]}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Pending Invite?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the pending invite for <strong>{displayName}</strong> ({roleLabel}). 
              They can still join using the invite link if it hasn't expired.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Revoking..." : "Revoke Invite"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
