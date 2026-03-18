import { useState, useEffect, lazy, Suspense, useMemo } from "react";
import { prefetchProfiles } from "@/hooks/useProfiles";
import { getProfileFromCache, cacheProfiles } from "@/lib/profileCache";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Users, Calendar, MessageCircle, Settings, Trash2, UserPlus, Loader2, Crown, Pencil, LayoutGrid, Plus, Target, Timer, X, RefreshCw, CreditCard, Flame, Building2, Lock, FolderOpen, BarChart3, Archive, ArchiveRestore, MoreVertical, Folder, ClipboardCheck, Copy } from "lucide-react";
import { ArchiveTeamDialog } from "@/components/ArchiveTeamDialog";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
const PitchBoard = lazy(() => import("@/components/pitch/PitchBoard"));
import { DefaultPitchSettings } from "@/components/pitch/DefaultPitchSettings";
import CreateGroupDialog from "@/components/chat/CreateGroupDialog";
import ChatGroupsList from "@/components/chat/ChatGroupsList";
import AddTeamMemberSheet from "@/components/AddTeamMemberSheet";
import { TeamAdminInviteDialog } from "@/components/TeamAdminInviteDialog";
import TeamPlayerPositionEditor from "@/components/TeamPlayerPositionEditor";
import AddRoleToMemberDialog from "@/components/AddRoleToMemberDialog";
import PromoteToTeamAdminDialog from "@/components/PromoteToTeamAdminDialog";
import { getSportEmoji } from "@/lib/sportEmojis";
import { findNearbyGameEvent } from "@/hooks/useNearbyGameEvent";
import MemberSubscriptionPaymentsManager from "@/components/MemberSubscriptionPaymentsManager";
import { PrimarySponsorDisplay } from "@/components/PrimarySponsorDisplay";
import { TeamSponsorSelector } from "@/components/TeamSponsorSelector";
import PendingInvitesList from "@/components/PendingInvitesList";
import TeamRewardsManager from "@/components/TeamRewardsManager";
import { getFolderColorClass } from "@/components/TeamFoldersManager";
import { ClassAttendanceSingle } from "@/components/ClassAttendanceSingle";


type TeamRole = "player" | "parent" | "coach" | "team_admin";

const SOCCER_SPORTS = ["soccer", "football", "futsal"];

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
  const [memberRoleFilter, setMemberRoleFilter] = useState<string>("child");
  
  const [selectedRole, setSelectedRole] = useState<TeamRole>("player");
  const [showPitchBoard, setShowPitchBoard] = useState(false);
  const [linkedEventId, setLinkedEventId] = useState<string | null>(null);
  const [isSavingPitchSettings, setIsSavingPitchSettings] = useState(false);
  
  // Handle admin invite dialog from team creation flow
  const locationState = location.state as { showAdminInvite?: boolean; inviteName?: string; inviteEmail?: string; teamName?: string } | null;
  const [showAdminInviteDialog, setShowAdminInviteDialog] = useState(!!locationState?.showAdminInvite);
  const adminInviteName = locationState?.inviteName || "";
  const adminInviteEmail = locationState?.inviteEmail || "";
  const adminInviteTeamName = locationState?.teamName || "";

  const { data: team, isLoading } = useQuery({
    queryKey: ["team", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs (id, name, is_pro, sport, class_mode_enabled)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const isSoccerClub = team?.clubs?.sport && SOCCER_SPORTS.some(keyword => 
    team.clubs.sport.toLowerCase().includes(keyword)
  );

  const isClassMode = !!team?.clubs?.class_mode_enabled;

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
      const { data } = await supabase
        .from("team_subscriptions")
        .select("*")
        .eq("team_id", id!)
        .maybeSingle();
      return data;
    },
    enabled: !!id,
  });

  const { data: clubSubscription, isLoading: isClubSubscriptionLoading, isFetching: isClubSubscriptionFetching } = useQuery({
    queryKey: ["club-subscription", team?.club_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", team!.club_id)
        .maybeSingle();
      return data;
    },
    enabled: !!team?.club_id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes to prevent unnecessary refetches
  });

  // Check if user is club admin for this team's club (needed for isSubscriptionLoading calculation)
  const { data: isClubAdmin, isLoading: isClubAdminLoading, isFetching: isClubAdminFetching } = useQuery({
    queryKey: ["is-club-admin", user?.id, team?.club_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("club_id", team!.club_id)
        .eq("role", "club_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && !!team?.club_id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch team folders for move-to-folder functionality
  const { data: teamFolders = [] } = useQuery({
    queryKey: ["team-folders", team?.club_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_folders")
        .select("*")
        .eq("club_id", team!.club_id)
        .order("sort_order");
      return data || [];
    },
    enabled: !!team?.club_id,
  });

  const moveTeamToFolderMutation = useMutation({
    mutationFn: async ({ teamId, folderId }: { teamId: string; folderId: string | null }) => {
      const { error } = await supabase
        .from("teams")
        .update({ folder_id: folderId })
        .eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team", id] });
      queryClient.invalidateQueries({ queryKey: ["club-teams", team?.club_id] });
      toast({ title: "Team moved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to move team", variant: "destructive" });
    },
  });

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
                               (teamSubscription as any)?.admin_pro_override || (teamSubscription as any)?.admin_pro_football_override;
  
  // Team has Pro if: club has Pro (inherited) OR (club is free AND team has individual Pro)
  // IMPORTANT: During loading, assume Pro access (optimistic) to avoid flashing Pro locks
  const isTeamPro = isSubscriptionLoading ? true : (clubHasPro || (!clubHasPro && teamHasIndividualPro));
  
  const clubHasProFootball = clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override;
  const teamHasIndividualProFootball = teamSubscription?.is_pro_football || (teamSubscription as any)?.admin_pro_football_override;
  // During loading, assume Pro access to avoid flashing Pro locks
  const hasProFootball = isSubscriptionLoading ? true : (clubHasProFootball || (!clubHasProFootball && teamHasIndividualProFootball));

  // Note: refetchOnMount: 'always' on the queries ensures fresh data
  // without clearing the cache (which would cause a flash of empty state)

  // Fetch children assigned to the team
  const { data: teamChildren = [], isLoading: isChildrenLoading, isFetching: isChildrenFetching, refetch: refetchChildren } = useQuery({
    queryKey: ["team-children", id],
    queryFn: async () => {
      // First get the child assignments
      const { data: assignments, error: assignError } = await supabase
        .from("child_team_assignments")
        .select("id, child_id")
        .eq("team_id", id!);
      if (assignError) throw assignError;
      if (!assignments || assignments.length === 0) return [];
      
      const childIds = assignments.map(a => a.child_id);
      
      // Fetch children separately - this handles RLS better
      const { data: childrenData, error: childError } = await supabase
        .from("children")
        .select("id, name, year_of_birth, parent_id")
        .in("id", childIds);
      if (childError) throw childError;
      
      // Fetch parent profiles
      const parentIds = [...new Set((childrenData || []).map(c => c.parent_id).filter(Boolean))];
      let parentProfiles: Record<string, { id: string; display_name: string | null }> = {};
      if (parentIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", parentIds);
        parentProfiles = (profiles || []).reduce((acc, p) => {
          acc[p.id] = p;
          return acc;
        }, {} as Record<string, { id: string; display_name: string | null }>);
      }
      
      // Combine the data
      return assignments.map(assignment => {
        const child = (childrenData || []).find(c => c.id === assignment.child_id);
        return {
          id: assignment.id,
          child_id: assignment.child_id,
          children: child ? {
            ...child,
            profiles: child.parent_id ? parentProfiles[child.parent_id] : null,
          } : null,
        };
      }).filter(a => a.children !== null);
    },
    enabled: !!id,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  // Fetch roles data with profiles - with caching for faster loads
  const { data: rawMembers = [], isLoading: isMembersLoading, isFetching: isMembersFetching, refetch: refetchMembers } = useQuery({
    queryKey: ["team-roles", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, user_id, role, profiles (id, display_name, avatar_url)")
        .eq("team_id", id!);
      if (error) throw error;
      
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
    
    return rawMembers.reduce((acc, role) => {
      // user_id should always be present in user_roles table
      const userId = role.user_id;
      if (!userId) return acc;
      
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
  }, [rawMembers]);


  const { data: userRoles = [], isLoading: isUserRoleLoading } = useQuery({
    queryKey: ["user-team-roles", id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("team_id", id!);
      return data?.map(r => r.role) ?? [];
    },
    enabled: !!id && !!user,
  });
  
  // Get primary role for display - prioritize admin roles
  const userRole = userRoles.includes("team_admin") ? "team_admin" 
    : userRoles.includes("coach") ? "coach"
    : userRoles[0] ?? null;

  const { data: isAppAdmin } = useQuery({
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
  // isMember includes club admins - they have implicit access to all teams in their club
  const isMember = userRoles.length > 0 || isAppAdmin;
  
  // isClubAdmin is already defined above (before isSubscriptionLoading calculation)
  
  // All team members can view pitch board (read-only); only team admins/coaches can edit
  // Subs Manager duty check is done dynamically when the pitch board opens with a linkedEventId
  const canAccessPitchBoard = isMember;
  const canEditPitchBoard = isCoachOrAdmin; // Non-coaches/admins get view-only (Subs Manager override handled via linkedEventId)

  // Check if user has "Subs Manager" duty for the linked event
  const { data: isSubsManager } = useQuery({
    queryKey: ["subs-manager-duty", linkedEventId, user?.id],
    queryFn: async () => {
      if (!linkedEventId || !user) return false;
      const { data } = await supabase
        .from("duties")
        .select("id")
        .eq("event_id", linkedEventId)
        .eq("name", "Subs Manager")
        .eq("assigned_to", user.id)
        .maybeSingle();
      return !!data;
    },
    enabled: !!linkedEventId && !!user && !canEditPitchBoard,
  });

  // Fetch pending invites for this team
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites", id, null],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, role, invited_user_id, invited_label, invited_email, created_at, status, email_sent_at, email_id, email_error")
        .eq("team_id", id!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      
      // Fetch profile data separately for invited users
      const invitesWithProfiles = await Promise.all(
        (data || []).map(async (invite) => {
          if (invite.invited_user_id) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("id, display_name, avatar_url")
              .eq("id", invite.invited_user_id)
              .single();
            return { ...invite, profiles: profile };
          }
          return { ...invite, profiles: null };
        })
      );
      
      // Strip email for non-admins to protect privacy
      if (!isCoachOrAdmin) {
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
      const { error } = await supabase.from("role_requests").insert({
        user_id: user!.id,
        team_id: id!,
        club_id: team?.club_id,
        role: selectedRole,
      });
      if (error) throw error;

      // Notify team admins, coaches, and club admins
      const { data: teamAdmins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", id!)
        .in("role", ["team_admin", "coach"]);

      // Also notify club admins
      const { data: clubAdmins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", team?.club_id)
        .eq("role", "club_admin");

      // Combine and deduplicate admin user IDs
      const adminUserIds = new Set<string>();
      teamAdmins?.forEach(a => adminUserIds.add(a.user_id));
      clubAdmins?.forEach(a => adminUserIds.add(a.user_id));

      if (adminUserIds.size > 0) {
        const notifications = Array.from(adminUserIds).map((userId) => ({
          user_id: userId,
          type: "role_request",
          message: `New role request: Someone wants to join ${team?.name} as ${selectedRole.replace("_", " ")}`,
          related_id: id!,
        }));
        await supabase.from("notifications").insert(notifications);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-request", id] });
      toast({ title: "Request submitted", description: "An admin will review your request." });
    },
    onError: () => {
      toast({ title: "Failed to submit request", variant: "destructive" });
    },
  });

  const handleDelete = async () => {
    // Get all team members to notify them
    const { data: teamMembers } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("team_id", id!);
    
    // Send notifications to all members (except current user)
    if (teamMembers && teamMembers.length > 0) {
      const notifications = teamMembers
        .filter(m => m.user_id !== user?.id)
        .map(m => ({
          user_id: m.user_id,
          type: "membership",
          message: `${team?.name || "A team"} has been deleted`,
          related_id: team?.club_id,
        }));
      
      if (notifications.length > 0) {
        await supabase.from("notifications").insert(notifications);
      }
    }

    const { error } = await supabase.from("teams").delete().eq("id", id!);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to delete team.",
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Team deleted" });
    navigate(`/clubs/${team?.club_id}`);
  };

  if (isLoading) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-32 w-full" />
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
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => {
          if (window.history.length > 1) {
            navigate(-1);
          } else {
            navigate(`/clubs/${team.club_id}`);
          }
        }}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold flex-1 truncate">{team.name}</h1>
          {isAdmin && isClassMode && (
            <Button variant="ghost" size="icon" onClick={() => navigate(`/teams/${id}/edit`)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`/teams/${id}/edit`)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit {isClassMode ? "Class" : "Team"}
              </DropdownMenuItem>
              {isClassMode && (
                <DropdownMenuItem onClick={async () => {
                  // Duplicate class: create a copy with "(Copy)" suffix
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
              {teamFolders.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Move to Folder
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        onClick={() => moveTeamToFolderMutation.mutate({ teamId: id!, folderId: null })}
                        disabled={(team as any)?.folder_id === null}
                      >
                        <FolderOpen className="h-4 w-4 mr-2 text-muted-foreground" />
                        Uncategorized
                      </DropdownMenuItem>
                      {teamFolders.map((folder: any) => (
                        <DropdownMenuItem
                          key={folder.id}
                          onClick={() => moveTeamToFolderMutation.mutate({ teamId: id!, folderId: folder.id })}
                          disabled={(team as any)?.folder_id === folder.id}
                        >
                          <Folder className={`h-4 w-4 mr-2 ${getFolderColorClass(folder.color || 'default').className}`} />
                          {folder.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                </>
              )}
              <ArchiveTeamDialog
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
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Team
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Team?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the team and all its events. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Archived Banner */}
      {(team as any)?.is_archived && (
        <Card className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-3 flex items-center gap-3">
            <Archive className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                This team is archived{(team as any)?.season_label ? ` · ${(team as any).season_label}` : ""}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">Only admins can see this team</p>
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
                  <Button size="sm" variant="outline" className="shrink-0 border-amber-600/40 text-amber-700">
                    <ArchiveRestore className="h-4 w-4 mr-1" /> Reinstate
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Team Info */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 border-2 border-primary/20">
              <AvatarImage src={team.logo_url || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-xl">
                {team.name?.charAt(0)?.toUpperCase() || "T"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xl">{getSportEmoji(team.clubs?.sport)}</span>
                <span className="font-semibold text-lg">{team.name}</span>
                {isTeamPro && (
                  <Badge className="bg-yellow-500 text-yellow-950">PRO</Badge>
                )}
                {hasProFootball && (
                  <Badge className="bg-emerald-500 text-emerald-950">PRO FOOTBALL</Badge>
                )}
              </div>
              <p className="text-muted-foreground text-sm">{team.clubs?.name}</p>
              {team.level_age && (
                <Badge variant="outline" className="mt-1">{team.level_age}</Badge>
              )}
            </div>
          </div>
          {team.description && (
            <p className="text-muted-foreground text-sm mt-3">{team.description}</p>
          )}
        </CardContent>
      </Card>

      {/* Enrolment Link for Class-mode teams - hide if already enrolled */}
      {team.clubs?.class_mode_enabled && team.class_day && !isEnrolledInClass && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 hover:border-primary/50 transition-colors cursor-pointer"
          onClick={() => navigate(`/clubs/${team.club_id}/enrol`)}
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

      {/* Join Request Section for Non-members - hidden in class mode (use enrolment page instead) */}
      {!isClassMode && !isUserRoleLoading && !isMember && !isClubAdmin && (
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
                        onClick={() => setSelectedRole(opt.value)}
                        className={`
                          p-3 rounded-lg border-2 text-left transition-all
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

                {/* Submit Button */}
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => requestRoleMutation.mutate()}
                  disabled={requestRoleMutation.isPending}
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

      {/* Quick Actions - Team Chat only for team members, not club admins who aren't members */}
      {isMember && (
        <div className="grid grid-cols-2 gap-3">
          <Link to={`/messages/${team.id}`} aria-label="Open team chat">
            <Card className="hover:border-primary/50 transition-colors" role="button">
              <CardContent className="p-4 flex flex-col items-center gap-2">
                <MessageCircle className="h-6 w-6 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium">Team Chat</span>
              </CardContent>
            </Card>
          </Link>
          <Link to={`/events?team=${team.id}`} aria-label="View team schedule">
            <Card className="hover:border-primary/50 transition-colors" role="button">
              <CardContent className="p-4 flex flex-col items-center gap-2">
                <Calendar className="h-6 w-6 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium">Schedule</span>
              </CardContent>
            </Card>
          </Link>
          {/* Vault - show as accessible during loading (optimistic) or when Pro */}
          {(isSubscriptionLoading || isTeamPro) ? (
            <Link to={`/vault?team=${team.id}`} aria-label="Open file vault">
              <Card className="hover:border-primary/50 transition-colors" role="button">
                <CardContent className="p-4 flex flex-col items-center gap-2">
                  <FolderOpen className="h-6 w-6 text-primary" aria-hidden="true" />
                  <span className="text-sm font-medium">Vault</span>
                </CardContent>
              </Card>
            </Link>
          ) : (
            <Card className="border-muted bg-muted/30 cursor-not-allowed">
              <CardContent className="p-4 flex flex-col items-center gap-2 relative">
                <div className="absolute top-2 right-2">
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Lock className="h-3 w-3" />
                    Pro
                  </Badge>
                </div>
                <FolderOpen className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Vault</span>
              </CardContent>
            </Card>
          )}
          {isSoccerClub && (hasProFootball || isAppAdmin) && (
            <Card 
              className="hover:border-primary/50 transition-colors cursor-pointer"
              onClick={async () => {
                // Check for nearby game event to auto-link
                const nearbyEventId = await findNearbyGameEvent(id!);
                setLinkedEventId(nearbyEventId);
                setShowPitchBoard(true);
              }}
              onMouseEnter={() => {
                // Prefetch player positions data
                queryClient.prefetchQuery({
                  queryKey: ["team-player-positions", id],
                  queryFn: async () => {
                    const { data } = await supabase
                      .from("team_player_positions")
                      .select("*")
                      .eq("team_id", id!);
                    return data || [];
                  },
                  staleTime: 60000,
                });
                // Prefetch formations
                queryClient.prefetchQuery({
                  queryKey: ["pitch-formations", id],
                  queryFn: async () => {
                    const { data } = await supabase
                      .from("pitch_formations")
                      .select("*")
                      .eq("team_id", id!);
                    return data || [];
                  },
                  staleTime: 60000,
                });
              }}
            >
              <CardContent className="p-4 flex flex-col items-center gap-2">
                <LayoutGrid className="h-6 w-6 text-primary" />
                <span className="text-sm font-medium">Pitch Board</span>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Collapsible Sections */}
      {(isMember || isClubAdmin) && (
        <Accordion 
          type="multiple" 
          defaultValue={[]} 
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
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2 flex-1">
                <Users className="h-5 w-5 text-primary" />
                <span className="text-lg font-semibold">Members</span>
                <Badge variant="secondary" className="ml-2">
                  {((isMembersLoading || isMembersFetching) && Object.keys(members).length === 0) || ((isChildrenLoading || isChildrenFetching) && teamChildren.length === 0)
                    ? "..."
                    : Object.keys(members).length + teamChildren.length}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 ml-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    refetchMembers();
                    refetchChildren();
                  }}
                  disabled={isMembersFetching || isChildrenFetching}
                >
                  <RefreshCw className={`h-4 w-4 ${isMembersFetching || isChildrenFetching ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pt-2">
                <div className="flex flex-wrap gap-2 justify-between items-center">
                  <Select value={memberRoleFilter} onValueChange={setMemberRoleFilter}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue placeholder="Filter by role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="player">Players</SelectItem>
                      <SelectItem value="parent">Parents</SelectItem>
                      <SelectItem value="coach">Coaches</SelectItem>
                      <SelectItem value="team_admin">Team Admins</SelectItem>
                      <SelectItem value="child">Children</SelectItem>
                    </SelectContent>
                  </Select>
                  {(isAdmin || isClubAdmin) && (
                    <AddTeamMemberSheet 
                      teamId={id!} 
                      teamName={team.name} 
                      clubId={team.club_id}
                      teamType={(team as any).team_type || "mixed"}
                      isClubAdminOnly={isClubAdmin && !isCoachOrAdmin}
                    />
                  )}
                </div>
{Object.keys(members).length === 0 && teamChildren.length === 0 && pendingInvites.length === 0 && !isMembersLoading && !isChildrenLoading && !isMembersFetching && !isChildrenFetching ? (
                  <p className="text-muted-foreground text-sm">No members yet</p>
                ) : (
                  <div className="space-y-2">
                    {Object.keys(members).length === 0 && teamChildren.length === 0 && pendingInvites.length === 0 && (isMembersFetching || isChildrenFetching) && (
                      <div className="flex justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {/* Pending Invites Section */}
                    {pendingInvites.length > 0 && (memberRoleFilter === "all" || pendingInvites.some(inv => inv.role === memberRoleFilter)) && (
                      <PendingInvitesList
                        invites={memberRoleFilter === "all" ? pendingInvites : pendingInvites.filter(inv => inv.role === memberRoleFilter)}
                        teamId={id}
                        isAdmin={isAdmin || isClubAdmin}
                      />
                    )}
                    {Object.entries(members).filter(([_, member]) => 
                      memberRoleFilter === "all" || memberRoleFilter === "child" ? memberRoleFilter === "all" : member.roles?.some(r => r.role === memberRoleFilter)
                    ).map(([userId, member]) => (
                      <Card key={userId}>
                        <CardContent className="p-3 flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={member.profile?.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/20 text-primary text-sm">
                              {member.profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="font-medium text-sm">{member.profile?.display_name || "Unknown User"}</p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {member.roles?.map((roleItem) => {
                              const roleLabels: Record<string, string> = {
                                app_admin: "App Admin",
                                club_admin: "Club Admin",
                                team_admin: "Team Admin",
                                coach: "Coach",
                                player: "Player",
                                parent: "Parent",
                                basic_user: "Member",
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
                              const colorClass = roleColors[roleItem.role] || roleColors.basic_user;
                              const label = roleLabels[roleItem.role] || "Member";
                              const canRemoveRole = isAdmin && userId !== user?.id && (member.roles?.length || 0) > 1;
                              return (
                                <AlertDialog key={roleItem.id}>
                                  <Badge variant="outline" className={`text-xs border ${colorClass} flex items-center gap-1`}>
                                    {label}
                                    {canRemoveRole && (
                                      <AlertDialogTrigger asChild>
                                        <button
                                          onClick={(e) => e.stopPropagation()}
                                          className="ml-0.5 hover:bg-destructive/20 rounded-full p-0.5 -mr-1"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </AlertDialogTrigger>
                                    )}
                                  </Badge>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Remove {label} Role?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This will remove the {label} role from {member.profile?.display_name || "this user"}.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={async () => {
                                          const { error } = await supabase
                                            .from("user_roles")
                                            .delete()
                                            .eq("id", roleItem.id);
                                          if (error) {
                                            toast({ title: "Failed to remove role", variant: "destructive" });
                                          } else {
                                            toast({ title: `Removed ${label} role` });
                                            queryClient.invalidateQueries({ queryKey: ["team-roles", id] });
                                          }
                                        }}
                                      >
                                        Remove
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              );
                            })}
                          </div>
                          {isAdmin && (
                            <AddRoleToMemberDialog
                              userId={userId}
                              userName={member.profile?.display_name || "User"}
                              teamId={id!}
                              teamName={team.name}
                              clubId={team.club_id}
                              existingRoles={member.roles?.map(r => r.role) || []}
                            />
                          )}
                          {isAdmin && userId !== user?.id && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove Member?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will remove {member.profile?.display_name} from the team. They can request to join again.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={async () => {
                                      const { error } = await supabase
                                        .from("user_roles")
                                        .delete()
                                        .eq("user_id", userId)
                                        .eq("team_id", id!);
                                      if (error) {
                                        toast({ title: "Failed to remove member", variant: "destructive" });
                                      } else {
                                        await supabase.from("notifications").insert({
                                          user_id: userId,
                                          type: "membership",
                                          message: `You have been removed from ${team?.name || "the team"}`,
                                          related_id: id,
                                        });
                                        queryClient.invalidateQueries({ queryKey: ["team-roles", id] });
                                        toast({ title: "Member removed" });
                                      }
                                    }}
                                    className="bg-destructive text-destructive-foreground"
                                  >
                                    Remove
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                    
                    {/* Children Section */}
                    {teamChildren.length > 0 && (memberRoleFilter === "all" || memberRoleFilter === "child") && (
                      <div className="mt-4 pt-4 border-t">
                        <p className="text-sm font-medium text-muted-foreground mb-2">Players (Children)</p>
                        <div className="space-y-2">
                          {teamChildren.map((assignment: any) => {
                            const child = assignment.children;
                            if (!child) return null;
                            const parent = child.profiles;
                            return (
                              <Card key={assignment.id}>
                                <CardContent className="p-3 flex items-center gap-3">
                                  <Avatar className="h-8 w-8">
                                    <AvatarFallback className="bg-pink-500/20 text-pink-500 text-sm">
                                      {child.name?.charAt(0)?.toUpperCase() || "?"}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1">
                                    <p className="font-medium text-sm">{child.name}</p>
                                    {parent?.display_name && (
                                      <p className="text-xs text-muted-foreground">Parent: {parent.display_name}</p>
                                    )}
                                  </div>
                                  <Badge variant="outline" className="text-xs border bg-pink-500/20 text-pink-400 border-pink-500/30">
                                    Child
                                  </Badge>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    )}
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
                  <span className="text-lg font-semibold">Attendance</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-2">
                  <ClassAttendanceSingle teamId={id!} clubId={team.club_id} />
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {isMember && (
          <AccordionItem value="chat-groups" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-primary" />
                <span className="text-lg font-semibold">Chat Groups</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-2">
                {isAdmin && (
                  <div className="flex justify-end">
                    <CreateGroupDialog teamId={id} />
                  </div>
                )}
                
                {/* Standard Team Chat Link */}
                <Link to={`/messages/${team.id}`}>
                  <Card className="hover:border-primary/50 transition-colors">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <MessageCircle className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Team Chat</p>
                        <p className="text-xs text-muted-foreground">Main team discussion</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                
                <ChatGroupsList teamId={id} canManage={isAdmin} />
              </div>
            </AccordionContent>
          </AccordionItem>
          )}

          {/* Admin Section - collapsed by default */}
          {isAdmin && (
            <AccordionItem value="admin" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-primary" />
                  <span className="text-lg font-semibold">Admin</span>
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
                  <span className="text-lg font-semibold">App Admin</span>
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
                                rotation_speed: teamSubscription?.rotation_speed || 2
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
                                  rotation_speed: teamSubscription?.rotation_speed || 2
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
                  <span className="text-lg font-semibold">Fee Payments</span>
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
                  <span className="text-lg font-semibold">Team Sponsor</span>
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
                  <span className="text-lg font-semibold">Team Rewards</span>
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
                  <span className="text-lg font-semibold">Pitch Settings</span>
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
                    {/* Player Positions Editor */}
                    <div className="flex justify-end">
                      <TeamPlayerPositionEditor 
                        teamId={id!} 
                        members={Object.fromEntries(
                          Object.entries(members).map(([userId, member]) => [
                            userId,
                            { userId, profile: member.profile, roles: member.roles }
                          ])
                        )}
                      />
                    </div>
                    <DefaultPitchSettings
                    teamSize={teamSubscription?.team_size || 7}
                    formation={teamSubscription?.formation || null}
                    minutesPerHalf={teamSubscription?.minutes_per_half || 10}
                    rotationSpeed={teamSubscription?.rotation_speed || 2}
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
                          rotation_speed: teamSubscription?.rotation_speed || 2,
                          minutes_per_half: teamSubscription?.minutes_per_half || 10,
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
                          rotation_speed: teamSubscription?.rotation_speed || 2,
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
                          minutes_per_half: teamSubscription?.minutes_per_half || 10,
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
                          rotation_speed: teamSubscription?.rotation_speed || 2,
                          minutes_per_half: teamSubscription?.minutes_per_half || 10,
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
                          rotation_speed: teamSubscription?.rotation_speed || 2,
                          minutes_per_half: teamSubscription?.minutes_per_half || 10
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
      {/* Pitch Board Modal */}
      {showPitchBoard && isSoccerClub && (hasProFootball || isAppAdmin) && rawMembers && createPortal(
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
              <p className="text-lg font-medium text-white">Loading Pitch Board...</p>
            </div>
          </div>
        }>
          <PitchBoard
            teamId={id!}
            teamName={team.name}
            members={rawMembers.map(m => ({
              id: m.id,
              user_id: m.user_id,
              role: m.role,
              profiles: m.profiles
            }))}
            onClose={() => {
              setShowPitchBoard(false);
              setLinkedEventId(null);
            }}
            disableAutoSubs={teamSubscription?.disable_auto_subs || false}
            initialRotationSpeed={teamSubscription?.rotation_speed || 2}
            initialDisablePositionSwaps={teamSubscription?.disable_position_swaps || false}
            initialDisableBatchSubs={teamSubscription?.disable_batch_subs || false}
            initialRotateGkAtHalftime={teamSubscription?.rotate_gk_at_halftime ?? true}
            initialMinutesPerHalf={teamSubscription?.minutes_per_half || 10}
            initialTeamSize={teamSubscription?.team_size}
            initialFormation={teamSubscription?.formation || undefined}
            readOnly={!canEditPitchBoard && !isSubsManager}
            isSubsManager={!!isSubsManager}
            initialLinkedEventId={linkedEventId}
            initialShowLineupPicker={teamSubscription?.show_lineup_picker || false}
          />
        </Suspense>,
        document.body
      )}
      
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
    </div>
  );
}
