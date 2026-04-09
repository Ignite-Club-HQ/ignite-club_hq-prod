import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface InviteOtherParentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childId: string;
  childName: string;
  teamIds: string[];
}

export default function InviteOtherParentSheet({
  open,
  onOpenChange,
  childId,
  childName,
  teamIds,
}: InviteOtherParentSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");

  const sendInvite = useMutation({
    mutationFn: async () => {
      if (!user || !parentName.trim() || !parentEmail.trim()) return;

      // Create one invite per team the child is assigned to
      // If no teams, create a club-level guardian invite
      const inviteToken = crypto.randomUUID();

      // Get the first team's club_id for context
      let clubId: string | null = null;
      let teamId: string | null = null;
      if (teamIds.length > 0) {
        teamId = teamIds[0];
        const { data: team } = await supabase
          .from("teams")
          .select("club_id")
          .eq("id", teamId)
          .single();
        clubId = team?.club_id || null;
      }

      // Create pending invite with guardian metadata (include all team IDs)
      const { data: insertedInvite, error: inviteError } = await supabase.from("pending_invites").insert({
        team_id: teamId,
        club_id: clubId,
        role: "parent" as any,
        invited_user_id: null,
        invited_by_user_id: user.id,
        invited_label: parentName.trim(),
        invited_email: parentEmail.trim().toLowerCase(),
        invite_token: inviteToken,
        metadata: {
          guardian_child_id: childId,
          guardian_child_name: childName,
          guardian_all_team_ids: teamIds,
          invited_by_parent: true,
        },
      } as any).select("id").single();

      if (inviteError) throw inviteError;

      const link = `${window.location.origin}/join/p/${inviteToken}`;

      // Send email notification
      // Get club branding for the email
      let clubName = "Your Club";
      let clubLogoUrl: string | undefined;
      let contactEmail: string | undefined;
      if (clubId) {
        const { data: club } = await supabase
          .from("clubs")
          .select("name, logo_url, contact_email")
          .eq("id", clubId)
          .single();
        if (club) {
          clubName = club.name;
          clubLogoUrl = club.logo_url || undefined;
          contactEmail = club.contact_email || undefined;
        }
      }

      // Get team name
      let teamName = "";
      if (teamId) {
        const { data: team } = await supabase
          .from("teams")
          .select("name")
          .eq("id", teamId)
          .single();
        teamName = team?.name || "";
      }

      await supabase.functions.invoke("send-email", {
        body: {
          to: parentEmail.trim().toLowerCase(),
          subject: `${clubName}: You've been invited as a guardian for ${childName} ⚽`,
          template: "team-invite",
          senderName: clubName,
          replyTo: contactEmail,
          templateData: {
            recipientName: parentName.trim(),
            invitedEmail: parentEmail.trim().toLowerCase(),
            teamName,
            clubName,
            roleName: "Parent",
            inviteLink: link,
            clubLogoUrl,
            childrenNames: [childName],
          },
        },
      });

      return { link };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child_guardians", childId] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      toast({ title: `Invite sent to ${parentName.trim()}` });
      setParentName("");
      setParentEmail("");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      console.error("[InviteOtherParent] Error:", error);
      toast({ title: "Failed to send invite", variant: "destructive" });
    },
  });

  const canSend = parentName.trim() && parentEmail.trim() && parentEmail.includes("@");

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Invite Parent for {childName}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Invite another parent or guardian. They'll be automatically linked to {childName} when they accept.
          </p>

          <div className="space-y-2">
            <Label htmlFor="parent-name">Name</Label>
            <Input
              id="parent-name"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              placeholder="Enter parent's name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="parent-email">Email</Label>
            <Input
              id="parent-email"
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              placeholder="Enter parent's email"
            />
          </div>
        </div>

        <ResponsiveDialogFooter className="mt-4">
          <Button
            className="w-full"
            onClick={() => sendInvite.mutate()}
            disabled={!canSend || sendInvite.isPending}
          >
            {sendInvite.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {canSend ? `Send Invite to ${parentName.trim()}` : "Enter name and email"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
