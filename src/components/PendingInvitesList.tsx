import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, Trash2, X, Loader2 } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import PendingInviteCard from "./PendingInviteCard";

interface PendingInvite {
  id: string;
  role: string;
  invited_user_id: string | null;
  invited_label: string | null;
  invited_email?: string | null;
  created_at: string;
  status: string;
  profiles?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface PendingInvitesListProps {
  invites: PendingInvite[];
  teamId?: string;
  clubId?: string;
}

export default function PendingInvitesList({ invites, teamId, clubId }: PendingInvitesListProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [isSendingNotifications, setIsSendingNotifications] = useState(false);

  // Fetch invite links for all roles present in pending invites
  const uniqueRoles = [...new Set(invites.map(inv => inv.role))];
  
  const { data: inviteLinks = {} } = useQuery({
    queryKey: ["team-invite-links", teamId, uniqueRoles],
    queryFn: async () => {
      if (!teamId) return {};
      const { data } = await supabase
        .from("team_invites")
        .select("token, role")
        .eq("team_id", teamId)
        .in("role", uniqueRoles as any)
        .order("created_at", { ascending: false });
      
      const linksByRole: Record<string, string> = {};
      data?.forEach(invite => {
        if (!linksByRole[invite.role]) {
          linksByRole[invite.role] = `${window.location.origin}/join/${invite.token}`;
        }
      });
      return linksByRole;
    },
    enabled: !!teamId && uniqueRoles.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("pending_invites")
        .delete()
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, clubId] });
      toast({ title: `${selectedIds.size} invite(s) revoked` });
      setSelectedIds(new Set());
      setShowBulkDeleteDialog(false);
    },
    onError: () => {
      toast({ title: "Failed to revoke invites", variant: "destructive" });
    },
  });

  const handleSelectAll = () => {
    if (selectedIds.size === invites.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invites.map(inv => inv.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleBulkResend = async () => {
    const selectedInvites = invites.filter(inv => selectedIds.has(inv.id));
    const linksToShare: string[] = [];
    const emailsToSend: { email: string; name: string; link: string; role: string }[] = [];
    
    selectedInvites.forEach(inv => {
      const link = inviteLinks[inv.role];
      if (link) {
        if (!linksToShare.includes(link)) {
          linksToShare.push(link);
        }
        if (inv.invited_email) {
          emailsToSend.push({
            email: inv.invited_email,
            name: inv.invited_label || "Member",
            link,
            role: inv.role,
          });
        }
      }
    });

    if (linksToShare.length === 0) {
      toast({ 
        title: "No invite links available", 
        description: "Generate invite links from the team page first",
        variant: "destructive" 
      });
      return;
    }

    // Send email notifications for invites with emails
    if (emailsToSend.length > 0) {
      setIsSendingNotifications(true);
      let successCount = 0;
      for (const { email, name, link, role } of emailsToSend) {
        try {
          await supabase.functions.invoke("send-email", {
            body: {
              to: email,
              subject: "Reminder: You're invited to join the team!",
              html: `
                <h2>Reminder: You've been invited!</h2>
                <p>Hi ${name},</p>
                <p>This is a reminder that you've been invited to join the team as a <strong>${role}</strong>.</p>
                <p><a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #f97316; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Accept Invite</a></p>
                <p>Or copy this link: ${link}</p>
              `,
            },
          });
          successCount++;
        } catch (error) {
          console.error(`Failed to send email to ${email}:`, error);
        }
      }
      setIsSendingNotifications(false);
      
      if (successCount > 0) {
        toast({ 
          title: `${successCount} email(s) sent!`,
          description: successCount < emailsToSend.length 
            ? `Some emails failed. Links also copied to clipboard.` 
            : undefined
        });
      }
    }

    // Also copy links to clipboard
    try {
      const text = linksToShare.length === 1 
        ? linksToShare[0] 
        : linksToShare.join("\n");
      await navigator.clipboard.writeText(text);
      if (emailsToSend.length === 0) {
        toast({ 
          title: `${linksToShare.length} invite link(s) copied!`,
          description: "Share these links with the pending members"
        });
      }
    } catch {
      if (emailsToSend.length === 0) {
        toast({ title: "Failed to copy links", variant: "destructive" });
      }
    }
  };

  const isAllSelected = selectedIds.size === invites.length && invites.length > 0;
  const hasSelection = selectedIds.size > 0;

  if (invites.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Bulk Actions Bar */}
      <div className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
        <Checkbox
          checked={isAllSelected}
          onCheckedChange={handleSelectAll}
          aria-label="Select all pending invites"
        />
        <span className="text-sm text-muted-foreground">
          {hasSelection ? (
            <>
              <span className="font-medium text-foreground">{selectedIds.size}</span> selected
            </>
          ) : (
            "Select all"
          )}
        </span>
        
        {hasSelection && (
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleBulkResend}
              disabled={isSendingNotifications}
            >
              {isSendingNotifications ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Resend ({selectedIds.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => setShowBulkDeleteDialog(true)}
            >
              <Trash2 className="h-3 w-3" />
              Revoke ({selectedIds.size})
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Invite Cards with Selection */}
      <div className="space-y-2">
        {invites.map((invite) => (
          <div key={invite.id} className="flex items-start gap-2">
            <div className="pt-4">
              <Checkbox
                checked={selectedIds.has(invite.id)}
                onCheckedChange={() => handleToggleSelect(invite.id)}
                aria-label={`Select invite for ${invite.invited_label || invite.profiles?.display_name || "Unknown"}`}
              />
            </div>
            <div className="flex-1">
              <PendingInviteCard
                invite={invite}
                teamId={teamId}
                clubId={clubId}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {selectedIds.size} Pending Invite(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the selected pending invites. They can still join using the invite link if it hasn't expired.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? "Revoking..." : `Revoke ${selectedIds.size} Invite(s)`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
