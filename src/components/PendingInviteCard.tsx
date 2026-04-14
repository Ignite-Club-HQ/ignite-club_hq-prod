import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, X, UserCheck, Send, MoreHorizontal, Trash2, Check, Pencil, Mail, MailX, AlertCircle, Loader2, Copy, Share2, ArrowRightLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Capacitor } from "@capacitor/core";

import { Share } from "@capacitor/share";
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
  isAdmin?: boolean;
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

export default function PendingInviteCard({ invite, teamId, clubId, isAdmin = true }: PendingInviteCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  const [selectedMoveTeamId, setSelectedMoveTeamId] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [editName, setEditName] = useState(invite.invited_label || "");
  const [editRole, setEditRole] = useState<AppRole>(invite.role as AppRole);
  const [isResending, setIsResending] = useState(false);

  // Fetch team name and club branding for resend email
  const { data: teamData } = useQuery({
    queryKey: ["team-name", teamId],
    queryFn: async () => {
      if (!teamId) return null;
      const { data } = await supabase
        .from("teams")
        .select("name, club_id, clubs(name, logo_url, contact_email)")
        .eq("id", teamId)
        .single();
      return data;
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch club branding for club invites
  const { data: clubData } = useQuery({
    queryKey: ["club-branding-invite", clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email")
        .eq("id", clubId)
        .single();
      return data;
    },
    enabled: !!clubId && !teamId,
    staleTime: 1000 * 60 * 5,
  });

  // Get the pending invite token and metadata for resending
  const { data: pendingInviteData } = useQuery({
    queryKey: ["pending-invite-token", invite.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("pending_invites")
        .select("invite_token, metadata, short_code")
        .eq("id", invite.id)
        .single();
      return data;
    },
    enabled: !!invite.id,
    staleTime: 1000 * 60 * 5,
  });

  const pendingInviteToken = pendingInviteData?.invite_token;
  const pendingShortCode = (pendingInviteData as any)?.short_code as string | null;
  const inviteMetadata = pendingInviteData?.metadata as { children?: { name: string }[]; customMessage?: string } | null;

  // Use short URL for sharing, full URL for emails/internal
  const inviteLink = pendingInviteToken ? `https://igniteclubhq.app/join/p/${pendingInviteToken}` : null;
  const shareLink = pendingShortCode 
    ? `https://igniteclubhq.app/j/${pendingShortCode}` 
    : inviteLink;

  const handleCopyLink = async () => {
    if (!inviteLink) {
      toast({ title: "No invite link available", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({ title: "Invite link copied!" });
    } catch {
      toast({ title: "Failed to copy link", variant: "destructive" });
    }
  };

  const buildShareMessage = () => {
    const clubName = teamData?.clubs?.name || clubData?.name || "";
    const teamName = teamData?.name || "";
    const childrenNames = inviteMetadata?.children?.map(c => c.name?.trim()).filter(Boolean) || [];
    const isAdminRole = ['club_admin', 'committee_member', 'coach', 'team_admin'].includes(invite.role);
    const roleName = roleLabels[invite.role] || invite.role.replace("_", " ");
    const email = invite.invited_email;
    const appDownload = `\n\n📲 Download "Ignite Club HQ" from the App Store or Google Play to get started.`;
    const emailNote = email
      ? `\n\nSign up with ${email} so your account links automatically.`
      : "";

    const link = shareLink;

    // Admin/Coach invite to a team
    if (isAdminRole && teamName) {
      return `You've been invited to join ${teamName}${clubName ? ` at ${clubName}` : ""} as ${roleName}. Tap here to get started: ${link}${appDownload}${emailNote}`;
    }

    // Admin invite to a club (no team)
    if (isAdminRole && clubName) {
      return `You've been invited to help run ${clubName} as ${roleName}. Tap here to get started: ${link}${appDownload}${emailNote}`;
    }

    // Parent invite with children
    if (invite.role === "parent" && childrenNames.length === 1) {
      return `${childrenNames[0]} has been added to ${teamName || clubName || "the team"}${clubName && teamName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`;
    }
    if (invite.role === "parent" && childrenNames.length > 1) {
      return `Your kids (${childrenNames.join(", ")}) have been added to ${teamName || clubName || "the team"}${clubName && teamName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`;
    }

    // Parent invite without children names
    if (invite.role === "parent" && teamName) {
      return `Your child has been added to ${teamName}${clubName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`;
    }

    // Generic team invite
    if (teamName) {
      return `You've been added to ${teamName}${clubName ? ` at ${clubName}` : ""}! Tap here to join: ${link}${appDownload}${emailNote}`;
    }

    // Generic club invite
    if (clubName) {
      return `You've been invited to join ${clubName}! Tap here to get started: ${link}${appDownload}${emailNote}`;
    }

    return `You've been invited to join the team! Tap here to get started: ${link}${appDownload}${emailNote}`;
  };

  const handleShareInvite = async () => {
    if (!inviteLink) {
      toast({ title: "No invite link available", variant: "destructive" });
      return;
    }
    const clubName = teamData?.clubs?.name || clubData?.name || "the club";
    const message = buildShareMessage().trim();

    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({
          title: `Join ${clubName}`,
          text: message,
          dialogTitle: `Join ${clubName}`,
        });
        return;
      } catch {
        // User cancelled or share failed, fall through to WhatsApp
      }
    }

    // Fallback: open WhatsApp
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("pending_invites")
        .delete()
        .eq("id", invite.id);
      if (error) throw error;
    },
    onMutate: async () => {
      // Cancel any outgoing refetches - use broad pattern to match all pending-invites queries
      await queryClient.cancelQueries({ queryKey: ["pending-invites"] });
      
      // Snapshot and optimistically update all matching queries
      const queryCache = queryClient.getQueryCache();
      const pendingInviteQueries = queryCache.findAll({ queryKey: ["pending-invites"] });
      
      const previousData: { queryKey: any; data: any }[] = [];
      pendingInviteQueries.forEach((query) => {
        const data = query.state.data;
        previousData.push({ queryKey: query.queryKey, data });
        
        // Optimistically remove the invite from this query
        if (Array.isArray(data)) {
          queryClient.setQueryData(query.queryKey, data.filter((inv: any) => inv.id !== invite.id));
        }
      });
      
      return { previousData };
    },
    onSuccess: () => {
      toast({ title: "Pending invite revoked" });
      setShowDeleteDialog(false);
    },
    onError: (error, _, context) => {
      // Rollback all queries to their previous values on error
      if (context?.previousData) {
        context.previousData.forEach(({ queryKey, data }) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast({ title: "Failed to revoke invite", variant: "destructive" });
    },
    onSettled: () => {
      // Refetch all pending-invites queries to ensure consistency
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
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
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      toast({ title: "Pending invite updated" });
      setShowEditDialog(false);
    },
    onError: () => {
      toast({ title: "Failed to update invite", variant: "destructive" });
    },
  });

  // Handle resend email
  const handleResendEmail = async (overrideEmail?: string) => {
    let targetEmail = overrideEmail || invite.invited_email;
    
    // Always refetch the latest stored email if it's missing from props
    if (!targetEmail) {
      const { data: freshInvite } = await supabase
        .from("pending_invites")
        .select("invited_email")
        .eq("id", invite.id)
        .maybeSingle();
      if (freshInvite?.invited_email) {
        targetEmail = freshInvite.invited_email;
      }
    }
    
    if (!targetEmail) {
      // No email — open the email input dialog
      setEmailInput("");
      setShowEmailDialog(true);
      return;
    }

    if (!pendingInviteToken) {
      toast({ 
        title: "No invite token", 
        description: "Could not find invite token for resending",
        variant: "destructive" 
      });
      return;
    }

    setIsResending(true);
    
    try {
      // If we're adding an email for the first time, save it to the invite
      if (overrideEmail && !invite.invited_email) {
        await supabase
          .from("pending_invites")
          .update({ invited_email: overrideEmail.trim().toLowerCase() } as any)
          .eq("id", invite.id);
      }

      const inviteLinkForEmail = `${window.location.origin}/join/p/${pendingInviteToken}`;
      const recipientName = invite.invited_label || invite.profiles?.display_name || "Member";
      
      // Determine team/club names for email
      const teamName = teamData?.name || clubData?.name || "the team";
      const clubName = teamData?.clubs?.name || clubData?.name || "The Club";
      const clubLogoUrl = teamData?.clubs?.logo_url || clubData?.logo_url || undefined;
      const clubContactEmail = (teamData?.clubs as any)?.contact_email || (clubData as any)?.contact_email || undefined;
      
      // Extract children names from invite metadata for parent invites
      const childrenNames = invite.role === "parent" && inviteMetadata?.children
        ? inviteMetadata.children.map(c => c.name)
        : undefined;

      const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
        body: {
          to: targetEmail.trim().toLowerCase(),
           subject: childrenNames && childrenNames.length === 1
             ? `Reminder: ${clubName} — see which team ${childrenNames[0]} is in ⚽`
             : childrenNames && childrenNames.length > 1
               ? `Reminder: ${clubName} — see which team your kids are in ⚽`
               : `Reminder: ${clubName} — you've been added to the team ⚽`,
          template: "team-invite",
          senderName: clubName !== "The Club" ? clubName : undefined,
          replyTo: clubContactEmail,
          templateData: {
            recipientName,
            invitedEmail: targetEmail.trim().toLowerCase(),
            teamName,
            clubName,
            roleName: roleLabels[invite.role] || invite.role.replace("_", " "),
            inviteLink: inviteLinkForEmail,
            clubLogoUrl,
            childrenNames,
            customMessage: inviteMetadata?.customMessage,
          },
        },
      });

      if (funcError) {
        throw new Error(funcError.message || "Failed to send email");
      }

      if (emailResult?.verified && emailResult?.success) {
        // Update pending invite with email status
        await supabase
          .from("pending_invites")
          .update({
            email_sent_at: new Date().toISOString(),
            email_id: emailResult.emailId,
            email_error: null,
          } as any)
          .eq("id", invite.id);

        queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
        
        toast({ 
          title: "Email sent!", 
          description: `Invite email sent to ${targetEmail}` 
        });
        setShowEmailDialog(false);
      } else {
        throw new Error(emailResult?.error || "Email not verified");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Update pending invite with error
      await supabase
        .from("pending_invites")
        .update({
          email_error: errorMessage,
        } as any)
        .eq("id", invite.id);

      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      
      toast({ 
        title: "Failed to send email", 
        description: errorMessage,
        variant: "destructive" 
      });
    } finally {
      setIsResending(false);
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
      <Card
        className="border-2 border-dashed border-orange-500/40 bg-gradient-to-r from-orange-500/5 to-amber-500/5"
      >
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
            {isAdmin && invite.invited_email && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-0.5 group"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(invite.invited_email!);
                  toast({ title: "Email copied", description: invite.invited_email });
                }}
              >
                <span className="truncate max-w-[180px]">{invite.invited_email}</span>
                <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            )}
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              <Badge variant="outline" className={`${roleColor} text-xs`}>
                {roleLabel}
              </Badge>
              <Badge className="bg-orange-500/90 hover:bg-orange-500 text-white text-xs font-medium px-2">
                <Clock className="h-3 w-3 mr-1" />
                Pending
              </Badge>
              {/* Email status indicator - only for admins */}
              {isAdmin && invite.invited_email && (
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

          {/* Action menu - always visible for admins */}
          {isAdmin && (
            <div className="flex items-center gap-1 shrink-0">
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {inviteLink && (
                    <>
                      <DropdownMenuItem onClick={handleCopyLink}>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy invite link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleShareInvite}>
                        <Share2 className="h-4 w-4 mr-2" />
                        Share invite link
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={handleOpenEdit}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit name/role
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => handleResendEmail()} 
                    disabled={isResending}
                  >
                    {isResending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4 mr-2" />
                    )}
                    {!invite.invited_email ? "Send email" : invite.email_sent_at && !invite.email_error ? "Resend email" : "Send email"}
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
          )}
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

      {/* Email input dialog for invites without email */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Invite Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Enter an email address for <strong>{displayName}</strong> to send the invite email.
            </p>
            <div className="space-y-2">
              <Label htmlFor="invite-email-input">Email</Label>
              <Input
                id="invite-email-input"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="Enter email address"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleResendEmail(emailInput.trim())}
              disabled={!emailInput.trim() || !emailInput.includes("@") || isResending}
            >
              {isResending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Email
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
