import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Trash2, Send, Loader2 } from "lucide-react";
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

  // Fetch team name for notifications
  const { data: teamData } = useQuery({
    queryKey: ["team-name", teamId],
    queryFn: async () => {
      if (!teamId) return null;
      const { data } = await supabase
        .from("teams")
        .select("name")
        .eq("id", teamId)
        .single();
      return data;
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 10,
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
    const pushUsersToNotify: { userId: string; name: string; link: string; role: string }[] = [];
    
    selectedInvites.forEach(inv => {
      const link = inviteLinks[inv.role];
      if (link) {
        if (!linksToShare.includes(link)) {
          linksToShare.push(link);
        }
        // Collect email recipients
        if (inv.invited_email) {
          emailsToSend.push({
            email: inv.invited_email,
            name: inv.invited_label || "Member",
            link,
            role: inv.role,
          });
        }
        // Collect push notification recipients (existing app users)
        if (inv.invited_user_id) {
          pushUsersToNotify.push({
            userId: inv.invited_user_id,
            name: inv.invited_label || inv.profiles?.display_name || "Member",
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

    setIsSendingNotifications(true);
    let emailSuccessCount = 0;
    let pushSuccessCount = 0;
    const teamName = teamData?.name || "the team";

    // Send email notifications for invites with emails
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
              <p><a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #f97316; color: white; text-decoration: none; border-radius: 6px;">Accept Invitation</a></p>
              <p>Or copy this link: ${link}</p>
            `,
          },
        });
        emailSuccessCount++;
      } catch (error) {
        console.error("Failed to send email to", email, error);
      }
    }

    // Send push notifications and in-app notifications for existing app users
    for (const { userId, name, link, role } of pushUsersToNotify) {
      try {
        // Create in-app notification
        const { data: notification, error: notifError } = await supabase
          .from("notifications")
          .insert({
            user_id: userId,
            type: "invite_reminder",
            message: `Reminder: You've been invited to join ${teamName} as ${role}. Accept your invitation!`,
            related_id: teamId,
          })
          .select()
          .single();

        if (notifError) {
          console.error("Failed to create notification for", userId, notifError);
          continue;
        }

        // Send push notification
        await supabase.functions.invoke("send-push-notification", {
          body: {
            userId,
            title: "📬 Invitation Reminder",
            body: `You've been invited to join ${teamName} as ${role}. Tap to view!`,
            url: "/notifications",
            notificationId: notification?.id,
            tag: `invite-reminder-${notification?.id}`,
          },
        });

        pushSuccessCount++;
      } catch (error) {
        console.error("Failed to send push notification to", userId, error);
      }
    }

    setIsSendingNotifications(false);

    // Build success message
    const messages: string[] = [];
    if (emailSuccessCount > 0) {
      messages.push(`${emailSuccessCount} email${emailSuccessCount > 1 ? "s" : ""} sent`);
    }
    if (pushSuccessCount > 0) {
      messages.push(`${pushSuccessCount} push notification${pushSuccessCount > 1 ? "s" : ""} sent`);
    }

    // Copy links to clipboard
    try {
      await navigator.clipboard.writeText(linksToShare.join("\n"));
      messages.push(`${linksToShare.length} link${linksToShare.length > 1 ? "s" : ""} copied`);
    } catch (err) {
      console.error("Failed to copy links:", err);
    }

    if (messages.length > 0) {
      toast({ 
        title: "Invites resent!", 
        description: messages.join(", ")
      });
    }
    
    setSelectedIds(new Set());
  };

  if (invites.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Bulk Actions Bar */}
      <Card className="p-3 flex items-center justify-between bg-muted/50">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={selectedIds.size === invites.length && invites.length > 0}
            onCheckedChange={handleSelectAll}
            aria-label="Select all pending invites"
          />
          <span className="text-sm text-muted-foreground">
            {selectedIds.size > 0 
              ? `${selectedIds.size} selected` 
              : `${invites.length} pending invite${invites.length !== 1 ? "s" : ""}`}
          </span>
        </div>
        
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkResend}
              disabled={isSendingNotifications}
            >
              {isSendingNotifications ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1.5" />
              )}
              Resend
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setShowBulkDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Revoke
            </Button>
          </div>
        )}
      </Card>

      {/* Individual Invite Cards */}
      {invites.map((invite) => (
        <div key={invite.id} className="flex items-start gap-2">
          <div className="pt-4">
            <Checkbox
              checked={selectedIds.has(invite.id)}
              onCheckedChange={() => handleToggleSelect(invite.id)}
              aria-label={`Select invite for ${invite.invited_label || invite.profiles?.display_name || "pending member"}`}
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

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {selectedIds.size} invite{selectedIds.size > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the selected pending invites. The invited members will no longer be able to join using their existing invite.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
