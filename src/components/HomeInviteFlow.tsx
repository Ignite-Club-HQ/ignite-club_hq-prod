import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import AddTeamMemberSheet from "@/components/AddTeamMemberSheet";

interface HomeInviteFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function HomeInviteFlow({ open, onOpenChange }: HomeInviteFlowProps) {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);

  const { data: teams = [] } = useQuery({
    queryKey: ["home-invite-teams", user?.id, activeClubFilter],
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
        .select("id, name, club_id, clubs(id, name)")
        .in("id", teamIds);

      if (!teamData) return [];
      return teamData
        .filter(t => !activeClubFilter || t.club_id === activeClubFilter)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  // Auto-select if only one team
  useEffect(() => {
    if (teams.length === 1 && open && !selectedTeamId) {
      const team = teams[0];
      setSelectedTeamId(team.id);
      // Immediately open the invite sheet
      onOpenChange(false);
      setInviteSheetOpen(true);
    }
  }, [teams, open, selectedTeamId]);

  const handleTeamSelect = (teamId: string) => {
    setSelectedTeamId(teamId);
    onOpenChange(false);
    setInviteSheetOpen(true);
  };

  const handleInviteSheetChange = (isOpen: boolean) => {
    setInviteSheetOpen(isOpen);
    if (!isOpen) {
      setSelectedTeamId(null);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setSelectedTeamId(null);
    }
    onOpenChange(v);
  };

  const selectedTeam = teams.find(t => t.id === selectedTeamId);

  return (
    <>
      {/* Team picker dialog — only shown when multiple teams */}
      {teams.length > 1 && (
        <ResponsiveDialog open={open} onOpenChange={handleClose}>
          <ResponsiveDialogContent className="max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Invite to Team
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Choose a team to invite someone to.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            <div className="pt-2">
              <MobileCardSelect
                value=""
                onValueChange={handleTeamSelect}
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
            </div>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}

      {/* AddTeamMemberSheet — the full invite flow with name capture */}
      {selectedTeam && (
        <AddTeamMemberSheet
          teamId={selectedTeam.id}
          teamName={selectedTeam.name}
          clubId={selectedTeam.club_id || (selectedTeam.clubs as any)?.id || ""}
          triggerVariant="none"
          externalOpen={inviteSheetOpen}
          onExternalOpenChange={handleInviteSheetChange}
        />
      )}
    </>
  );
}
