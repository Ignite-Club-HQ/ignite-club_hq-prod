import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "invite_welcome_shown";

const roleLabels: Record<string, string> = {
  basic_user: "Basic User",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App Admin",
  league_admin: "League Admin",
  committee_member: "Committee Member",
};

export function PendingInviteWelcomeDialog() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Only show once per session
  const sessionKey = user ? `${STORAGE_KEY}_${user.id}` : null;

  const { data: pendingInvites = [], isLoading } = useQuery({
    queryKey: ["pending-invites-for-user", user?.id],
    queryFn: async () => {
      if (!user) return [];
      // Fetch pending invites where the current user is the invited user
      const { data, error } = await supabase
        .from("pending_invites")
        .select(`
          id,
          role,
          invite_token,
          team_id,
          club_id,
          invited_label,
          teams:team_id (
            name,
            logo_url,
            clubs:club_id (
              name,
              logo_url
            )
          ),
          clubs:club_id (
            name,
            logo_url
          )
        `)
        .eq("invited_user_id", user.id)
        .eq("status", "pending")
        .limit(5);

      if (error) {
        console.error("[InviteWelcome] Error fetching invites:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!user && !dismissed,
    staleTime: 0,
  });

  useEffect(() => {
    if (!user || !sessionKey) return;
    // Only show once per session
    const alreadyShown = sessionStorage.getItem(sessionKey);
    if (alreadyShown) return;

    if (!isLoading && pendingInvites.length > 0) {
      // Small delay to let the page settle after login
      const timer = setTimeout(() => {
        setOpen(true);
        sessionStorage.setItem(sessionKey, "true");
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [user, sessionKey, isLoading, pendingInvites.length]);

  const handleAccept = (invite: any) => {
    setOpen(false);
    // Navigate to join page with the invite token
    if (invite.invite_token) {
      navigate(`/join/p/${invite.invite_token}`);
    }
  };

  const handleAcceptAll = async () => {
    if (pendingInvites.length === 1) {
      handleAccept(pendingInvites[0]);
      return;
    }
    // For multiple invites, navigate to first one — they can accept others via notifications
    handleAccept(pendingInvites[0]);
  };

  const handleDismiss = () => {
    setOpen(false);
    setDismissed(true);
  };

  if (!user || pendingInvites.length === 0) return null;

  const invite = pendingInvites[0];
  const teamName = (invite.teams as any)?.name;
  const clubName = (invite.teams as any)?.clubs?.name || (invite.clubs as any)?.name;
  const logoUrl = (invite.teams as any)?.logo_url || (invite.teams as any)?.clubs?.logo_url || (invite.clubs as any)?.logo_url;
  const entityName = teamName || clubName || "a team";
  const roleName = roleLabels[invite.role] || invite.role;
  const hasMultiple = pendingInvites.length > 1;

  return (
    <ResponsiveDialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <ResponsiveDialogContent className="max-w-sm">
        <ResponsiveDialogHeader>
          <div className="flex flex-col items-center gap-3 pt-2">
            <Avatar className="h-16 w-16">
              <AvatarImage src={logoUrl} alt={entityName} />
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                <Users className="h-8 w-8" />
              </AvatarFallback>
            </Avatar>
            <ResponsiveDialogTitle className="text-center">
              You've been invited! 🎉
            </ResponsiveDialogTitle>
          </div>
          <ResponsiveDialogDescription className="text-center">
            {hasMultiple ? (
              <>You have <strong>{pendingInvites.length} pending invitations</strong>. Your first invite is to join <strong>{entityName}</strong> as a <strong>{roleName}</strong>.</>
            ) : (
              <>{clubName && teamName ? <><strong>{clubName}</strong> has invited</> : <>You've been invited</>} you to join <strong>{entityName}</strong> as a <strong>{roleName}</strong>.</>
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {hasMultiple && (
          <div className="px-1">
            <p className="text-xs text-muted-foreground text-center mb-2">All pending invitations:</p>
            <div className="flex flex-col gap-1">
              {pendingInvites.map((inv: any) => {
                const tName = inv.teams?.name;
                const cName = inv.teams?.clubs?.name || inv.clubs?.name;
                return (
                  <div key={inv.id} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2 text-sm">
                    <span className="font-medium">{tName || cName || "Invite"}</span>
                    <Badge variant="secondary" className="text-xs">{roleLabels[inv.role] || inv.role}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            className="w-full"
            onClick={handleAcceptAll}
            disabled={!!acceptingId}
          >
            {acceptingId ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Accepting...</>
            ) : (
              hasMultiple ? `Accept First Invite` : `Accept Invitation`
            )}
          </Button>
          <Button variant="ghost" className="w-full" onClick={handleDismiss}>
            I'll do this later
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
