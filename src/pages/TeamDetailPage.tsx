import { useState, useEffect, useRef, lazy, Suspense, useMemo, type ReactNode } from "react";
import { prefetchProfiles } from "@/hooks/useProfiles";
import { cacheProfiles, getProfileFromCache, selectCachedProfileById, selectCachedProfilesByIds } from "@/lib/profileCache";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Users, Calendar, MessageCircle, Settings, Trash2, UserPlus, Loader2, Crown, Pencil, LayoutGrid, Plus, Target, Timer, X, RefreshCw, CreditCard, Flame, Building2, Lock, FolderOpen, BarChart3, Archive, ArchiveRestore, ClipboardCheck, Copy, ChevronRight, LogOut, ArrowRightLeft, Trophy, Eye, Radio, MoreVertical, Image as ImageIcon, FileText } from "lucide-react";
import { TeamNextEventCard } from "@/components/team/TeamNextEventCard";
import { TeamRankCard } from "@/components/team/TeamRankCard";
import { TeamNextStepsCard } from "@/components/team/TeamNextStepsCard";
import { TeamLatestPhotos } from "@/components/team/TeamLatestPhotos";
import { TeamChatPreview } from "@/components/team/TeamChatPreview";
import { ArchiveTeamDialog } from "@/components/ArchiveTeamDialog";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import InviteOtherParentSheet from "@/components/InviteOtherParentSheet";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SwipeableCard } from "@/components/ui/swipeable-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { markTeamDeleted, unmarkTeamDeleted } from "@/lib/deletedTeamTombstones";
import { removeTeamFromMessagesPageCache } from "@/lib/messagesPageCache";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
const PitchBoard = lazyWithRetry(() => import("@/components/pitch/PitchBoard"));
// NetballBoard / BasketballBoard archived — football-only build (see archive/sports/)
const TeamGameHistoryTab = lazyWithRetry(() => import("@/components/history/TeamGameHistoryTab"));
import { isNetballSport, isBasketballSport } from "@/lib/sportDetection";
import {
  clearPitchBoardOpenFlag,
  shouldRestorePitchBoardForCurrentPath,
} from "@/components/pitch/pitchBoardOpenFlag";
import { DefaultPitchSettings } from "@/components/pitch/DefaultPitchSettings";
import CreateGroupDialog from "@/components/chat/CreateGroupDialog";
import ChatGroupsList from "@/components/chat/ChatGroupsList";
const AddTeamMemberSheet = lazyWithRetry(() => import("@/components/AddTeamMemberSheet"));
import AddPlayerToParentSheet from "@/components/team/AddPlayerToParentSheet";
import LinkChildToParentSheet from "@/components/LinkChildToParentSheet";
import { TeamAdminInviteDialog } from "@/components/TeamAdminInviteDialog";
import TeamPlayerPositionEditor from "@/components/TeamPlayerPositionEditor";
import PlayerPositionSheet from "@/components/PlayerPositionSheet";
import AddRoleToMemberDialog from "@/components/AddRoleToMemberDialog";
import MemberDetailSheet from "@/components/MemberDetailSheet";
import ChildDetailSheet from "@/components/ChildDetailSheet";
import PromoteToTeamAdminDialog from "@/components/PromoteToTeamAdminDialog";
import TeamCaptainCard from "@/components/TeamCaptainCard";

import { MoveToTeamSheet } from "@/components/MoveToTeamSheet";
import { getSportEmoji } from "@/lib/sportEmojis";
import { findNearbyGameEvent } from "@/hooks/useNearbyGameEvent";
import MemberSubscriptionPaymentsManager from "@/components/MemberSubscriptionPaymentsManager";
import { PrimarySponsorDisplay } from "@/components/PrimarySponsorDisplay";
import { TeamSponsorSelector } from "@/components/TeamSponsorSelector";
import PendingInvitesList from "@/components/PendingInvitesList";

import TeamRewardsManager from "@/components/TeamRewardsManager";
import { ClassAttendanceSingle } from "@/components/ClassAttendanceSingle";
import { cn } from "@/lib/utils";
import { defaultMinutesPerHalfForTeamName } from "@/lib/teamAgeDefaults";
import TeamCompetitionsSection from "@/components/competitions/TeamCompetitionsSection";
import { PlayHQTeamLinkCard } from "@/components/PlayHQTeamLinkCard";
import { friendlyQueryError, friendlyQueryErrorMessage } from "@/lib/friendlyQueryError";
import { lazyWithRetry } from "@/lib/lazyWithRetry";


type TeamRole = "player" | "parent" | "coach" | "team_admin";

const SOCCER_SPORTS = ["soccer", "football", "futsal"];
const normalizeDutyName = (name: string | null | undefined) => name?.trim().toLowerCase() ?? "";

const teamRoleOptions: { value: TeamRole; label: string }[] = [
  { value: "player", label: "Player" },
  { value: "parent", label: "Parent" },
  { value: "coach", label: "Coach" },
  { value: "team_admin", label: "Team Admin" },
];

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [memberRoleFilter, setMemberRoleFilter] = useState<string>("all");
  const [headerInviteOpen, setHeaderInviteOpen] = useState(false);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [hasSetInitialFilter, setHasSetInitialFilter] = useState(false);
  
  const [selectedRole, setSelectedRole] = useState<TeamRole>("player");
  const [selectedChildForLink, setSelectedChildForLink] = useState<string>("");
  const [newChildName, setNewChildName] = useState<string>("");
  const [showPitchBoard, setShowPitchBoard] = useState(false);
  const [linkedEventId, setLinkedEventId] = useState<string | null>(null);
  const [pitchBoardMembersOverride, setPitchBoardMembersOverride] = useState<Array<{ id: string; user_id: string; role: string; profiles: { display_name: string | null; avatar_url: string | null } | null }>>([]);
  const [isSavingPitchSettings, setIsSavingPitchSettings] = useState(false);
  
  // Long-press position editor state
  const [positionSheetPlayer, setPositionSheetPlayer] = useState<{ id: string; name: string; type: "member" | "child" } | null>(null);
  const [inviteParentChild, setInviteParentChild] = useState<{ childId: string; childName: string } | null>(null);
  const [linkChildToParent, setLinkChildToParent] = useState<{ childName: string; existingChildId?: string; pendingInviteIds: string[] } | null>(null);
  const [moveToTeam, setMoveToTeam] = useState<{ type: "adult" | "child"; id: string; name: string; roles?: string[] } | null>(null);
  const [addRoleMember, setAddRoleMember] = useState<{ userId: string; userName: string; existingRoles: string[] } | null>(null);
  const [removeMember, setRemoveMember] = useState<{ userId: string; name: string } | null>(null);
  const [removeChild, setRemoveChild] = useState<{ childId: string; name: string } | null>(null);
  const [removeChildConfirmText, setRemoveChildConfirmText] = useState("");
  const [selectedMember, setSelectedMember] = useState<{ userId: string; displayName: string; avatarUrl?: string | null; roles: { id: string; role: string }[] } | null>(null);
  const [selectedChild, setSelectedChild] = useState<{ childId: string; childName: string; parentDisplay: string | null; isPending: boolean; linkInviteIds?: string[] } | null>(null);
  
  // Handle admin invite dialog from team creation flow
  const locationState = location.state as { showAdminInvite?: boolean; inviteName?: string; inviteEmail?: string; teamName?: string } | null;
  const [showAdminInviteDialog, setShowAdminInviteDialog] = useState(!!locationState?.showAdminInvite);
  const adminInviteName = locationState?.inviteName || "";
  const adminInviteEmail = locationState?.inviteEmail || "";
  const adminInviteTeamName = locationState?.teamName || "";

  const { data: team, isLoading, fetchStatus: teamFetchStatus } = useQuery({
    queryKey: ["team", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs!club_id (id, name, is_pro, sport, class_mode_enabled, bot_user_id)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
  const teamQueryPaused = teamFetchStatus === "paused";

  const isSoccerClub = team?.clubs?.sport && SOCCER_SPORTS.some(keyword => 
    team.clubs.sport.toLowerCase().includes(keyword)
  );
  const isNetballClub = isNetballSport(team?.clubs?.sport);
  const isBasketballClub = isBasketballSport(team?.clubs?.sport);

  const isClassMode = !!team?.clubs?.class_mode_enabled;

  // Default to "child" filter only when arriving from an invite link for junior teams
  useEffect(() => {
    if (team && !hasSetInitialFilter) {
      const tType = (team as any).team_type || "mixed";
      const fromInvite = new URLSearchParams(window.location.search).get("from") === "invite";
      if (tType === "junior" && fromInvite) {
        setMemberRoleFilter("child");
      }
      setHasSetInitialFilter(true);
    }
  }, [team, hasSetInitialFilter]);

  // Auto-open the game board when arriving from a "Resume game" tap
  // (CourtBoardResumeCard / GameTimerWidget on the home screen).
  // Depend on location.search so a warm-resume restore from
  // PitchBoardResumeRedirect (which appends ?openPitchBoard=1 via replace
  // navigation while this page is already mounted) re-triggers the effect.
  useEffect(() => {
    if (!team) return;
    const params = new URLSearchParams(window.location.search);
    // Accept both `openBoard=1` (CourtBoardResumeCard / GameTimerWidget) and
    // `openPitchBoard=1` (PitchBoardResumeRedirect cold-start recovery) so a
    // restored team-scoped pitch board reopens regardless of entry point.
    if (
      params.get("openBoard") === "1" ||
      params.get("openPitchBoard") === "1" ||
      shouldRestorePitchBoardForCurrentPath(window.location.pathname)
    ) {
      setShowPitchBoard(true);
      // Strip the param so a refresh doesn't re-open after the coach closed it.
      params.delete("openBoard");
      params.delete("openPitchBoard");
      const next = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${next ? `?${next}` : ""}`
      );
    }
  }, [team, location.search]);


  // Check if user (or their children) is already enrolled in this class
  const { data: isEnrolledInClass } = useQuery({
    queryKey: ["class-enrolment-check", id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_enrolments")
        .select("id")
        .eq("team_id", id!)
        .neq("status", "withdrawn")
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    enabled: !!id && !!user && isClassMode,
  });

  const { data: teamSubscription } = useQuery({
    queryKey: ["team-subscription", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_subscriptions")
        .select("*")
        .eq("team_id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: clubSubscription, isLoading: isClubSubscriptionLoading, isFetching: isClubSubscriptionFetching } = useQuery({
    queryKey: ["club-subscription", team?.club_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", team!.club_id)
        .maybeSingle();
      if (error) throw friendlyQueryError(error, "this club's subscription details");
      return data;
    },
    enabled: !!team?.club_id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes to prevent unnecessary refetches
  });

  // Check if user is club admin for this team's club (needed for isSubscriptionLoading calculation)
  const { data: isClubAdmin, isLoading: isClubAdminLoading, isFetching: isClubAdminFetching } = useQuery({
    queryKey: ["is-club-admin", user?.id, team?.club_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("club_id", team!.club_id)
        .eq("role", "club_admin")
        .maybeSingle();
      if (error) throw friendlyQueryError(error, "your club admin permissions");
      return !!data;
    },
    enabled: !!user && !!team?.club_id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });


  // Note: team folders query and mutation removed - "Move to Folder" no longer in this page

  // Track if subscription data is still loading - don't show Pro lock while loading OR refetching
  // Must wait for:
  // 1. Team to load (so we know if it has a club_id)
  // 2. Club subscription to load/refetch (if team has a club_id)
  // 3. Club admin check to load/refetch (affects whether we show admin features)
  // Using isFetching catches both initial load AND background refetches
  const isSubscriptionLoading = isLoading || (!!team?.club_id && (isClubSubscriptionLoading || isClubAdminLoading || isClubSubscriptionFetching || isClubAdminFetching));

  // Pro Access Logic:
  // 1. If club has Pro → ALL teams inherit Pro (clubSubscription takes precedence)
  // 2. If club does NOT have Pro → check team's individual subscription
  const clubHasPro = clubSubscription?.is_pro || clubSubscription?.is_pro_football || 
                     clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override;
  
  const teamHasIndividualPro = teamSubscription?.is_pro || teamSubscription?.is_pro_football ||
                                (teamSubscription as any)?.admin_pro_override || (teamSubscription as any)?.admin_pro_football_override ||
                                team?.is_pro;
  
  // Team has Pro if: club has Pro (inherited) OR (club is free AND team has individual Pro)
  // IMPORTANT: During loading, assume Pro access (optimistic) to avoid flashing Pro locks
  const isTeamPro = isSubscriptionLoading ? true : (clubHasPro || (!clubHasPro && teamHasIndividualPro));
  
  const clubHasProFootball = clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override;
  const teamHasIndividualProFootball = teamSubscription?.is_pro_football || (teamSubscription as any)?.admin_pro_football_override;
  // During loading, assume Pro access to avoid flashing Pro locks
  const hasProFootball = isSubscriptionLoading ? true : (clubHasProFootball || (!clubHasProFootball && teamHasIndividualProFootball));

  // Trial detection: team is on trial if subscription says so OR if team.is_pro with pro_expires_at (website signup)
  const isOnTrial = !!(
    teamSubscription?.is_trial ||
    clubSubscription?.is_trial ||
    (team?.is_pro && (team as any)?.pro_expires_at)
  );

  // Note: refetchOnMount: 'always' on the queries ensures fresh data
  // without clearing the cache (which would cause a flash of empty state)

  // Fetch children assigned to the team
  const { data: teamChildren = [], isLoading: isChildrenLoading, isFetching: isChildrenFetching, refetch: refetchChildren } = useQuery({
    queryKey: ["team-children", id],
    queryFn: async () => {
      const { data: rpcChildren, error: rpcError } = await supabase.rpc("get_team_children_for_pitch_board", {
        p_team_id: id!,
      });
      if (rpcError) throw rpcError;

      const childrenRows = rpcChildren || [];
      if (childrenRows.length === 0) return [];

      const childIds = childrenRows.map((row) => row.child_id);

      // Guardians are club-scoped: a parent linked to this child at ANOTHER club
      // must never surface on this club's roster.
      const { data: teamRow } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", id!)
        .maybeSingle();
      const { data: guardianLinks } = teamRow?.club_id
        ? await supabase.rpc("club_scoped_child_guardians", {
            p_child_ids: childIds,
            p_club_id: teamRow.club_id,
          })
        : { data: [] as { child_id: string; guardian_id: string }[] };


      const parentIds = [...new Set([
        ...childrenRows.map((c) => c.parent_id).filter(Boolean),
        ...(guardianLinks || []).map((g) => g.guardian_id).filter(Boolean),
      ])];

      let parentProfiles: Record<string, { id: string; display_name: string | null }> = {};
      if (parentIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(parentIds);
        parentProfiles = (profiles || []).reduce((acc, p) => {
          acc[p.id] = p;
          return acc;
        }, {} as Record<string, { id: string; display_name: string | null }>);
      }

      const guardiansByChild: Record<string, string[]> = {};
      for (const link of (guardianLinks || [])) {
        if (!guardiansByChild[link.child_id]) guardiansByChild[link.child_id] = [];
        guardiansByChild[link.child_id].push(link.guardian_id);
      }

      return childrenRows.map((child) => {
        const allParentNames: string[] = [];
        if (child.parent_id && parentProfiles[child.parent_id]?.display_name) {
          allParentNames.push(parentProfiles[child.parent_id].display_name!);
        }
        for (const gId of (guardiansByChild[child.child_id] || [])) {
          if (gId !== child.parent_id && parentProfiles[gId]?.display_name) {
            allParentNames.push(parentProfiles[gId].display_name!);
          }
        }

        return {
          id: child.assignment_id,
          child_id: child.child_id,
          children: {
            id: child.child_id,
            name: child.child_name,
            year_of_birth: child.year_of_birth,
            parent_id: child.parent_id,
            profiles: child.parent_id ? parentProfiles[child.parent_id] : null,
            allParentNames,
          },
        };
      });
    },
    enabled: !!id,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  // Fetch roles data with profiles - with caching for faster loads
  const { data: rawMembers = [], isLoading: isMembersLoading, isFetching: isMembersFetching, isError: isMembersError, error: membersError, refetch: refetchMembers } = useQuery({
    queryKey: ["team-roles", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, user_id, role, profiles (id, display_name, avatar_url)")
        .eq("team_id", id!);
      if (error) throw friendlyQueryError(error, "the team member list");
      
      // Cache profiles for faster future loads
      if (data) {
        const profiles = data
          .filter(r => r.profiles)
          .map(r => ({
            id: r.profiles!.id,
            display_name: r.profiles!.display_name,
            avatar_url: r.profiles!.avatar_url,
          }));
        if (profiles.length > 0) {
          cacheProfiles(profiles);
        }
      }
      
      return data || [];
    },
    enabled: !!id,
    staleTime: 0, // Always fetch fresh data
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnMount: 'always', // Always refetch when component mounts
    refetchOnWindowFocus: false,
  });

  // Group roles by user - use user_id directly since it's always present
  // Memoize to prevent recalculation on every render
  const members = useMemo(() => {
    if (!rawMembers || rawMembers.length === 0) {
      return {};
    }
    
    // Filter out club bot account from member list
    const botUserId = team?.clubs?.bot_user_id;
    
    return rawMembers.reduce((acc, role) => {
      // user_id should always be present in user_roles table
      const userId = role.user_id;
      if (!userId || userId === botUserId) return acc;
      
      if (!acc[userId]) {
        // Try to get cached profile data for faster initial render
        const cachedProfile = getProfileFromCache(userId);
        acc[userId] = {
          profile: role.profiles || (cachedProfile ? {
            id: userId,
            display_name: cachedProfile.display_name,
            avatar_url: cachedProfile.avatar_url,
          } : { id: userId, display_name: null, avatar_url: null }),
          roles: [],
        };
      }
      acc[userId].roles.push({ id: role.id, role: role.role });
      return acc;
    }, {} as Record<string, { profile: any; roles: { id: string; role: string }[] }>);
  }, [rawMembers, team?.clubs?.bot_user_id]);

  /**
   * Adult members whose primary role is "player". Used purely for presentation:
   * child players and adult players are shown under one combined "Players (N)"
   * heading so the roster reads as a single squad list.
   */
  const adultPlayerCount = useMemo(() => {
    const priority = ["player", "parent", "coach", "team_admin", "club_admin", "app_admin", "basic_user"];
    let count = 0;
    for (const member of Object.values(members)) {
      let primaryRole = "basic_user";
      let best = Infinity;
      for (const r of member.roles || []) {
        const idx = priority.indexOf(r.role);
        if (idx !== -1 && idx < best) {
          best = idx;
          primaryRole = r.role;
        }
      }
      if (primaryRole === "player") count++;
    }
    return count;
  }, [members]);



  // When the pitch board is opened in the context of a match (linkedEventId
  // set by the "nearby game" detection), restrict the roster to players whose
  // RSVP for that event is "going". Adults (staff) are always retained so they
  // can run the board. Without an event link we keep the full roster.
  const { data: goingRsvpsForLinkedEvent } = useQuery({
    queryKey: ["pitch-board-going-rsvps", linkedEventId],
    queryFn: async () => {
      if (!linkedEventId) return null;
      const { data, error } = await supabase
        .from("rsvps")
        .select("user_id, child_id, status")
        .eq("event_id", linkedEventId)
        .eq("status", "going");
      if (error) throw error;
      return data || [];
    },
    enabled: !!linkedEventId,
    staleTime: 30_000,
  });

  const pitchBoardMembers = useMemo(() => {
    const STAFF_ROLES = new Set(["team_admin", "coach", "club_admin", "app_admin"]);
    const goingChildIds = goingRsvpsForLinkedEvent
      ? new Set(goingRsvpsForLinkedEvent.map(r => r.child_id).filter((v): v is string => !!v))
      : null;
    const goingAdultIds = goingRsvpsForLinkedEvent
      ? new Set(goingRsvpsForLinkedEvent.map(r => r.user_id).filter((v): v is string => !!v))
      : null;

    const adults = rawMembers
      .filter(m => !goingAdultIds || STAFF_ROLES.has(m.role) || goingAdultIds.has(m.user_id))
      .map(m => ({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        profiles: m.profiles,
      }));

    const children = teamChildren
      .filter(child => child.children)
      .filter(child => !goingChildIds || goingChildIds.has(child.children.id))
      .map(child => ({
        id: `child-${child.children.id}`,
        user_id: child.children.id,
        role: "player" as string,
        profiles: { display_name: child.children.name, avatar_url: null },
      }));

    return [...adults, ...children];
  }, [rawMembers, teamChildren, goingRsvpsForLinkedEvent]);

  const isPitchBoardRosterLoading = isMembersLoading || isMembersFetching || isChildrenLoading || isChildrenFetching;

  const { data: userRoleRows = [], isLoading: isUserRoleLoading } = useQuery({
    queryKey: ["user-team-roles", id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role, via_captain")
        .eq("user_id", user!.id)
        .eq("team_id", id!);
      return (data ?? []) as Array<{ role: string; via_captain: boolean | null }>;
    },
    enabled: !!id && !!user,
  });

  const userRoles = userRoleRows.map(r => r.role);
  // Captains receive a `team_admin` role row marked `via_captain`. They get the
  // same day-to-day management rights, but must not reach team settings or the
  // destructive team actions (mirrors the RLS policy on `teams`).
  const hasRealTeamAdminRole = userRoleRows.some(r => r.role === "team_admin" && !r.via_captain);
  const isCaptainAdmin = userRoleRows.some(r => r.role === "team_admin" && !!r.via_captain);

  // Get primary role for display - prioritize admin roles
  const userRole = userRoles.includes("team_admin") ? "team_admin" 
    : userRoles.includes("coach") ? "coach"
    : userRoles[0] ?? null;

  const { data: isAppAdmin, isLoading: isAppAdminLoading } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  const isCoachOrAdmin = userRole === "team_admin" || userRole === "coach" || isAppAdmin;
  const isAdmin = isCoachOrAdmin;
  // Club admins should have the same team-management actions in the team menu
  const canManageTeam = isAdmin || isClubAdmin;
  // Settings / archive / delete stay with real admins only — captains are excluded.
  const canEditTeamSettings =
    hasRealTeamAdminRole ||
    userRoles.includes("coach") ||
    !!isAppAdmin ||
    !!isClubAdmin;
  // Only real admins may appoint or remove captains.
  const canManageCaptains = hasRealTeamAdminRole || !!isAppAdmin || !!isClubAdmin;
  // isMember includes club admins - they have implicit access to all teams in their club
  const isMember = userRoles.length > 0 || isAppAdmin || isClubAdmin;


  // Sticky pitch-board access gate. `isSoccerClub` / `hasProFootball` /
  // `isAppAdmin` all come from async queries that can transiently return
  // undefined/false on app resume (aborted in-flight GETs, refetch errors).
  // Without a latch the mounted board unmounts mid-game and the user is left
  // staring at the team page. Once access has been proven we keep the board
  // rendered for as long as it is open.
  const rawPitchBoardAccess = !!(isSoccerClub && (hasProFootball || isAppAdmin));
  const pitchBoardAccessEverGrantedRef = useRef(false);
  if (rawPitchBoardAccess) pitchBoardAccessEverGrantedRef.current = true;
  const pitchBoardAccessGranted =
    rawPitchBoardAccess || pitchBoardAccessEverGrantedRef.current;

  const { data: nearbySubsManagerEventId } = useQuery({
    queryKey: ["nearby-subs-manager-event", id, user?.id],
    queryFn: async () => {
      const nearbyEventId = await findNearbyGameEvent(id!);
      if (!nearbyEventId) return null;
      const { data, error } = await supabase
        .from("duties")
        .select("id, name")
        .eq("event_id", nearbyEventId)
        .eq("assigned_to", user!.id);
      if (error) throw error;
      return (data || []).some((d: any) => normalizeDutyName(d.name) === "subs manager") ? nearbyEventId : null;
    },
    enabled: !!id && !!user && !isCoachOrAdmin && !isClubAdmin,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const hasNearbySubsManagerDuty = !!nearbySubsManagerEventId;
  
  // isClubAdmin is already defined above (before isSubscriptionLoading calculation)
  
  // All team members can view pitch board (read-only); only team admins/coaches can edit
  // Subs Manager duty check is done dynamically when the pitch board opens with a linkedEventId
  const canAccessPitchBoard = isMember;
  const canEditPitchBoard = isCoachOrAdmin || isClubAdmin || hasNearbySubsManagerDuty; // Club admins, team admins, coaches, and match Subs Managers can edit

  // Check if user has "Subs Manager" duty for the linked event
  const { data: isSubsManager } = useQuery({
    queryKey: ["subs-manager-duty", linkedEventId, user?.id],
    queryFn: async () => {
      if (!linkedEventId || !user) return false;
      const { data } = await supabase
        .from("duties")
        .select("id, name")
        .eq("event_id", linkedEventId)
        .eq("assigned_to", user.id)
      return (data || []).some((d: any) => normalizeDutyName(d.name) === "subs manager");
    },
    enabled: !!linkedEventId && !!user,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Detect a live game for this team so we can show a "Watch Live" entry
  // point to all team members (parents/players included). Polls every 30s
  // because the coach's sync also updates `active_games.updated_at` regularly
  // — that's the cheapest reliable signal without subscribing on every
  // team page load.
  const { data: activeGame } = useQuery({
    queryKey: ["team-active-game", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("active_games")
        .select("id, updated_at, pitch_state")
        .eq("team_id", id!)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!id && (isMember || isClubAdmin),
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const liveSport = (activeGame?.pitch_state as { sport?: string } | null)?.sport ?? null;
  const showWatchLive =
    !!activeGame && (liveSport === "basketball" || liveSport === "netball") && !showPitchBoard;

  // Fetch pending invites for this team
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites", id, null],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, role, invited_user_id, invited_label, invited_email, created_at, status, email_sent_at, email_id, email_error, last_reminder_sent_at, reminder_count, metadata")
        .eq("team_id", id!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      
      // Filter out anonymous share-link invites with no identifying info
      const identifiableInvites = (data || []).filter(
        inv => inv.invited_label || inv.invited_email || inv.invited_user_id
      );
      
      // Fetch profile data separately for invited users
      const invitesWithProfiles = await Promise.all(
        identifiableInvites.map(async (invite) => {
          if (invite.invited_user_id) {
            const { data: profile } = await selectCachedProfileById(invite.invited_user_id);
            return { ...invite, profiles: profile };
          }
          return { ...invite, profiles: null };
        })
      );
      
      // Strip email for non-admins to protect privacy
      if (!isCoachOrAdmin && !isClubAdmin) {
        return invitesWithProfiles.map(inv => ({
          ...inv,
          invited_email: undefined,
          email_sent_at: undefined,
          email_id: undefined,
          email_error: undefined,
        }));
      }
      return invitesWithProfiles;
    },
    enabled: !!id && isMember,
  });
  const { data: existingRequest } = useQuery({
    queryKey: ["team-request", id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("role_requests")
        .select("*")
        .eq("team_id", id!)
        .eq("user_id", user!.id)
        .eq("status", "pending")
        .maybeSingle();
      return data;
    },
    enabled: !!id && !!user && !isMember,
  });

  const requestRoleMutation = useMutation({
    mutationFn: async () => {
      const metadata: Record<string, any> = {};
      if (selectedRole === "parent") {
        const trimmedNew = newChildName.trim();
        if (selectedChildForLink && selectedChildForLink !== "__new__") {
          const child = teamChildren.find((c: any) => c.children?.id === selectedChildForLink);
          metadata.child_id = selectedChildForLink;
          metadata.child_name = child?.children?.name || "";
        } else if (trimmedNew) {
          metadata.child_name = trimmedNew;
        } else {
          throw new Error("Please select your child or add their name");
        }
      }
      const { error } = await supabase.from("role_requests").insert({
        user_id: user!.id,
        team_id: id!,
        club_id: team?.club_id,
        role: selectedRole,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      } as any);
      if (error) throw error;
      // Admin notifications are created by the on_role_request_created DB trigger
      // (which includes the requester's name). No client-side insert needed.
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-request", id] });
      setSelectedChildForLink("");
      setNewChildName("");
      toast({ title: "Request submitted", description: "An admin will review your request." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to submit request", description: error.message, variant: "destructive" });
    },
  });

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPermanentDeleteDialog, setShowPermanentDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (isDeleting) return; // prevent duplicate submission
    setIsDeleting(true);
    try {
      // 1. Load + dedupe intended notification recipients (excluding initiator)
      const { data: teamMembers } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", id!);

      const recipientIds = Array.from(
        new Set(
          (teamMembers || [])
            .map((m) => m.user_id)
            .filter((uid): uid is string => !!uid && uid !== user?.id),
        ),
      );

      // 2. Attempt the soft-delete FIRST — nobody is contacted until it commits.
      const { error: deleteError } = await supabase.from("teams").update({
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id,
      } as any).eq("id", id!);

      if (deleteError) {
        // Deletion failed: no notifications, no navigation, dialog stays open.
        toast({
          title: "Error",
          description: "Failed to delete team.",
          variant: "destructive",
        });
        return;
      }

      // 3. Deletion committed — now notify.
      let notificationError: string | null = null;
      if (recipientIds.length > 0) {
        const { error: notifyError } = await supabase.from("notifications").insert(
          recipientIds.map((uid) => ({
            user_id: uid,
            type: "membership",
            message: `${team?.name || "A team"} has been deleted`,
            related_id: team?.club_id,
          })),
        );
        if (notifyError) notificationError = notifyError.message;
      }

      queryClient.invalidateQueries({ queryKey: ["team", id] });
      if (team?.club_id) {
        queryClient.invalidateQueries({ queryKey: ["club", team.club_id] });
        queryClient.invalidateQueries({ queryKey: ["club-teams", team.club_id] });
      }
      queryClient.invalidateQueries({ queryKey: ["my-teams"] });

      // Picker query families that list selectable teams — these must drop the
      // deleted team immediately, otherwise Event creation / Gallery / Vault
      // pickers keep showing it from a stale cache until an app restart.
      queryClient.invalidateQueries({ queryKey: ["club-teams-for-event"] });
      queryClient.invalidateQueries({ queryKey: ["all-club-teams-for-target"] });
      queryClient.invalidateQueries({ queryKey: ["user-teams-upload-sheet"] });
      queryClient.invalidateQueries({ queryKey: ["media-filter-teams"] });
      queryClient.invalidateQueries({ queryKey: ["vault-club-teams"] });


      // Purge every client-side cache that still holds this team, so a
      // soft-deleted team can never repaint as a phantom second chat thread
      // (e.g. after a team with the same name is recreated).
      markTeamDeleted(id!);
      if (user?.id) {
        removeTeamFromMessagesPageCache(user.id, id!);
        queryClient.setQueryData(
          ["my-teams-with-messages", user.id],
          (old: any) => {
            if (!old?.teams) return old;
            const latestMessages = { ...(old.latestMessages || {}) };
            delete latestMessages[id!];
            return {
              ...old,
              teams: old.teams.filter((t: any) => t?.id !== id),
              latestMessages,
            };
          },
        );
        queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages", user.id] });
      }

      setShowDeleteDialog(false);

      if (notificationError) {
        toast({
          title: "Team deleted — notifications failed",
          description: `The team was deleted, but some members may not have been notified. ${notificationError}`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Team deleted", description: "You can restore it within 30 days." });
      }

      navigate(`/clubs/${team?.club_id}`);
    } finally {
      setIsDeleting(false);
    }
  };


  const handleRestoreTeam = async () => {
    const { error } = await supabase.from("teams").update({
      deleted_at: null,
      deleted_by: null,
    } as any).eq("id", id!);

    if (error) {
      toast({ title: "Error", description: "Failed to restore team.", variant: "destructive" });
      return;
    }

    unmarkTeamDeleted(id!);
    toast({ title: "Team restored!" });
    queryClient.invalidateQueries({ queryKey: ["team", id] });
    if (user?.id) {
      queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages", user.id] });
    }
  };

  const handlePermanentDeleteTeam = async () => {
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("permanent-delete-entity", {
        body: { entityType: "team", entityId: id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setShowPermanentDeleteDialog(false);
      toast({ title: "Team permanently deleted", description: "All data has been removed." });
      navigate(`/clubs/${team?.club_id}`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to permanently delete team.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading || (teamQueryPaused && !team)) {
    return (
      <div className="py-6 space-y-6" role="status" aria-label="Loading team">
        <Skeleton className="h-8 w-32" aria-hidden="true" />
        <Skeleton className="h-32 w-full" aria-hidden="true" />
        <span className="sr-only">Loading team…</span>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Team not found</p>
      </div>
    );
  }

  return (
    <div className="py-4 space-y-4">
      {/* Header: Back, Team name + member count, Invite CTA, overflow menu */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="shrink-0 min-h-[48px] min-w-[48px] h-12 w-12 -ml-2" aria-label="Go back" onClick={() => {
          if (location.key && location.key !== "default") {
            navigate(-1);
          } else {
            navigate(`/clubs/${team.club_id}`);
          }
        }}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate leading-tight">{team.name}</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            {Object.keys(members).length + teamChildren.length} member{Object.keys(members).length + teamChildren.length !== 1 ? 's' : ''}
          </p>
        </div>
        {(isAdmin || isClubAdmin) && (
          <Button size="sm" className="shrink-0 h-9" onClick={() => setHeaderInviteOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1.5" />
            Invite
          </Button>
        )}
        {canEditTeamSettings && isClassMode && (
          <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={`Edit ${isClassMode ? 'class' : 'team'}`} onClick={() => navigate(`/teams/${id}/edit`)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        {(isAdmin || isClubAdmin) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="Team options menu">
                <MoreVertical className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEditTeamSettings && <DropdownMenuItem onClick={() => navigate(`/teams/${id}/edit`)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit {isClassMode ? "Class" : "Team"}
              </DropdownMenuItem>}
              {isClassMode && (
                <DropdownMenuItem onClick={async () => {
                  const { data: newTeam, error } = await supabase
                    .from("teams")
                    .insert({
                      name: `${team.name} (Copy)`,
                      club_id: team.club_id,
                      level_age: (team as any).level_age || null,
                      description: (team as any).description || null,
                      folder_id: (team as any).folder_id || null,
                      team_type: (team as any).team_type || "mixed",
                      created_by: user!.id,
                      class_day: (team as any).class_day || null,
                      class_time: (team as any).class_time || null,
                      class_duration_minutes: (team as any).class_duration_minutes || null,
                      class_capacity: (team as any).class_capacity || null,
                    })
                    .select()
                    .single();
                  if (error) {
                    toast({ title: "Failed to duplicate class", variant: "destructive" });
                  } else {
                    toast({ title: "Class duplicated", description: `"${newTeam.name}" created. Edit it to customise.` });
                    navigate(`/teams/${newTeam.id}/edit`);
                  }
                }}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate Class
                </DropdownMenuItem>
              )}
              {/* Leave Team - only for members (not pure club admins) */}
              {userRoles.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-warning">
                        <LogOut className="h-4 w-4 mr-2" />
                        Leave Team
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Leave Team?</AlertDialogTitle>
                        <AlertDialogDescription>
                          You will be removed from {team?.name || "this team"}. You'll need a new invite to rejoin.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            const { error } = await supabase
                              .from("user_roles")
                              .delete()
                              .eq("user_id", user!.id)
                              .eq("team_id", id!);
                            if (error) {
                              toast({ title: "Failed to leave team", variant: "destructive" });
                            } else {
                              const today = new Date().toISOString().slice(0, 10);
                              const { data: futureEvents } = await supabase
                                .from("events")
                                .select("id")
                                .eq("team_id", id!)
                                .gte("event_date", today);
                              if (futureEvents && futureEvents.length > 0) {
                                await supabase
                                  .from("rsvps")
                                  .delete()
                                  .eq("user_id", user!.id)
                                  .in("event_id", futureEvents.map(e => e.id));
                              }
                              toast({ title: `You left ${team?.name || "the team"}` });
                              queryClient.invalidateQueries({ queryKey: ["team-roles", id] });
                              queryClient.invalidateQueries({ queryKey: ["user-roles"] });
                              queryClient.invalidateQueries({ queryKey: ["user-memberships-for-events"] });
                              queryClient.invalidateQueries({ queryKey: ["user-memberships-and-events"] });
                              queryClient.invalidateQueries({ queryKey: ["user-clubs-for-filter"] });
                              queryClient.invalidateQueries({ queryKey: ["user-teams-for-filter"] });
                              queryClient.invalidateQueries({ queryKey: ["events"] });
                              queryClient.invalidateQueries({ queryKey: ["user-rsvps-home"] });
                              navigate(`/clubs/${team?.club_id}`);
                            }
                          }}
                          className="bg-destructive text-destructive-foreground"
                        >
                          Leave
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
              {canEditTeamSettings && <DropdownMenuSeparator />}
              {canEditTeamSettings && <ArchiveTeamDialog
                teamId={id!}
                teamName={team?.name || ""}
                clubId={team?.club_id || ""}
                isArchived={(team as any)?.is_archived || false}
                currentSeasonLabel={(team as any)?.season_label}
                onSuccess={() => navigate(`/clubs/${team?.club_id}`)}
                trigger={
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-amber-600">
                    {(team as any)?.is_archived ? (
                      <><ArchiveRestore className="h-4 w-4 mr-2" />Reinstate Team</>
                    ) : (
                      <><Archive className="h-4 w-4 mr-2" />Archive Team</>
                    )}
                  </DropdownMenuItem>
                }
              />
              }
              {canEditTeamSettings && <DropdownMenuItem
                className="text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Team
              </DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Hidden AddTeamMemberSheet controlled by header Invite button */}
      {(isAdmin || isClubAdmin) && headerInviteOpen && (
        <Suspense fallback={null}>
        <AddTeamMemberSheet
          teamId={id!}
          teamName={team.name}
          clubId={team.club_id}
          teamType={(team as any).team_type || "mixed"}
          isClubAdminOnly={isClubAdmin && !isCoachOrAdmin}
          canBulkInvite={isCoachOrAdmin || isClubAdmin}
          triggerVariant="none"
          externalOpen={headerInviteOpen}
          onExternalOpenChange={setHeaderInviteOpen}
        />
        </Suspense>
      )}

      {(isAdmin || isClubAdmin) && (
        <AddPlayerToParentSheet
          open={addPlayerOpen}
          onOpenChange={setAddPlayerOpen}
          teamId={id!}
          teamName={team.name}
          rawMembers={rawMembers as any}
        />
      )}

      {/* Soft-deleted banner */}
      {(team as any)?.deleted_at && canManageTeam && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center gap-3">
              <Trash2 className="h-5 w-5 text-destructive shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">This team has been removed</p>
                <p className="text-xs text-muted-foreground">
                  Removed {new Date((team as any).deleted_at).toLocaleDateString()} · Will be permanently deleted after 30 days
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={handleRestoreTeam}>
                <ArchiveRestore className="h-4 w-4 mr-1" />
                Restore
              </Button>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              onClick={() => setShowPermanentDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Permanently Delete
            </Button>
          </CardContent>
        </Card>
      )}

      <ConfirmDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        entityName={team?.name || ""}
        entityType="team"
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />

      <ConfirmDeleteDialog
        open={showPermanentDeleteDialog}
        onOpenChange={setShowPermanentDeleteDialog}
        entityName={team?.name || ""}
        entityType="team"
        onConfirm={handlePermanentDeleteTeam}
        isLoading={isDeleting}
        permanent
      />

      {/* Archived Banner */}
      {(team as any)?.is_archived && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-3 flex items-center gap-3">
            <Archive className="h-5 w-5 text-warning shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                This team is archived{(team as any)?.season_label ? ` · ${(team as any).season_label}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">Read-only — history is preserved. Only admins can see this team.</p>
            </div>
            {isAdmin && (
              <ArchiveTeamDialog
                teamId={id!}
                teamName={team.name || ""}
                clubId={team.club_id || ""}
                isArchived={true}
                currentSeasonLabel={(team as any)?.season_label}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ["team", id] })}
                trigger={
                  <Button size="sm" variant="outline" className="shrink-0">
                    <ArchiveRestore className="h-4 w-4 mr-1" /> Reinstate
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      )}


      {/* Enrolment Link for Class-mode teams - hide if already enrolled */}
      {team.clubs?.class_mode_enabled && team.class_day && !isEnrolledInClass && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 hover:border-primary/50 transition-colors cursor-pointer"
          role="button"
          tabIndex={0}
          aria-label="Enrol in this class"
          onClick={() => navigate(`/clubs/${team.club_id}/enrol`)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/clubs/${team.club_id}/enrol`); } }}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Enrol in this Class</p>
              <p className="text-xs text-muted-foreground">View availability and enrol</p>
            </div>
            <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180" />
          </CardContent>
        </Card>
      )}

      {/* Team Sponsor Display */}
      {team.sponsor_id && (
        <PrimarySponsorDisplay sponsorId={team.sponsor_id} variant="full" context="team_page" />
      )}

      {/* Upgrade Banner - Show only for team/club admins without pro access, hidden in class mode */}
      {!isClassMode && (isAdmin || isClubAdmin) && !isTeamPro && !hasProFootball && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2 shrink-0">
                <Crown className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Unlock Pro Features</p>
                <p className="text-xs text-muted-foreground">Get Points & Rewards, media uploads, and more</p>
              </div>
              <Button size="sm" onClick={() => navigate(`/teams/${team.id}/upgrade`)}>
                Upgrade
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscription Banner - Show for admins when team has an active trial */}
      {!isClassMode && (isAdmin || isClubAdmin) && isOnTrial && isTeamPro && (() => {
        // Determine trial source: team_subscriptions, club_subscriptions, or legacy teams table
        const isLegacyTeamTrial = !teamSubscription?.is_trial && !clubSubscription?.is_trial && team?.is_pro && (team as any)?.pro_expires_at;
        const isCancelled = teamSubscription?.is_trial 
          ? !!(teamSubscription as any)?.cancelled_at 
          : clubSubscription?.is_trial 
            ? !!(clubSubscription as any)?.cancelled_at 
            : false;
        const trialEndDate = teamSubscription?.is_trial 
          ? teamSubscription?.trial_ends_at 
          : clubSubscription?.is_trial
            ? clubSubscription?.trial_ends_at
            : isLegacyTeamTrial
              ? (team as any)?.pro_expires_at
              : null;
        const isClubTrial = !teamSubscription?.is_trial && clubSubscription?.is_trial && !isLegacyTeamTrial;
        const canCancel = (teamSubscription?.is_trial && !isCancelled) || isLegacyTeamTrial;

        return (
          <Card className={`border-amber-500/30 ${isCancelled ? 'bg-gradient-to-br from-muted/50 to-muted/30' : 'bg-gradient-to-br from-amber-500/5 to-amber-500/10'}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`rounded-full p-2 shrink-0 ${isCancelled ? 'bg-muted' : 'bg-amber-500/10'}`}>
                  <Crown className={`h-5 w-5 ${isCancelled ? 'text-muted-foreground' : 'text-amber-500'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  {isCancelled ? (
                    <>
                      <p className="font-medium text-sm">Subscription Cancelled</p>
                      <p className="text-xs text-muted-foreground">
                        Pro features active until {trialEndDate ? new Date(trialEndDate).toLocaleDateString() : 'trial ends'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-sm">Free Trial Active</p>
                      <p className="text-xs text-muted-foreground">
                        {isClubTrial ? 'Club trial' : 'Trial'} ends {trialEndDate ? new Date(trialEndDate).toLocaleDateString() : 'soon'}
                      </p>
                    </>
                  )}
                </div>
                {isClubTrial && team?.club_id ? (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate(`/clubs/${team.club_id}/upgrade`)}>
                    Manage
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Join Request Section for Non-members - hidden in class mode (use enrolment page instead) */}
      {!isClassMode && !isUserRoleLoading && !isClubAdminLoading && !isAppAdminLoading && !isMember && !isClubAdmin && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardContent className="p-5 sm:p-6">
            {existingRequest ? (
              <div className="flex flex-col items-center text-center space-y-3">
                <div className="rounded-full bg-warning/10 p-3">
                  <Timer className="h-6 w-6 text-warning" />
                </div>
                <div className="space-y-1">
                  <Badge variant="secondary" className="bg-warning/20 text-warning border-warning/30">
                    Request Pending
                  </Badge>
                  <p className="text-sm text-muted-foreground mt-2">
                    Your request to join as <span className="font-medium text-foreground">{existingRequest.role.replace("_", " ")}</span> is awaiting approval.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2.5 shrink-0">
                    <UserPlus className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base">Join {team.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      Select your role and request to become a team member
                    </p>
                  </div>
                </div>
                
                {/* Role Selection */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">What's your role?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {teamRoleOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={selectedRole === opt.value}
                        onClick={() => setSelectedRole(opt.value)}
                        className={`
                          p-3 rounded-lg border-2 text-left transition-all min-h-[44px]
                          ${selectedRole === opt.value 
                            ? 'border-primary bg-primary/10 ring-1 ring-primary/20' 
                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                          }
                        `}
                      >
                        <span className={`text-sm font-medium ${selectedRole === opt.value ? 'text-primary' : ''}`}>
                          {opt.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Child selection — required for parent role */}
                {selectedRole === "parent" && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Which child are you the parent of?</Label>
                    {teamChildren.length > 0 ? (
                      <Select
                        value={selectedChildForLink || ""}
                        onValueChange={(v) => {
                          setSelectedChildForLink(v);
                          if (v !== "__new__") setNewChildName("");
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select your child" />
                        </SelectTrigger>
                        <SelectContent>
                          {teamChildren.map((c: any) => (
                            <SelectItem key={c.children.id} value={c.children.id}>
                              {c.children.name}
                            </SelectItem>
                          ))}
                          <SelectItem value="__new__">+ Add a new child</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : null}
                    {(teamChildren.length === 0 || selectedChildForLink === "__new__") && (
                      <Input
                        placeholder="Child's full name"
                        value={newChildName}
                        onChange={(e) => setNewChildName(e.target.value.slice(0, 100))}
                        maxLength={100}
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      Admins need to know who your child is to approve your request.
                    </p>
                  </div>
                )}

                {/* Submit Button */}
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => requestRoleMutation.mutate()}
                  disabled={
                    requestRoleMutation.isPending ||
                    (selectedRole === "parent" &&
                      !(
                        (selectedChildForLink && selectedChildForLink !== "__new__") ||
                        newChildName.trim().length > 0
                      ))
                  }
                >
                  {requestRoleMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Request to Join as {selectedRole.replace("_", " ")}
                    </>
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  A team admin will review your request
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Post-creation onboarding nudge — shown to admins until both
          "invite members" and "add first event" are complete (or dismissed). */}
      {(isAdmin || isClubAdmin) && (
        <TeamNextStepsCard teamId={id!} onInvite={() => setHeaderInviteOpen(true)} />
      )}

      {/* Next Event Card — dominant hero */}
      {isMember && (
        <TeamNextEventCard teamId={id!} clubId={team.club_id} />
      )}

      {/* Watch Live banner — shown to ALL team members when a coach is running
          a basketball/netball board. Read-only spectator view; no controls. */}
      {isMember && showWatchLive && (
        <Link
          to={`/watch/team/${team.id}`}
          aria-label="Watch live game"
          className="block"
        >
          <Card className="border-primary/30 bg-primary/[0.05] hover:border-primary/50 transition-colors" role="button">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/15 relative">
                <Radio className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Watch Live</span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-destructive/40 text-destructive">
                    LIVE
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground capitalize">
                  {liveSport} game in progress
                </p>
              </div>
              <Eye className="h-4 w-4 text-primary shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Quick Actions — chat row + compact tile grid */}
      {isMember && (() => {
        const showVault = (isAdmin || isCoachOrAdmin || isClubAdmin);
        const vaultLocked = showVault && !(isSubscriptionLoading || isTeamPro);
        const mediaLocked = !(isSubscriptionLoading || isTeamPro);
        // Football/soccer only: the netball & basketball boards are archived
        // (see archive/sports/), so they must never be offered — not even to
        // app admins, who would otherwise open an empty modal.
        const showPitch = (isAdmin || isCoachOrAdmin || isClubAdmin || hasNearbySubsManagerDuty)
          && isSoccerClub && (hasProFootball || isAppAdmin);
        const launchPitchBoard = async () => {
          const [membersResult, childrenResult, nearbyEventId] = await Promise.all([
            refetchMembers(),
            refetchChildren(),
            findNearbyGameEvent(id!),
          ]);
          const freshMembers = membersResult.data || [];
          const freshChildren = childrenResult.data || [];
          let goingChildIds: Set<string> | null = null;
          let goingAdultIds: Set<string> | null = null;
          if (nearbyEventId) {
            const { data: goingRows } = await supabase
              .from("rsvps")
              .select("user_id, child_id")
              .eq("event_id", nearbyEventId)
              .eq("status", "going");
            goingChildIds = new Set((goingRows || []).map(r => r.child_id).filter((v): v is string => !!v));
            goingAdultIds = new Set((goingRows || []).map(r => r.user_id).filter((v): v is string => !!v));
          }
          const STAFF_ROLES = new Set(["team_admin", "coach", "club_admin", "app_admin"]);
          const nextPitchBoardMembers = [
            ...freshMembers.filter(m => !goingAdultIds || STAFF_ROLES.has(m.role) || goingAdultIds.has(m.user_id)).map(m => ({
              id: m.id, user_id: m.user_id, role: m.role, profiles: m.profiles,
            })),
            ...freshChildren
              .filter(child => child.children)
              .filter(child => !goingChildIds || goingChildIds.has(child.children.id))
              .map(child => ({
                id: `child-${child.children.id}`, user_id: child.children.id,
                role: "player" as string,
                profiles: { display_name: child.children.name, avatar_url: null },
              })),
          ];
          setPitchBoardMembersOverride(nextPitchBoardMembers);
          setLinkedEventId(nearbyEventId);
          setShowPitchBoard(true);
        };

        const tiles: Array<{
          key: string;
          icon: typeof Calendar;
          label: string;
          to?: string;
          onClick?: () => void;
          locked?: boolean;
          beta?: boolean;
        }> = [
          { key: "schedule", icon: Calendar, label: "Schedule", to: `/events?team=${team.id}` },
          { key: "media", icon: ImageIcon, label: "Media", to: mediaLocked ? undefined : `/media?team=${team.id}`, locked: mediaLocked },
        ];
        if (showVault) {
          tiles.push({
            key: "vault",
            icon: FolderOpen,
            label: "Vault",
            to: vaultLocked ? undefined : `/vault?team=${team.id}`,
            locked: vaultLocked,
          });
        }
        if (showPitch) {
          tiles.push({
            key: "pitch",
            icon: LayoutGrid,
            label: "Pitch Board",
            onClick: launchPitchBoard,
          });
        }

        const cols = tiles.length >= 4 ? "grid-cols-4" : tiles.length === 3 ? "grid-cols-3" : "grid-cols-2";

        return (
          <section className="space-y-2">
            {/* Chat — primary action with preview */}
            <Link to={`/messages/${team.id}`} aria-label="Open team chat" className="block">
              <Card className="border-primary/20 bg-primary/[0.03] hover:border-primary/40 transition-colors" role="button">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <MessageCircle className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
                  </div>
                  <TeamChatPreview teamId={team.id} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </Link>

            {/* Compact tile grid for secondary tools */}
            <div className={cn("grid gap-2", cols)}>
              {tiles.map(({ key, icon: Icon, label, to, onClick, locked, beta }) => {
                const inner = (
                  <div className={cn(
                    "relative flex flex-col items-center justify-center gap-1 rounded-lg border bg-card/60 px-1 py-2.5 h-[68px] transition-colors",
                    locked
                      ? "opacity-50"
                      : "hover:border-primary/40 hover:bg-card active:scale-[0.97]"
                  )}>
                    <Icon className="h-[18px] w-[18px] text-foreground/80" aria-hidden="true" />
                    <span className="text-[11px] font-medium text-foreground/90 leading-none">{label}</span>
                    {locked && (
                      <Lock className="absolute top-1 right-1 h-2.5 w-2.5 text-muted-foreground" aria-hidden="true" />
                    )}
                    {beta && (
                      <span className="absolute top-1 right-1 px-1 py-px rounded-sm bg-primary/15 text-primary text-[8px] font-bold uppercase leading-none">
                        Beta
                      </span>
                    )}
                  </div>
                );
                if (locked) {
                  return <div key={key} aria-disabled="true">{inner}</div>;
                }
                if (to) {
                  return (
                    <Link key={key} to={to} aria-label={label} className="block">
                      {inner}
                    </Link>
                  );
                }
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={label}
                    onClick={onClick}
                    className="block text-left w-full"
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Latest Photos — emotional/social engagement */}
      {isMember && (
        <TeamLatestPhotos teamId={id!} clubId={team.club_id} />
      )}

      {/* Compact rank module — secondary emphasis, includes "ways to improve" */}
      {isMember && (
        <TeamRankCard teamId={id!} clubId={team.club_id} />
      )}

      {/* Collapsible Sections */}
      {(isMember || isClubAdmin) && (
        <Accordion 
          type="multiple" 
          defaultValue={["members"]} 
          className="space-y-4"
          onValueChange={(value) => {
            // Auto-refresh members list when expanding if empty
            if (value.includes("members") && Object.keys(members).length === 0 && teamChildren.length === 0 && !isMembersLoading && !isMembersFetching && !isChildrenLoading && !isChildrenFetching) {
              refetchMembers();
              refetchChildren();
            }
          }}
        >
          {/* Members Section */}
          <AccordionItem value="members" className="border rounded-lg px-4">
            {/* Refresh button is a SIBLING of the trigger — never nested inside it,
                so no <button> ever descends from another <button>. */}
            <div className="flex items-center gap-2">
              <AccordionTrigger className="hover:no-underline flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Users className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                  <div className="flex flex-col min-w-0">
                    <h2 className="text-base font-semibold leading-tight">Team</h2>
                    <span className="text-[10px] text-muted-foreground leading-tight">Players, parents & coaches</span>
                  </div>
                  <div className="flex -space-x-2 ml-auto shrink-0">
                    {Object.values(members).slice(0, 5).map((member, i) => (
                      <Avatar key={i} className="h-7 w-7 border-2 border-background">
                        <AvatarImage src={member.profile?.avatar_url || undefined} />
                        <AvatarFallback className="bg-primary/20 text-primary text-[9px]">
                          {member.profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                    {Object.keys(members).length + teamChildren.length > 5 && (
                      <Avatar className="h-7 w-7 border-2 border-background">
                        <AvatarFallback className="bg-muted text-muted-foreground text-[9px]">
                          +{Object.keys(members).length + teamChildren.length - 5}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                </div>
              </AccordionTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label="Refresh members list"
                onClick={(e) => {
                  e.stopPropagation();
                  refetchMembers();
                  refetchChildren();
                }}
                disabled={isMembersFetching || isChildrenFetching}
              >
                <RefreshCw className={`h-4 w-4 ${isMembersFetching || isChildrenFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              </Button>
            </div>
            <AccordionContent>
              <div className="space-y-4 pt-2">
{isMembersError && Object.keys(members).length === 0 ? (
                  <div className="flex flex-col items-center py-6 text-center gap-3">
                    <p className="text-sm text-muted-foreground max-w-xs">
                      {friendlyQueryErrorMessage(membersError, "the team member list")}
                    </p>
                    <Button size="sm" variant="outline" onClick={() => refetchMembers()}>
                      <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden="true" />
                      Try again
                    </Button>
                  </div>
                ) : Object.keys(members).length === 0 && teamChildren.length === 0 && pendingInvites.length === 0 && !isMembersLoading && !isChildrenLoading && !isMembersFetching && !isChildrenFetching ? (
                  <div className="flex flex-col items-center py-6 text-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <UserPlus className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">No members yet</p>
                      <p className="text-sm text-muted-foreground mt-1">Invite players, parents or coaches to get started</p>
                    </div>
                    <Button size="sm" onClick={() => setHeaderInviteOpen(true)}>
                      <UserPlus className="h-4 w-4 mr-1.5" />
                      Invite Members
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {Object.keys(members).length === 0 && teamChildren.length === 0 && pendingInvites.length === 0 && (isMembersFetching || isChildrenFetching) && (
                      <div className="flex justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {/* Combined Players section — child players first, adult players
                        continue directly below under the same heading. */}
                    {(teamChildren.length > 0 || pendingInvites.some(inv => {
                      const meta = inv.metadata as { children?: { name: string }[] } | null;
                      return meta?.children && meta.children.length > 0;
                    })) && (memberRoleFilter === "all" || memberRoleFilter === "child") && (
                      <div className={adultPlayerCount > 0 ? "mb-2" : "mb-6 pb-4 border-b"}>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Players ({(() => {
                              const pendingOnlyCount = (() => {
                                const confirmedIds = new Set(teamChildren.map((a: any) => a.children?.id).filter(Boolean));
                                const confirmedNames = new Set(teamChildren.map((a: any) => a.children?.name?.toLowerCase()?.trim()).filter(Boolean));
                                const seen = new Set<string>();
                                for (const inv of pendingInvites) {
                                  const meta = inv.metadata as { children?: { name: string; child_id?: string; existingChildId?: string }[] } | null;
                                  if (!meta?.children) continue;
                                  for (const c of meta.children) {
                                    if (!c.name) continue;
                                    if (c.child_id && confirmedIds.has(c.child_id)) continue;
                                    if (confirmedNames.has(c.name.toLowerCase().trim())) continue;
                                    if (typeof c.existingChildId === 'string' && c.existingChildId.startsWith('pending-')) continue;
                                    seen.add(c.name.toLowerCase().trim());
                                  }
                                }
                                return seen.size;
                              })();
                              return teamChildren.length + pendingOnlyCount + adultPlayerCount;
                            })()})

                          </p>
                          {(isAdmin || isClubAdmin) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setAddPlayerOpen(true)}
                            >
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              Add player
                            </Button>
                          )}
                        </div>
                        <div className="space-y-2.5">
                          {(() => {
                            const pendingChildIds = new Set<string>();
                            const pendingChildNames = new Set<string>();
                            const pendingParentLabels = new Map<string, string>();
                            for (const inv of pendingInvites) {
                              const meta = inv.metadata as { children?: { name: string; child_id?: string }[] } | null;
                              if (!meta?.children) continue;
                              const parentLabel = inv.invited_label || inv.invited_email?.split("@")[0] || "Pending Parent";
                              for (const child of meta.children) {
                                if (child.child_id) {
                                  pendingChildIds.add(child.child_id);
                                  pendingParentLabels.set(child.child_id, parentLabel);
                                }
                                if (child.name) {
                                  pendingChildNames.add(child.name.toLowerCase());
                                  pendingParentLabels.set(child.name.toLowerCase(), parentLabel);
                                }
                              }
                            }

                             const sorted = [...teamChildren].sort((a: any, b: any) => {
                               const aChild = a.children;
                               const bChild = b.children;
                               const aIsPending = (aChild && (pendingChildIds.has(aChild.id) || 
                                 (aChild.name && pendingChildNames.has(aChild.name.toLowerCase()) && (!aChild.allParentNames || aChild.allParentNames.length === 0)))) ? 1 : 0;
                               const bIsPending = (bChild && (pendingChildIds.has(bChild.id) || 
                                 (bChild.name && pendingChildNames.has(bChild.name.toLowerCase()) && (!bChild.allParentNames || bChild.allParentNames.length === 0)))) ? 1 : 0;
                               return aIsPending - bIsPending;
                             });

                             return sorted.map((assignment: any) => {
                              const child = assignment.children;
                              if (!child) return null;
                              const isPending = pendingChildIds.has(child.id) || 
                                (child.name && pendingChildNames.has(child.name.toLowerCase()) && (!child.allParentNames || child.allParentNames.length === 0));
                              const parentLabel = pendingParentLabels.get(child.id) || pendingParentLabels.get(child.name?.toLowerCase());

                              const parentDisplay = isPending && parentLabel
                                ? `Parent: ${parentLabel}`
                                : child.allParentNames && child.allParentNames.length > 0
                                  ? `${child.allParentNames.length === 1 ? "Parent" : "Parents"}: ${child.allParentNames.join(" & ")}`
                                  : null;

                              const swipeActions = (() => {
                                if (!(isAdmin || isClubAdmin)) return [];
                                if (isPending) {
                                  return [{
                                    label: "Link",
                                    icon: <UserPlus className="h-4 w-4" />,
                                    onClick: () => {
                                      const inviteIds = pendingInvites
                                        .filter(inv => {
                                          const meta = inv.metadata as { children?: { name: string; child_id?: string }[] } | null;
                                          return meta?.children?.some(c => c.child_id === child.id || c.name?.toLowerCase() === child.name?.toLowerCase());
                                        })
                                        .map(inv => inv.id);
                                      setLinkChildToParent({ childName: child.name, existingChildId: child.id, pendingInviteIds: inviteIds });
                                    },
                                    className: "bg-orange-500 text-white",
                                  }];
                                }
                                const actions: { label: string; icon: ReactNode; onClick: () => void; className?: string }[] = [
                                  {
                                    label: "Parent",
                                    icon: <UserPlus className="h-4 w-4" />,
                                    onClick: () => setInviteParentChild({ childId: child.id, childName: child.name }),
                                    className: "bg-emerald-600 text-white",
                                  },
                                ];
                                if (isSoccerClub) {
                                  actions.push({
                                    label: "Position",
                                    icon: <Pencil className="h-4 w-4" />,
                                    onClick: () => setPositionSheetPlayer({ id: child.id, name: child.name, type: "child" }),
                                    className: "bg-blue-500 text-white",
                                  });
                                }
                                if (isClubAdmin) {
                                  actions.push({
                                    label: "Swap",
                                    icon: <ArrowRightLeft className="h-4 w-4" />,
                                    onClick: () => setMoveToTeam({ type: "child", id: child.id, name: child.name }),
                                    className: "bg-amber-500 text-white",
                                  });
                                }
                                return actions;
                              })();

                              return (
                                <SwipeableCard
                                  key={assignment.id}
                                  actions={swipeActions}
                                  enabled={(isAdmin || isClubAdmin)}
                                  className={cn(
                                    "border shadow-sm",
                                    ""
                                  )}
                                >
                                  <CardContent
                                    className="p-3.5 flex items-center gap-3 cursor-pointer"
                                    onClick={() => setSelectedChild({
                                      childId: child.id,
                                      childName: child.name,
                                      parentDisplay,
                                      isPending: !!isPending,
                                      linkInviteIds: isPending ? pendingInvites
                                        .filter(inv => {
                                          const meta = inv.metadata as { children?: { name: string; child_id?: string }[] } | null;
                                          return meta?.children?.some(c => c.child_id === child.id || c.name?.toLowerCase() === child.name?.toLowerCase());
                                        })
                                        .map(inv => inv.id) : undefined,
                                    })}
                                  >
                                    <Avatar className="h-9 w-9 shrink-0">
                                      <AvatarFallback className={cn(
                                        "text-sm font-semibold",
                                        isPending ? "bg-orange-500/20 text-orange-500" : "bg-pink-500/20 text-pink-500"
                                      )}>
                                        {child.name?.charAt(0)?.toUpperCase() || "?"}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-semibold text-sm truncate">{child.name}</p>
                                      {parentDisplay && (
                                        <p className="text-xs text-muted-foreground truncate mt-0.5">{parentDisplay}</p>
                                      )}
                                    </div>
                                    <Badge variant="outline" className={cn(
                                      "text-[10px] border px-1.5 py-0 h-4 shrink-0",
                                      isPending 
                                        ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                                        : "bg-pink-500/20 text-pink-400 border-pink-500/30"
                                    )}>
                                      {isPending ? "Pending" : "Child"}
                                    </Badge>
                                  </CardContent>
                                </SwipeableCard>
                              );
                            });
                          })()}
                          {(() => {
                            const confirmedChildIds = new Set(teamChildren.map((a: any) => a.children?.id).filter(Boolean));
                            const confirmedChildNames = new Set(teamChildren.map((a: any) => a.children?.name?.toLowerCase()?.trim()).filter(Boolean));
                            
                            const isConfirmedChild = (name: string) => {
                              const norm = name.toLowerCase().trim();
                              if (confirmedChildNames.has(norm)) return true;
                              for (const confirmed of confirmedChildNames) {
                                if (Math.abs(norm.length - confirmed.length) > 2) continue;
                                const len1 = norm.length, len2 = confirmed.length;
                                const dp: number[][] = Array.from({ length: len1 + 1 }, (_, i) => 
                                  Array.from({ length: len2 + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
                                );
                                for (let i = 1; i <= len1; i++) {
                                  for (let j = 1; j <= len2; j++) {
                                    dp[i][j] = norm[i-1] === confirmed[j-1]
                                      ? dp[i-1][j-1]
                                      : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
                                  }
                                }
                                if (dp[len1][len2] <= 2) return true;
                              }
                              return false;
                            };
                            
                            const seenPendingNames = new Map<string, { name: string; parentLabels: string[]; inviteIds: string[] }>();
                            
                            for (const inv of pendingInvites) {
                              const meta = inv.metadata as { children?: { name: string; child_id?: string; existingChildId?: string }[] } | null;
                              if (!meta?.children) continue;
                              const parentLabel = inv.invited_label || inv.invited_email?.split("@")[0] || "Pending Parent";
                              
                              for (const child of meta.children) {
                                if (!child.name) continue;
                                if (child.child_id && confirmedChildIds.has(child.child_id)) continue;
                                if (isConfirmedChild(child.name)) continue;
                                if (typeof child.existingChildId === 'string' && child.existingChildId.startsWith('pending-')) continue;
                                
                                const key = child.name.toLowerCase().trim();
                                const existing = seenPendingNames.get(key);
                                if (existing) {
                                  if (!existing.parentLabels.includes(parentLabel)) {
                                    existing.parentLabels.push(parentLabel);
                                  }
                                  if (!existing.inviteIds.includes(inv.id)) {
                                    existing.inviteIds.push(inv.id);
                                  }
                                } else {
                                  seenPendingNames.set(key, { name: child.name, parentLabels: [parentLabel], inviteIds: [inv.id] });
                                }
                              }
                            }
                            
                            return Array.from(seenPendingNames.entries()).map(([key, { name, parentLabels, inviteIds }]) => (
                              <SwipeableCard
                                key={`pending-child-${key}`}
                                enabled={isAdmin || isClubAdmin}
                                actions={(isAdmin || isClubAdmin) ? [{
                                  label: "Link",
                                  icon: <UserPlus className="h-4 w-4" />,
                                  onClick: () => setLinkChildToParent({ childName: name, pendingInviteIds: inviteIds }),
                                  className: "bg-orange-500",
                                }] : []}
                                className="border shadow-sm"
                              >
                                <CardContent className="p-3.5 flex items-center gap-3">
                                  <Avatar className="h-9 w-9 shrink-0">
                                    <AvatarFallback className="bg-orange-500/20 text-orange-500 text-sm font-semibold">
                                      {name?.charAt(0)?.toUpperCase() || "?"}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-sm truncate">{name}</p>
                                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                                      {parentLabels.length > 1 ? `Parents: ${parentLabels.join(" & ")}` : `Parent: ${parentLabels[0]}`}
                                    </p>
                                  </div>
                                  <Badge variant="outline" className="text-[10px] border px-1.5 py-0 h-4 shrink-0 bg-orange-500/20 text-orange-400 border-orange-500/30">
                                    Pending
                                  </Badge>
                                </CardContent>
                              </SwipeableCard>
                            ));
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Role-grouped members with headers */}
                    {(() => {
                      // True when the child-players block above is on screen — the
                      // adult "player" group then continues it without its own header.
                      const childBlockShown =
                        (teamChildren.length > 0 ||
                          pendingInvites.some((inv) => {
                            const meta = inv.metadata as { children?: { name: string }[] } | null;
                            return !!meta?.children && meta.children.length > 0;
                          })) &&
                        (memberRoleFilter === "all" || memberRoleFilter === "child");
                      const filteredMembers = Object.entries(members).filter(([_, member]) =>
                        memberRoleFilter === "all" || memberRoleFilter === "child" ? memberRoleFilter === "all" : member.roles?.some(r => r.role === memberRoleFilter)
                      );

                      const roleOrder = ["player", "parent", "team_admin", "club_admin", "app_admin", "basic_user"] as const;
                      const roleGroupLabels: Record<string, string> = {
                        player: "Players",
                        parent: "Parents & Coaches",
                        team_admin: "Team Admins",
                        club_admin: "Club Admins",
                        app_admin: "App Admins",
                        basic_user: "Members",
                      };
                      const roleGroupMap: Record<string, string> = {
                        player: "player",
                        parent: "parent",
                        coach: "parent",
                        team_admin: "team_admin",
                        club_admin: "club_admin",
                        app_admin: "app_admin",
                        basic_user: "basic_user",
                      };

                      // Group members by their primary (highest-priority) role
                      const grouped: Record<string, [string, typeof members[string]][]> = {};
                      for (const entry of filteredMembers) {
                        const [, member] = entry;
                        const roles = member.roles || [];
                        let primaryRole = "basic_user";
                        let bestPriority = Infinity;
                        const allRoles = ["player", "parent", "coach", "team_admin", "club_admin", "app_admin", "basic_user"];
                        for (const r of roles) {
                          const idx = allRoles.indexOf(r.role as any);
                          if (idx !== -1 && idx < bestPriority) {
                            bestPriority = idx;
                            primaryRole = r.role;
                          }
                        }
                        const mappedRole = roleGroupMap[primaryRole] || "basic_user";
                        if (!grouped[mappedRole]) grouped[mappedRole] = [];
                        grouped[mappedRole].push(entry);
                      }

                      // Group pending invites by role
                      const pendingByRole: Record<string, typeof pendingInvites> = {};
                      for (const inv of pendingInvites) {
                        if (memberRoleFilter !== "all" && inv.role !== memberRoleFilter) continue;
                        const role = inv.role || "basic_user";
                        const mappedInvRole = roleGroupMap[role] || "basic_user";
                        if (!pendingByRole[mappedInvRole]) pendingByRole[mappedInvRole] = [];
                        pendingByRole[mappedInvRole].push(inv);
                      }

                      // Collect all roles that have members or pending invites
                      const allRoles = new Set([...Object.keys(grouped), ...Object.keys(pendingByRole)]);

                      return roleOrder.filter(role => allRoles.has(role)).map(role => {
                        const roleMembers = grouped[role] || [];
                        const rolePending = pendingByRole[role] || [];
                        if (roleMembers.length === 0 && rolePending.length === 0) return null;

                        const mergeWithChildren = role === "player" && childBlockShown;

                        return (
                          <div key={role} className="mb-3 pb-3 border-b last:border-b-0 last:mb-0 last:pb-0">
                            {!mergeWithChildren && (
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{roleGroupLabels[role] || role}</p>
                            )}

                            <div className="space-y-2">
                              {roleMembers.map(([userId, member]) => {
                                const canManage = (isAdmin || isClubAdmin) && userId !== user?.id;
                                const memberSwipeActions: { label: string; icon: ReactNode; onClick: () => void; className?: string }[] = [];
                                
                                if ((isAdmin || isClubAdmin)) {
                                  memberSwipeActions.push({
                                    label: "Role",
                                    icon: <Plus className="h-4 w-4" />,
                                    onClick: () => setAddRoleMember({ userId, userName: member.profile?.display_name || "User", existingRoles: member.roles?.map(r => r.role) || [] }),
                                    className: "bg-blue-600 text-white",
                                  });
                                }
                                if (isClubAdmin && userId !== user?.id) {
                                  memberSwipeActions.push({
                                    label: "Move",
                                    icon: <ArrowRightLeft className="h-4 w-4" />,
                                    onClick: () => setMoveToTeam({
                                      type: "adult",
                                      id: userId,
                                      name: member.profile?.display_name || "User",
                                      roles: member.roles?.map(r => r.role) || [],
                                    }),
                                    className: "bg-amber-500 text-white",
                                  });
                                }
                                if (canManage) {
                                  memberSwipeActions.push({
                                    label: "Remove",
                                    icon: <Trash2 className="h-4 w-4" />,
                                    onClick: () => setRemoveMember({ userId, name: member.profile?.display_name || "User" }),
                                    className: "bg-destructive",
                                  });
                                }

                                return (
                                  <SwipeableCard key={userId} actions={memberSwipeActions} enabled={memberSwipeActions.length > 0} className="border shadow-sm">
                                    <CardContent
                                      className="p-3.5 flex items-center gap-3 cursor-pointer"
                                      onClick={() => setSelectedMember({
                                        userId,
                                        displayName: member.profile?.display_name || "Unknown User",
                                        avatarUrl: member.profile?.avatar_url,
                                        roles: member.roles || [],
                                      })}
                                    >
                                      <Avatar className="h-8 w-8 shrink-0">
                                        <AvatarImage src={member.profile?.avatar_url || undefined} />
                                        <AvatarFallback className="bg-primary/20 text-primary text-sm">
                                          {member.profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm truncate">{member.profile?.display_name || "Unknown User"}</p>
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {member.roles?.map((roleItem) => {
                                          const roleLabels: Record<string, string> = {
                                            app_admin: "App Admin", club_admin: "Club Admin", team_admin: "Team Admin",
                                            coach: "Coach", player: "Player", parent: "Parent", basic_user: "Member",
                                          };
                                          const roleColors: Record<string, string> = {
                                            app_admin: "bg-red-500/20 text-red-400 border-red-500/30",
                                            club_admin: "bg-purple-500/20 text-purple-400 border-purple-500/30",
                                            team_admin: "bg-blue-500/20 text-blue-400 border-blue-500/30",
                                            coach: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
                                            player: "bg-amber-500/20 text-amber-400 border-amber-500/30",
                                            parent: "bg-pink-500/20 text-pink-400 border-pink-500/30",
                                            basic_user: "bg-muted text-muted-foreground border-border",
                                          };
                                          return (
                                            <Badge key={roleItem.id} variant="outline" className={`text-[10px] border px-1.5 py-0 h-4 ${roleColors[roleItem.role] || roleColors.basic_user}`}>
                                              {roleLabels[roleItem.role] || "Member"}
                                            </Badge>
                                          );
                                        })}
                                      </div>
                                    </CardContent>
                                  </SwipeableCard>
                                );
                              })}
                              {/* Pending invites at bottom of each role group */}
                              {rolePending.length > 0 && (memberRoleFilter === "all" || memberRoleFilter === role) && (
                                <PendingInvitesList
                                  invites={rolePending}
                                  teamId={id}
                                  isAdmin={isAdmin || isClubAdmin}
                                />
                              )}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}

              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Class Attendance - only in class mode for admins */}
          {isClassMode && (isCoachOrAdmin || isClubAdmin) && (
            <AccordionItem value="class-attendance" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Attendance</h2>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-2">
                  <ClassAttendanceSingle teamId={id!} clubId={team.club_id} />
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Game History - basketball + netball only */}
          {isMember && (isBasketballClub || isNetballClub) && isAppAdmin && (
            <AccordionItem value="game-history" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Game History</h2>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-2">
                  <Suspense fallback={<div className="text-xs text-muted-foreground py-4">Loading…</div>}>
                    <TeamGameHistoryTab
                      teamId={id!}
                      teamName={team.name}
                      canManage={isAdmin || isCoachOrAdmin || isClubAdmin}
                    />
                  </Suspense>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}


          {/* Admin Section - collapsed by default */}
          {(isAdmin || isClubAdmin) && (
            <AccordionItem value="admin" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Admin</h2>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 pt-2">
                  {/* Quick Action: Add Team Admin */}
                  <Card className="border-primary/30 bg-primary/5">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/20">
                          <Crown className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">Team Admin Management</p>
                          <p className="text-xs text-muted-foreground">Add another admin to help manage the team</p>
                        </div>
                        <PromoteToTeamAdminDialog
                          teamId={id!}
                          teamName={team.name}
                          clubId={team.club_id}
                          members={members}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Captain (senior / mixed teams only) — same management rights as a team admin */}
                  {["senior", "mixed"].includes(String((team as any).team_type || "mixed").toLowerCase()) && (
                    <TeamCaptainCard
                      teamId={id!}
                      teamName={team.name}
                      members={members}
                      canManage={canManageCaptains}
                    />
                  )}


                  {/* PlayHQ Link */}
                  <PlayHQTeamLinkCard teamId={id!} clubId={team.club_id} />
          
          
                  <Link to={`/teams/${id}/roles`}>
            <Card className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Settings className="h-5 w-5 text-primary" />
                </div>
                <span className="font-medium">Manage Roles</span>
              </CardContent>
            </Card>
          </Link>
          
          {isTeamPro ? (
            <Link to={`/teams/${id}/attendance`}>
              <Card className="hover:border-primary/50 transition-colors">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10">
                    <BarChart3 className="h-5 w-5 text-emerald-500" />
                  </div>
                  <span className="font-medium">Attendance Stats</span>
                </CardContent>
              </Card>
            </Link>
          ) : (
            <Link to={`/teams/${id}/upgrade`}>
              <Card className="hover:border-primary/50 transition-colors opacity-75">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <span className="font-medium text-muted-foreground">Attendance Stats</span>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    <Lock className="h-3 w-3 mr-1" />
                    Pro
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          )}

          {hasProFootball ? (
            <Link to={`/reports/player-stats?teamId=${id}`}>
              <Card className="hover:border-primary/50 transition-colors">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10">
                    <FileText className="h-5 w-5 text-emerald-500" />
                  </div>
                  <span className="font-medium">Player Stats Reports</span>
                </CardContent>
              </Card>
            </Link>
          ) : (
            <Link to={`/teams/${id}/upgrade`}>
              <Card className="hover:border-primary/50 transition-colors opacity-75">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <span className="font-medium text-muted-foreground">Player Stats Reports</span>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    <Lock className="h-3 w-3 mr-1" />
                    Pro Football
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          )}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* App Admin Section - only for app admins */}
          {isAppAdmin && (
            <AccordionItem value="app-admin" className="border rounded-lg px-4 border-yellow-500/30 bg-yellow-500/5">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-yellow-500" />
                  <h2 className="text-lg font-semibold">App Admin</h2>
                  <Badge className="bg-yellow-500 text-yellow-950 text-xs">Admin Only</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 pt-2">
                  <p className="text-xs text-muted-foreground mb-3">
                    Grant free Pro access. These toggles are for admin-granted access only — they won't reflect promo code or paid subscription status.
                  </p>
                  <Card>
                    <CardContent className="p-4 space-y-4">
                      {/* Pro Toggle */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Crown className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">Free Pro Access</p>
                            <p className="text-xs text-muted-foreground">Grant free Pro features</p>
                          </div>
                        </div>
                        <Switch
                          checked={(teamSubscription as any)?.admin_pro_override || false}
                          onCheckedChange={async (checked) => {
                            const { error } = await supabase
                              .from("team_subscriptions")
                              .upsert({ 
                                team_id: id!, 
                                admin_pro_override: checked,
                                admin_pro_football_override: checked ? (teamSubscription as any)?.admin_pro_football_override || false : false,
                                is_pro: teamSubscription?.is_pro || false,
                                is_pro_football: teamSubscription?.is_pro_football || false,
                                disable_auto_subs: teamSubscription?.disable_auto_subs || false,
                                rotation_speed: teamSubscription?.rotation_speed || 1
                              }, { onConflict: 'team_id' });
                            if (error) {
                              toast({ title: "Failed to update", variant: "destructive" });
                            } else {
                              queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
                              toast({ title: checked ? "Free Pro access granted" : "Free Pro access removed" });
                            }
                          }}
                        />
                      </div>
                      
                      {/* Pro Football Toggle - Only for Soccer Teams */}
                      {isSoccerClub && (
                        <div className="flex items-center justify-between pt-2 border-t">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10">
                              <Target className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">Free Pro Football Access</p>
                              <p className="text-xs text-muted-foreground">Grant free Pro Football features</p>
                            </div>
                          </div>
                          <Switch
                            checked={(teamSubscription as any)?.admin_pro_football_override || false}
                            onCheckedChange={async (checked) => {
                              const { error } = await supabase
                                .from("team_subscriptions")
                                .upsert({ 
                                  team_id: id!, 
                                  admin_pro_override: checked ? true : (teamSubscription as any)?.admin_pro_override || false,
                                  admin_pro_football_override: checked,
                                  is_pro: teamSubscription?.is_pro || false,
                                  is_pro_football: teamSubscription?.is_pro_football || false,
                                  disable_auto_subs: teamSubscription?.disable_auto_subs || false,
                                  rotation_speed: teamSubscription?.rotation_speed || 1
                                }, { onConflict: 'team_id' });
                              if (error) {
                                toast({ title: "Failed to update", variant: "destructive" });
                              } else {
                                queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
                                toast({ title: checked ? "Free Pro Football access granted" : "Free Pro Football access removed" });
                              }
                            }}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Subscription Payments Section - for team admins/coaches OR club admins */}
          {/* Use isSubscriptionLoading || isTeamPro to prevent Pro locks during loading */}
          {(isCoachOrAdmin || isClubAdmin) && (
            <AccordionItem value="subscription-payments" className="border rounded-lg px-4" disabled={!isSubscriptionLoading && !isTeamPro && !isAppAdmin}>
              <AccordionTrigger className="hover:no-underline disabled:cursor-not-allowed disabled:opacity-70" disabled={!isSubscriptionLoading && !isTeamPro && !isAppAdmin}>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Fee Payments</h2>
                  {/* Only show Pro lock when NOT loading AND NOT Pro AND NOT AppAdmin */}
                  {!isSubscriptionLoading && !isTeamPro && !isAppAdmin && (
                    <div className="flex items-center gap-1.5 ml-2">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <Badge variant="outline" className="text-xs font-normal">Pro</Badge>
                    </div>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                {isSubscriptionLoading ? (
                  <div className="pt-2 flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (isTeamPro || isAppAdmin) ? (
                  <div className="pt-2">
                    <MemberSubscriptionPaymentsManager
                      clubId={team.club_id}
                      teamId={id!}
                      members={members}
                      isAdmin={isCoachOrAdmin || isClubAdmin}
                    />
                  </div>
                ) : (
                  <div className="pt-2 text-center text-muted-foreground py-4">
                    Upgrade to Pro to access this feature.
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Team Sponsor - Pro only, hidden in class mode */}
          {isAdmin && team.club_id && !isClassMode && (
            <AccordionItem value="team-sponsor" className="border rounded-lg px-4" disabled={!isTeamPro && !isAppAdmin && !isSubscriptionLoading}>
              <AccordionTrigger className="hover:no-underline disabled:cursor-not-allowed disabled:opacity-70" disabled={!isTeamPro && !isAppAdmin && !isSubscriptionLoading}>
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Team Sponsor</h2>
                  {!isTeamPro && !isAppAdmin && !isSubscriptionLoading && (
                    <div className="flex items-center gap-1.5 ml-2">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <Badge variant="outline" className="text-xs font-normal">Pro</Badge>
                    </div>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                {isSubscriptionLoading ? (
                  <div className="pt-2 flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (isTeamPro || isAppAdmin) ? (
                  <div className="pt-2">
                    <TeamSponsorSelector
                      teamId={id!}
                      currentSponsorId={team.sponsor_id || null}
                      onUpdate={() => queryClient.invalidateQueries({ queryKey: ["team", id] })}
                    />
                  </div>
                ) : (
                  <div className="pt-2 text-center text-muted-foreground py-4">
                    Upgrade to Pro to access this feature.
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Team Rewards Section - Pro only, hidden in class mode */}
          {isAdmin && team.club_id && !isClassMode && (
            <AccordionItem value="team-rewards" className="border rounded-lg px-4" disabled={!isTeamPro && !isAppAdmin && !isSubscriptionLoading}>
              <AccordionTrigger className="hover:no-underline disabled:cursor-not-allowed disabled:opacity-70" disabled={!isTeamPro && !isAppAdmin && !isSubscriptionLoading}>
                <div className="flex items-center gap-2">
                  <Flame className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Team Rewards</h2>
                  {!isTeamPro && !isAppAdmin && !isSubscriptionLoading && (
                    <div className="flex items-center gap-1.5 ml-2">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <Badge variant="outline" className="text-xs font-normal">Pro</Badge>
                    </div>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                {isSubscriptionLoading ? (
                  <div className="pt-2 flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (isTeamPro || isAppAdmin) ? (
                  <div className="pt-2">
                    <TeamRewardsManager 
                      teamId={id!} 
                      clubId={team.club_id} 
                      disableTeamOverrides={clubSubscription?.disable_team_pom_rewards || false}
                    />
                  </div>
                ) : (
                  <div className="pt-2 text-center text-muted-foreground py-4">
                    Upgrade to Pro to access this feature.
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Pitch Settings Section - Pro Football only */}
          {isAdmin && isSoccerClub && (
            <AccordionItem value="pitch-settings" className="border rounded-lg px-4" disabled={!hasProFootball && !isAppAdmin && !isSubscriptionLoading}>
              <AccordionTrigger className="hover:no-underline disabled:cursor-not-allowed disabled:opacity-70" disabled={!hasProFootball && !isAppAdmin && !isSubscriptionLoading}>
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Pitch Settings</h2>
                  {!hasProFootball && !isAppAdmin && !isSubscriptionLoading && (
                    <div className="flex items-center gap-1.5 ml-2">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <Badge variant="outline" className="text-xs font-normal">Pro Football</Badge>
                    </div>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                {isSubscriptionLoading ? (
                  <div className="pt-2 flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (hasProFootball || isAppAdmin) ? (
                  <div className="pt-2 space-y-4">
                    <DefaultPitchSettings
                    teamSize={teamSubscription?.team_size || 7}
                    formation={teamSubscription?.formation || null}
                    minutesPerHalf={teamSubscription?.minutes_per_half || defaultMinutesPerHalfForTeamName(team?.name)}
                    rotationSpeed={teamSubscription?.rotation_speed || 1}
                    disableAutoSubs={teamSubscription?.disable_auto_subs || false}
                    disablePositionSwaps={teamSubscription?.disable_position_swaps || false}
                    isSaving={isSavingPitchSettings}
                    onTeamSizeChange={async (size) => {
                      // Don't set saving here - let DefaultPitchSettings handle formation update
                    }}
                    onFormationChange={async (formation, newTeamSize?: number) => {
                      setIsSavingPitchSettings(true);
                      const { error } = await supabase
                        .from("team_subscriptions")
                        .upsert({ 
                          team_id: id!, 
                          formation,
                          team_size: newTeamSize ?? teamSubscription?.team_size ?? 7,
                          is_pro: teamSubscription?.is_pro || false,
                          is_pro_football: teamSubscription?.is_pro_football || false,
                          disable_auto_subs: teamSubscription?.disable_auto_subs || false,
                          rotation_speed: teamSubscription?.rotation_speed || 1,
                          minutes_per_half: teamSubscription?.minutes_per_half || defaultMinutesPerHalfForTeamName(team?.name),
                          disable_position_swaps: teamSubscription?.disable_position_swaps || false
                        }, { onConflict: 'team_id' });
                      setIsSavingPitchSettings(false);
                      if (error) {
                        toast({ title: "Failed to update settings", variant: "destructive" });
                      } else {
                        queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
                        toast({ title: newTeamSize ? "Team size updated" : "Formation updated" });
                      }
                    }}
                    onMinutesPerHalfChange={async (minutes) => {
                      setIsSavingPitchSettings(true);
                      const { error } = await supabase
                        .from("team_subscriptions")
                        .upsert({ 
                          team_id: id!, 
                          minutes_per_half: minutes,
                          team_size: teamSubscription?.team_size || 7,
                          formation: teamSubscription?.formation || null,
                          is_pro: teamSubscription?.is_pro || false,
                          is_pro_football: teamSubscription?.is_pro_football || false,
                          disable_auto_subs: teamSubscription?.disable_auto_subs || false,
                          rotation_speed: teamSubscription?.rotation_speed || 1,
                          disable_position_swaps: teamSubscription?.disable_position_swaps || false
                        }, { onConflict: 'team_id' });
                      setIsSavingPitchSettings(false);
                      if (error) {
                        toast({ title: "Failed to update minutes per half", variant: "destructive" });
                      } else {
                        queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
                        toast({ title: "Minutes per half updated" });
                      }
                    }}
                    onRotationSpeedChange={async (speed) => {
                      setIsSavingPitchSettings(true);
                      const { error } = await supabase
                        .from("team_subscriptions")
                        .upsert({ 
                          team_id: id!, 
                          rotation_speed: speed,
                          team_size: teamSubscription?.team_size || 7,
                          formation: teamSubscription?.formation || null,
                          is_pro: teamSubscription?.is_pro || false,
                          is_pro_football: teamSubscription?.is_pro_football || false,
                          disable_auto_subs: teamSubscription?.disable_auto_subs || false,
                          minutes_per_half: teamSubscription?.minutes_per_half || defaultMinutesPerHalfForTeamName(team?.name),
                          disable_position_swaps: teamSubscription?.disable_position_swaps || false
                        }, { onConflict: 'team_id' });
                      setIsSavingPitchSettings(false);
                      if (error) {
                        toast({ title: "Failed to update rotation speed", variant: "destructive" });
                      } else {
                        queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
                        toast({ title: "Rotation speed updated" });
                      }
                    }}
                    onDisableAutoSubsChange={async (disabled) => {
                      setIsSavingPitchSettings(true);
                      const { error } = await supabase
                        .from("team_subscriptions")
                        .upsert({ 
                          team_id: id!, 
                          disable_auto_subs: disabled,
                          team_size: teamSubscription?.team_size || 7,
                          formation: teamSubscription?.formation || null,
                          is_pro: teamSubscription?.is_pro || false,
                          is_pro_football: teamSubscription?.is_pro_football || false,
                          rotation_speed: teamSubscription?.rotation_speed || 1,
                          minutes_per_half: teamSubscription?.minutes_per_half || defaultMinutesPerHalfForTeamName(team?.name),
                          disable_position_swaps: teamSubscription?.disable_position_swaps || false
                        }, { onConflict: 'team_id' });
                      setIsSavingPitchSettings(false);
                      if (error) {
                        toast({ title: "Failed to update auto subs setting", variant: "destructive" });
                      } else {
                        queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
                        toast({ title: disabled ? "Auto subs disabled" : "Auto subs enabled" });
                      }
                    }}
                    onDisablePositionSwapsChange={async (disabled) => {
                      setIsSavingPitchSettings(true);
                      const { error } = await supabase
                        .from("team_subscriptions")
                        .upsert({ 
                          team_id: id!, 
                          disable_position_swaps: disabled,
                          team_size: teamSubscription?.team_size || 7,
                          formation: teamSubscription?.formation || null,
                          is_pro: teamSubscription?.is_pro || false,
                          is_pro_football: teamSubscription?.is_pro_football || false,
                          disable_auto_subs: teamSubscription?.disable_auto_subs || false,
                          rotation_speed: teamSubscription?.rotation_speed || 1,
                          minutes_per_half: teamSubscription?.minutes_per_half || defaultMinutesPerHalfForTeamName(team?.name)
                        }, { onConflict: 'team_id' });
                      setIsSavingPitchSettings(false);
                      if (error) {
                        toast({ title: "Failed to update position swaps setting", variant: "destructive" });
                      } else {
                        queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
                        toast({ title: disabled ? "Position swaps disabled" : "Position swaps enabled" });
                      }
                    }}
                  />
                  </div>
                ) : (
                  <div className="pt-2 text-center text-muted-foreground py-4">
                    Upgrade to Pro Football to access this feature.
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      )}

      {/* Competitions Section */}
      <TeamCompetitionsSection teamId={id!} canManage={isAdmin || isCoachOrAdmin || isClubAdmin} />

      {/* Pitch Board Modal — soccer */}
      {showPitchBoard && pitchBoardAccessGranted && createPortal(
        <Suspense fallback={
          <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: '#2d5a27' }}>
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary">
                  <Flame className="h-8 w-8 text-primary-foreground" />
                </div>
                <span className="text-4xl animate-bounce">⚽</span>
              </div>
              <Loader2 className="h-6 w-6 animate-spin text-white" />
              <p className="text-lg font-medium text-white">
                {isPitchBoardRosterLoading ? "Loading players..." : "Loading Pitch Board..."}
              </p>
            </div>
          </div>
        }>
          {isPitchBoardRosterLoading ? (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: '#2d5a27' }}>
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
                <p className="text-lg font-medium text-white">Loading players...</p>
              </div>
            </div>
          ) : (
            <PitchBoard
              teamId={id!}
              teamName={team.name}
              members={pitchBoardMembersOverride.length > 0 ? pitchBoardMembersOverride : pitchBoardMembers}
              onClose={() => {
                clearPitchBoardOpenFlag();
                setShowPitchBoard(false);
                setLinkedEventId(null);
                setPitchBoardMembersOverride([]);
              }}
              disableAutoSubs={teamSubscription?.disable_auto_subs || false}
              initialRotationSpeed={teamSubscription?.rotation_speed || 1}
              initialDisablePositionSwaps={teamSubscription?.disable_position_swaps || false}
              initialDisableBatchSubs={teamSubscription?.disable_batch_subs || false}
              initialRotateGkAtHalftime={teamSubscription?.rotate_gk_at_halftime ?? true}
              initialMinutesPerHalf={teamSubscription?.minutes_per_half || defaultMinutesPerHalfForTeamName(team?.name)}
              initialMaxSpreadMinutes={(teamSubscription as any)?.max_spread_minutes ?? 5}
              initialTeamSize={teamSubscription?.team_size}
              initialFormation={teamSubscription?.formation || undefined}
              readOnly={!canEditPitchBoard && !isSubsManager}
              isSubsManager={!!isSubsManager || hasNearbySubsManagerDuty}
              initialLinkedEventId={linkedEventId}
              onUnlinkEvent={() => {
                setLinkedEventId(null);
                setPitchBoardMembersOverride([]);
              }}
              initialShowLineupPicker={teamSubscription?.show_lineup_picker || false}
            />
          )}
        </Suspense>,
        document.body
      )}

      {/* Netball + Basketball Game Board modals archived — football-only build (see archive/sports/) */}

      {/* Admin invite dialog - shown after team creation with "assign someone else" option */}
      <TeamAdminInviteDialog
        open={showAdminInviteDialog}
        onOpenChange={(open) => {
          setShowAdminInviteDialog(open);
          // Clear the location state when dialog is closed to prevent re-showing on refresh
          if (!open && locationState?.showAdminInvite) {
            navigate(location.pathname, { replace: true, state: {} });
          }
        }}
        teamName={adminInviteTeamName || team?.name || ""}
        inviteName={adminInviteName}
        inviteEmail={adminInviteEmail}
        onDone={() => {
          setShowAdminInviteDialog(false);
          navigate(location.pathname, { replace: true, state: {} });
        }}
      />

      {/* Long-press position editor */}
      {positionSheetPlayer && id && (
        <PlayerPositionSheet
          open={!!positionSheetPlayer}
          onOpenChange={(open) => { if (!open) setPositionSheetPlayer(null); }}
          teamId={id}
          playerId={positionSheetPlayer.id}
          playerName={positionSheetPlayer.name}
          playerType={positionSheetPlayer.type}
        />
      )}
      {inviteParentChild && id && (
        <InviteOtherParentSheet
          open={!!inviteParentChild}
          onOpenChange={(open) => { if (!open) setInviteParentChild(null); }}
          childId={inviteParentChild.childId}
          childName={inviteParentChild.childName}
          teamIds={[id]}
        />
      )}
      {linkChildToParent && id && team && (
        <LinkChildToParentSheet
          open={!!linkChildToParent}
          onOpenChange={(open) => { if (!open) setLinkChildToParent(null); }}
          childName={linkChildToParent.childName}
          existingChildId={linkChildToParent.existingChildId}
          pendingInviteIds={linkChildToParent.pendingInviteIds}
          teamId={id}
          clubId={team.club_id || (team.clubs as any)?.id || ""}
          members={members}
        />
      )}
      {moveToTeam && id && team && (
        <MoveToTeamSheet
          open={!!moveToTeam}
          onOpenChange={(open) => { if (!open) setMoveToTeam(null); }}
          clubId={team.club_id || (team.clubs as any)?.id || ""}
          fromTeamId={id}
          fromTeamName={team.name}
          memberType={moveToTeam.type}
          memberId={moveToTeam.id}
          memberName={moveToTeam.name}
          memberRoles={moveToTeam.roles}
        />
      )}
      {addRoleMember && id && team && (
        <AddRoleToMemberDialog
          userId={addRoleMember.userId}
          userName={addRoleMember.userName}
          teamId={id}
          teamName={team.name}
          clubId={team.club_id}
          existingRoles={addRoleMember.existingRoles}
          open={!!addRoleMember}
          onOpenChange={(open) => { if (!open) setAddRoleMember(null); }}
        />
      )}
      <AlertDialog open={!!removeMember} onOpenChange={(open) => { if (!open) setRemoveMember(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {removeMember?.name} from the team. They can request to join again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!removeMember || !id) return;
                // Use scoped RPC so team role, child assignments to this team,
                // and team-chat group memberships are revoked atomically.
                // child_guardians and access to unrelated teams are preserved.
                const { error } = await supabase.rpc("remove_team_member", {
                  _team_id: id,
                  _user_id: removeMember.userId,
                });
                if (error) {
                  toast({ title: "Failed to remove member", description: error.message, variant: "destructive" });
                } else {
                  await supabase.from("notifications").insert({
                    user_id: removeMember.userId,
                    type: "membership",
                    message: `You have been removed from ${team?.name || "the team"}`,
                    related_id: id,
                  });
                  queryClient.invalidateQueries({ queryKey: ["team-roles", id] });
                  queryClient.invalidateQueries({ queryKey: ["chat-members", "team", id] });
                  queryClient.invalidateQueries({ queryKey: ["authorized-scopes"] });
                  toast({ title: "Member removed" });
                }
                setRemoveMember(null);
              }}
              className="bg-destructive text-destructive-foreground"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {selectedMember && (
        <MemberDetailSheet
          open={!!selectedMember}
          onOpenChange={(open) => { if (!open) setSelectedMember(null); }}
          userId={selectedMember.userId}
          displayName={selectedMember.displayName}
          avatarUrl={selectedMember.avatarUrl}
          roles={selectedMember.roles}
          canManage={isAdmin || isClubAdmin}
          canMove={isClubAdmin && selectedMember.userId !== user?.id}
          isSelf={selectedMember.userId === user?.id}
          teamId={id}
          teamName={team.name}
          clubId={team.club_id}
          onRolesUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ["team-roles", id] });
            setSelectedMember(null);
          }}
          onAddRole={() => setAddRoleMember({
            userId: selectedMember.userId,
            userName: selectedMember.displayName,
            existingRoles: selectedMember.roles.map(r => r.role),
          })}
          onMove={() => setMoveToTeam({
            type: "adult",
            id: selectedMember.userId,
            name: selectedMember.displayName,
            roles: selectedMember.roles.map(r => r.role),
          })}
          onRemove={() => setRemoveMember({
            userId: selectedMember.userId,
            name: selectedMember.displayName,
          })}
          onRemoveRole={async (roleItem) => {
            const { error } = await supabase
              .from("user_roles")
              .delete()
              .eq("id", roleItem.id);
            if (error) {
              toast({ title: "Failed to remove role", variant: "destructive" });
            } else {
              toast({ title: "Role removed" });
              queryClient.invalidateQueries({ queryKey: ["team-roles", id] });
              setSelectedMember(null);
            }
          }}
        />
      )}
      {selectedChild && (
        <ChildDetailSheet
          open={!!selectedChild}
          onOpenChange={(open) => { if (!open) setSelectedChild(null); }}
          childName={selectedChild.childName}
          parentDisplay={selectedChild.parentDisplay}
          isPending={selectedChild.isPending}
          canManage={isAdmin || isClubAdmin}
          showPosition={!!isSoccerClub}
          canMove={isClubAdmin}
          onInviteParent={() => setInviteParentChild({ childId: selectedChild.childId, childName: selectedChild.childName })}
          onEditPosition={() => setPositionSheetPlayer({ id: selectedChild.childId, name: selectedChild.childName, type: "child" })}
          onSwapTeam={() => setMoveToTeam({ type: "child", id: selectedChild.childId, name: selectedChild.childName })}
          onLink={selectedChild.isPending && selectedChild.linkInviteIds ? () => setLinkChildToParent({ childName: selectedChild.childName, existingChildId: selectedChild.childId, pendingInviteIds: selectedChild.linkInviteIds || [] }) : undefined}
          onRemove={(isAdmin || isClubAdmin) && !selectedChild.isPending ? () => setRemoveChild({ childId: selectedChild.childId, name: selectedChild.childName }) : undefined}
        />
      )}
      <AlertDialog open={!!removeChild} onOpenChange={(open) => { if (!open) { setRemoveChild(null); setRemoveChildConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Player?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will remove <strong>{removeChild?.name}</strong> from the team. Their RSVPs, attendance and stats history for this team will no longer be linked. Their parent can request to rejoin.
                </p>
                <p className="text-foreground font-medium">
                  Type <span className="font-bold text-destructive">"{removeChild?.name}"</span> to confirm:
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={removeChildConfirmText}
            onChange={(e) => setRemoveChildConfirmText(e.target.value)}
            placeholder={removeChild?.name || ""}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeChildConfirmText.trim().toLowerCase() !== (removeChild?.name || "").trim().toLowerCase()}
              onClick={async () => {
                if (!removeChild || !id) return;
                const { error } = await supabase
                  .from("child_team_assignments")
                  .delete()
                  .eq("child_id", removeChild.childId)
                  .eq("team_id", id);
                if (error) {
                  toast({ title: "Failed to remove player", variant: "destructive" });
                } else {
                  queryClient.invalidateQueries({ queryKey: ["team-children", id] });
                  toast({ title: "Player removed" });
                }
                setRemoveChild(null);
                setRemoveChildConfirmText("");
              }}
              className="bg-destructive text-destructive-foreground"
            >
              Remove Player
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
