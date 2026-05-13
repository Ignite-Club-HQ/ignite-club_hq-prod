import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2, Trophy, UserPlus, Users } from "lucide-react";
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
import { AddMiniLeagueMemberSheet } from "@/components/AddMiniLeagueMemberSheet";

interface HomeInviteFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Target =
  | { kind: "team"; id: string; name: string; clubId: string }
  | { kind: "mini_league"; id: string; name: string; clubId: string };

export default function HomeInviteFlow({ open, onOpenChange }: HomeInviteFlowProps) {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);

  // Effective club filter: use activeClubFilter if set, otherwise the manually selected club
  const effectiveClubId = activeClubFilter || selectedClubId;

  const { data: invitables, isLoading: invitablesLoading, isFetching: invitablesFetching } = useQuery({
    queryKey: ["home-invite-targets", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", user!.id);

      if (!roles || roles.length === 0) {
        return { teams: [], clubs: [], miniLeagues: [] };
      }

      const allClubIds = [...new Set(roles.map(r => r.club_id).filter(Boolean))] as string[];
      const teamIds = [...new Set(roles.map(r => r.team_id).filter(Boolean))] as string[];

      // Clubs where user can manage mini-league members club-wide
      // (mirrors MiniLeagueDetailPage.canManageLeague club-wide check)
      const MANAGE_ROLES = new Set([
        "club_admin",
        "league_admin",
        "coach",
        "committee_member",
        "app_admin",
      ]);
      const leagueAdminClubIds = [
        ...new Set(
          roles
            .filter(r => MANAGE_ROLES.has(r.role as string))
            .map(r => r.club_id)
            .filter(Boolean)
        ),
      ] as string[];

      // Per-league grants from mini_league_admins
      const { data: scopedAdmins } = await supabase
        .from("mini_league_admins")
        .select("mini_league_id")
        .eq("user_id", user!.id);
      const scopedLeagueIds = (scopedAdmins || []).map(r => r.mini_league_id).filter(Boolean) as string[];

      const [teamsRes, clubsRes, clubLeaguesRes, scopedLeaguesRes] = await Promise.all([
        teamIds.length
          ? supabase
              .from("teams")
              .select("id, name, club_id, clubs(id, name)")
              .in("id", teamIds)
          : Promise.resolve({ data: [] as any[] }),
        allClubIds.length
          ? supabase.from("clubs").select("id, name").in("id", allClubIds)
          : Promise.resolve({ data: [] as any[] }),
        leagueAdminClubIds.length
          ? supabase
              .from("mini_leagues")
              .select("id, name, club_id")
              .in("club_id", leagueAdminClubIds)
          : Promise.resolve({ data: [] as any[] }),
        scopedLeagueIds.length
          ? supabase
              .from("mini_leagues")
              .select("id, name, club_id")
              .in("id", scopedLeagueIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const teams = (teamsRes.data || []).sort((a: any, b: any) => a.name.localeCompare(b.name));
      const clubs = (clubsRes.data || []).sort((a: any, b: any) => a.name.localeCompare(b.name));
      const leagueMap = new Map<string, any>();
      [...(clubLeaguesRes.data || []), ...(scopedLeaguesRes.data || [])].forEach((l: any) => {
        leagueMap.set(l.id, l);
      });
      const miniLeagues = [...leagueMap.values()].sort((a: any, b: any) =>
        a.name.localeCompare(b.name)
      );

      // Ensure clubs list includes any club referenced by an accessible mini-league
      const knownClubIds = new Set(clubs.map((c: any) => c.id));
      const missingClubIds = miniLeagues
        .map(l => l.club_id)
        .filter((cid): cid is string => !!cid && !knownClubIds.has(cid));
      if (missingClubIds.length) {
        const { data: extraClubs } = await supabase
          .from("clubs")
          .select("id, name")
          .in("id", [...new Set(missingClubIds)]);
        (extraClubs || []).forEach((c: any) => clubs.push(c));
        clubs.sort((a: any, b: any) => a.name.localeCompare(b.name));
      }

      return { teams, clubs, miniLeagues };
    },
  });

  const allTeams = invitables?.teams || [];
  const clubs = invitables?.clubs || [];
  const allLeagues = invitables?.miniLeagues || [];

  // Filter by effective club
  const filteredTeams = effectiveClubId
    ? allTeams.filter(t => t.club_id === effectiveClubId)
    : allTeams;
  const filteredLeagues = effectiveClubId
    ? allLeagues.filter(l => l.club_id === effectiveClubId)
    : allLeagues;

  const totalFiltered = filteredTeams.length + filteredLeagues.length;

  const targetOptions = useMemo(() => [
    ...filteredTeams.map(t => ({
      value: `team:${t.id}`,
      label: t.name,
      description: "Team",
      icon: Users,
    })),
    ...filteredLeagues.map(l => ({
      value: `mini_league:${l.id}`,
      label: l.name,
      description: "Mini-league",
      icon: Trophy,
    })),
  ].sort((a, b) => a.label.localeCompare(b.label)), [filteredTeams, filteredLeagues]);

  // Determine what step to show
  const needsClubPick = !activeClubFilter && clubs.length > 1 && !selectedClubId;

  // Auto-select if only one option after filtering
  useEffect(() => {
    if (!open || target) return;
    if (needsClubPick) return;
    if (totalFiltered === 1) {
      if (filteredTeams.length === 1) {
        const t = filteredTeams[0];
        setTarget({ kind: "team", id: t.id, name: t.name, clubId: t.club_id });
      } else {
        const l = filteredLeagues[0];
        setTarget({ kind: "mini_league", id: l.id, name: l.name, clubId: l.club_id });
      }
      onOpenChange(false);
      setInviteSheetOpen(true);
    }
  }, [filteredTeams, filteredLeagues, totalFiltered, open, target, needsClubPick, onOpenChange]);

  // Auto-select club if only one club
  useEffect(() => {
    if (!open || activeClubFilter) return;
    if (clubs.length === 1 && !selectedClubId) {
      setSelectedClubId(clubs[0].id);
    }
  }, [clubs, open, activeClubFilter, selectedClubId]);

  const handleClubSelect = (clubId: string) => {
    setSelectedClubId(clubId);
  };

  const handleTargetSelect = (value: string) => {
    const sep = value.indexOf(":");
    const kind = value.slice(0, sep);
    const id = value.slice(sep + 1);
    if (kind === "team") {
      const t = filteredTeams.find(x => x.id === id);
      if (!t) return;
      setTarget({ kind: "team", id: t.id, name: t.name, clubId: t.club_id });
    } else if (kind === "mini_league") {
      const l = filteredLeagues.find(x => x.id === id);
      if (!l) return;
      setTarget({ kind: "mini_league", id: l.id, name: l.name, clubId: l.club_id });
    } else {
      return;
    }
    onOpenChange(false);
    setInviteSheetOpen(true);
  };

  const handleInviteSheetChange = (isOpen: boolean) => {
    setInviteSheetOpen(isOpen);
    if (!isOpen) {
      setTarget(null);
      setSelectedClubId(null);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setTarget(null);
      setSelectedClubId(null);
    }
    onOpenChange(v);
  };

  const canBulkInvite = useMemo(() => {
    if (!target || target.kind !== "team") return false;
    const roles = getCachedRoles();
    if (!roles) return false;
    return roles.some(r =>
      ['club_admin', 'team_admin', 'coach', 'app_admin'].includes(r.role) &&
      (r.team_id === target.id || r.club_id === target.clubId)
    );
  }, [target]);

  const clubSelectedNoTargets =
    !needsClubPick && selectedClubId && totalFiltered === 0 && !activeClubFilter;
  const isInitialLoading = open && !invitables && (invitablesLoading || invitablesFetching);
  const showPicker =
    open &&
    (needsClubPick ||
      totalFiltered > 1 ||
      clubSelectedNoTargets);

  return (
    <>
      {isInitialLoading && (
        <ResponsiveDialog open={open} onOpenChange={handleClose}>
          <ResponsiveDialogContent className="max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Invite Members
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Loading your teams and mini-leagues…
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}

      {showPicker && (
        <ResponsiveDialog open={open} onOpenChange={handleClose}>
          <ResponsiveDialogContent className="max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Invite Members
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {needsClubPick
                  ? "Choose a club first, then select a team or mini-league."
                  : clubSelectedNoTargets
                    ? "This club has no teams or mini-leagues you can invite to yet."
                    : "Choose a team or mini-league to invite someone to."}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            <div className="pt-2 pb-6 space-y-3">
              {/* Club picker */}
              {!activeClubFilter && clubs.length > 1 && (
                <MobileCardSelect
                  value={selectedClubId || ""}
                  onValueChange={handleClubSelect}
                  options={clubs.map(c => {
                    const hasAny =
                      allTeams.some(t => t.club_id === c.id) ||
                      allLeagues.some(l => l.club_id === c.id);
                    return {
                      value: c.id,
                      label: c.name,
                      description: !hasAny ? "Nothing to invite to" : undefined,
                      disabled: !hasAny,
                    };
                  })}
                  label="Select Club"
                  placeholder="Choose a club..."
                  searchable={clubs.length > 5}
                  searchPlaceholder="Search clubs..."
                  emptyMessage="No clubs found."
                />
              )}

              {/* Combined target picker */}
              {!needsClubPick && totalFiltered > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground px-1">Teams & mini-leagues</p>
                  <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                    {targetOptions.map((option) => {
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleTargetSelect(option.value)}
                          className="w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:bg-accent/50 active:bg-accent active:scale-[0.99]"
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-base font-medium text-foreground">{option.label}</span>
                              <span className="block text-xs text-muted-foreground">{option.description}</span>
                            </span>
                          </span>
                          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}

      {target?.kind === "team" && (
        <AddTeamMemberSheet
          teamId={target.id}
          teamName={target.name}
          clubId={target.clubId}
          canBulkInvite={canBulkInvite}
          triggerVariant="none"
          externalOpen={inviteSheetOpen}
          onExternalOpenChange={handleInviteSheetChange}
        />
      )}

      {target?.kind === "mini_league" && (
        <AddMiniLeagueMemberSheet
          miniLeagueId={target.id}
          miniLeagueName={target.name}
          clubId={target.clubId}
          externalOpen={inviteSheetOpen}
          onExternalOpenChange={handleInviteSheetChange}
        />
      )}
    </>
  );
}
