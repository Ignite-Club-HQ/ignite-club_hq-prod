import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Users, Plus, Crown, Settings, Trash2, Pencil, Building2, Shield, Flame, Search, X, Folder, ChevronDown, ChevronRight, GripVertical, MoreVertical, CreditCard, FolderPlus, Loader2, Gift, Lock, FolderOpen, MessageCircle, FolderInput, Trophy, Archive, ArchiveRestore } from "lucide-react";
import { ArchiveTeamDialog } from "@/components/ArchiveTeamDialog";
import { getSportEmoji } from "@/lib/sportEmojis";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { CreateTeamFolderDialog } from "@/components/CreateTeamFolderDialog";
import { Textarea } from "@/components/ui/textarea";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import AddClubAdminSheet from "@/components/AddClubAdminSheet";
import AwardPointsDialog from "@/components/AwardPointsDialog";
import { getFolderColorClass, FOLDER_COLORS } from "@/components/TeamFoldersManager";
import { SponsorsManager } from "@/components/SponsorsManager";
import ClubRewardsManager from "@/components/ClubRewardsManager";
import { PrimarySponsorDisplay } from "@/components/PrimarySponsorDisplay";
import { ClubTeamSponsorAllocator } from "@/components/ClubTeamSponsorAllocator";
import { ClubThemeEditor } from "@/components/ClubThemeEditor";
import { ClubDMSettings } from "@/components/ClubDMSettings";
import { Palette, CalendarDays, BookOpen, ClipboardCheck } from "lucide-react";
import PendingInviteCard from "@/components/PendingInviteCard";
import { TermsManager } from "@/components/TermsManager";
import { AdminEnrolmentManager } from "@/components/AdminEnrolmentManager";
import { ClassAttendanceManager } from "@/components/ClassAttendanceManager";
import { ClassModeOnboardingGuide } from "@/components/ClassModeOnboardingGuide";

type ClubRole = "club_admin";

const clubRoleOptions: { value: ClubRole; label: string }[] = [
  { value: "club_admin", label: "Club Admin" },
];

const MEMBERS_PER_PAGE = 10;

export default function ClubDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<ClubRole>("club_admin");
  const [displayCount, setDisplayCount] = useState(MEMBERS_PER_PAGE);
  const [teamSearchQuery, setTeamSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [showAllTeams, setShowAllTeams] = useState<boolean | null>(null); // null = not yet initialized
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const draggedTeamRef = useRef<string | null>(null);
  
  // Folder management state
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<{ id: string; name: string; description: string | null; color: string } | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [folderColor, setFolderColor] = useState("default");

  const { data: club, isLoading } = useQuery({
    queryKey: ["club", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("*")
        .eq("id", id!)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });


  // Fetch roles data with profiles and team info - includes both club-level and team-level roles
  const { data: rawClubMembers = [], isLoading: isMembersLoading, isFetching: isMembersFetching, refetch: refetchClubMembers } = useQuery({
    queryKey: ["club-members-roles", id],
    queryFn: async () => {
      // First get team IDs for this club
      const { data: teamsData } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", id!);
      const teamIds = teamsData?.map(t => t.id) || [];

      // Fetch club-level roles only (club_admin)
      const { data: clubRoles, error: clubError } = await supabase
        .from("user_roles")
        .select("id, user_id, role, team_id, club_id, profiles (id, display_name, avatar_url, ignite_points), teams (id, name)")
        .eq("club_id", id!)
        .is("team_id", null);
      if (clubError) throw clubError;

      // Fetch team-level roles for teams in this club
      let teamRoles: typeof clubRoles = [];
      if (teamIds.length > 0) {
        const { data: teamRolesData, error: teamError } = await supabase
          .from("user_roles")
          .select("id, user_id, role, team_id, club_id, profiles (id, display_name, avatar_url, ignite_points), teams (id, name)")
          .in("team_id", teamIds);
        if (teamError) throw teamError;
        teamRoles = teamRolesData || [];
      }

      // Combine all roles
      const allRoles = [...(clubRoles || []), ...(teamRoles || [])];
      return allRoles;
    },
    enabled: !!id,
    refetchOnMount: true,
  });

  // Group roles by user - use user_id as fallback if profiles.id is missing
  const clubMembers = rawClubMembers.reduce((acc, role) => {
    const userId = role.profiles?.id || role.user_id;
    if (!userId) return acc;
    if (!acc[userId]) {
      acc[userId] = {
        profile: role.profiles,
        roles: [],
      };
    }
    // Determine scope name: team name for team roles, club name for club roles
    const scopeName = role.teams?.name || (role.club_id ? club?.name : undefined);
    // Deduplicate by role id
    const existingRoleIndex = acc[userId].roles.findIndex(r => r.id === role.id);
    if (existingRoleIndex === -1) {
      acc[userId].roles.push({ id: role.id, role: role.role, scopeName });
    }
    return acc;
  }, {} as Record<string, { profile: any; roles: { id: string; role: string; scopeName?: string }[] }>);

  const { data: teams } = useQuery({
    queryKey: ["club-teams", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*, team_folders!teams_folder_id_fkey(id, name)")
        .eq("club_id", id!)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch user's team memberships to show "My Team" badge
  const { data: userTeamIds = [] } = useQuery({
    queryKey: ["user-team-memberships", id, user?.id],
    queryFn: async () => {
      const teamIds = teams?.map(t => t.id) || [];
      if (teamIds.length === 0) return [];
      
      const { data } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .in("team_id", teamIds);
      
      return [...new Set(data?.map(r => r.team_id) || [])];
    },
    enabled: !!user && !!teams && teams.length > 0,
  });

  // Fetch team folders
  const { data: teamFolders = [] } = useQuery({
    queryKey: ["team-folders", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_folders")
        .select("*")
        .eq("club_id", id!)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch mini leagues for this club
  const { data: miniLeagues = [] } = useQuery({
    queryKey: ["club-mini-leagues", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("*")
        .eq("club_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Toggle folder expansion
  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));
  };

  // Mutation for moving teams between folders
  const moveTeamToFolderMutation = useMutation({
    mutationFn: async ({ teamId, folderId }: { teamId: string; folderId: string | null }) => {
      const { error } = await supabase
        .from("teams")
        .update({ folder_id: folderId })
        .eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-teams", id] });
      toast({ title: "Team moved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to move team", variant: "destructive" });
    },
  });

  // Folder management mutations
  const createFolderMutation = useMutation({
    mutationFn: async (params: { name: string; description: string; color: string }) => {
      const { error } = await supabase.from("team_folders").insert({
        club_id: id!,
        name: params.name,
        description: params.description || null,
        color: params.color,
        sort_order: teamFolders.length,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-folders", id] });
      setCreateFolderDialogOpen(false);
      toast({ title: "Folder created" });
    },
    onError: () => {
      toast({ title: "Failed to create folder", variant: "destructive" });
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: async () => {
      if (!editingFolder) return;
      const { error } = await supabase
        .from("team_folders")
        .update({
          name: folderName.trim(),
          description: folderDescription.trim() || null,
          color: folderColor,
        })
        .eq("id", editingFolder.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-folders", id] });
      setEditingFolder(null);
      setFolderName("");
      setFolderDescription("");
      setFolderColor("default");
      toast({ title: "Folder updated" });
    },
    onError: () => {
      toast({ title: "Failed to update folder", variant: "destructive" });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      const { error } = await supabase
        .from("team_folders")
        .delete()
        .eq("id", folderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-folders", id] });
      queryClient.invalidateQueries({ queryKey: ["club-teams", id] });
      toast({ title: "Folder deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete folder", variant: "destructive" });
    },
  });

  const handleOpenEditFolder = (folder: typeof teamFolders[0]) => {
    setEditingFolder({ id: folder.id, name: folder.name, description: folder.description, color: folder.color || "default" });
    setFolderName(folder.name);
    setFolderDescription(folder.description || "");
    setFolderColor(folder.color || "default");
  };

  const handleCloseEditFolder = () => {
    setEditingFolder(null);
    setFolderName("");
    setFolderDescription("");
    setFolderColor("default");
  };

  // Drag handlers for teams
  const handleTeamDragStart = (e: React.DragEvent, teamId: string) => {
    if (!isAdmin) return;
    draggedTeamRef.current = teamId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", teamId);
  };

  const handleFolderDragOver = (e: React.DragEvent, folderId: string | null) => {
    if (!isAdmin || !draggedTeamRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverFolderId(folderId);
  };

  const handleFolderDragLeave = () => {
    setDragOverFolderId(null);
  };

  const handleFolderDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDragOverFolderId(null);
    const teamId = draggedTeamRef.current;
    if (!teamId || !isAdmin) return;
    
    // Find the team to check its current folder
    const team = teams?.find(t => t.id === teamId);
    if (team?.folder_id === folderId) {
      draggedTeamRef.current = null;
      return;
    }
    
    moveTeamToFolderMutation.mutate({ teamId, folderId });
    draggedTeamRef.current = null;
  };

  const handleTeamDragEnd = () => {
    draggedTeamRef.current = null;
    setDragOverFolderId(null);
  };

  // Separate active vs archived teams
  const activeTeams = useMemo(() => teams?.filter(t => !(t as any).is_archived) || [], [teams]);
  const archivedTeams = useMemo(() => teams?.filter(t => (t as any).is_archived) || [], [teams]);

  // Group ACTIVE teams by folder
  const groupedTeams = useMemo(() => {
    const byFolder: Record<string, typeof activeTeams> = {};
    const uncategorized: typeof activeTeams = [];
    
    teamFolders.forEach(folder => {
      byFolder[folder.id] = [];
    });
    
    activeTeams.forEach(team => {
      if (team.folder_id && byFolder[team.folder_id]) {
        byFolder[team.folder_id].push(team);
      } else {
        uncategorized.push(team);
      }
    });
    
    return { uncategorized, byFolder };
  }, [activeTeams, teamFolders]);
  
  // Helper to check if team should be visible based on showAllTeams toggle
  const shouldShowTeam = (teamId: string) => {
    if (effectiveShowAllTeams) return true;
    return userTeamIds.includes(teamId);
  };
  
  // Count user's teams for display
  const myTeamsCount = useMemo(() => {
    return activeTeams.filter(t => userTeamIds.includes(t.id)).length;
  }, [activeTeams, userTeamIds]);

  const { data: userRole } = useQuery({
    queryKey: ["user-club-role", id, user?.id],
    queryFn: async () => {
      // Check for club_admin role - can have team_id null OR be associated with a team in this club
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("club_id", id!)
        .eq("role", "club_admin")
        .limit(1)
        .maybeSingle();

      if (data?.role) return data.role;

      // Also check for club-level roles with team_id null (non-admin roles)
      const { data: clubLevelRole } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("club_id", id!)
        .is("team_id", null)
        .limit(1)
        .maybeSingle();

      return clubLevelRole?.role ?? null;
    },
    enabled: !!id && !!user,
  });

  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  const isAdmin = userRole === "club_admin" || isAppAdmin;
  const isMember = !!userRole || isAppAdmin;

  // Fetch pending invites for this club
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites", null, id, isAdmin],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, role, invited_user_id, invited_label, invited_email, created_at, status, email_sent_at, email_id, email_error")
        .eq("club_id", id!)
        .is("team_id", null)
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
              .maybeSingle();
            return { ...invite, profiles: profile };
          }
          return { ...invite, profiles: null };
        })
      );
      
      return invitesWithProfiles;
    },
    enabled: !!id && isAdmin === true,
    staleTime: 0,
  });
  
  // Initialize showAllTeams based on admin status (once we know it)
  // Admins see all teams by default, non-admins see only their teams
  // Default to true while loading to avoid hiding teams during initial render
  const effectiveShowAllTeams = showAllTeams !== null ? showAllTeams : (isAdmin !== false ? true : false);
  
  // Fetch team subscriptions to show Pro status badges
  const { data: teamSubscriptions = [] } = useQuery({
    queryKey: ["club-team-subscriptions", id],
    queryFn: async () => {
      const teamIds = teams?.map(t => t.id) || [];
      if (teamIds.length === 0) return [];
      const { data } = await supabase
        .from("team_subscriptions")
        .select("*")
        .in("team_id", teamIds);
      return data || [];
    },
    enabled: !!teams && teams.length > 0,
  });

  // Fetch team sponsor allocations with sponsor details
  const { data: teamSponsorAllocations = [] } = useQuery({
    queryKey: ["club-team-sponsors", id],
    queryFn: async () => {
      const teamIds = teams?.map(t => t.id) || [];
      if (teamIds.length === 0) return [];
      const { data } = await supabase
        .from("team_sponsor_allocations")
        .select("*, sponsors(*)")
        .in("team_id", teamIds);
      return data || [];
    },
    enabled: !!teams && teams.length > 0,
  });

  // Helper to get first sponsor for a team
  const getTeamSponsor = (teamId: string) => {
    const allocation = teamSponsorAllocations.find(a => a.team_id === teamId);
    return allocation?.sponsors as { id: string; name: string; logo_url: string | null; website_url: string | null } | undefined;
  };

  // Fetch club subscription
  const { data: clubSubscription } = useQuery({
    queryKey: ["club-subscription", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", id!)
        .maybeSingle();
      return data;
    },
    enabled: !!id,
  });

  // Check for existing pending request
  const { data: existingRequest } = useQuery({
    queryKey: ["club-request", id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("role_requests")
        .select("*")
        .eq("club_id", id!)
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
        club_id: id!,
        role: selectedRole,
      });
      if (error) throw error;

      // Notify club admins
      const { data: admins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", id!)
        .eq("role", "club_admin");

      if (admins?.length) {
        const notifications = admins.map((admin) => ({
          user_id: admin.user_id,
          type: "role_request",
          message: `New role request: Someone wants to join ${club?.name} as ${selectedRole.replace("_", " ")}`,
          related_id: id!,
        }));
        await supabase.from("notifications").insert(notifications);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-request", id] });
      setRequestDialogOpen(false);
      toast({ title: "Request submitted", description: "An admin will review your request." });
    },
    onError: () => {
      toast({ title: "Failed to submit request", variant: "destructive" });
    },
  });

  const handleDelete = async () => {
    // Get all club members to notify them (from club-level and team-level roles)
    const { data: teamsData } = await supabase
      .from("teams")
      .select("id")
      .eq("club_id", id!);
    const teamIds = teamsData?.map(t => t.id) || [];

    // Get club-level members
    const { data: clubMembersData } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("club_id", id!);
    
    // Get team-level members
    let teamMembers: { user_id: string }[] = [];
    if (teamIds.length > 0) {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("team_id", teamIds);
      teamMembers = data || [];
    }

    // Combine and deduplicate member IDs
    const allMemberIds = [...new Set([
      ...(clubMembersData || []).map(m => m.user_id),
      ...teamMembers.map(m => m.user_id)
    ])].filter(uid => uid !== user?.id);

    // Send notifications to all members
    if (allMemberIds.length > 0) {
      const notifications = allMemberIds.map(uid => ({
        user_id: uid,
        type: "membership",
        message: `${club?.name || "A club"} has been deleted`,
        related_id: null,
      }));
      
      await supabase.from("notifications").insert(notifications);
    }

    const { error } = await supabase.from("clubs").delete().eq("id", id!);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to delete club.",
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Club deleted" });
    navigate("/clubs");
  };

  // Mutation for app admins to toggle club Pro status
  const toggleClubProMutation = useMutation({
    mutationFn: async ({ isPro, isProFootball }: { isPro: boolean; isProFootball: boolean }) => {
      // Check if subscription record exists
      if (clubSubscription) {
        // Update existing subscription
        const { error } = await supabase
          .from("club_subscriptions")
          .update({
            is_pro: isPro,
            is_pro_football: isProFootball,
            activated_at: isPro || isProFootball ? new Date().toISOString() : null,
            expires_at: null, // Admin-enabled = no expiry
          })
          .eq("club_id", id!);
        if (error) throw error;
      } else {
        // Create new subscription record
        const { error } = await supabase
          .from("club_subscriptions")
          .insert({
            club_id: id!,
            is_pro: isPro,
            is_pro_football: isProFootball,
            plan: "unlimited",
            team_limit: null,
            activated_at: isPro || isProFootball ? new Date().toISOString() : null,
            expires_at: null,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-subscription", id] });
      queryClient.invalidateQueries({ queryKey: ["club", id] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-clubs"] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-teams"] });
      queryClient.invalidateQueries({ queryKey: ["team-subscriptions"] });
      toast({ title: "Club subscription updated" });
    },
    onError: () => {
      toast({ title: "Failed to update subscription", variant: "destructive" });
    },
  });

  const handleToggleClubPro = (checked: boolean) => {
    toggleClubProMutation.mutate({
      isPro: checked,
      isProFootball: checked ? (clubSubscription?.is_pro_football || false) : false,
    });
  };

  const handleToggleClubProFootball = (checked: boolean) => {
    // Pro Football includes Pro - enabling Pro Football automatically enables Pro
    toggleClubProMutation.mutate({
      isPro: checked ? true : (clubSubscription?.is_pro || false),
      isProFootball: checked,
    });
  };

  const isSoccerClub = club?.sport?.toLowerCase().includes("soccer") || 
                       club?.sport?.toLowerCase().includes("football") || 
                       club?.sport?.toLowerCase().includes("futsal");


  if (isLoading) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!club) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Club not found</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/clubs")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold flex-1 truncate">{club.name}</h1>
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`/clubs/${id}/edit`)}>
                <Pencil className="h-4 w-4 mr-2" />
                {club?.class_mode_enabled ? "Edit Organisation" : "Edit Club"}
              </DropdownMenuItem>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={(e) => e.preventDefault()}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {club?.class_mode_enabled ? "Delete Organisation" : "Delete Club"}
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{club?.class_mode_enabled ? "Delete Organisation?" : "Delete Club?"}</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the {club?.class_mode_enabled ? "organisation" : "club"}, all {club?.class_mode_enabled ? "classes" : "teams"}, and events. This action cannot be undone.
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

      {/* Club Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={club.logo_url || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-xl">
                {club.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold">{club.name}</h2>
                {(clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override) && (
                  <Badge className="bg-emerald-500 text-emerald-950 text-xs">
                    <Crown className="h-3 w-3 mr-1" /> Pro Football
                  </Badge>
                )}
                {(clubSubscription?.is_pro || clubSubscription?.admin_pro_override) && 
                 !(clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override) && (
                  <Badge className="bg-yellow-500 text-yellow-950 text-xs">
                    <Crown className="h-3 w-3 mr-1" /> Pro
                  </Badge>
                )}
              </div>
              {club.description && (
                <p className="text-muted-foreground mt-1">{club.description}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upgrade Banner for Free Users */}
      {/* Only show if club doesn't have Pro AND user has a reason to see it:
          - Admins can always see (they can upgrade)
          - Non-admins only see if they're on a team without Pro */}
      {!clubSubscription?.is_pro && !clubSubscription?.admin_pro_override && (() => {
        // Check if user is on any team that doesn't have Pro
        const userTeamsWithoutPro = userTeamIds.filter(teamId => {
          const teamSub = teamSubscriptions.find(ts => ts.team_id === teamId);
          const teamHasPro = teamSub?.is_pro || teamSub?.is_pro_football || 
                             (teamSub as any)?.admin_pro_override || (teamSub as any)?.admin_pro_football_override;
          return !teamHasPro;
        });
        
        // Show banner if: user is admin OR user has at least one team without Pro
        // If user is only on teams that have Pro, don't show
        const shouldShow = isAdmin || (userTeamIds.length > 0 && userTeamsWithoutPro.length > 0);
        
        if (!shouldShow) return null;
        
        return (
          <Card className="border-primary/30 bg-gradient-to-r from-primary/10 to-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-primary/20">
                    <Crown className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">
                      {isAdmin ? "Upgrade to Pro" : "Pro Features Available"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {isAdmin 
                        ? `Unlock Vault, Media, Rewards & more for your ${club?.class_mode_enabled ? "organisation" : "club"}`
                        : `Contact your ${club?.class_mode_enabled ? "organisation" : "club"} admin to unlock Pro features`
                      }
                    </p>
                  </div>
                </div>
                {isAdmin && (
                  <Link to={`/clubs/${id}/upgrade`}>
                    <Button size="sm" className="shrink-0">
                      Upgrade
                    </Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Class Mode Onboarding Guide */}
      {isAdmin && club?.class_mode_enabled && (
        <ClassModeOnboardingGuide clubId={id!} />
      )}

      {/* Primary Sponsor Display */}
      {club?.primary_sponsor_id && (
        <PrimarySponsorDisplay sponsorId={club.primary_sponsor_id} variant="full" context="club_page" />
      )}

      {/* Quick Actions */}
      {isMember && (() => {
        const hasProAccess = clubSubscription?.is_pro || clubSubscription?.is_pro_football || 
                             clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override;
        return (
          <div className="grid grid-cols-2 gap-3">
            {hasProAccess ? (
              <Link to={`/messages/club/${id}`}>
                <Card className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4 flex flex-col items-center gap-2">
                    <MessageCircle className="h-6 w-6 text-primary" />
                    <span className="text-sm font-medium">{club?.class_mode_enabled ? "Group Chat" : "Club Chat"}</span>
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
                  <MessageCircle className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">{club?.class_mode_enabled ? "Group Chat" : "Club Chat"}</span>
                </CardContent>
              </Card>
            )}
            {hasProAccess ? (
              <Link to={`/vault?club=${id}`}>
                <Card className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4 flex flex-col items-center gap-2">
                    <FolderOpen className="h-6 w-6 text-primary" />
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
          </div>
        );
      })()}

      {/* Collapsible Sections */}
      <Accordion type="multiple" defaultValue={[]} className="space-y-4">
        {/* Teams Section */}
        <AccordionItem value="teams" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">{club?.class_mode_enabled ? "Classes" : "Teams"}</span>
              {activeTeams && <Badge variant="secondary" className="ml-2">{activeTeams.length}</Badge>}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {isAdmin && (
                <div className="flex items-center gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setCreateFolderDialogOpen(true)}>
                    <Folder className="h-4 w-4 mr-1" /> Add Folder
                  </Button>
                  <CreateTeamFolderDialog
                    open={createFolderDialogOpen}
                    onOpenChange={setCreateFolderDialogOpen}
                    onCreateFolder={(name, description, color) => 
                      createFolderMutation.mutate({ name, description, color })
                    }
                    isCreating={createFolderMutation.isPending}
                  />
                  <Link to={`/clubs/${id}/teams/new`}>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" /> Add Team
                    </Button>
                  </Link>
                </div>
              )}

              {/* Team Search and Show All Toggle */}
              {activeTeams && activeTeams.length > 0 && (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search teams..."
                      value={teamSearchQuery}
                      onChange={(e) => setTeamSearchQuery(e.target.value)}
                      className="pl-9 pr-9"
                    />
                    {teamSearchQuery && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                        onClick={() => setTeamSearchQuery("")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  {/* Show All Teams Toggle - show for non-admins when there are teams they don't belong to */}
                  {!isAdmin && activeTeams.length > 0 && (myTeamsCount === 0 || activeTeams.length > myTeamsCount) && (
                    <div className="flex items-center justify-between px-1">
                      <Label htmlFor="show-all-teams" className="text-sm text-muted-foreground cursor-pointer">
                        Show all teams ({activeTeams.length})
                      </Label>
                      <Switch
                        id="show-all-teams"
                        checked={effectiveShowAllTeams}
                        onCheckedChange={setShowAllTeams}
                      />
                    </div>
                  )}
                </div>
              )}

              {activeTeams?.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-6 text-center">
                    <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">No teams yet</p>
                    {isAdmin && (
                      <Link to={`/clubs/${id}/teams/new`} className="mt-3 inline-block">
                        <Button variant="outline" size="sm">Create First Team</Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {/* Render folders with their teams */}
                  {teamFolders.map((folder) => {
                    const folderTeams = groupedTeams.byFolder[folder.id] || [];
                    const filteredFolderTeams = folderTeams.filter((team) => {
                      // First check showAllTeams toggle
                      if (!shouldShowTeam(team.id)) return false;
                      // Then apply search filter
                      if (!teamSearchQuery.trim()) return true;
                      const query = teamSearchQuery.toLowerCase().trim();
                      return (
                        team.name?.toLowerCase().includes(query) ||
                        team.level_age?.toLowerCase().includes(query) ||
                        team.description?.toLowerCase().includes(query)
                      );
                    });
                    
                    // Hide folder if no teams match (after showAllTeams filter)
                    // But always show empty folders to admins so they can drag teams into them
                    if (filteredFolderTeams.length === 0 && !isAdmin) return null;
                    
                    const isExpanded = expandedFolders[folder.id] !== false;
                    
                    return (
                      <Collapsible key={folder.id} open={isExpanded} onOpenChange={() => toggleFolder(folder.id)}>
                        <div
                          onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                          onDragLeave={handleFolderDragLeave}
                          onDrop={(e) => handleFolderDrop(e, folder.id)}
                          className={`rounded-lg transition-all ${dragOverFolderId === folder.id ? "ring-2 ring-primary ring-offset-2" : ""}`}
                        >
                          <CollapsibleTrigger asChild>
                            <Card className={`cursor-pointer hover:border-primary/30 active:scale-[0.99] transition-all ${getFolderColorClass(folder.color || 'default').bgClassName}`}>
                              <CardContent className="p-3 flex items-center gap-3">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform" />
                                )}
                                <Folder className={`h-5 w-5 shrink-0 ${getFolderColorClass(folder.color || 'default').className}`} />
                                <span className="font-medium flex-1 text-left truncate">{folder.name}</span>
                                <Badge variant="secondary" className="text-xs shrink-0">
                                  {folderTeams.length} team{folderTeams.length !== 1 ? "s" : ""}
                                </Badge>
                                {isAdmin && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 shrink-0"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => handleOpenEditFolder(folder)}>
                                        <Pencil className="h-4 w-4 mr-2" />
                                        Edit Folder
                                      </DropdownMenuItem>
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <DropdownMenuItem 
                                            className="text-destructive focus:text-destructive"
                                            onSelect={(e) => e.preventDefault()}
                                          >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Delete Folder
                                          </DropdownMenuItem>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Delete Folder?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              This will delete the folder "{folder.name}". Teams in this folder will become uncategorized.
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                              onClick={() => deleteFolderMutation.mutate(folder.id)}
                                              className="bg-destructive text-destructive-foreground"
                                            >
                                              Delete
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </CardContent>
                            </Card>
                          </CollapsibleTrigger>
                        </div>
                        <CollapsibleContent className="pl-4 space-y-2 mt-2">
                          {filteredFolderTeams.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-2 pl-2">No teams in this folder</p>
                          ) : (
                            filteredFolderTeams.map((team) => {
                              const teamSub = teamSubscriptions.find(s => s.team_id === team.id);
                              const clubHasPro = clubSubscription?.is_pro || clubSubscription?.admin_pro_override;
                              const clubHasProFootball = clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override;
                              const isPro = teamSub?.is_pro || teamSub?.admin_pro_override || clubHasPro;
                              const isProFootball = teamSub?.is_pro_football || teamSub?.admin_pro_football_override || clubHasProFootball;
                              const isUserTeamMember = userTeamIds.includes(team.id);
                              return (
                                <Card 
                                  key={team.id} 
                                  className={`hover:border-primary/50 transition-colors ${isUserTeamMember ? 'border-primary/30 bg-primary/5' : ''}`}
                                >
                                  <CardContent className="p-4 flex items-center gap-3">
                                    <Link to={`/teams/${team.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                                      <Avatar className="h-10 w-10 shrink-0">
                                        <AvatarImage src={team.logo_url || undefined} />
                                        <AvatarFallback className="bg-primary/20 text-primary">
                                          {team.name?.charAt(0)?.toUpperCase() || "T"}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <h4 className="font-medium truncate">{team.name}</h4>
                                          {isUserTeamMember && (
                                            <Badge variant="outline" className="text-xs border-primary text-primary">My Team</Badge>
                                          )}
                                          {isProFootball && (
                                            <Badge className="bg-emerald-500 text-emerald-950 text-xs">PRO FOOTBALL</Badge>
                                          )}
                                          {isPro && !isProFootball && (
                                            <Badge className="bg-yellow-500 text-yellow-950 text-xs">PRO</Badge>
                                          )}
                                        </div>
                                      </div>
                                    </Link>
                                    <Link to={`/teams/${team.id}`} onClick={(e) => e.stopPropagation()} className="shrink-0 p-1">
                                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    </Link>
                                  </CardContent>
                                </Card>
                              );
                            })
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}

                  {/* Uncategorized drop zone */}
                  {teamFolders.length > 0 && (
                    <div
                      onDragOver={(e) => handleFolderDragOver(e, null)}
                      onDragLeave={handleFolderDragLeave}
                      onDrop={(e) => handleFolderDrop(e, null)}
                      className={`rounded-lg transition-all ${dragOverFolderId === null && draggedTeamRef.current ? "ring-2 ring-primary ring-offset-2 bg-muted/30 p-2" : ""}`}
                    >
                      {groupedTeams.uncategorized.length > 0 && (
                        <div className="flex items-center gap-2 mb-2 text-muted-foreground">
                          <Folder className="h-4 w-4" />
                          <span className="text-sm font-medium">Uncategorized</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Render uncategorized teams */}
                  {groupedTeams.uncategorized
                    .filter((team) => {
                      // First check showAllTeams toggle
                      if (!shouldShowTeam(team.id)) return false;
                      // Then apply search filter
                      if (!teamSearchQuery.trim()) return true;
                      const query = teamSearchQuery.toLowerCase().trim();
                      return (
                        team.name?.toLowerCase().includes(query) ||
                        team.level_age?.toLowerCase().includes(query) ||
                        team.description?.toLowerCase().includes(query)
                      );
                    })
                    .map((team) => {
                      const teamSub = teamSubscriptions.find(s => s.team_id === team.id);
                      const clubHasPro = clubSubscription?.is_pro || clubSubscription?.admin_pro_override;
                      const clubHasProFootball = clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override;
                      const isPro = teamSub?.is_pro || teamSub?.admin_pro_override || clubHasPro;
                      const isProFootball = teamSub?.is_pro_football || teamSub?.admin_pro_football_override || clubHasProFootball;
                      const isUserTeamMember = userTeamIds.includes(team.id);
                      return (
                        <Card 
                          key={team.id} 
                          className={`hover:border-primary/50 transition-colors ${isUserTeamMember ? 'border-primary/30 bg-primary/5' : ''}`}
                        >
                          <CardContent className="p-4 flex items-center gap-3">
                            <Link to={`/teams/${team.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                              <Avatar className="h-10 w-10 shrink-0">
                                <AvatarImage src={team.logo_url || undefined} />
                                <AvatarFallback className="bg-primary/20 text-primary">
                                  {team.name?.charAt(0)?.toUpperCase() || "T"}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="font-medium truncate">{team.name}</h4>
                                  {isUserTeamMember && (
                                    <Badge variant="outline" className="text-xs border-primary text-primary">My Team</Badge>
                                  )}
                                  {isProFootball && (
                                    <Badge className="bg-emerald-500 text-emerald-950 text-xs">PRO FOOTBALL</Badge>
                                  )}
                                  {isPro && !isProFootball && (
                                    <Badge className="bg-yellow-500 text-yellow-950 text-xs">PRO</Badge>
                                  )}
                                </div>
                              </div>
                            </Link>
                            <Link to={`/teams/${team.id}`} onClick={(e) => e.stopPropagation()} className="shrink-0 p-1">
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </Link>
                          </CardContent>
                        </Card>
                      );
                    })}
                  
                  {/* No teams message */}
                  {activeTeams.length > 0 && activeTeams.filter(team => shouldShowTeam(team.id)).length === 0 && !effectiveShowAllTeams && (
                    <p className="text-muted-foreground text-sm text-center py-4">
                      You haven't joined any teams yet. Toggle "Show all teams" to see all teams in this club.
                    </p>
                  )}
                  {activeTeams.length > 0 && teamSearchQuery && 
                    activeTeams.filter((team) => {
                      if (!shouldShowTeam(team.id)) return false;
                      const query = teamSearchQuery.toLowerCase().trim();
                      return (
                        team.name?.toLowerCase().includes(query) ||
                        team.level_age?.toLowerCase().includes(query) ||
                        team.description?.toLowerCase().includes(query)
                      );
                    }).length === 0 && (
                    <p className="text-muted-foreground text-sm text-center py-4">No teams match your search</p>
                  )}
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Archived Teams Section - admins only */}
      {isAdmin && archivedTeams.length > 0 && (
        <Accordion type="multiple" defaultValue={[]} className="space-y-4">
          <AccordionItem value="archived-teams" className="border border-amber-500/30 rounded-lg px-4 bg-amber-50/30 dark:bg-amber-950/10">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Archive className="h-5 w-5 text-amber-600" />
                <span className="text-lg font-semibold text-amber-800 dark:text-amber-300">Archived Teams</span>
                <Badge variant="secondary" className="ml-2">{archivedTeams.length}</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-2">
                {archivedTeams.map((team) => (
                  <Card key={team.id} className="border-amber-500/20 bg-amber-50/50 dark:bg-amber-950/10 opacity-80">
                    <CardContent className="p-4 flex items-center gap-3">
                      <Link to={`/teams/${team.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                        <Avatar className="h-10 w-10 shrink-0 grayscale">
                          <AvatarImage src={team.logo_url || undefined} />
                          <AvatarFallback className="bg-muted text-muted-foreground">
                            {team.name?.charAt(0)?.toUpperCase() || "T"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-medium truncate text-muted-foreground">{team.name}</h4>
                            <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-700">
                              <Archive className="h-3 w-3 mr-1" />
                              Archived
                            </Badge>
                            {(team as any).season_label && (
                              <Badge variant="secondary" className="text-xs">
                                {(team as any).season_label}
                              </Badge>
                            )}
                          </div>
                          {team.level_age && (
                            <p className="text-xs text-muted-foreground mt-0.5">{team.level_age}</p>
                          )}
                        </div>
                      </Link>
                      <ArchiveTeamDialog
                        teamId={team.id}
                        teamName={team.name}
                        clubId={id!}
                        isArchived={true}
                        currentSeasonLabel={(team as any).season_label}
                        trigger={
                          <Button variant="outline" size="sm" className="shrink-0">
                            <ArchiveRestore className="h-4 w-4 mr-1" />
                            Reinstate
                          </Button>
                        }
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Mini Leagues Section - hidden for class-mode clubs */}
      {!club?.class_mode_enabled && (isAdmin || miniLeagues.length > 0) && (
        <Accordion type="multiple" defaultValue={[]} className="space-y-4">
          <AccordionItem value="mini-leagues" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-primary" />
                <span className="text-lg font-semibold">Mini Leagues</span>
                {miniLeagues.length > 0 && <Badge variant="secondary" className="ml-2">{miniLeagues.length}</Badge>}
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-2">
                {isAdmin && (
                  <div className="flex justify-end">
                    <Link to={`/mini-leagues?clubId=${id}`}>
                      <Button size="sm">
                        <Plus className="h-4 w-4 mr-1" /> New Mini League
                      </Button>
                    </Link>
                  </div>
                )}
                {miniLeagues.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-4">
                    No mini leagues yet. Create one to organize ability-based sessions.
                  </p>
                ) : (
                  miniLeagues.map((league) => (
                    <Link key={league.id} to={`/mini-leagues/${league.id}`}>
                      <Card className="hover:bg-muted/50 transition-colors">
                        <CardContent className="p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <Trophy className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{league.name}</p>
                              {league.description && (
                                <p className="text-sm text-muted-foreground line-clamp-1">
                                  {league.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </CardContent>
                      </Card>
                    </Link>
                  ))
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      <Dialog open={!!editingFolder} onOpenChange={(open) => !open && handleCloseEditFolder()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-folder-name">Folder Name</Label>
              <Input
                id="edit-folder-name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-folder-description">Description (optional)</Label>
              <Textarea
                id="edit-folder-description"
                value={folderDescription}
                onChange={(e) => setFolderDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Folder Color</Label>
              <div className="flex flex-wrap gap-2">
                {FOLDER_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => setFolderColor(color.value)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${color.bgClassName} ${
                      folderColor === color.value ? "ring-2 ring-offset-2 ring-primary" : ""
                    }`}
                  >
                    <Folder className={`h-4 w-4 ${color.className}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseEditFolder}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateFolderMutation.mutate()}
              disabled={!folderName.trim() || updateFolderMutation.isPending}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Club Members and Admin Accordion */}
      <Accordion 
        type="multiple" 
        defaultValue={[]} 
        className="space-y-4"
        onValueChange={(value) => {
          // Auto-refresh members list when expanding if empty
          if (value.includes("members") && Object.keys(clubMembers).length === 0 && !isMembersLoading && !isMembersFetching) {
            refetchClubMembers();
          }
        }}
      >
        {/* Club Members Section - separate from Admin */}
        {isMember && (
          <AccordionItem value="members" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <span className="text-lg font-semibold">{club?.class_mode_enabled ? "Members" : "Club Members"}</span>
                {!isMembersLoading && <Badge variant="secondary" className="ml-2">{Object.keys(clubMembers).length}</Badge>}
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2 pt-2">
                {isAdmin && (
                  <div className="flex items-center gap-2 justify-end mb-3">
                    <AddClubAdminSheet 
                      clubId={id!}
                      clubName={club.name}
                    />
                  </div>
                )}
                {isMembersLoading ? (
                  <>
                    {[1, 2, 3].map((i) => (
                      <Card key={i}>
                        <CardContent className="p-3 flex items-center gap-3">
                          <Skeleton className="h-8 w-8 rounded-full" />
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-5 w-16 ml-auto" />
                        </CardContent>
                      </Card>
                    ))}
                  </>
                ) : Object.keys(clubMembers).length === 0 && pendingInvites.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No members yet</p>
                ) : (
                  <>
                  {/* Pending Invites Section */}
                  {pendingInvites.length > 0 && (
                    <>
                      {pendingInvites.map((invite) => (
                        <PendingInviteCard
                          key={invite.id}
                          invite={invite}
                          clubId={id}
                        />
                      ))}
                    </>
                  )}
                  {Object.entries(clubMembers).slice(0, displayCount).map(([userId, member]) => (
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
                            const roleColors: Record<string, string> = {
                              app_admin: "bg-red-500/15 text-red-600 border-red-500/30",
                              club_admin: "bg-purple-500/15 text-purple-600 border-purple-500/30",
                              team_admin: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
                              coach: "bg-blue-500/15 text-blue-600 border-blue-500/30",
                              committee_member: "bg-violet-500/15 text-violet-600 border-violet-500/30",
                              player: "bg-amber-500/15 text-amber-600 border-amber-500/30",
                              parent: "bg-teal-500/15 text-teal-600 border-teal-500/30",
                              league_admin: "bg-orange-500/15 text-orange-600 border-orange-500/30",
                              basic_user: "bg-muted text-muted-foreground border-border",
                            };
                            const colorClass = roleColors[roleItem.role] || roleColors.basic_user;
                            return (
                              <Badge key={roleItem.id} variant="outline" className={`text-[10px] rounded-md border px-1.5 py-0.5 ${colorClass}`}>
                                {roleItem.role?.replace(/_/g, " ") || "Member"}
                                {roleItem.scopeName && ` • ${roleItem.scopeName}`}
                              </Badge>
                            );
                          })}
                        </div>
                        {isAdmin && (userId !== user?.id || isAppAdmin) && (
                          <>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={(e) => {
                                e.preventDefault();
                                // Find and click the hidden award points trigger
                                const trigger = document.getElementById(`award-points-${userId}`);
                                trigger?.click();
                              }}>
                                <Flame className="h-4 w-4 mr-2 text-amber-500" />
                                Award Points
                              </DropdownMenuItem>
                              {userId !== user?.id && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={(e) => e.preventDefault()}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Remove Member
                                  </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove Member?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will remove {member.profile?.display_name} from the club. They can request to join again.
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
                                          .eq("club_id", id!);
                                        if (error) {
                                          toast({ title: "Failed to remove member", variant: "destructive" });
                                        } else {
                                          await supabase.from("notifications").insert({
                                            user_id: userId,
                                            type: "membership",
                                            message: `You have been removed from ${club?.name || "the club"}`,
                                            related_id: id,
                                          });
                                          queryClient.invalidateQueries({ queryKey: ["club-members-roles", id] });
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
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <div className="hidden">
                            <AwardPointsDialog
                              memberId={userId}
                              memberName={member.profile?.display_name || "Member"}
                              currentPoints={member.profile?.ignite_points || 0}
                              clubId={id!}
                              clubName={club?.name || "Club"}
                              triggerId={`award-points-${userId}`}
                            />
                          </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                  {Object.keys(clubMembers).length > displayCount && (
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={() => setDisplayCount(prev => prev + MEMBERS_PER_PAGE)}
                    >
                      Show more ({Object.keys(clubMembers).length - displayCount} remaining)
                    </Button>
                  )}
                  </>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

      {/* Sponsors - Pro only, Admin only, hidden for class-mode clubs */}
      {isAdmin && !club?.class_mode_enabled && (
        <AccordionItem 
          value="sponsors" 
          className="border rounded-lg px-4"
          disabled={!isAppAdmin && !(clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override)}
        >
          <AccordionTrigger 
            className="hover:no-underline"
            disabled={!isAppAdmin && !(clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override)}
          >
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Sponsors</span>
              {!isAppAdmin && !(clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override) && (
                <div className="flex items-center gap-1.5 ml-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline" className="text-xs font-normal">Pro</Badge>
                </div>
              )}
            </div>
          </AccordionTrigger>
          {(isAppAdmin || clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override) && (
            <AccordionContent>
              <div className="pt-2 space-y-4">
                <SponsorsManager 
                  clubId={id!} 
                  currentPrimarySponsorId={club?.primary_sponsor_id || null}
                  onPrimaryChange={() => queryClient.invalidateQueries({ queryKey: ["club", id] })}
                />
                <ClubTeamSponsorAllocator clubId={id!} />
              </div>
            </AccordionContent>
          )}
        </AccordionItem>
      )}

      {/* Rewards - Pro only, Admin only */}
      {isAdmin && (
        <AccordionItem 
          value="rewards" 
          className="border rounded-lg px-4"
          disabled={!isAppAdmin && !(clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override)}
        >
          <AccordionTrigger 
            className="hover:no-underline"
            disabled={!isAppAdmin && !(clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override)}
          >
            <div className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Rewards</span>
              {!isAppAdmin && !(clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override) && (
                <div className="flex items-center gap-1.5 ml-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline" className="text-xs font-normal">Pro</Badge>
                </div>
              )}
            </div>
          </AccordionTrigger>
          {(isAppAdmin || clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override) && (
            <AccordionContent>
              <div className="pt-2">
                <ClubRewardsManager clubId={id!} />
              </div>
            </AccordionContent>
          )}
        </AccordionItem>
      )}

      {/* Direct Messages - Pro only, Admin only */}
      {isAdmin && (clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override) && (
        <AccordionItem value="dm-settings" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Direct Messages</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-2">
              <ClubDMSettings clubId={id!} />
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Class Mode - Terms Management (Admin only, when class mode enabled) */}
      {isAdmin && club?.class_mode_enabled && (
        <AccordionItem value="terms" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Terms & Classes</span>
            </div>
          </AccordionTrigger>
             <AccordionContent>
            <div className="pt-2 space-y-6">
              <TermsManager clubId={id!} />
              <AdminEnrolmentManager clubId={id!} />
              <ClassAttendanceManager clubId={id!} />
              <Link to={`/clubs/${id}/enrol`}>
                <Card className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <BookOpen className="h-5 w-5 text-primary" />
                    </div>
                    <span className="font-medium">View Enrolment Page</span>
                  </CardContent>
                </Card>
              </Link>
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Admin Actions */}
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
              <Link to={`/clubs/${id}/roles`}>
                <Card className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Settings className="h-5 w-5 text-primary" />
                    </div>
                    <span className="font-medium">Manage Roles</span>
                  </CardContent>
                </Card>
              </Link>

              <Link to={`/clubs/${id}/stripe`}>
                <Card className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <CreditCard className="h-5 w-5 text-primary" />
                    </div>
                    <span className="font-medium">Payment Settings</span>
                  </CardContent>
                </Card>
              </Link>

              <Link to={`/clubs/${id}/upgrade`}>
                <Card className={`hover:border-primary/50 transition-colors ${clubSubscription?.is_pro ? "border-yellow-500/30 bg-yellow-500/5" : ""}`}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${clubSubscription?.is_pro ? "bg-yellow-500/20" : "bg-muted"}`}>
                      <Building2 className={`h-5 w-5 ${clubSubscription?.is_pro ? "text-yellow-500" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1">
                      <span className="font-medium">Club Pro Plans</span>
                      {clubSubscription?.is_pro && (
                        <p className="text-xs text-muted-foreground">
                          {clubSubscription.is_pro_football ? "Pro Football" : "Pro"} • {clubSubscription.plan?.charAt(0).toUpperCase()}{clubSubscription.plan?.slice(1)}
                        </p>
                      )}
                    </div>
                    {clubSubscription?.is_pro && (
                      <Badge className="bg-yellow-500 text-yellow-950">Active</Badge>
                    )}
                  </CardContent>
                </Card>
              </Link>
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Club Branding - Pro only */}
      {isAdmin && (clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override) && (
        <AccordionItem value="branding" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Club Branding</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-2">
              <ClubThemeEditor
                clubId={id!}
                clubLogoUrl={club.logo_url}
                initialPrimary={club.theme_primary_h !== null ? { h: club.theme_primary_h!, s: club.theme_primary_s!, l: club.theme_primary_l! } : undefined}
                initialSecondary={club.theme_secondary_h !== null ? { h: club.theme_secondary_h!, s: club.theme_secondary_s!, l: club.theme_secondary_l! } : undefined}
                initialAccent={club.theme_accent_h !== null ? { h: club.theme_accent_h!, s: club.theme_accent_s!, l: club.theme_accent_l! } : undefined}
                initialDarkPrimary={(club as any).theme_dark_primary_h !== null ? { h: (club as any).theme_dark_primary_h!, s: (club as any).theme_dark_primary_s!, l: (club as any).theme_dark_primary_l! } : undefined}
                initialDarkSecondary={(club as any).theme_dark_secondary_h !== null ? { h: (club as any).theme_dark_secondary_h!, s: (club as any).theme_dark_secondary_s!, l: (club as any).theme_dark_secondary_l! } : undefined}
                initialDarkAccent={(club as any).theme_dark_accent_h !== null ? { h: (club as any).theme_dark_accent_h!, s: (club as any).theme_dark_accent_s!, l: (club as any).theme_dark_accent_l! } : undefined}
                initialShowLogoInHeader={club.show_logo_in_header}
                initialShowNameInHeader={(club as any).show_name_in_header ?? true}
                initialLogoOnlyMode={(club as any).logo_only_mode ?? false}
                initialThemeEnabled={(club as any).theme_enabled ?? true}
                onSave={() => {
                  queryClient.invalidateQueries({ queryKey: ["club", id] });
                  queryClient.invalidateQueries({ queryKey: ["club-themes"] });
                }}
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* App Admin Section */}
      {isAppAdmin && (
        <AccordionItem value="app-admin" className="border rounded-lg px-4 border-red-500/30">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-500" />
              <span className="text-lg font-semibold">App Admin</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <Card className="border-red-500/30 bg-red-500/5">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">Club Pro</Label>
                    <p className="text-xs text-muted-foreground">Enable Pro features for all teams</p>
                  </div>
                  <Switch
                    checked={clubSubscription?.is_pro || false}
                    onCheckedChange={handleToggleClubPro}
                    disabled={toggleClubProMutation.isPending}
                  />
                </div>
                
                {isSoccerClub && (
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="font-medium">Club Pro Football</Label>
                      <p className="text-xs text-muted-foreground">Enable pitch board for all teams (includes Pro)</p>
                    </div>
                    <Switch
                      checked={clubSubscription?.is_pro_football || false}
                      onCheckedChange={handleToggleClubProFootball}
                      disabled={toggleClubProMutation.isPending}
                    />
                  </div>
                )}
                
                {clubSubscription?.is_pro && (
                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    Plan: {clubSubscription.plan?.charAt(0).toUpperCase()}{clubSubscription.plan?.slice(1)} • 
                    Teams: {clubSubscription.team_limit ?? "Unlimited"}
                  </div>
                )}
              </CardContent>
            </Card>
          </AccordionContent>
        </AccordionItem>
      )}
      </Accordion>
    </div>
  );
}
