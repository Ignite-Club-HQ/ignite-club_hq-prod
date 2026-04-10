import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Crown } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface CreateGroupDialogProps {
  clubId?: string;
  teamId?: string;
  miniLeagueId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "league_admin", label: "League Admins" },
  { value: "committee_member", label: "Committee Members" },
  { value: "team_admin", label: "Team Admins" },
  { value: "coach", label: "Coaches" },
  { value: "parent", label: "Parents" },
  { value: "player", label: "Players" },
];

export default function CreateGroupDialog({ clubId, teamId, miniLeagueId, open: controlledOpen, onOpenChange }: CreateGroupDialogProps) {
  const { user } = useAuth();
  const { activeClubFilter, activeClubTeamIds } = useClubTheme();
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(teamId || "");
  const [selectedClubId, setSelectedClubId] = useState<string>(clubId || "");
  const [selectedMiniLeagueId, setSelectedMiniLeagueId] = useState<string>(miniLeagueId || "");
  const [groupType, setGroupType] = useState<"team" | "club" | "league">(
    miniLeagueId ? "league" : teamId ? "team" : clubId ? "club" : "team"
  );

  // Use controlled or uncontrolled state
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
    } else {
      setInternalOpen(open);
    }
  };

  // Auto-select filtered club
  useEffect(() => {
    if (activeClubFilter && !clubId) {
      setSelectedClubId(activeClubFilter);
      setGroupType("club");
    }
  }, [activeClubFilter, clubId]);

  // Fetch admin teams
  const { data: adminTeams = [] } = useQuery({
    queryKey: ["admin-teams-for-groups", user?.id],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, club_id")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach", "app_admin", "committee_member"]);
      
      // Get team IDs from team roles
      const teamIds = roles?.map((r) => r.team_id).filter((id): id is string => id !== null) || [];
      
      // Also get teams from clubs where user is a committee member
      const clubIds = roles?.filter(r => r.club_id && !r.team_id).map(r => r.club_id).filter((id): id is string => id !== null) || [];
      
      let allTeamIds = [...teamIds];
      
      // If user is committee member of a club, they can create groups for any team in that club
      if (clubIds.length > 0) {
        const { data: clubTeams } = await supabase
          .from("teams")
          .select("id")
          .in("club_id", clubIds);
        
        if (clubTeams) {
          clubTeams.forEach(t => {
            if (!allTeamIds.includes(t.id)) {
              allTeamIds.push(t.id);
            }
          });
        }
      }
      
      if (allTeamIds.length === 0) return [];

      const { data } = await supabase
        .from("teams")
        .select("id, name, club_id, clubs(name)")
        .in("id", allTeamIds);
      
      return data || [];
    },
    enabled: !!user && !teamId && !miniLeagueId && isOpen,
  });

  // Fetch admin mini-leagues (Pro Football clubs only)
  const { data: adminMiniLeagues = [] } = useQuery({
    queryKey: ["admin-mini-leagues-for-groups", user?.id, activeClubFilter],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "app_admin", "committee_member", "coach", "team_admin"]);
      
      let clubIds = roles?.map((r) => r.club_id).filter((id): id is string => id !== null) || [];
      if (activeClubFilter) clubIds = clubIds.filter(id => id === activeClubFilter);
      if (clubIds.length === 0) return [];

      // Only Pro Football clubs can have league groups
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("club_id")
        .in("club_id", clubIds)
        .or("is_pro_football.eq.true,admin_pro_football_override.eq.true");
      
      const proFootballClubIds = subs?.map(s => s.club_id) || [];
      if (proFootballClubIds.length === 0) return [];

      const { data } = await supabase
        .from("mini_leagues")
        .select("id, name, club_id, clubs(name)")
        .in("club_id", proFootballClubIds);
      
      return data || [];
    },
    enabled: !!user && !miniLeagueId && isOpen,
  });

  // Fetch admin clubs with their Pro status
  const { data: adminClubs = [] } = useQuery({
    queryKey: ["admin-clubs-for-groups-with-pro", user?.id],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "app_admin", "committee_member"]);
      
      const clubIds = roles?.map((r) => r.club_id).filter(Boolean) || [];
      if (clubIds.length === 0) return [];

      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name")
        .in("id", clubIds);
      
      if (!clubs || clubs.length === 0) return [];

      // Fetch Pro status for each club
      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("club_id", clubIds);

      const subMap = new Map(subscriptions?.map(s => [s.club_id, s]) || []);

      return clubs.map(club => {
        const sub = subMap.get(club.id);
        const hasPro = !!(sub?.is_pro || sub?.is_pro_football || sub?.admin_pro_override || sub?.admin_pro_football_override);
        return { ...club, hasPro };
      });
    },
    enabled: !!user && !clubId && isOpen,
  });

  // Check if a specific club has Pro (for pre-selected clubId)
  const { data: selectedClubPro } = useQuery({
    queryKey: ["club-pro-for-group", clubId || selectedClubId],
    queryFn: async () => {
      const targetClubId = clubId || selectedClubId;
      if (!targetClubId) return false;
      
      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .eq("club_id", targetClubId)
        .maybeSingle();
      
      return !!(data?.is_pro || data?.is_pro_football || data?.admin_pro_override || data?.admin_pro_football_override);
    },
    enabled: !!(clubId || selectedClubId) && isOpen,
  });

  // Check if any club has Pro (for enabling club group type)
  const hasAnyClubWithPro = useMemo(() => {
    if (clubId) return selectedClubPro;
    return adminClubs.some(c => c.hasPro);
  }, [adminClubs, clubId, selectedClubPro]);

  // Filter clubs with Pro for club group type
  const clubsWithPro = useMemo(() => {
    return adminClubs.filter(c => c.hasPro);
  }, [adminClubs]);

  const createGroupMutation = useMutation({
    mutationFn: async () => {
      if (!user || selectedRoles.length === 0) return;
      
      const finalTeamId = teamId || (groupType === "team" ? selectedTeamId : null);
      const finalClubId = clubId || (groupType === "club" ? selectedClubId : null);
      const finalMiniLeagueId = miniLeagueId || (groupType === "league" ? selectedMiniLeagueId : null);
      
      if (!finalTeamId && !finalClubId && !finalMiniLeagueId) {
        throw new Error("Please select a team, club, or league");
      }
      
      const { error } = await supabase.from("chat_groups").insert({
        name: name.trim(),
        club_id: finalClubId || null,
        team_id: finalTeamId || null,
        mini_league_id: finalMiniLeagueId || null,
        allowed_roles: selectedRoles,
        created_by: user.id,
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chat group created");
      setOpen(false);
      setName("");
      setSelectedRoles([]);
      setSelectedTeamId("");
      setSelectedClubId("");
      setSelectedMiniLeagueId("");
      // Invalidate all chat group related queries immediately
      queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["messages-page"] });
    },
    onError: (error) => {
      console.error("Error creating group:", error);
      toast.error(error.message || "Failed to create chat group");
    },
  });

  const toggleRole = (role: AppRole) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error("Please enter a group name");
      return;
    }
    if (selectedRoles.length === 0) {
      toast.error("Please select at least one role");
      return;
    }
    if (!teamId && !clubId && !miniLeagueId && groupType === "team" && !selectedTeamId) {
      toast.error("Please select a team");
      return;
    }
    if (!teamId && !clubId && !miniLeagueId && groupType === "club" && !selectedClubId) {
      toast.error("Please select a club");
      return;
    }
    if (!teamId && !clubId && !miniLeagueId && groupType === "league" && !selectedMiniLeagueId) {
      toast.error("Please select a league");
      return;
    }
    createGroupMutation.mutate();
  };

  const showSelector = !teamId && !clubId && !miniLeagueId;
  const isClubFiltered = !!activeClubFilter;

  // Filter admin teams to only those in the filtered club
  const filteredAdminTeams = useMemo(() => {
    if (!activeClubFilter) return adminTeams;
    // Filter by club_id from the team data
    return adminTeams.filter(team => team.club_id === activeClubFilter);
  }, [adminTeams, activeClubFilter]);

  // Render without trigger button when controlled
  const dialogContent = (
      <ResponsiveDialog open={isOpen} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Create Chat Group</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Coaches Chat, Parents Group"
              />
            </div>

            {showSelector && (
              <>
                <div className="space-y-2">
                  <Label>Group Type</Label>
                  <Select 
                    value={groupType} 
                    onValueChange={(v) => {
                      setGroupType(v as "team" | "club" | "league");
                      if (v === "club") setSelectedClubId(activeClubFilter || "");
                    }}
                    disabled={isClubFiltered && groupType !== "league"}
                    modal={false}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100000]">
                      <SelectItem value="team">Team Group</SelectItem>
                      <SelectItem value="club" disabled={!hasAnyClubWithPro}>
                        <span className="flex items-center gap-2">
                          Club Group
                          {!hasAnyClubWithPro && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              <Crown className="h-3 w-3" />
                              Pro
                            </span>
                          )}
                        </span>
                      </SelectItem>
                      <SelectItem value="league" disabled={adminMiniLeagues.length === 0}>
                        <span className="flex items-center gap-2">
                          League Group
                          {adminMiniLeagues.length === 0 && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              <Crown className="h-3 w-3" />
                              Pro Football
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {!hasAnyClubWithPro && groupType === "team" && (
                    <p className="text-xs text-muted-foreground">
                      Club groups require a Club Pro subscription.
                    </p>
                  )}
                </div>

                {groupType === "team" && (
                  <div className="space-y-2">
                    <Label>Select Team</Label>
                    <Select value={selectedTeamId} onValueChange={setSelectedTeamId} modal={false}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a team..." />
                      </SelectTrigger>
                      <SelectContent className="z-[100000]">
                        {filteredAdminTeams.map((team) => (
                          <SelectItem key={team.id} value={team.id}>
                            {team.name} ({team.clubs?.name})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {groupType === "club" && (
                  <div className="space-y-2">
                    <Label>Select Club</Label>
                    <Select 
                      value={selectedClubId} 
                      onValueChange={setSelectedClubId}
                      disabled={isClubFiltered}
                      modal={false}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a club with Pro..." />
                      </SelectTrigger>
                      <SelectContent className="z-[100000]">
                        {clubsWithPro.map((club) => (
                          <SelectItem key={club.id} value={club.id}>
                            {club.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {groupType === "league" && (
                  <div className="space-y-2">
                    <Label>Select League</Label>
                    <Select value={selectedMiniLeagueId} onValueChange={setSelectedMiniLeagueId} modal={false}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a league..." />
                      </SelectTrigger>
                      <SelectContent className="z-[100000]">
                        {adminMiniLeagues.map((league: any) => (
                          <SelectItem key={league.id} value={league.id}>
                            {league.name} ({league.clubs?.name})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
            
            <div className="space-y-2">
              <Label>Who can access this group?</Label>
              <p className="text-xs text-muted-foreground">
                Select the roles that can participate in this chat group
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2">
                {ROLE_OPTIONS.map((role) => (
                  <div key={role.value} className="flex items-center gap-2">
                    <Checkbox
                      id={role.value}
                      checked={selectedRoles.includes(role.value)}
                      onCheckedChange={() => toggleRole(role.value)}
                    />
                    <Label htmlFor={role.value} className="font-normal cursor-pointer text-sm">
                      {role.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1 sm:flex-none">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createGroupMutation.isPending} className="flex-1 sm:flex-none">
              {createGroupMutation.isPending ? "Creating..." : "Create Group"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
  );

  // If not controlled, show trigger button
  if (controlledOpen === undefined) {
    return (
      <>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          New Group
        </Button>
        {dialogContent}
      </>
    );
  }

  return dialogContent;
}
