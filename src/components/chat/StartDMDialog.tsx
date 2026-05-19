import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { Search, MessageCircle, Loader2, Crown, Lock, Check, X, Users, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DMableUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  shared_clubs: string[];
  club_ids: string[];
  team_ids: string[];
}

interface ClubInfo {
  id: string;
  name: string;
}

interface TeamInfo {
  id: string;
  name: string;
  club_id: string;
}

interface StartDMDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * "dm" (default) — fast direct-message flow. Picking 1 person starts a DM
   * instantly; picking multiple auto-creates an unnamed group.
   * "custom-group" — manual people picker. Group name is required and shown at
   * the top; submit always creates a group even with one person selected.
   */
  mode?: "dm" | "custom-group";
}

export function StartDMDialog({ open: controlledOpen, onOpenChange, mode = "dm" }: StartDMDialogProps) {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<DMableUser[]>([]);
  const [groupName, setGroupName] = useState("");
  const BUILTIN_CATEGORIES = ["Club Management", "Operations", "Volunteers", "Custom Groups"] as const;
  const CUSTOM_CATS_KEY = "chat.custom_categories";
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_CATS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    } catch { return []; }
  });
  const [groupCategory, setGroupCategory] = useState<string>("Custom Groups");
  const [selectedClubId, setSelectedClubId] = useState<string>("all");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("all");

  // Use controlled or uncontrolled state
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
    } else {
      setInternalOpen(open);
    }
  };

  // Auto-select club filter when in club mode
  useEffect(() => {
    if (activeClubFilter && isOpen) {
      setSelectedClubId(activeClubFilter);
    }
  }, [activeClubFilter, isOpen]);

  // Check if user has Pro access for DMs
  const { data: hasProAccess, isLoading: checkingPro } = useQuery({
    queryKey: ["has-pro-for-dm", user?.id],
    queryFn: async () => {
      // Get clubs user is a member of
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);

      if (!roles?.length) return false;

      const clubIds = [...new Set(roles.map(r => r.club_id).filter(Boolean))];

      // Check if any of these clubs have Pro
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", clubIds);

      return subs?.some(sub => 
        (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) && 
        (!sub.expires_at || new Date(sub.expires_at) > new Date())
      ) ?? false;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Check if current user can send DMs (has admin role or allowed by club settings)
  const { data: canSendDMs, isLoading: checkingCanSend } = useQuery({
    queryKey: ["can-send-dms", user?.id],
    queryFn: async () => {
      // First check if user is app_admin - they can always DM
      const { data: isAppAdmin } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      
      if (isAppAdmin) return { canSend: true, reason: null };

      // Get user's club memberships with their roles
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select("club_id, team_id, role")
        .eq("user_id", user!.id);

      if (!userRoles?.length) return { canSend: false, reason: "no_membership" };

      // Get unique club IDs from direct club roles
      const directClubIds = userRoles.filter(r => r.club_id).map(r => r.club_id);
      
      // Also get club IDs from team memberships
      const teamIds = userRoles.filter(r => r.team_id).map(r => r.team_id);
      let teamClubIds: string[] = [];
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("id, club_id")
          .in("id", teamIds);
        teamClubIds = (teams || []).map(t => t.club_id);
      }

      const allClubIds = [...new Set([...directClubIds, ...teamClubIds].filter(Boolean))] as string[];
      if (allClubIds.length === 0) return { canSend: false, reason: "no_membership" };

      // Check Pro status of these clubs
      const { data: proClubs } = await supabase
        .from("club_subscriptions")
        .select("club_id")
        .in("club_id", allClubIds)
        .or("is_pro.eq.true,is_pro_football.eq.true,admin_pro_override.eq.true,admin_pro_football_override.eq.true");

      const proClubIds = proClubs?.map(c => c.club_id) || [];
      if (proClubIds.length === 0) return { canSend: false, reason: "no_pro" };

      // Get DM settings for Pro clubs
      const { data: dmSettings } = await supabase
        .from("club_dm_settings")
        .select("club_id, dm_enabled, allowed_roles")
        .in("club_id", proClubIds);

      // Check if user has permission in any Pro club
      for (const clubId of proClubIds) {
        const settings = dmSettings?.find(s => s.club_id === clubId);
        const dmEnabled = settings?.dm_enabled ?? true;
        const allowedRoles = settings?.allowed_roles ?? ['app_admin', 'club_admin', 'team_admin'];

        if (!dmEnabled) continue;

        // Check if user has an allowed role in this club
        const userClubRoles = userRoles.filter(r => r.club_id === clubId).map(r => r.role);
        if (userClubRoles.some(role => allowedRoles.includes(role))) {
          return { canSend: true, reason: null };
        }

        // Check if user has an allowed role in any team of this club
        const clubTeamIds = teamIds.filter(tid => {
          const teamRole = userRoles.find(r => r.team_id === tid);
          if (!teamRole) return false;
          // Check if this team belongs to the club
          return teamClubIds.includes(clubId);
        });
        
        const userTeamRoles = userRoles
          .filter(r => clubTeamIds.includes(r.team_id as string))
          .map(r => r.role);
        
        if (userTeamRoles.some(role => allowedRoles.includes(role))) {
          return { canSend: true, reason: null };
        }
      }

      return { canSend: false, reason: "not_admin" };
    },
    enabled: !!user && hasProAccess === true,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch users that can be DMed (members of shared Pro clubs + mini-league parents) excluding app admins
  const { data: dmData, isLoading: loadingUsers } = useQuery({
    queryKey: ["dmable-users-with-filters", user?.id, activeClubFilter],
    queryFn: async () => {
      // Get Pro clubs user is a member of
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);

      if (!userRoles?.length) return { users: [], clubs: [], teams: [] };

      let clubIds = [...new Set(userRoles.map(r => r.club_id).filter(Boolean))] as string[];

      // If in club mode, filter to only the active club
      if (activeClubFilter) {
        clubIds = clubIds.filter(id => id === activeClubFilter);
      }

      if (clubIds.length === 0) return { users: [], clubs: [], teams: [] };

      // Filter to Pro clubs only
      const { data: proClubs } = await supabase
        .from("club_subscriptions")
        .select("club_id")
        .in("club_id", clubIds)
        .or("is_pro.eq.true,is_pro_football.eq.true,admin_pro_override.eq.true,admin_pro_football_override.eq.true");

      const proClubIds = proClubs?.map(c => c.club_id) || [];
      if (proClubIds.length === 0) return { users: [], clubs: [], teams: [] };

      // Fetch clubs, teams, club members, mini-leagues, and app admins in parallel
      const [clubsResult, teamsResult, clubMembersResult, miniLeaguesResult, appAdminsResult] = await Promise.all([
        supabase.from("clubs").select("id, name").in("id", proClubIds),
        supabase.from("teams").select("id, name, club_id").in("club_id", proClubIds),
        supabase.from("user_roles").select("user_id, club_id, team_id, role").in("club_id", proClubIds).neq("user_id", user!.id),
        supabase.from("mini_leagues").select("id, club_id").in("club_id", proClubIds),
        supabase.from("user_roles").select("user_id").eq("role", "app_admin"),
      ]);

      const clubs = (clubsResult.data || []) as ClubInfo[];
      const teams = (teamsResult.data || []) as TeamInfo[];
      const clubMembers = clubMembersResult.data || [];
      const miniLeagues = miniLeaguesResult.data || [];
      const appAdminIds = new Set((appAdminsResult.data || []).map(a => a.user_id));

      const clubNameMap = new Map(clubs.map(c => [c.id, c.name]));

      // Get mini-league parents
      let miniLeagueParents: { parent_user_id: string; mini_league_id: string }[] = [];
      if (miniLeagues.length > 0) {
        const miniLeagueIds = miniLeagues.map(ml => ml.id);
        const { data: mlPlayers } = await supabase
          .from("mini_league_players")
          .select("parent_user_id, mini_league_id")
          .in("mini_league_id", miniLeagueIds)
          .not("parent_user_id", "is", null);
        miniLeagueParents = (mlPlayers || []).filter(p => p.parent_user_id !== user!.id);
      }

      // Build a map of mini-league to club
      const miniLeagueClubMap = new Map(miniLeagues.map(ml => [ml.id, ml.club_id]));

      // Group by user and collect their clubs and teams
      const userClubMap = new Map<string, Set<string>>();
      const userTeamMap = new Map<string, Set<string>>();
      const userClubNameMap = new Map<string, string[]>();
      
      // Process club members (excluding app_admin role users)
      clubMembers.forEach((member: { user_id: string; club_id: string; team_id: string | null; role: string }) => {
        // Skip app admins
        if (appAdminIds.has(member.user_id)) return;

        if (!userClubMap.has(member.user_id)) {
          userClubMap.set(member.user_id, new Set());
          userTeamMap.set(member.user_id, new Set());
          userClubNameMap.set(member.user_id, []);
        }
        if (member.club_id) {
          userClubMap.get(member.user_id)!.add(member.club_id);
          const clubName = clubNameMap.get(member.club_id);
          if (clubName && !userClubNameMap.get(member.user_id)!.includes(clubName)) {
            userClubNameMap.get(member.user_id)!.push(clubName);
          }
        }
        if (member.team_id) {
          userTeamMap.get(member.user_id)!.add(member.team_id);
        }
      });

      // Process mini-league parents (they might not have user_roles entries)
      miniLeagueParents.forEach((mlParent) => {
        // Skip app admins
        if (appAdminIds.has(mlParent.parent_user_id)) return;

        const clubId = miniLeagueClubMap.get(mlParent.mini_league_id);
        if (!clubId) return;

        if (!userClubMap.has(mlParent.parent_user_id)) {
          userClubMap.set(mlParent.parent_user_id, new Set());
          userTeamMap.set(mlParent.parent_user_id, new Set());
          userClubNameMap.set(mlParent.parent_user_id, []);
        }
        userClubMap.get(mlParent.parent_user_id)!.add(clubId);
        const clubName = clubNameMap.get(clubId);
        if (clubName && !userClubNameMap.get(mlParent.parent_user_id)!.includes(clubName)) {
          userClubNameMap.get(mlParent.parent_user_id)!.push(clubName);
        }
      });

      const uniqueUserIds = [...userClubMap.keys()];

      if (uniqueUserIds.length === 0) return { users: [], clubs, teams };

      // Fetch profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", uniqueUserIds);

      const users = (profiles || []).map(p => ({
        ...p,
        shared_clubs: userClubNameMap.get(p.id) || [],
        club_ids: [...(userClubMap.get(p.id) || [])],
        team_ids: [...(userTeamMap.get(p.id) || [])],
      })) as DMableUser[];

      return { users, clubs, teams };
    },
    enabled: !!user && hasProAccess === true,
    staleTime: 2 * 60 * 1000,
  });

  const dmableUsers = dmData?.users || [];
  const availableClubs = dmData?.clubs || [];
  const availableTeams = dmData?.teams || [];

  // Filter teams based on selected club
  const filteredTeams = useMemo(() => {
    if (selectedClubId === "all") return availableTeams;
    return availableTeams.filter(t => t.club_id === selectedClubId);
  }, [availableTeams, selectedClubId]);

  // Start single DM mutation
  const startDMMutation = useMutation({
    mutationFn: async (otherUserId: string) => {
      const { data, error } = await supabase.rpc("get_or_create_dm_conversation", {
        other_user_id: otherUserId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (conversationId) => {
      setOpen(false);
      setSelectedUsers([]);
      navigate(`/messages/dm/${conversationId}`);
    },
    onError: (error) => {
      toast.error("Failed to start conversation: " + error.message);
    },
  });

  // Start group DM mutation (creates a chat group)
  const startGroupDMMutation = useMutation({
    mutationFn: async ({ users, customName, category }: { users: DMableUser[]; customName: string; category?: string | null }) => {
      // Use custom name if provided, otherwise auto-name from member first names
      const groupName = customName.trim() || users.map(u => u.display_name?.split(" ")[0] || "User").join(", ");
      
      const allowedRoles: ("basic_user" | "club_admin" | "team_admin" | "coach" | "player" | "parent" | "app_admin")[] = 
        ["basic_user", "parent", "player", "coach", "team_admin", "club_admin"];
      
      const insertPayload: Record<string, unknown> = {
        name: groupName,
        created_by: user!.id,
        allowed_roles: allowedRoles,
      };
      if (category && category.trim()) insertPayload.category = category.trim();

      const { data: groupData, error: groupError } = await supabase
        .from("chat_groups")
        .insert(insertPayload as any)
        .select()
        .single();
      
      if (groupError) throw groupError;
      
      // Add all selected users to group_members. The creator is auto-added by
      // a DB trigger (add_creator_to_personal_group), so we only add the others
      // here. If this fails, roll back the group so the user doesn't end up
      // stranded in an empty group where their own messages would silently
      // fail RLS ("messages vanish" bug).
      const memberInserts = users.map(u => ({
        group_id: groupData.id,
        user_id: u.id,
        added_by: user!.id,
      }));

      if (memberInserts.length > 0) {
        const { error: membersError } = await supabase
          .from("group_members")
          .insert(memberInserts);

        if (membersError) {
          console.error("Failed to add members, rolling back group:", membersError);
          // Best-effort cleanup so we don't leave an orphan group behind.
          await supabase.from("chat_groups").delete().eq("id", groupData.id);
          throw new Error("Could not add members to the group. Please try again.");
        }
      }

      return groupData.id as string;
    },
    onSuccess: (groupId) => {
      setOpen(false);
      setSelectedUsers([]);
      setGroupName("");
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      navigate(`/groups/${groupId}`);
      toast.success("Group chat created!");
    },
    onError: (error) => {
      toast.error("Failed to create group chat: " + error.message);
    },
  });

  const toggleUserSelection = (dmUser: DMableUser) => {
    setSelectedUsers(prev => {
      const isSelected = prev.some(u => u.id === dmUser.id);
      if (isSelected) {
        return prev.filter(u => u.id !== dmUser.id);
      } else {
        return [...prev, dmUser];
      }
    });
  };

  const removeSelectedUser = (userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
  };

  const handleStartConversation = () => {
    if (mode === "custom-group") {
      if (!groupName.trim()) {
        toast.error("Give your group a name");
        return;
      }
      startGroupDMMutation.mutate({ users: selectedUsers, customName: groupName, category: groupCategory });
      return;
    }

    if (selectedUsers.length === 0) return;

    if (selectedUsers.length === 1) {
      // Single user - start regular DM
      startDMMutation.mutate(selectedUsers[0].id);
    } else {
      // Multiple users - create group chat
      startGroupDMMutation.mutate({ users: selectedUsers, customName: groupName, category: null });
    }
  };

  // Filter users by search query, club, and team
  const filteredUsers = useMemo(() => {
    if (!dmableUsers) return [];
    
    let filtered = dmableUsers;
    
    // Filter by club
    if (selectedClubId !== "all") {
      filtered = filtered.filter(u => u.club_ids.includes(selectedClubId));
    }
    
    // Filter by team
    if (selectedTeamId !== "all") {
      filtered = filtered.filter(u => u.team_ids.includes(selectedTeamId));
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(u => 
        u.display_name?.toLowerCase().includes(query) ||
        u.shared_clubs.some(c => c.toLowerCase().includes(query))
      );
    }
    
    return filtered;
  }, [dmableUsers, searchQuery, selectedClubId, selectedTeamId]);

  const isPending = startDMMutation.isPending || startGroupDMMutation.isPending;

  // Reset team filter when club changes
  const handleClubChange = (value: string) => {
    setSelectedClubId(value);
    setSelectedTeamId("all");
  };

  // Check if club filter is locked (in club mode)
  const isClubFilterLocked = !!activeClubFilter;

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={(open) => {
      setOpen(open);
      if (!open) {
        setSelectedUsers([]);
        setGroupName("");
        setSearchQuery("");
        setSelectedClubId(activeClubFilter || "all");
        setSelectedTeamId("all");
      }
    }}>
      <ResponsiveDialogContent className="sm:max-w-md" fullScreen>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            {mode === "custom-group" ? "New Custom Group" : "New Direct Message"}
            {!hasProAccess && (
              <Badge variant="secondary" className="gap-1">
                <Crown className="h-3 w-3" />
                Pro
              </Badge>
            )}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {mode === "custom-group"
              ? "Pick people one by one and give your group a name"
              : "Pick one person to chat 1:1, or several to start a quick group"}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-1">
          {(checkingPro && hasProAccess === undefined) || (checkingCanSend && canSendDMs === undefined) ? (
            <div className="flex justify-center py-8 flex-1 items-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !hasProAccess ? (
            <div className="flex flex-col items-center py-8 text-center gap-3 flex-1 justify-center">
              <div className="p-3 rounded-full bg-muted">
                <Lock className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">Pro Feature</p>
                <p className="text-sm text-muted-foreground">
                  Direct messages require you to be a member of a Pro club
                </p>
              </div>
            </div>
          ) : !canSendDMs?.canSend ? (
            <div className="flex flex-col items-center py-8 text-center gap-3 flex-1 justify-center">
              <div className="p-3 rounded-full bg-muted">
                <Lock className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">Admin Feature</p>
                <p className="text-sm text-muted-foreground">
                  Direct messages are restricted to club administrators. Contact your club admin if you need this feature enabled.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Selected users chips */}
              {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-2 p-2 bg-muted/50 rounded-lg">
                  {selectedUsers.map(u => (
                    <Badge key={u.id} variant="secondary" className="gap-1 pr-1">
                      {u.display_name?.split(" ")[0] || "User"}
                      <button
                        onClick={() => removeSelectedUser(u.id)}
                        className="ml-1 rounded-full hover:bg-background/50 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              {/* Group name: required + always shown in custom-group mode; optional + shown when 2+ in DM mode */}
              {(mode === "custom-group" || selectedUsers.length > 1) && (
                <div className="space-y-2">
                  <Input
                    placeholder={mode === "custom-group" ? "Group name" : "Group name (optional)"}
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    maxLength={60}
                    className="h-11 rounded-xl"
                    autoFocus={mode === "custom-group"}
                  />
                  {mode === "custom-group" && (() => {
                    const allCategories = Array.from(new Set([...BUILTIN_CATEGORIES, ...customCategories]));
                    const handleAddCategory = () => {
                      const input = window.prompt("New category name");
                      const trimmed = (input || "").trim().slice(0, 40);
                      if (!trimmed) return;
                      if (allCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
                        setGroupCategory(allCategories.find((c) => c.toLowerCase() === trimmed.toLowerCase())!);
                        return;
                      }
                      const next = [...customCategories, trimmed];
                      setCustomCategories(next);
                      try { localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(next)); } catch {}
                      setGroupCategory(trimmed);
                    };
                    return (
                      <div className="flex gap-2">
                        <select
                          value={groupCategory}
                          onChange={(e) => setGroupCategory(e.target.value)}
                          className="flex-1 h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {allCategories.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleAddCategory}
                          className="h-11 rounded-xl shrink-0"
                        >
                          + New
                        </Button>
                      </div>
                    );
                  })()}
                  {mode !== "custom-group" && (
                    <p className="text-xs text-muted-foreground">Leave blank to use member names</p>
                  )}
                </div>
              )}

              {/* Filters */}
              <div className="flex gap-2">
                <Select value={selectedClubId} onValueChange={handleClubChange} disabled={isClubFilterLocked}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="All Clubs" />
                  </SelectTrigger>
                  <SelectContent className="z-[100000]">
                    {!isClubFilterLocked && <SelectItem value="all">All Clubs</SelectItem>}
                    {availableClubs.map(club => (
                      <SelectItem key={club.id} value={club.id}>{club.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="All Teams" />
                  </SelectTrigger>
                  <SelectContent className="z-[100000]">
                    <SelectItem value="all">All Teams</SelectItem>
                    {filteredTeams.map(team => (
                      <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search members..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div>
                <div className="space-y-1">
                  {loadingUsers && filteredUsers.length === 0 ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredUsers.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      {searchQuery || selectedClubId !== "all" || selectedTeamId !== "all" 
                        ? "No members found" 
                        : "No members available to message"}
                    </div>
                  ) : (
                    filteredUsers.map((dmUser) => {
                      const isSelected = selectedUsers.some(u => u.id === dmUser.id);
                      const teamCount = dmUser.team_ids.length;
                      const initials = (dmUser.display_name || "?")
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map(s => s.charAt(0).toUpperCase())
                        .join("");
                      return (
                        <button
                          key={dmUser.id}
                          onClick={() => toggleUserSelection(dmUser)}
                          disabled={isPending}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left active:scale-[0.99] touch-manipulation border ${
                            isSelected
                              ? "bg-primary/10 border-primary/40 shadow-sm shadow-primary/10"
                              : "bg-card border-border hover:border-primary/30 hover:bg-accent/40"
                          }`}
                        >
                          <div className="relative">
                            <Avatar className={`h-11 w-11 ring-2 transition-all ${isSelected ? "ring-primary" : "ring-transparent"}`}>
                              <AvatarImage src={dmUser.avatar_url || undefined} />
                              <AvatarFallback className="text-xs font-semibold bg-muted">
                                {initials || "?"}
                              </AvatarFallback>
                            </Avatar>
                            {isSelected && (
                              <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center ring-2 ring-background">
                                <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate text-sm leading-tight">
                              {dmUser.display_name || "Unknown User"}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {dmUser.shared_clubs.slice(0, 1).map(c => (
                                <span
                                  key={c}
                                  className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground max-w-[180px] truncate"
                                >
                                  {c}
                                </span>
                              ))}
                              {teamCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                                  <Users className="h-2.5 w-2.5" />
                                  {teamCount} {teamCount === 1 ? "team" : "teams"}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer with action button - matches CreateGroupDialog pattern */}
        {(selectedUsers.length > 0 || mode === "custom-group") && (
          <ResponsiveDialogFooter className="sticky bottom-0 -mx-1 px-1 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] bg-background border-t border-border z-10">
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1 sm:flex-none">
              Cancel
            </Button>
            <Button
              onClick={handleStartConversation}
              disabled={isPending || (mode === "custom-group" && !groupName.trim())}
              className="flex-1 sm:flex-none gap-2"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "custom-group" || selectedUsers.length > 1 ? (
                <Users className="h-4 w-4" />
              ) : (
                <MessageCircle className="h-4 w-4" />
              )}
              {mode === "custom-group"
                ? selectedUsers.length === 0
                  ? "Create Group (just me)"
                  : `Create Group (${selectedUsers.length + 1})`
                : selectedUsers.length === 1
                  ? "Start Chat"
                  : `Create Group (${selectedUsers.length} people)`}
            </Button>
          </ResponsiveDialogFooter>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
