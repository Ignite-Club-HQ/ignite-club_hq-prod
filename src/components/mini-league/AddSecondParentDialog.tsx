import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { Database, Json } from "@/integrations/supabase/types";

interface AddSecondParentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerId: string;
  playerName: string;
  childId: string | null;
  miniLeagueId: string;
  miniLeagueName: string;
  clubId: string;
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AddSecondParentDialog({
  open,
  onOpenChange,
  playerId,
  playerName,
  childId,
  miniLeagueId,
  miniLeagueName,
  clubId,
}: AddSecondParentDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");

  const reset = () => {
    setParentName("");
    setParentEmail("");
  };

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = parentName.trim();
      const trimmedEmail = parentEmail.trim().toLowerCase();
      if (!trimmedName) throw new Error("Enter the parent's name");
      if (!emailRe.test(trimmedEmail)) throw new Error("Enter a valid email");
      if (!user?.id) throw new Error("Not signed in");

      // Reuse existing child if linked; otherwise create one so the second
      // parent has a child row to attach to when they accept.
      let resolvedChildId = childId;
      if (!resolvedChildId) {
        const newChildId = crypto.randomUUID();
        const { error: childError } = await supabase.from("children").insert({
          id: newChildId,
          parent_id: null,
          name: playerName,
        });
        if (childError) throw new Error(`Couldn't prepare child record: ${childError.message}`);
        resolvedChildId = newChildId;

        // Link the player to this child so future accepts merge correctly.
        await supabase
          .from("mini_league_players")
          .update({ child_id: newChildId })
          .eq("id", playerId);
      }

      const inviteToken = crypto.randomUUID();
      const inviteMetadata: Json = {
        mini_league_id: miniLeagueId,
        child_id: resolvedChildId,
        player_id: playerId,
        player_name: playerName,
        children: [{ name: playerName, yearOfBirth: null }],
        is_additional_guardian: true,
      };

      const invitePayload: Database["public"]["Tables"]["pending_invites"]["Insert"] = {
        club_id: clubId,
        role: "parent",
        invited_user_id: null,
        invited_by_user_id: user.id,
        invited_label: trimmedName,
        invited_email: trimmedEmail,
        invite_token: inviteToken,
        metadata: inviteMetadata,
      };

      const { error: inviteError } = await supabase.from("pending_invites").insert(invitePayload);
      if (inviteError) throw new Error(inviteError.message);

      // Pull branding for the email
      const { data: clubBranding } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email")
        .eq("id", clubId)
        .maybeSingle();

      const link = `${window.location.origin}/join/p/${inviteToken}`;
      const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
        body: {
          to: trimmedEmail,
          subject: `You're invited to ${miniLeagueName}`,
          template: "team-invite",
          senderName: clubBranding?.name || undefined,
          replyTo: clubBranding?.contact_email || undefined,
          templateData: {
            recipientName: trimmedName,
            teamName: miniLeagueName,
            clubName: clubBranding?.name || "The Club",
            roleName: "Parent",
            inviteLink: link,
            clubLogoUrl: clubBranding?.logo_url || undefined,
            childrenNames: [playerName],
            isMiniLeague: true,
          },
        },
      });

      const sent = !funcError && emailResult?.verified && emailResult?.success;
      await supabase
        .from("pending_invites")
        .update({
          email_sent_at: sent ? new Date().toISOString() : null,
          email_id: emailResult?.emailId || null,
          email_error: funcError?.message || (!sent ? "Email not verified" : null),
        })
        .eq("invite_token", inviteToken);

      return sent;
    },
    onSuccess: (sent) => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      toast.success(sent ? "Invite sent to second parent" : "Invite created (email pending)");
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Invite Second Parent
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Send an invite to a second parent or guardian for <span className="font-medium">{playerName}</span>.
            They'll be linked as an additional guardian when they join.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-3 px-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="second-parent-name">Parent name</Label>
            <Input
              id="second-parent-name"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              placeholder="Jane Smith"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="second-parent-email">Parent email</Label>
            <Input
              id="second-parent-email"
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              placeholder="jane@example.com"
              autoComplete="off"
            />
          </div>
        </div>

        <ResponsiveDialogFooter className="px-4 pb-safe gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={inviteMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending}>
            {inviteMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4 mr-1.5" />
            )}
            Send Invite
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
