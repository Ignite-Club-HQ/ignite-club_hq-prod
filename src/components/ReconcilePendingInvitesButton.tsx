import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

interface PendingInviteRow {
  id: string;
  invited_user_id: string | null;
  invited_email: string | null;
  invited_label: string | null;
}

interface Props {
  invites: PendingInviteRow[];
  teamId?: string;
  clubId?: string;
}

/**
 * Admin tool to reconcile "ghost" pending invites — entries left in a pending state
 * because the user signed up with a different role than the invite was for, or because
 * their email matches but the system never auto-linked them.
 *
 * Strategy: for each pending invite, find any user who is already an active member of
 * this team/club AND matches by email (case-insensitive) or by invited_user_id.
 * If found, mark the invite as accepted and link it to that user — regardless of role.
 */
export default function ReconcilePendingInvitesButton({ invites, teamId, clubId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // Only show if there's something to potentially reconcile (has email or user_id)
  const candidates = invites.filter(i => i.invited_email || i.invited_user_id);
  if (candidates.length === 0) return null;

  const handleReconcile = async () => {
    setIsRunning(true);
    let reconciled = 0;
    let skipped = 0;

    try {
      // Get all active members for this team or club
      let activeQuery = supabase
        .from("user_roles")
        .select("user_id, profiles:user_id(id, display_name)");

      if (teamId) activeQuery = activeQuery.eq("team_id", teamId);
      else if (clubId) activeQuery = activeQuery.eq("club_id", clubId);
      else {
        toast({ title: "Cannot reconcile", description: "Missing team or club context", variant: "destructive" });
        setIsRunning(false);
        return;
      }

      const { data: activeMembers } = await activeQuery;
      const activeUserIds = new Set((activeMembers || []).map(m => m.user_id));

      if (activeUserIds.size === 0) {
        toast({ title: "No active members found to match against" });
        setIsRunning(false);
        setIsOpen(false);
        return;
      }

      // Resolve emails for active members via auth lookup is not possible from client.
      // Instead, look up by invited_user_id directly, and for invited_email match
      // against profiles -> we need a server-side lookup. Use a single RPC-style
      // approach: fetch profiles for active users and match by their email field
      // (we'll fall back to invited_user_id match only if email lookup is unavailable).
      const { data: activeProfiles } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", Array.from(activeUserIds));

      const emailToUserId = new Map<string, string>();
      for (const p of activeProfiles || []) {
        const e = (p as any).email?.toLowerCase?.().trim();
        if (e) emailToUserId.set(e, p.id);
      }

      for (const inv of candidates) {
        let matchedUserId: string | null = null;

        if (inv.invited_user_id && activeUserIds.has(inv.invited_user_id)) {
          matchedUserId = inv.invited_user_id;
        } else if (inv.invited_email) {
          const e = inv.invited_email.toLowerCase().trim();
          const uid = emailToUserId.get(e);
          if (uid) matchedUserId = uid;
        }

        if (!matchedUserId) {
          skipped++;
          continue;
        }

        const { error: updErr } = await supabase
          .from("pending_invites")
          .update({
            status: "accepted",
            accepted_at: new Date().toISOString(),
            invited_user_id: matchedUserId,
          })
          .eq("id", inv.id);

        if (updErr) {
          skipped++;
          continue;
        }
        reconciled++;
      }

      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, clubId] });
      queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });

      if (reconciled === 0) {
        toast({
          title: "Nothing to reconcile",
          description: `No pending invites matched an existing active member (${skipped} checked).`,
        });
      } else {
        toast({
          title: `Reconciled ${reconciled} invite${reconciled !== 1 ? "s" : ""}`,
          description: skipped > 0 ? `${skipped} could not be matched and remain pending.` : undefined,
        });
      }
    } catch (err: any) {
      toast({
        title: "Reconcile failed",
        description: err?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
      setIsOpen(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        disabled={isRunning}
        className="h-7 text-xs gap-1.5"
        title="Match pending invites to active members by email and clear them"
      >
        {isRunning ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Wand2 className="h-3 w-3" />
        )}
        Reconcile
      </Button>

      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconcile pending invites?</AlertDialogTitle>
            <AlertDialogDescription>
              This will scan {candidates.length} pending invite{candidates.length !== 1 ? "s" : ""} and
              mark any as accepted where the invited person is already an active member of this
              {teamId ? " team" : " club"} (matched by email). This is useful for cleaning up "ghost"
              pending invites left behind when someone signed up with a different role than was
              originally invited.
              <br /><br />
              Roles are not changed — only the pending invite status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReconcile} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Reconciling...
                </>
              ) : (
                "Reconcile"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
