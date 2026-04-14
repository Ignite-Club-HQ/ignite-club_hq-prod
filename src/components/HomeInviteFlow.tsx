import { useState, useEffect, useMemo } from "react";
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
import { getCachedRoles } from "@/lib/rolesCache";
import AddTeamMemberSheet from "@/components/AddTeamMemberSheet";

interface HomeInviteFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function HomeInviteFlow({ open, onOpenChange }: HomeInviteFlowProps) {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);

  // Effective club filter: use activeClubFilter if set, otherwise the manually selected club
  const effectiveClubId = activeClubFilter || selectedClubId;

  const { data: teamsAndClubs } = useQuery({
    queryKey: ["home-invite-teams-clubs", user?.id],
    enabled: !!user && open,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, club_id")
        .eq("user_id", user!.id);

      if (!roles || roles.length === 0) return { teams: [], clubs: [] };

      // Get unique club IDs from ALL roles (not just team-based ones)
      const allClubIds = [...new Set(roles.map(r => r.club_id).filter(Boolean))] as string[];

      // Get teams
      const teamIds = [...new Set(roles.map(r => r.team_id).filter(Boolean))] as string[];

      let teams: any[] = [];
      let clubs: any[] = [];

      if (teamIds.length > 0) {
        const { data } = await supabase
          .from("teams")
          .select("id, name, club_id, clubs(id, name)")
          .in("id", teamIds);
        teams = (data || []).sort((a: any, b: any) => a.name.localeCompare(b.name));
      }

      if (allClubIds.length > 0) {
        const { data } = await supabase
          .from("clubs")
          .select("id, name")
          .in("id", allClubIds);
        clubs = (data || []).sort((a: any, b: any) => a.name.localeCompare(b.name));
      }

      return { teams, clubs };
    },
  });

  const allTeams = teamsAndClubs?.teams || [];
  const clubs = teamsAndClubs?.clubs || [];

  // Filter teams by effective club
  const filteredTeams = effectiveClubId
    ? allTeams.filter(t => t.club_id === effectiveClubId)
    : allTeams;

  // Determine what step to show
  const needsClubPick = !activeClubFilter && clubs.length > 1 && !selectedClubId;

  // Auto-select if only one team after filtering
  useEffect(() => {
    if (!open || selectedTeamId) return;
    if (needsClubPick) return;
    if (filteredTeams.length === 1) {
      setSelectedTeamId(filteredTeams[0].id);
      onOpenChange(false);
      setInviteSheetOpen(true);
    }
  }, [filteredTeams, open, selectedTeamId, needsClubPick, onOpenChange]);

  // Auto-select club if only one club
  useEffect(() => {
    if (!open || activeClubFilter) return;
    if (clubs.length === 1 && !selectedClubId) {
      setSelectedClubId(clubs[0].id);
    }
  }, [clubs, open, activeClubFilter, selectedClubId]);

  const handleClubSelect = (clubId: string) => {
    setSelectedClubId(clubId);
    // Don't close dialog — teams will re-filter and either auto-select or show team picker
  };

  const handleTeamSelect = (teamId: string) => {
    setSelectedTeamId(teamId);
    onOpenChange(false);
    setInviteSheetOpen(true);
  };

  const handleInviteSheetChange = (isOpen: boolean) => {
    setInviteSheetOpen(isOpen);
    if (!isOpen) {
      setSelectedTeamId(null);
      setSelectedClubId(null);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setSelectedTeamId(null);
      setSelectedClubId(null);
    }
    onOpenChange(v);
  };

  const selectedTeam = allTeams.find(t => t.id === selectedTeamId);

  const canBulkInvite = useMemo(() => {
    if (!selectedTeamId) return false;
    const roles = getCachedRoles();
    if (!roles) return false;
    return roles.some(r =>
      ['club_admin', 'team_admin', 'coach', 'app_admin'].includes(r.role) &&
      (r.team_id === selectedTeamId || (selectedTeam && r.club_id === selectedTeam.club_id))
    );
  }, [selectedTeamId, selectedTeam]);

  // Show dialog when: needs club pick, or needs team pick (multiple filtered teams),
  // or club is selected but has no teams (show message)
  const clubSelectedNoTeams = !needsClubPick && selectedClubId && filteredTeams.length === 0 && !activeClubFilter;
  const showPicker = open && (needsClubPick || filteredTeams.length > 1 || clubSelectedNoTeams);

  return (
    <>
      {showPicker && (
        <ResponsiveDialog open={open} onOpenChange={handleClose}>
          <ResponsiveDialogContent className="max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Invite to Team
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {needsClubPick
                  ? "Choose a club first, then select a team."
                  : clubSelectedNoTeams
                    ? "This club has no teams yet. Select a different club or create a team first."
                    : "Choose a team to invite someone to."}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            <div className="pt-2 space-y-3">
              {/* Club picker — only when no active club filter and multiple clubs */}
              {!activeClubFilter && clubs.length > 1 && (
                <MobileCardSelect
                  value={selectedClubId || ""}
                  onValueChange={handleClubSelect}
                  options={clubs.map(c => ({
                    value: c.id,
                    label: c.name,
                  }))}
                  label="Select Club"
                  placeholder="Choose a club..."
                  searchable={clubs.length > 5}
                  searchPlaceholder="Search clubs..."
                  emptyMessage="No clubs found."
                />
              )}

              {/* Team picker — only after club is resolved and multiple teams */}
              {!needsClubPick && filteredTeams.length > 1 && (
                <MobileCardSelect
                  value=""
                  onValueChange={handleTeamSelect}
                  options={filteredTeams.map(t => ({
                    value: t.id,
                    label: t.name,
                  }))}
                  label="Select Team"
                  placeholder="Choose a team..."
                  searchable={filteredTeams.length > 5}
                  searchPlaceholder="Search teams..."
                  emptyMessage="No teams found."
                />
              )}
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
          canBulkInvite={canBulkInvite}
          triggerVariant="none"
          externalOpen={inviteSheetOpen}
          onExternalOpenChange={handleInviteSheetChange}
        />
      )}
    </>
  );
}
