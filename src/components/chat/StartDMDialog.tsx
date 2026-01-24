import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
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

export function StartDMDialog() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<DMableUser[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string>("all");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("all");

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
    enabled: !!user && open,
  });

  // Fetch users that can be DMed (members of shared Pro clubs) along with club/team info
  const { data: dmData, isLoading: loadingUsers } = useQuery({
    queryKey: ["dmable-users-with-filters", user?.id],
    queryFn: async () => {
      // Get Pro clubs user is a member of
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);

      if (!userRoles?.length) return { users: [], clubs: [], teams: [] };

      const clubIds = [...new Set(userRoles.map(r => r.club_id).filter(Boolean))] as string[];

      // Filter to Pro clubs only
      const { data: proClubs } = await supabase
        .from("club_subscriptions")
        .select("club_id")
        .in("club_id", clubIds)
        .or("is_pro.eq.true,is_pro_football.eq.true,admin_pro_override.eq.true,admin_pro_football_override.eq.true");

      const proClubIds = proClubs?.map(c => c.club_id) || [];
      if (proClubIds.length === 0) return { users: [], clubs: [], teams: [] };

      // Fetch clubs and teams in parallel
      const [clubsResult, teamsResult, clubMembersResult] = await Promise.all([
        supabase.from("clubs").select("id, name").in("id", proClubIds),
        supabase.from("teams").select("id, name, club_id").in("club_id", proClubIds),
        supabase.from("user_roles").select("user_id, club_id, team_id").in("club_id", proClubIds).neq("user_id", user!.id),
      ]);

      const clubs = (clubsResult.data || []) as ClubInfo[];
      const teams = (teamsResult.data || []) as TeamInfo[];
      const clubMembers = clubMembersResult.data || [];

      const clubNameMap = new Map(clubs.map(c => [c.id, c.name]));

      if (!clubMembers.length) return { users: [], clubs, teams };

      // Group by user and collect their clubs and teams
      const userClubMap = new Map<string, Set<string>>();
      const userTeamMap = new Map<string, Set<string>>();
      const userClubNameMap = new Map<string, string[]>();
      
      clubMembers.forEach((member: { user_id: string; club_id: string; team_id: string | null }) => {
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

      const uniqueUserIds = [...userClubMap.keys()];

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
    enabled: !!user && open && hasProAccess === true,
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
    mutationFn: async (users: DMableUser[]) => {
      // Create a group chat with all selected users + current user
      const groupName = users.map(u => u.display_name?.split(" ")[0] || "User").join(", ");
      
      const allowedRoles: ("basic_user" | "club_admin" | "team_admin" | "coach" | "player" | "parent" | "app_admin")[] = 
        ["basic_user", "parent", "player", "coach", "team_admin", "club_admin"];
      
      const { data: groupData, error: groupError } = await supabase
        .from("chat_groups")
        .insert({
          name: groupName,
          created_by: user!.id,
          allowed_roles: allowedRoles,
        })
        .select()
        .single();
      
      if (groupError) throw groupError;
      
      // Add all selected users + current user to group_members
      const memberInserts = [
        { group_id: groupData.id, user_id: user!.id, added_by: user!.id },
        ...users.map(u => ({ group_id: groupData.id, user_id: u.id, added_by: user!.id }))
      ];
      
      const { error: membersError } = await supabase
        .from("group_members")
        .insert(memberInserts);
      
      if (membersError) {
        console.error("Failed to add members:", membersError);
        // Don't throw - group was created, members just didn't get added
      }
      
      return groupData.id as string;
    },
    onSuccess: (groupId) => {
      setOpen(false);
      setSelectedUsers([]);
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
    if (selectedUsers.length === 0) return;
    
    if (selectedUsers.length === 1) {
      // Single user - start regular DM
      startDMMutation.mutate(selectedUsers[0].id);
    } else {
      // Multiple users - create group chat
      startGroupDMMutation.mutate(selectedUsers);
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

  return (
    <ResponsiveDialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) {
        setSelectedUsers([]);
        setSearchQuery("");
        setSelectedClubId("all");
        setSelectedTeamId("all");
      }
    }}>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <MessageCircle className="h-4 w-4" />
        <span className="hidden sm:inline">New DM</span>
      </Button>

      <ResponsiveDialogContent fullScreen className="sm:max-w-md sm:max-h-[85vh] flex flex-col p-0">
        <ResponsiveDialogHeader className="p-4 pb-2 border-b sm:border-b-0">
          <ResponsiveDialogTitle className="flex items-center gap-2">
            Start a Conversation
            {!hasProAccess && (
              <Badge variant="secondary" className="gap-1">
                <Crown className="h-3 w-3" />
                Pro
              </Badge>
            )}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Select one or more members to message
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 flex flex-col min-h-0 px-4 pb-4">
          {checkingPro || loadingUsers ? (
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
          ) : (
            <>
              {/* Selected users chips */}
              {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3 p-2 bg-muted/50 rounded-lg">
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

              {/* Filters */}
              <div className="flex gap-2 mb-3">
                <Select value={selectedClubId} onValueChange={handleClubChange}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="All Clubs" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Clubs</SelectItem>
                    {availableClubs.map(club => (
                      <SelectItem key={club.id} value={club.id}>{club.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="All Teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Teams</SelectItem>
                    {filteredTeams.map(team => (
                      <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search members..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <ScrollArea className="flex-1 -mx-4 px-4">
                <div className="space-y-1">
                  {filteredUsers.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      {searchQuery || selectedClubId !== "all" || selectedTeamId !== "all" 
                        ? "No members found" 
                        : "No members available to message"}
                    </div>
                  ) : (
                    filteredUsers.map((dmUser) => {
                      const isSelected = selectedUsers.some(u => u.id === dmUser.id);
                      return (
                        <button
                          key={dmUser.id}
                          onClick={() => toggleUserSelection(dmUser)}
                          disabled={isPending}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left ${
                            isSelected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted"
                          }`}
                        >
                          <div className="relative">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={dmUser.avatar_url || undefined} />
                              <AvatarFallback>
                                {dmUser.display_name?.charAt(0).toUpperCase() || "?"}
                              </AvatarFallback>
                            </Avatar>
                            {isSelected && (
                              <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                                <Check className="h-3 w-3 text-primary-foreground" />
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">
                              {dmUser.display_name || "Unknown User"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {dmUser.shared_clubs.join(", ")}
                            </p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>

              {/* Start conversation button */}
              {selectedUsers.length > 0 && (
                <Button
                  onClick={handleStartConversation}
                  disabled={isPending}
                  className="mt-3 gap-2"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : selectedUsers.length > 1 ? (
                    <Users className="h-4 w-4" />
                  ) : (
                    <MessageCircle className="h-4 w-4" />
                  )}
                  {selectedUsers.length === 1 
                    ? "Start Chat" 
                    : `Create Group (${selectedUsers.length} people)`
                  }
                </Button>
              )}
            </>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
