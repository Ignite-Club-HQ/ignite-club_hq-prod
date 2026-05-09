import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, Loader2, ChevronRight, UserPlus, X, Bell, BellRing } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import MemberDetailSheet from "@/components/MemberDetailSheet";
import AddRoleToMemberDialog from "@/components/AddRoleToMemberDialog";
import { AddGroupMembersDialog } from "@/components/chat/AddGroupMembersDialog";
import { NotificationNudgeDialog } from "@/components/NotificationNudgeDialog";
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
import { toast } from "sonner";

interface ChatMembersSheetProps {
  chatType: "team" | "club" | "group";
  chatId: string;
  chatName: string;
  teamId?: string;
  clubId?: string;
  groupAllowedRoles?: string[];
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

interface Member {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role?: string;
}

interface SelectedMemberDetail {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  roles: { id: string; role: string }[];
}

export function ChatMembersSheet({ 
  chatType, 
  chatId, 
  chatName,
  teamId,
  clubId,
  groupAllowedRoles,
  externalOpen,
  onExternalOpenChange,
}: ChatMembersSheetProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = onExternalOpenChange || setInternalOpen;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const previousCountRef = useRef<number | null>(null);
  const cacheKey = `chat-members-count-${chatType}-${chatId}`;

  // Role management state
  const [selectedMember, setSelectedMember] = useState<SelectedMemberDetail | null>(null);
  const [addRoleMember, setAddRoleMember] = useState<{ userId: string; userName: string; existingRoles: string[] } | null>(null);

  // Personal group management state
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [removeMemberConfirm, setRemoveMemberConfirm] = useState<{ id: string; name: string } | null>(null);

  // Self push-enable dialog
  const [selfNudgeOpen, setSelfNudgeOpen] = useState(false);

  // Track members that we've already nudged in this session (to disable button)
  const [nudgedMemberIds, setNudgedMemberIds] = useState<Set<string>>(new Set());

  // Send a one-tap nudge notification to a specific member
  const nudgeMutation = useMutation({
    mutationFn: async (member: { id: string; name: string }) => {
      const { error } = await supabase.from("notifications").insert({
        user_id: member.id,
        type: "admin_nudge",
        message: `Turn on notifications so you don't miss messages in ${chatName}.`,
      });
      if (error) throw error;
      return member;
    },
    onSuccess: (member) => {
      setNudgedMemberIds((prev) => new Set(prev).add(member.id));
      toast.success(`Reminder sent to ${member.name}`);
    },
    onError: (err: any) => {
      toast.error("Could not send reminder: " + (err?.message || "unknown error"));
    },
  });

  // Is this a personal group (no team/club/league binding)?
  const isPersonalGroupChat = chatType === "group" && !teamId && !clubId;

  // Fetch the group creator so we can show creator-only controls
  const { data: groupCreatorId } = useQuery({
    queryKey: ["chat-group-creator", chatId],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_groups")
        .select("created_by")
        .eq("id", chatId)
        .maybeSingle();
      return data?.created_by ?? null;
    },
    enabled: open && isPersonalGroupChat,
    staleTime: 5 * 60 * 1000,
  });

  const isGroupCreator = !!user && !!groupCreatorId && groupCreatorId === user.id;

  // Remove a member from a personal group (creator only — enforced by RLS)
  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("group_members")
        .delete()
        .eq("group_id", chatId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_data, userId) => {
      toast.success("Member removed");
      queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      setRemoveMemberConfirm(null);
    },
    onError: (err: any) => {
      toast.error("Failed to remove member: " + (err?.message || "Unknown error"));
    },
  });

  // Resolve the effective team ID for role management
  const effectiveTeamId = chatType === "team" ? chatId : teamId;

  // Resolve clubId for the team if not provided
  const { data: resolvedClubId } = useQuery({
    queryKey: ["chat-members-team-club", effectiveTeamId],
    queryFn: async () => {
      if (clubId) return clubId;
      if (chatType === "club") return chatId;
      if (!effectiveTeamId) return null;
      const { data } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", effectiveTeamId)
        .maybeSingle();
      return data?.club_id ?? null;
    },
    enabled: open && !!effectiveTeamId,
    staleTime: 1000 * 60 * 30,
  });

  // Check if current user is admin (for team chats or group chats with teamId)
  const { data: isCurrentUserAdmin } = useQuery({
    queryKey: ["chat-members-admin-check", effectiveTeamId, resolvedClubId, user?.id],
    queryFn: async () => {
      if (!user || !effectiveTeamId) return false;
      
      const [teamRoleResult, clubRoleResult, appAdminResult] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("team_id", effectiveTeamId)
          .in("role", ["team_admin", "coach"])
          .maybeSingle(),
        resolvedClubId
          ? supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", user.id)
              .eq("club_id", resolvedClubId)
              .eq("role", "club_admin")
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "app_admin")
          .maybeSingle(),
      ]);
      
      return !!teamRoleResult.data || !!clubRoleResult.data || !!appAdminResult.data;
    },
    enabled: open && !!user && !!effectiveTeamId && resolvedClubId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

  // Check if this is a personal group (no team_id or club_id)
  const isPersonalGroup = chatType === "group" && !teamId && !clubId;

  // Fetch members based on chat type
  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["chat-members", chatType, chatId, teamId, clubId],
    queryFn: async () => {
      // For personal groups, fetch from group_members table
      if (chatType === "group" && !teamId && !clubId) {
        const { data: groupMembers, error } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", chatId);
        
        if (error || !groupMembers?.length) return [];
        
        const userIds = groupMembers.map(gm => gm.user_id);
        
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", userIds);
        
        return (profiles || []).map(p => ({
          id: p.id,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          role: undefined,
        })) as Member[];
      }
      
      // For team/club groups, use role-based membership
      let roleQuery;
      
      if (chatType === "team") {
        roleQuery = supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("team_id", chatId);
      } else if (chatType === "club") {
        roleQuery = supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("club_id", chatId);
      } else if (chatType === "group") {
        if (teamId) {
          roleQuery = supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("team_id", teamId)
            .in("role", (groupAllowedRoles || []) as ("app_admin" | "basic_user" | "club_admin" | "coach" | "parent" | "player" | "team_admin")[]);
        } else if (clubId) {
          roleQuery = supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("club_id", clubId)
            .in("role", (groupAllowedRoles || []) as ("app_admin" | "basic_user" | "club_admin" | "coach" | "parent" | "player" | "team_admin")[]);
        } else {
          return [];
        }
      } else {
        return [];
      }

      const { data: roles } = await roleQuery;
      if (!roles?.length) return [];

      const userIds = [...new Set(roles.map(r => r.user_id))] as string[];
      
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      const memberMap = new Map<string, Member>();
      for (const r of roles) {
        if (!memberMap.has(r.user_id)) {
          const profile = profileMap.get(r.user_id);
          memberMap.set(r.user_id, {
            id: r.user_id,
            display_name: profile?.display_name || null,
            avatar_url: profile?.avatar_url || null,
            role: r.role,
          });
        }
      }
      
      return Array.from(memberMap.values());
    },
    enabled: open,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch club bot_user_id to hide from member list
  const resolvedClubIdForBot = chatType === "club" ? chatId : clubId;
  const { data: clubBotUserId } = useQuery({
    queryKey: ["club-bot-user", chatType, chatId, resolvedClubIdForBot],
    queryFn: async () => {
      let cId = resolvedClubIdForBot;
      if (!cId && chatType === "team") {
        const { data: team } = await supabase
          .from("teams")
          .select("club_id")
          .eq("id", chatId)
          .maybeSingle();
        cId = team?.club_id ?? undefined;
      }
      if (!cId) return null;
      const { data } = await supabase
        .from("clubs")
        .select("bot_user_id")
        .eq("id", cId)
        .maybeSingle();
      return data?.bot_user_id ?? null;
    },
    enabled: open,
    staleTime: 1000 * 60 * 30,
  });

  // Deduplicate members by id and filter out club bot account
  const uniqueMembers = members?.reduce((acc, member) => {
    if (!acc.find(m => m.id === member.id) && member.id !== clubBotUserId) {
      acc.push(member);
    }
    return acc;
  }, [] as Member[]) || [];

  const memberIds = useMemo(() => uniqueMembers.map(m => m.id), [uniqueMembers]);

  // Fetch notification preferences
  const { data: notifPrefs } = useQuery({
    queryKey: ["chat-members-notif-prefs", chatType, chatId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data, error } = await supabase
        .rpc("get_members_messages_enabled", { member_ids: memberIds });
      if (error) console.error("[ChatMembers] notif prefs RPC error:", error);
      const map: Record<string, boolean> = {};
      const returnedIds = new Set<string>();
      for (const row of data || []) {
        map[row.user_id] = row.messages_enabled;
        returnedIds.add(row.user_id);
      }
      for (const id of memberIds) {
        if (!returnedIds.has(id)) {
          map[id] = false;
        }
      }
      return map;
    },
    enabled: open && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  // Fetch push reachability
  const { data: pushReachable } = useQuery({
    queryKey: ["chat-members-push-reachable", chatType, chatId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data, error } = await supabase
        .rpc("get_members_push_reachable", { member_ids: memberIds });
      if (error) console.error("[ChatMembers] push reachable RPC error:", error);
      const map: Record<string, boolean> = {};
      for (const row of data || []) {
        map[row.user_id] = row.has_push;
      }
      return map;
    },
    enabled: open && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  // Fetch chat mute preferences
  const { data: mutePrefs } = useQuery({
    queryKey: ["chat-members-mute-prefs", chatType, chatId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data } = await supabase
        .from("chat_mute_preferences")
        .select("user_id, muted_until")
        .eq("chat_type", chatType)
        .eq("chat_id", chatId)
        .in("user_id", memberIds);
      const now = new Date();
      const map: Record<string, boolean> = {};
      for (const row of data || []) {
        const isMuted = !row.muted_until || new Date(row.muted_until) > now;
        if (isMuted) {
          map[row.user_id] = true;
        }
      }
      return map;
    },
    enabled: open && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  const handleNavigateToPage = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const formatRole = (role: string) => {
    return role.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  };

  // Handle member tap — fetch full roles then show detail sheet
  const handleMemberTap = async (member: Member) => {
    if (!isCurrentUserAdmin || !effectiveTeamId) return;
    
    const { data: roles } = await supabase
      .from("user_roles")
      .select("id, role")
      .eq("user_id", member.id)
      .eq("team_id", effectiveTeamId);

    setOpen(false);
    requestAnimationFrame(() => {
      setSelectedMember({
        userId: member.id,
        displayName: member.display_name || "Unknown",
        avatarUrl: member.avatar_url,
        roles: (roles || []).map(r => ({ id: r.id, role: r.role })),
      });
    });
  };

  // Handle role removal
  const handleRemoveRole = async (roleItem: { id: string; role: string }) => {
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("id", roleItem.id);
    if (error) {
      toast.error("Failed to remove role");
    } else {
      toast.success("Role removed");
      if (effectiveTeamId) {
        queryClient.invalidateQueries({ queryKey: ["team-roles", effectiveTeamId] });
      }
      queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      setSelectedMember(null);
    }
  };

  // Handle member removal from team
  const handleRemoveMember = async () => {
    if (!selectedMember || !effectiveTeamId) return;
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", selectedMember.userId)
      .eq("team_id", effectiveTeamId);
    if (error) {
      toast.error("Failed to remove member");
    } else {
      toast.success("Member removed");
      queryClient.invalidateQueries({ queryKey: ["team-roles", effectiveTeamId] });
      queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      setSelectedMember(null);
    }
  };

  // Check if member count decreased and trigger refresh
  useEffect(() => {
    if (!membersLoading && uniqueMembers.length > 0) {
      const storedCount = localStorage.getItem(cacheKey);
      const previousCount = storedCount ? parseInt(storedCount, 10) : null;
      if (previousCount !== null && uniqueMembers.length < previousCount) {
        queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      }
      localStorage.setItem(cacheKey, uniqueMembers.length.toString());
      previousCountRef.current = uniqueMembers.length;
    }
  }, [uniqueMembers.length, membersLoading, cacheKey, queryClient, chatType, chatId]);

  const isExternallyControlled = externalOpen !== undefined;

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        {!isExternallyControlled && (
          <SheetTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              title="View members"
            >
              <Users className="h-4 w-4" />
            </Button>
          </SheetTrigger>
        )}
        <SheetContent side="right" className="w-[300px] sm:w-[400px]">
          <SheetHeader>
            <SheetTitle>{chatName}</SheetTitle>
          </SheetHeader>
          
          <div className="mt-4">
            {/* Navigation links */}
            {chatType === "team" && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => handleNavigateToPage(`/teams/${chatId}`)}
                  className="flex w-full touch-manipulation items-center justify-between rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted"
                >
                  <span className="text-sm font-medium">View team page</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
                <Separator className="mt-2" />
              </div>
            )}
            {chatType === "club" && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => handleNavigateToPage(`/clubs/${chatId}`)}
                  className="flex w-full touch-manipulation items-center justify-between rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted"
                >
                  <span className="text-sm font-medium">View club page</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
                <Separator className="mt-2" />
              </div>
            )}
            {chatType === "group" && (teamId || clubId) && (
              <div className="mb-3">
                {teamId && (
                  <button
                    type="button"
                    onClick={() => handleNavigateToPage(`/teams/${teamId}`)}
                    className="flex w-full touch-manipulation items-center justify-between rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted"
                  >
                    <span className="text-sm font-medium">View team page</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
                {clubId && (
                  <button
                    type="button"
                    onClick={() => handleNavigateToPage(`/clubs/${clubId}`)}
                    className="flex w-full touch-manipulation items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50 active:bg-muted"
                  >
                    <span className="text-sm text-muted-foreground">View club page</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
                <Separator className="mt-2" />
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">
                  Members {uniqueMembers.length > 0 && `(${uniqueMembers.length})`}
                </h3>
                {isPersonalGroupChat && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 h-8"
                    onClick={() => setAddPeopleOpen(true)}
                  >
                    <UserPlus className="h-4 w-4" />
                    Add
                  </Button>
                )}
              </div>
              <ScrollArea className="h-[calc(100vh-180px)]">
                {membersLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : uniqueMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No members found
                  </p>
                ) : (
                  <div className="space-y-2">
                      {uniqueMembers.map((member) => {
                        const pushDisabled = notifPrefs ? (notifPrefs[member.id] === false) : false;
                        const noPushSetup = pushReachable ? (pushReachable[member.id] === false) : false;
                        const chatMuted = mutePrefs?.[member.id] ?? false;
                        const canTap = isCurrentUserAdmin && !!effectiveTeamId;

                        return (
                          <div
                            key={member.id}
                            className={`flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 ${canTap ? "cursor-pointer active:bg-muted" : ""}`}
                            onClick={canTap ? () => handleMemberTap(member) : undefined}
                          >
                            <Avatar className="h-9 w-9">
                              <AvatarImage src={member.avatar_url || undefined} />
                              <AvatarFallback>
                                {member.display_name?.[0]?.toUpperCase() || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {member.display_name || "Unknown"}
                              </p>
                              {member.role && (
                                <p className="text-xs text-muted-foreground">
                                  {formatRole(member.role)}
                                </p>
                              )}
                            </div>
                            {canTap && (
                              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            {(pushDisabled || noPushSetup) && (
                              <svg style={{ marginLeft: 4, flexShrink: 0 }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label={noPushSetup ? "No push notifications set up" : "Push notifications disabled"}><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 1 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                            )}
                            {chatMuted && (
                              <svg style={{ marginLeft: 2, flexShrink: 0 }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A.7.7 0 0 1 5.9 7.8H4a1 1 0 0 0-1 1v6.4a1 1 0 0 0 1 1h1.9a.7.7 0 0 1 .513.213l3.384 3.383A.705.705 0 0 0 11 19.298z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>
                            )}
                            {isPersonalGroupChat && isGroupCreator && member.id !== user?.id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRemoveMemberConfirm({ id: member.id, name: member.display_name || "this member" });
                                }}
                                aria-label="Remove member"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Member detail sheet for role management */}
      {selectedMember && effectiveTeamId && (
        <MemberDetailSheet
          open={!!selectedMember}
          onOpenChange={(o) => { if (!o) setSelectedMember(null); }}
          userId={selectedMember.userId}
          displayName={selectedMember.displayName}
          avatarUrl={selectedMember.avatarUrl}
          roles={selectedMember.roles}
          canManage={true}
          canMove={false}
          isSelf={selectedMember.userId === user?.id}
          onAddRole={() => {
            setAddRoleMember({
              userId: selectedMember.userId,
              userName: selectedMember.displayName,
              existingRoles: selectedMember.roles.map(r => r.role),
            });
          }}
          onMove={() => {}}
          onRemove={handleRemoveMember}
          onRemoveRole={handleRemoveRole}
        />
      )}

      {/* Add role dialog */}
      {addRoleMember && effectiveTeamId && resolvedClubId && (
        <AddRoleToMemberDialog
          userId={addRoleMember.userId}
          userName={addRoleMember.userName}
          teamId={effectiveTeamId}
          teamName={chatName}
          clubId={resolvedClubId}
          existingRoles={addRoleMember.existingRoles}
          open={!!addRoleMember}
          onOpenChange={(o) => {
            if (!o) {
              setAddRoleMember(null);
              // Refresh member list
              queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
            }
          }}
        />
      )}

      {/* Add people to a personal group */}
      {isPersonalGroupChat && (
        <AddGroupMembersDialog
          open={addPeopleOpen}
          onOpenChange={setAddPeopleOpen}
          groupId={chatId}
          existingMemberIds={memberIds}
        />
      )}

      {/* Confirm member removal (creator only) */}
      <AlertDialog
        open={!!removeMemberConfirm}
        onOpenChange={(o) => { if (!o) setRemoveMemberConfirm(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeMemberConfirm?.name} will no longer be able to see or post in this group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMemberConfirm && removeMemberMutation.mutate(removeMemberConfirm.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
