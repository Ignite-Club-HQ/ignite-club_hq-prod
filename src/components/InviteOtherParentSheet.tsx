import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, UserPlus, Mail, User, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
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
  const [sent, setSent] = useState(false);

  const sendInvite = useMutation({
    mutationFn: async () => {
      if (!user || !parentName.trim() || !parentEmail.trim()) return;

      const inviteToken = crypto.randomUUID();

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

      if (insertedInvite?.id) {
        await supabase
          .from("pending_invites")
          .update({
            email_sent_at: new Date().toISOString(),
          } as any)
          .eq("id", insertedInvite.id);
      }

      return { link };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child_guardians", childId] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      setSent(true);
    },
    onError: (error: Error) => {
      console.error("[InviteOtherParent] Error:", error);
      toast({ title: "Failed to send invite", variant: "destructive" });
    },
  });

  const handleClose = (open: boolean) => {
    if (!open) {
      setTimeout(() => {
        setParentName("");
        setParentEmail("");
        setSent(false);
      }, 300);
    }
    onOpenChange(open);
  };

  const canSend = parentName.trim() && parentEmail.trim() && parentEmail.includes("@");

  return (
    <ResponsiveDialog open={open} onOpenChange={handleClose}>
      <ResponsiveDialogContent className="max-w-md">
        {sent ? (
          <>
            <ResponsiveDialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <ResponsiveDialogTitle>Invite Sent!</ResponsiveDialogTitle>
                  <ResponsiveDialogDescription>
                    Guardian invite for {childName}
                  </ResponsiveDialogDescription>
                </div>
              </div>
            </ResponsiveDialogHeader>

            <div className="space-y-4 py-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
                <p className="font-medium mb-1">{parentName}</p>
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  Invite sent to {parentEmail}
                </p>
              </div>

              <p className="text-sm text-muted-foreground text-center">
                When they accept, they'll be automatically linked to <strong>{childName}</strong> as a guardian.
              </p>
            </div>

            <ResponsiveDialogFooter>
              <Button onClick={() => handleClose(false)} className="w-full">
                Done
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : (
          <>
            <ResponsiveDialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <UserPlus className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <ResponsiveDialogTitle>Invite Parent</ResponsiveDialogTitle>
                  <ResponsiveDialogDescription>
                    Guardian for {childName}
                  </ResponsiveDialogDescription>
                </div>
              </div>
            </ResponsiveDialogHeader>

            <div className="space-y-4 py-2">
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={parentName}
                  onChange={(e) => setParentName(e.target.value)}
                  placeholder="Parent's name"
                  className="pl-10"
                />
              </div>

              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  value={parentEmail}
                  onChange={(e) => setParentEmail(e.target.value)}
                  placeholder="Parent's email"
                  className="pl-10"
                />
              </div>
            </div>

            <ResponsiveDialogFooter className="mt-2">
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
                {canSend ? "Send Invite" : "Enter name and email"}
              </Button>
            </ResponsiveDialogFooter>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
