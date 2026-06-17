import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2, ChevronRight, UserPlus, X, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import MemberDetailSheet from "@/components/MemberDetailSheet";
import AddRoleToMemberDialog from "@/components/AddRoleToMemberDialog";
import { AddGroupMembersDialog } from "@/components/chat/AddGroupMembersDialog";
import { cn } from "@/lib/utils";
import { useOnlineSet } from "@/hooks/useUserPresence";

interface ChatParticipantsListProps {
  chatType: "team" | "club" | "group" | "club_admin";
  chatId: string;
  chatName: string;
  teamId?: string;
  clubId?: string;
  miniLeagueId?: string;
  groupAllowedRoles?: string[];
  groupCreatedBy?: string | null;
  groupMembershipMode?: string | null;
  /** Club-admin thread: include this member alongside the club admins. */
  clubAdminMemberUserId?: string;
  enabled?: boolean;
  /** Called when a tap navigates away (so caller can close its sheet) */
  onBeforeNavigate?: () => void;
  className?: string;
  scrollClassName?: string;
  /** When true, render the list inline (no inner ScrollArea) so the parent container scrolls. */
  inline?: boolean;
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

/**
 * Reusable participants list. Extracted from ChatMembersSheet so it can be
 * embedded inside the unified Chat Details panel.
 */
export function ChatParticipantsList({
  chatType,
  chatId,
  chatName,
  teamId,
  clubId,
  miniLeagueId,
  groupAllowedRoles,
  groupCreatedBy,
  groupMembershipMode,
  clubAdminMemberUserId,
  enabled = true,
  onBeforeNavigate,
  className,
  scrollClassName = "h-[360px]",
  inline = false,
}: ChatParticipantsListProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const navigate = useNavigate();
  const previousCountRef = useRef<number | null>(null);
  const cacheKey = `chat-members-count-${chatType}-${chatId}`;

  const [selectedMember, setSelectedMember] = useState<SelectedMemberDetail | null>(null);
  const [addRoleMember, setAddRoleMember] = useState<{
    userId: string;
    userName: string;
    existingRoles: string[];
  } | null>(null);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [removeMemberConfirm, setRemoveMemberConfirm] = useState<{ id: string; name: string } | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const { data: groupMeta } = useQuery({
    queryKey: ["chat-group-meta", chatId],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_groups")
        .select("created_by, membership_mode")
        .eq("id", chatId)
        .maybeSingle();
      return data ?? null;
    },
    enabled: enabled && chatType === "group",
    staleTime: 5 * 60 * 1000,
  });

  const effectiveGroupMembershipMode = groupMembershipMode ?? groupMeta?.membership_mode ?? null;
  const groupCreatorId = groupCreatedBy ?? groupMeta?.created_by ?? null;
  // "Manual" personal-style membership: either a true personal group (no team/club)
  // or a club-scoped group created with membership_mode === 'manual' (custom category group).
  const isPersonalGroupChat =
    chatType === "group" &&
    !teamId &&
    !miniLeagueId &&
    (!clubId || effectiveGroupMembershipMode === "manual");

  const isGroupCreator = !!user && !!groupCreatorId && groupCreatorId === user.id;

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("group_members")
        .delete()
        .eq("group_id", chatId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member removed");
      queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      setRemoveMemberConfirm(null);
    },
    onError: (err: any) => {
      toast.error("Failed to remove member: " + (err?.message || "Unknown error"));
    },
  });

  const leaveGroupMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("group_members")
        .delete()
        .eq("group_id", chatId)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("You left the group");
      queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      queryClient.invalidateQueries({ queryKey: ["personal-groups"] });
      queryClient.invalidateQueries({ queryKey: ["messages-inbox"] });
      setLeaveConfirmOpen(false);
      navigate("/messages");
    },
    onError: (err: any) => {
      toast.error("Failed to leave group: " + (err?.message || "Unknown error"));
    },
  });

  const effectiveTeamId = chatType === "team" ? chatId : teamId;

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
    enabled: enabled && !!effectiveTeamId,
    staleTime: 1000 * 60 * 30,
  });

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
    enabled: enabled && !!user && !!effectiveTeamId && resolvedClubId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["chat-members", chatType, chatId, teamId, clubId, miniLeagueId, clubAdminMemberUserId, effectiveGroupMembershipMode],
    queryFn: async () => {
      // Club-admin conversation: all club admins + the member
      if (chatType === "club_admin" && clubId) {
        const { data: admins } = await supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("club_id", clubId)
          .eq("role", "club_admin");
        const roleMap = new Map<string, string>();
        for (const a of admins || []) roleMap.set(a.user_id, "club_admin");
        if (clubAdminMemberUserId && !roleMap.has(clubAdminMemberUserId)) {
          roleMap.set(clubAdminMemberUserId, "member");
        }
        const userIds = Array.from(roleMap.keys());
        if (userIds.length === 0) return [] as Member[];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", userIds);
        const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);
        return userIds.map((id) => {
          const p = profileMap.get(id);
          return {
            id,
            display_name: p?.display_name || null,
            avatar_url: p?.avatar_url || null,
            role: roleMap.get(id),
          } as Member;
        });
      }

      // Mini-league chat: union of league admins, per-league grants, and parents of players
      if (chatType === "group" && miniLeagueId) {
        const [leagueRow, perLeagueAdmins, players] = await Promise.all([
          supabase.from("mini_leagues").select("club_id").eq("id", miniLeagueId).maybeSingle(),
          supabase.from("mini_league_admins").select("user_id").eq("mini_league_id", miniLeagueId),
          supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", miniLeagueId)
            .not("parent_user_id", "is", null),
        ]);
        const mlClubId = leagueRow.data?.club_id;
        const roleMap = new Map<string, string>();
        if (mlClubId) {
          const { data: clubRoles } = await supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("club_id", mlClubId)
            .eq("role", "league_admin");
          for (const r of clubRoles || []) {
            roleMap.set(r.user_id, r.role);
          }
        }
        for (const a of perLeagueAdmins.data || []) {
          if (!roleMap.has(a.user_id)) roleMap.set(a.user_id, "league_admin");
        }
        for (const p of players.data || []) {
          if (p.parent_user_id && !roleMap.has(p.parent_user_id)) {
            roleMap.set(p.parent_user_id, "parent");
          }
        }
        const userIds = Array.from(roleMap.keys());
        if (userIds.length === 0) return [] as Member[];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", userIds);
        const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);
        return userIds.map((id) => {
          const profile = profileMap.get(id);
          return {
            id,
            display_name: profile?.display_name || null,
            avatar_url: profile?.avatar_url || null,
            role: roleMap.get(id),
          } as Member;
        });
      }

      if (chatType === "group" && (!teamId && !clubId || effectiveGroupMembershipMode === "manual")) {
        const { data: groupMembers, error } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", chatId);
        if (error) return [];

        const memberIdSet = new Set<string>((groupMembers || []).map((gm) => gm.user_id));
        const roleByUser = new Map<string, string | undefined>();
        for (const id of memberIdSet) roleByUser.set(id, undefined);

        // Manual club-scoped groups also grant access to club_admins (and app_admins)
        // for moderation — surface them in the member list so read receipts reconcile.
        if (clubId) {
          const [{ data: clubAdmins }, { data: appAdmins }] = await Promise.all([
            supabase
              .from("user_roles")
              .select("user_id, role")
              .eq("club_id", clubId)
              .eq("role", "club_admin"),
            supabase
              .from("user_roles")
              .select("user_id, role")
              .eq("role", "app_admin"),
          ]);
          for (const r of [...(clubAdmins || []), ...(appAdmins || [])]) {
            if (!memberIdSet.has(r.user_id)) {
              memberIdSet.add(r.user_id);
              roleByUser.set(r.user_id, r.role);
            }
          }
        }

        const userIds = Array.from(memberIdSet);
        if (userIds.length === 0) return [];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", userIds);
        return (profiles || []).map((p) => ({
          id: p.id,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          role: roleByUser.get(p.id),
        })) as Member[];
      }

      let roleQuery;
      if (chatType === "team") {
        roleQuery = supabase.from("user_roles").select("user_id, role").eq("team_id", chatId);
      } else if (chatType === "club") {
        roleQuery = supabase.from("user_roles").select("user_id, role").eq("club_id", chatId);
      } else if (chatType === "group") {
        if (teamId) {
          roleQuery = supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("team_id", teamId)
            .in(
              "role",
              (groupAllowedRoles || []) as (
                | "app_admin"
                | "basic_user"
                | "club_admin"
                | "coach"
                | "parent"
                | "player"
                | "team_admin"
              )[],
            );
        } else if (clubId) {
          roleQuery = supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("club_id", clubId)
            .in(
              "role",
              (groupAllowedRoles || []) as (
                | "app_admin"
                | "basic_user"
                | "club_admin"
                | "coach"
                | "parent"
                | "player"
                | "team_admin"
              )[],
            );
        } else {
          return [];
        }
      } else {
        return [];
      }

      const { data: roles } = await roleQuery;
      if (!roles?.length) return [];

      const userIds = [...new Set(roles.map((r) => r.user_id))] as string[];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);
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
    enabled,
    staleTime: 1000 * 60 * 5,
  });

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
      const { data } = await supabase.from("clubs").select("bot_user_id").eq("id", cId).maybeSingle();
      return data?.bot_user_id ?? null;
    },
    enabled,
    staleTime: 1000 * 60 * 30,
  });

  const uniqueMembers =
    members?.reduce((acc, member) => {
      if (!acc.find((m) => m.id === member.id) && member.id !== clubBotUserId) {
        acc.push(member);
      }
      return acc;
    }, [] as Member[]) || [];

  const memberIds = useMemo(() => uniqueMembers.map((m) => m.id), [uniqueMembers]);

  const { data: notifPrefs } = useQuery({
    queryKey: ["chat-members-notif-prefs", chatType, chatId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data } = await supabase.rpc("get_members_messages_enabled", { member_ids: memberIds });
      const map: Record<string, boolean> = {};
      const returnedIds = new Set<string>();
      for (const row of data || []) {
        map[row.user_id] = row.messages_enabled;
        returnedIds.add(row.user_id);
      }
      for (const id of memberIds) {
        if (!returnedIds.has(id)) map[id] = false;
      }
      return map;
    },
    enabled: enabled && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  const { data: pushReachable } = useQuery({
    queryKey: ["chat-members-push-reachable", chatType, chatId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data } = await supabase.rpc("get_members_push_reachable", { member_ids: memberIds });
      const map: Record<string, boolean> = {};
      for (const row of data || []) map[row.user_id] = row.has_push;
      return map;
    },
    enabled: enabled && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

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
        if (isMuted) map[row.user_id] = true;
      }
      return map;
    },
    enabled: enabled && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  // Online status: combine realtime presence with DB heartbeat (last 90s).
  const realtimeOnline = useOnlineSet(memberIds);
  const { data: heartbeatOnlineIds } = useQuery({
    queryKey: ["chat-members-online-heartbeat", chatType, chatId, memberIds],
    queryFn: async (): Promise<string[]> => {
      if (memberIds.length === 0) return [];
      const { data, error } = await supabase.rpc(
        "get_online_users_from_set" as any,
        { _user_ids: memberIds },
      );
      if (error || !data) return [];
      return (data as Array<{ user_id: string }>).map((r) => r.user_id);
    },
    enabled: enabled && memberIds.length > 0,
    staleTime: 30 * 1000,
    refetchInterval: 45 * 1000,
  });
  const onlineIds = useMemo(() => {
    const s = new Set<string>(realtimeOnline);
    for (const id of heartbeatOnlineIds || []) s.add(id);
    return s;
  }, [realtimeOnline, heartbeatOnlineIds]);

  const sortedMembers = useMemo(() => {
    return [...uniqueMembers].sort((a, b) => {
      const aOnline = onlineIds.has(a.id) ? 1 : 0;
      const bOnline = onlineIds.has(b.id) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return (a.display_name || "").localeCompare(b.display_name || "");
    });
  }, [uniqueMembers, onlineIds]);



  const formatRole = (role: string) =>
    role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  const handleMemberTap = async (member: Member) => {
    if (!isCurrentUserAdmin || !effectiveTeamId) return;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("id, role")
      .eq("user_id", member.id)
      .eq("team_id", effectiveTeamId);
    onBeforeNavigate?.();
    requestAnimationFrame(() => {
      setSelectedMember({
        userId: member.id,
        displayName: member.display_name || "Unknown",
        avatarUrl: member.avatar_url,
        roles: (roles || []).map((r) => ({ id: r.id, role: r.role })),
      });
    });
  };

  const handleRemoveRole = async (roleItem: { id: string; role: string }) => {
    const { error } = await supabase.from("user_roles").delete().eq("id", roleItem.id);
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

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold">
          Participants{uniqueMembers.length > 0 ? ` · ${uniqueMembers.length}` : ""}
        </h3>
        {isPersonalGroupChat && isGroupCreator && (
          <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => setAddPeopleOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add
          </Button>
        )}
      </div>

      {(() => {
        const listBody = membersLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : uniqueMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No participants found</p>
        ) : (
          <div className="space-y-1">
            {sortedMembers.map((member) => {
              const pushDisabled = notifPrefs ? notifPrefs[member.id] === false : false;
              const noPushSetup = pushReachable ? pushReachable[member.id] === false : false;
              const chatMuted = mutePrefs?.[member.id] ?? false;
              const canTap = isCurrentUserAdmin && !!effectiveTeamId;
              return (
                <div
                  key={member.id}
                  className={`flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 ${
                    canTap ? "cursor-pointer active:bg-muted" : ""
                  }`}
                  onClick={canTap ? () => handleMemberTap(member) : undefined}
                >
                  <div className="relative shrink-0">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={member.avatar_url || undefined} />
                      <AvatarFallback>{member.display_name?.[0]?.toUpperCase() || "?"}</AvatarFallback>
                    </Avatar>
                    {onlineIds.has(member.id) && (
                      <span
                        className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-background"
                        aria-label="Online"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{member.display_name || "Unknown"}</p>
                    {member.role && (
                      <p className="text-xs text-muted-foreground">{formatRole(member.role)}</p>
                    )}
                  </div>
                  {canTap && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  {(pushDisabled || noPushSetup) && (
                    <svg
                      style={{ marginLeft: 4, flexShrink: 0 }}
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-label={noPushSetup ? "No push notifications set up" : "Push notifications disabled"}
                    >
                      <path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 1 .6 5" />
                      <path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" />
                      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                      <line x1="2" y1="2" x2="22" y2="22" />
                    </svg>
                  )}
                  {chatMuted && (
                    <svg
                      style={{ marginLeft: 2, flexShrink: 0 }}
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A.7.7 0 0 1 5.9 7.8H4a1 1 0 0 0-1 1v6.4a1 1 0 0 0 1 1h1.9a.7.7 0 0 1 .513.213l3.384 3.383A.705.705 0 0 0 11 19.298z" />
                      <line x1="22" y1="9" x2="16" y2="15" />
                      <line x1="16" y1="9" x2="22" y2="15" />
                    </svg>
                  )}
                  {isPersonalGroupChat && isGroupCreator && member.id !== user?.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRemoveMemberConfirm({
                          id: member.id,
                          name: member.display_name || "this member",
                        });
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
        );
        return inline ? listBody : (
          <div
            className={cn("min-h-0 overflow-y-auto overscroll-contain", scrollClassName)}
            data-allow-scroll
            data-chat-scroll-lock="true"
            style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
          >
            {listBody}
          </div>
        );
      })()}

      {isPersonalGroupChat && !!user && memberIds.includes(user.id) && (
        <div className="mt-3 px-1">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setLeaveConfirmOpen(true)}
          >
            <LogOut className="h-4 w-4" />
            Leave group
          </Button>
        </div>
      )}

      {selectedMember && effectiveTeamId && (
        <MemberDetailSheet
          open={!!selectedMember}
          onOpenChange={(o) => {
            if (!o) setSelectedMember(null);
          }}
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
              existingRoles: selectedMember.roles.map((r) => r.role),
            });
          }}
          onMove={() => {}}
          onRemove={handleRemoveMember}
          onRemoveRole={handleRemoveRole}
        />
      )}

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
              queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
            }
          }}
        />
      )}

      {isPersonalGroupChat && (
        <AddGroupMembersDialog
          open={addPeopleOpen}
          onOpenChange={setAddPeopleOpen}
          groupId={chatId}
          existingMemberIds={memberIds}
        />
      )}

      <AlertDialog
        open={!!removeMemberConfirm}
        onOpenChange={(o) => {
          if (!o) setRemoveMemberConfirm(null);
        }}
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
              onClick={() =>
                removeMemberConfirm && removeMemberMutation.mutate(removeMemberConfirm.id)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave group?</AlertDialogTitle>
            <AlertDialogDescription>
              You will no longer receive messages from this group. The group creator can add you back later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => leaveGroupMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
