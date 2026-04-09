import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Link2, Loader2, Share2, UserPlus } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Button } from "@/components/ui/button";
import { MobileCardSelect } from "@/components/MobileCardSelect";
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
import { useClubTheme } from "@/hooks/useClubTheme";

interface MemberInviteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MemberInviteSheet({ open, onOpenChange }: MemberInviteSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { activeClubFilter } = useClubTheme();
  const [selectedTeam, setSelectedTeam] = useState("");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [clubName, setClubName] = useState("");

  const { data: teams = [] } = useQuery({
    queryKey: ["member-invite-teams", user?.id, activeClubFilter],
    enabled: !!user && open,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .not("team_id", "is", null);

      if (!roles || roles.length === 0) return [];
      const teamIds = [...new Set(roles.map(r => r.team_id).filter(Boolean))] as string[];

      const { data: teamData } = await supabase
        .from("teams")
        .select("id, name, club_id, clubs(name)")
        .in("id", teamIds);

      if (!teamData) return [];
      return teamData
        .filter(t => !activeClubFilter || t.club_id === activeClubFilter)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  if (teams.length === 1 && !selectedTeam) {
    setSelectedTeam(teams[0].id);
  }

  const generateLink = useMutation({
    mutationFn: async () => {
      if (!user || !selectedTeam) return;

      const team = teams.find(t => t.id === selectedTeam);
      if (!team) return;

      setTeamName(team.name);
      setClubName((team.clubs as any)?.name || "");

      // Secure RPC: any team member can get/create a player invite token
      const { data: token, error } = await supabase
        .rpc("get_or_create_member_invite_token", { p_team_id: selectedTeam });
      if (error || !token) throw error || new Error("No token returned");

      const link = `https://igniteclubhq.app/join/${token}`;
      setGeneratedLink(link);
    },
    onError: (error: Error) => {
      console.error("[MemberInvite] Error:", error);
      toast({ title: "Failed to generate link", variant: "destructive" });
    },
  });

  const handleShare = async () => {
    if (!generatedLink) return;
    const msg = `Join ${teamName}${clubName ? ` at ${clubName}` : ""}! Tap here: ${generatedLink}\n\n📲 Download "Ignite Club HQ" from the App Store or Google Play to get started.`;

    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({ title: `Join ${clubName || teamName}`, text: msg, dialogTitle: "Share invite" });
        return;
      } catch { /* cancelled */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handleCopy = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      toast({ title: "Link copied!" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setGeneratedLink(null);
      setSelectedTeam(teams.length === 1 ? teams[0]?.id || "" : "");
    }
    onOpenChange(v);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleClose}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Invite to Team
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Share a join link — they'll be added to the team when they sign up.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {!generatedLink ? (
          <div className="space-y-4 pt-2">
            {teams.length > 1 && (
              <MobileCardSelect
                value={selectedTeam}
                onValueChange={setSelectedTeam}
                options={teams.map(t => ({
                  value: t.id,
                  label: activeClubFilter ? t.name : `${t.name} (${(t.clubs as any)?.name || ""})`,
                }))}
                label="Select Team"
                placeholder="Choose a team..."
                searchable={teams.length > 5}
                searchPlaceholder="Search teams..."
                emptyMessage="No teams found."
              />
            )}

            {teams.length === 1 && (
              <div className="text-sm text-muted-foreground">
                Team: <span className="font-medium text-foreground">{teams[0].name}</span>
              </div>
            )}

            <ResponsiveDialogFooter>
              <Button
                className="w-full"
                onClick={() => generateLink.mutate()}
                disabled={!selectedTeam || generateLink.isPending}
              >
                {generateLink.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Get Invite Link
              </Button>
            </ResponsiveDialogFooter>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
              <p className="font-medium mb-1">{teamName}</p>
              <p className="text-xs text-muted-foreground break-all select-all">{generatedLink}</p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" />
                Copy Link
              </Button>
            </div>
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
