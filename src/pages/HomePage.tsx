import { useState, lazy, Suspense, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import SoccerBall from "@/components/pitch/SoccerBall";
import { Calendar, MapPin, Users, Clock, Plus, UserPlus, Download, Smartphone, LayoutGrid, Pencil, Trash2, XCircle, X, CheckCircle2, HelpCircle, Minus, Loader2, Flame, Gift, Lock, FolderOpen, Crown, Bell } from "lucide-react";
import { RewardClaimQRDialog } from "@/components/RewardClaimQRDialog";
import { RecurringEventActionDialog } from "@/components/RecurringEventActionDialog";
import { CancelEventConfirmDialog } from "@/components/CancelEventConfirmDialog";
import { RecurringCancelEventDialog } from "@/components/RecurringCancelEventDialog";
import { AccountRecoveryBanner } from "@/components/AccountRecoveryBanner";
import { QuickRSVPDialog } from "@/components/QuickRSVPDialog";
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
import { PageLoading } from "@/components/ui/page-loading";

// Lazy load PitchBoard - it's a heavy 4k+ line component with Fabric.js
const PitchBoard = lazy(() => import("@/components/pitch/PitchBoard"));
import GameTimerWidget from "@/components/pitch/GameTimerWidget";
import PendingSubWidget from "@/components/pitch/PendingSubWidget";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { getSportEmoji } from "@/lib/sportEmojis";
import { findNearbyGameEvent } from "@/hooks/useNearbyGameEvent";
import { useClubTheme, hasClubThemeCached } from "@/hooks/useClubTheme";
import { ClubSponsorSection } from "@/components/ClubSponsorSection";
import { MultiClubSponsorCarousel } from "@/components/MultiClubSponsorCarousel";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";

type EventType = "game" | "training" | "social";
type TeamRole = "player" | "parent" | "coach" | "team_admin";
type ClubRole = "club_admin";

interface Event {
  id: string;
  title: string;
  type: EventType;
  event_date: string;
  address: string | null;
  suburb: string | null;
  club_id: string;
  team_id: string | null;
  is_cancelled: boolean;
  is_recurring: boolean;
  parent_event_id: string | null;
  opponent: string | null;
  teams: { name: string } | null;
  clubs: { name: string; sport: string | null };
}

interface Club {
  id: string;
  name: string;
  sport: string | null;
}

interface Team {
  id: string;
  name: string;
  club_id: string;
  clubs: { name: string; sport: string | null };
}

const eventTypeColors: Record<EventType, string> = {
  game: "bg-destructive/20 text-destructive",
  training: "bg-primary/20 text-primary",
  social: "bg-warning/20 text-warning",
};

const teamRoleOptions: { value: TeamRole; label: string }[] = [
  { value: "player", label: "Player" },
  { value: "parent", label: "Parent" },
  { value: "coach", label: "Coach" },
  { value: "team_admin", label: "Team Admin" },
];

const clubRoleOptions: { value: ClubRole; label: string }[] = [
  { value: "club_admin", label: "Club Admin" },
];

function formatEventDate(dateStr: string) {
  const date = parseISO(dateStr);
  if (isToday(date)) return `Today at ${format(date, "h:mm a")}`;
  if (isTomorrow(date)) return `Tomorrow at ${format(date, "h:mm a")}`;
  return format(date, "EEE, MMM d 'at' h:mm a");
}

export default function HomePage() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { canPrompt, isInstalled, isIOS, isReady, installApp } = usePWAInstall();
  const { activeClubFilter, activeClubTeamIds, activeThemeData } = useClubTheme();
  
  // Use cached theme state to prevent gradient flash on initial render
  const [initialHasClubTheme] = useState(hasClubThemeCached);
  const hasClubTheme = activeThemeData || initialHasClubTheme;
  
  // Only show install card on first login if app is not already installed
  const installCardDismissedKey = `ignite-install-dismissed-${user?.id}`;
  const [showInstallCard, setShowInstallCard] = useState(() => {
    if (!user?.id) return false;
    return localStorage.getItem(installCardDismissedKey) !== 'true';
  });
  
  const dismissInstallCard = () => {
    setShowInstallCard(false);
    if (user?.id) {
      localStorage.setItem(installCardDismissedKey, 'true');
    }
  };
  
  const [clubDialogOpen, setClubDialogOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [selectedClub, setSelectedClub] = useState<string>("");
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [selectedClubForTeam, setSelectedClubForTeam] = useState<string>("");
  const [selectedClubRole, setSelectedClubRole] = useState<ClubRole>("club_admin");
  const [selectedTeamRole, setSelectedTeamRole] = useState<TeamRole>("player");
  const [pitchBoardTeam, setPitchBoardTeam] = useState<{ id: string; name: string; members: any[]; readOnly: boolean; linkedEventId?: string | null } | null>(null);
  const [pitchBoardLoading, setPitchBoardLoading] = useState(false);
  const [pitchBoardsExpanded, setPitchBoardsExpanded] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [eventToCancel, setEventToCancel] = useState<Event | null>(null);
  const [quickRsvpEvent, setQuickRsvpEvent] = useState<Event | null>(null);
  const [rewardQROpen, setRewardQROpen] = useState(false);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [selectedUpgradeClub, setSelectedUpgradeClub] = useState<string>("");
  const [remindDialogOpen, setRemindDialogOpen] = useState(false);
  const [eventToRemind, setEventToRemind] = useState<Event | null>(null);
  const [nonRsvpCount, setNonRsvpCount] = useState(0);
  const [loadingRemindCount, setLoadingRemindCount] = useState(false);

  const { data: allEvents, isLoading } = useQuery({
    queryKey: ["upcoming-events", user?.id],
    queryFn: async () => {
      const now = new Date();
      const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      
      const { data, error } = await supabase
        .from("events")
        .select(`
          id,
          title,
          type,
          event_date,
          address,
          suburb,
          club_id,
          team_id,
          is_cancelled,
          is_recurring,
          parent_event_id,
          opponent,
          teams (name),
          clubs (name, sport)
        `)
        .gte("event_date", now.toISOString())
        .lte("event_date", fourteenDaysFromNow.toISOString())
        .order("event_date", { ascending: true })
        .limit(20);

      if (error) throw error;
      return data as Event[];
    },
    enabled: !!user,
  });

  // Filter events by active club theme
  const events = useMemo(() => {
    if (!allEvents) return [];
    if (!activeClubFilter) return allEvents.slice(0, 10);
    return allEvents.filter(e => e.club_id === activeClubFilter).slice(0, 10);
  }, [allEvents, activeClubFilter]);

  // Fetch user's RSVPs for visible events
  const eventIds = events?.map(e => e.id) || [];
  const { data: userRsvps } = useQuery({
    queryKey: ["user-rsvps-home", user?.id, eventIds],
    queryFn: async () => {
      if (eventIds.length === 0) return [];
      const { data, error } = await supabase
        .from("rsvps")
        .select("event_id, status")
        .eq("user_id", user!.id)
        .is("child_id", null)
        .in("event_id", eventIds);
      if (error) throw error;
      return data;
    },
    enabled: !!user && eventIds.length > 0,
  });

  const getUserRsvpStatus = (eventId: string) => {
    return userRsvps?.find(r => r.event_id === eventId)?.status || null;
  };

  const getRsvpIcon = (status: string | null) => {
    switch (status) {
      case "going":
        return <CheckCircle2 className="h-4 w-4 mr-1 text-primary" />;
      case "not_going":
        return <X className="h-4 w-4 mr-1 text-destructive" />;
      case "maybe":
        return <HelpCircle className="h-4 w-4 mr-1 text-warning" />;
      default:
        return <Minus className="h-4 w-4 mr-1 text-muted-foreground" />;
    }
  };

  // Fetch user roles to check admin permissions
  const { data: userRoles } = useQuery({
    queryKey: ["user-roles", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch pending reward redemptions
  const { data: pendingRedemptions = [] } = useQuery({
    queryKey: ["pending-redemptions-home", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("reward_redemptions")
        .select(`
          id,
          reward_id,
          club_id,
          points_spent,
          status,
          redeemed_at,
          club_rewards (id, name, description, points_required, qr_code_url, show_qr_code),
          clubs (name)
        `)
        .eq("user_id", user!.id)
        .eq("status", "pending")
        .order("redeemed_at", { ascending: false })
        .limit(1);
      return data || [];
    },
    enabled: !!user,
  });

  const latestPendingRedemption = pendingRedemptions[0] as {
    id: string;
    club_id: string;
    club_rewards: { name: string; qr_code_url: string | null; show_qr_code: boolean } | null;
    clubs: { name: string } | null;
  } | undefined;

  const isAppAdmin = userRoles?.some(r => r.role === "app_admin");

  // Get user's clubs (for upgrade selection)
  const { data: userClubs = [] } = useQuery({
    queryKey: ["user-clubs-for-upgrade", user?.id, userRoles],
    queryFn: async () => {
      // Get user's club IDs through their roles
      const clubIds = userRoles?.filter(r => r.club_id).map(r => r.club_id) as string[] || [];
      
      // Also get club IDs from team memberships
      const teamIds = userRoles?.filter(r => r.team_id).map(r => r.team_id) as string[] || [];
      
      if (teamIds.length > 0) {
        const { data: teamsData } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        
        teamsData?.forEach(t => {
          if (t.club_id && !clubIds.includes(t.club_id)) {
            clubIds.push(t.club_id);
          }
        });
      }

      if (clubIds.length === 0) return [];

      // Fetch club details
      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name, sport")
        .in("id", clubIds)
        .order("name");

      return clubs || [];
    },
    enabled: !!user && !!userRoles,
  });

  // Check if user has Pro access (via club or team subscription)
  // Logic: Club Pro → all teams inherit; Free club → check team subscription
  const { data: hasProAccess } = useQuery({
    queryKey: ["user-has-pro-access", user?.id, userRoles?.map(r => r.club_id).filter(Boolean).join(","), userRoles?.map(r => r.team_id).filter(Boolean).join(",")],
    queryFn: async () => {
      if (!userRoles || userRoles.length === 0) return false;
      
      const clubIds = [...new Set(userRoles.filter(r => r.club_id).map(r => r.club_id))] as string[];
      const teamIds = [...new Set(userRoles.filter(r => r.team_id).map(r => r.team_id))] as string[];
      
      // Get club IDs from team memberships
      if (teamIds.length > 0) {
        const { data: teamsData } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        
        teamsData?.forEach(t => {
          if (t.club_id && !clubIds.includes(t.club_id)) {
            clubIds.push(t.club_id);
          }
        });
      }

      if (clubIds.length === 0 && teamIds.length === 0) return false;

      // First check club subscriptions
      if (clubIds.length > 0) {
        const { data: clubSubs } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("club_id", clubIds);

        const hasClubPro = clubSubs?.some(s => 
          s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
        );
        
        if (hasClubPro) return true;
      }
      
      // If no club Pro, check team-level subscriptions (for teams in free clubs)
      if (teamIds.length > 0) {
        const { data: teamSubs } = await supabase
          .from("team_subscriptions")
          .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("team_id", teamIds);
        
        const hasTeamPro = teamSubs?.some(s => 
          s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
        );
        
        if (hasTeamPro) return true;
      }

      return false;
    },
    enabled: !!user && !!userRoles,
  });

  const handleUpgradeClick = () => {
    // Check if user is team admin but NOT club admin - navigate to team upgrade
    const isClubAdmin = userRoles?.some(r => r.role === "club_admin");
    const teamAdminRole = userRoles?.find(r => r.role === "team_admin" && r.team_id);
    
    if (!isClubAdmin && teamAdminRole?.team_id) {
      // Team admin only - go to team upgrade page
      navigate(`/teams/${teamAdminRole.team_id}/upgrade`);
    } else if (userClubs.length === 1) {
      navigate(`/clubs/${userClubs[0].id}/upgrade`);
    } else if (userClubs.length > 1) {
      setUpgradeDialogOpen(true);
    } else {
      navigate("/clubs");
    }
  };

  const canManageEvent = (event: Event) => {
    if (isAppAdmin) return true;
    return userRoles?.some(r => 
      (r.role === "club_admin" && r.club_id === event.club_id) ||
      (r.role === "team_admin" && r.team_id === event.team_id) ||
      (r.role === "coach" && r.team_id === event.team_id)
    );
  };

  const cancelEventMutation = useMutation({
    mutationFn: async ({ cancelType, customMessage, sendPushNotification }: { 
      cancelType: 'single' | 'series'; 
      customMessage?: string; 
      sendPushNotification?: boolean 
    }) => {
      if (!eventToCancel) return;
      
      if (cancelType === 'series' && eventToCancel.parent_event_id) {
        // Cancel all events in the series
        await supabase.from("events").update({ is_cancelled: true }).eq("parent_event_id", eventToCancel.parent_event_id);
        await supabase.from("events").update({ is_cancelled: true }).eq("id", eventToCancel.parent_event_id);
      } else if (cancelType === 'series' && eventToCancel.is_recurring) {
        // This is the parent - cancel all children and this event
        await supabase.from("events").update({ is_cancelled: true }).eq("parent_event_id", eventToCancel.id);
        await supabase.from("events").update({ is_cancelled: true }).eq("id", eventToCancel.id);
      } else {
        // Just cancel this single event
        const { error } = await supabase
          .from("events")
          .update({ is_cancelled: true })
          .eq("id", eventToCancel.id);
        if (error) throw error;
      }
      
      // TODO: Handle customMessage and sendPushNotification if needed
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upcoming-events"] });
      setCancelDialogOpen(false);
      setEventToCancel(null);
    },
  });

  const remindMutation = useMutation({
    mutationFn: async () => {
      if (!eventToRemind) return;
      
      // Get all RSVPs for this event
      const { data: existingRsvps } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", eventToRemind.id);
      
      const rsvpUserIds = existingRsvps?.map(r => r.user_id) || [];
      
      // Get all members who should RSVP (team or club members)
      let memberQuery = supabase.from("user_roles").select("user_id");
      if (eventToRemind.team_id) {
        memberQuery = memberQuery.eq("team_id", eventToRemind.team_id);
      } else {
        memberQuery = memberQuery.eq("club_id", eventToRemind.club_id);
      }
      
      const { data: allMembers } = await memberQuery;
      const allMemberIds = [...new Set(allMembers?.map(m => m.user_id) || [])];
      
      // Find members who haven't RSVPed
      const nonRsvpMembers = allMemberIds.filter(memberId => !rsvpUserIds.includes(memberId));
      
      if (nonRsvpMembers.length === 0) {
        throw new Error("Everyone has already RSVPed!");
      }
      
      // Check for existing notifications to avoid duplicates
      const { data: existingNotifications } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_reminder")
        .eq("related_id", eventToRemind.id)
        .in("user_id", nonRsvpMembers);
      
      const existingNotificationUserIds = existingNotifications?.map(n => n.user_id) || [];
      const membersToNotify = nonRsvpMembers.filter(memberId => !existingNotificationUserIds.includes(memberId));
      
      if (membersToNotify.length === 0) {
        throw new Error("All members have already been reminded!");
      }
      
      // Create notifications for members who haven't been reminded
      const notifications = membersToNotify.map(userId => ({
        user_id: userId,
        type: "event_reminder",
        message: `Reminder: Please RSVP for "${eventToRemind.title}"`,
        related_id: eventToRemind.id,
      }));
      
      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) throw error;
      
      return membersToNotify.length;
    },
    onSuccess: (count) => {
      toast({
        title: "Reminders sent!",
        description: `Sent to ${count} member${count === 1 ? '' : 's'}`,
      });
      setRemindDialogOpen(false);
      setEventToRemind(null);
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to send reminders", variant: "destructive" });
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: async ({ eventId, deleteType }: { eventId: string; deleteType: 'single' | 'series' }) => {
      const event = events?.find(e => e.id === eventId);
      if (deleteType === 'series' && event?.parent_event_id) {
        // Delete parent and all children
        await supabase.from("events").delete().eq("parent_event_id", event.parent_event_id);
        await supabase.from("events").delete().eq("id", event.parent_event_id);
      } else if (deleteType === 'series' && event?.is_recurring) {
        // This is the parent - delete all children first, then this event
        await supabase.from("events").delete().eq("parent_event_id", eventId);
        await supabase.from("events").delete().eq("id", eventId);
      } else {
        // Just delete this single event
        const { error } = await supabase.from("events").delete().eq("id", eventId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upcoming-events"] });
      setDeleteDialogOpen(false);
      setEventToDelete(null);
    },
  });

  // Mutation to mark reward as claimed
  const claimMutation = useMutation({
    mutationFn: async (redemption: { id: string; club_id: string; reward_name: string }) => {
      const { error } = await supabase
        .from("reward_redemptions")
        .update({
          status: "fulfilled",
          verified_at: new Date().toISOString(),
          verified_by: user!.id,
        })
        .eq("id", redemption.id);

      if (error) throw error;

      // Get claimer's name
      const claimerName = profile?.display_name || "Someone";

      // Notify club admins about the claim
      const { data: clubAdmins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", redemption.club_id)
        .eq("role", "club_admin");

      if (clubAdmins && clubAdmins.length > 0) {
        const notifications = clubAdmins
          .filter(admin => admin.user_id !== user!.id)
          .map(admin => ({
            user_id: admin.user_id,
            type: "reward_claimed",
            message: `${claimerName} marked their "${redemption.reward_name}" reward as claimed`,
            related_id: redemption.id,
          }));

        if (notifications.length > 0) {
          await supabase.from("notifications").insert(notifications);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-redemptions-home"] });
      setClaimDialogOpen(false);
      toast({
        title: "Reward Claimed!",
        description: "The reward has been marked as fulfilled.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to claim reward",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const { data: clubs } = useQuery({
    queryKey: ["all-clubs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name, sport")
        .order("name");
      if (error) throw error;
      return data as Club[];
    },
    enabled: !!user,
  });

  const { data: teams } = useQuery({
    queryKey: ["all-teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, club_id, clubs (name, sport)")
        .order("name");
      if (error) throw error;
      return data as Team[];
    },
    enabled: !!user,
  });

  // Fetch user's soccer teams with Pro Football subscription where user is direct team member (coach/team_admin)
  // Club admins who are not explicit team members get read-only access (handled separately)
  const { data: mySoccerTeams } = useQuery({
    queryKey: ["my-soccer-teams-pro", user?.id],
    queryFn: async () => {
      // Only fetch teams where user is coach or team_admin (direct team edit access)
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("team_id, role")
        .eq("user_id", user!.id)
        .in("role", ["coach", "team_admin"]);
      
      if (rolesError) throw rolesError;
      if (!userRoles?.length) return [];

      // Get teams where user is coach or team_admin
      const coachAdminTeamIds = userRoles
        .filter(r => r.team_id)
        .map(r => r.team_id) as string[];
      
      if (coachAdminTeamIds.length === 0) {
        return [];
      }

      // Fetch team details
      const { data: teamsData, error: teamsError } = await supabase
        .from("teams")
        .select("id, name, club_id, clubs (id, name, sport)")
        .in("id", coachAdminTeamIds);
      
      if (teamsError) throw teamsError;
      
      // Filter to only soccer/football clubs (check if sport contains keywords)
      const soccerKeywords = ["soccer", "football", "futsal"];
      const soccerTeams = teamsData?.filter(t => {
        if (!t.clubs?.sport) return false;
        const sportLower = t.clubs.sport.toLowerCase();
        return soccerKeywords.some(keyword => sportLower.includes(keyword));
      }) || [];

      if (!soccerTeams.length) return [];

      // Check which teams have Pro Football subscription (team-level)
      const { data: teamSubscriptions } = await supabase
        .from("team_subscriptions")
        .select("team_id, is_pro_football")
        .in("team_id", soccerTeams.map(t => t.id))
        .eq("is_pro_football", true);

      const proFootballTeamIds = new Set(teamSubscriptions?.map(s => s.team_id) || []);

      // Check which clubs have Pro Football subscription (club-level)
      const clubIds = [...new Set(soccerTeams.map(t => t.club_id).filter(Boolean))] as string[];
      if (clubIds.length > 0) {
        const { data: clubSubscriptions } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro_football")
          .in("club_id", clubIds)
          .eq("is_pro_football", true);
        
        const proFootballClubIds = new Set(clubSubscriptions?.map(s => s.club_id) || []);
        
        // Add teams from Pro Football clubs
        soccerTeams.forEach(t => {
          if (t.club_id && proFootballClubIds.has(t.id)) {
            proFootballTeamIds.add(t.id);
          }
        });
      }

      // Coaches and team admins require Pro Football subscription for pitch board access
      return soccerTeams.filter(t => proFootballTeamIds.has(t.id));
    },
    enabled: !!user,
  });

  // Fetch soccer teams where user is a member (player/parent) OR club admin with Pro Football for read-only access
  // Club admins who are not explicit team members (coach/team_admin) get view-only access
  const { data: readOnlySoccerTeams } = useQuery({
    queryKey: ["read-only-soccer-teams", user?.id],
    queryFn: async () => {
      // Get user's roles
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", user!.id);
      
      if (rolesError) throw rolesError;
      if (!userRoles?.length) return [];

      const isAppAdmin = userRoles.some(r => r.role === "app_admin");

      // Get team IDs where user is player or parent
      const memberTeamIds = userRoles
        .filter(r => r.team_id && (r.role === "player" || r.role === "parent"))
        .map(r => r.team_id) as string[];
      
      // Get club IDs where user is club_admin (these teams get read-only access)
      const adminClubIds = userRoles
        .filter(r => r.club_id && r.role === "club_admin")
        .map(r => r.club_id) as string[];

      // Build query based on roles
      let teamsQuery = supabase
        .from("teams")
        .select("id, name, club_id, clubs (id, name, sport)");
      
      if (isAppAdmin) {
        // App admin can see all teams (read-only for teams they're not coach/team_admin of)
      } else if (memberTeamIds.length > 0 && adminClubIds.length > 0) {
        teamsQuery = teamsQuery.or(`id.in.(${memberTeamIds.join(",")}),club_id.in.(${adminClubIds.join(",")})`);
      } else if (adminClubIds.length > 0) {
        teamsQuery = teamsQuery.in("club_id", adminClubIds);
      } else if (memberTeamIds.length > 0) {
        teamsQuery = teamsQuery.in("id", memberTeamIds);
      } else {
        return [];
      }

      const { data: teamsData, error: teamsError } = await teamsQuery;
      
      if (teamsError) throw teamsError;
      
      // Filter to soccer/football teams
      const soccerKeywords = ["soccer", "football", "futsal"];
      const soccerTeams = teamsData?.filter(t => {
        if (!t.clubs?.sport) return false;
        const sportLower = t.clubs.sport.toLowerCase();
        return soccerKeywords.some(keyword => sportLower.includes(keyword));
      }) || [];

      if (!soccerTeams.length) return [];

      // Check which teams have Pro Football subscription (team-level)
      const { data: teamSubscriptions } = await supabase
        .from("team_subscriptions")
        .select("team_id, is_pro_football")
        .in("team_id", soccerTeams.map(t => t.id))
        .eq("is_pro_football", true);

      const proFootballTeamIds = new Set(teamSubscriptions?.map(s => s.team_id) || []);

      // Check which clubs have Pro Football subscription (club-level)
      const clubIds = [...new Set(soccerTeams.map(t => t.club_id).filter(Boolean))];
      if (clubIds.length > 0) {
        const { data: clubSubscriptions } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro_football")
          .in("club_id", clubIds)
          .eq("is_pro_football", true);
        
        const proFootballClubIds = new Set(clubSubscriptions?.map(s => s.club_id) || []);
        
        // Add teams from Pro Football clubs
        soccerTeams.forEach(t => {
          if (t.club_id && proFootballClubIds.has(t.id)) {
            proFootballTeamIds.add(t.id);
          }
        });
      }

      // Return only teams with Pro Football
      return soccerTeams.filter(t => proFootballTeamIds.has(t.id));
    },
    enabled: !!user,
  });

  // Fetch user's recently used pitch boards (last 2 used)
  const { data: recentlyUsedGames } = useQuery({
    queryKey: ["recently-used-pitch-boards", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("active_games")
        .select("team_id, updated_at")
        .eq("user_id", user!.id)
        .not("team_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Filter out teams already shown in coach/admin section
  const readOnlyTeamsFiltered = readOnlySoccerTeams?.filter(
    t => !mySoccerTeams?.some(mt => mt.id === t.id)
  ) || [];

  // Combine all available teams and limit to last 2 used
  const allAvailableTeams = [
    ...(mySoccerTeams || []).map(t => ({ ...t, readOnly: false })),
    ...readOnlyTeamsFiltered.map(t => ({ ...t, readOnly: true }))
  ];

  // Filter by active club theme if set
  const filteredAvailableTeams = activeClubFilter
    ? allAvailableTeams.filter(t => t.club_id === activeClubFilter)
    : allAvailableTeams;

  // Sort by recently used and limit to 2
  const recentTeamIds = recentlyUsedGames?.map(g => g.team_id) || [];
  const sortedTeams = [...filteredAvailableTeams].sort((a, b) => {
    const aIndex = recentTeamIds.indexOf(a.id);
    const bIndex = recentTeamIds.indexOf(b.id);
    // Teams not in recent list go to the end
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
  
  // Only show last 2 used pitch boards (or all if expanded)
  const displayedTeams = pitchBoardsExpanded ? sortedTeams : sortedTeams.slice(0, 2);

  // Function to open pitch board for a team - requires Pro Football subscription
  const openPitchBoard = async (teamId: string, teamName: string, readOnly: boolean = false) => {
    setPitchBoardLoading(true);
    try {
      // Check Pro Football subscription before opening
      const { data: teamSub } = await supabase
        .from("team_subscriptions")
        .select("is_pro_football")
        .eq("team_id", teamId)
        .maybeSingle();
      
      let hasProFootball = teamSub?.is_pro_football || false;
      
      // If team doesn't have Pro Football, check club level
      if (!hasProFootball) {
        const { data: team } = await supabase
          .from("teams")
          .select("club_id")
          .eq("id", teamId)
          .single();
        
        if (team?.club_id) {
          const { data: clubSub } = await supabase
            .from("club_subscriptions")
            .select("is_pro_football")
            .eq("club_id", team.club_id)
            .maybeSingle();
          
          hasProFootball = clubSub?.is_pro_football || false;
        }
      }
      
      // Allow if user is app admin or has pro football subscription
      if (!hasProFootball && !isAppAdmin) {
        toast({
          title: "Pro Football Required",
          description: "Pitch Board requires a Pro Football subscription.",
          variant: "destructive",
        });
        return;
      }
      
      // Fetch members and check for nearby game in parallel
      const [membersResult, nearbyEventId] = await Promise.all([
        supabase
          .from("user_roles")
          .select("*, profiles (display_name, avatar_url)")
          .eq("team_id", teamId),
        findNearbyGameEvent(teamId)
      ]);
      
      setPitchBoardTeam({ 
        id: teamId, 
        name: teamName, 
        members: membersResult.data || [], 
        readOnly,
        linkedEventId: nearbyEventId 
      });
    } finally {
      setPitchBoardLoading(false);
    }
  };

  const clubRequestMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("role_requests").insert({
        user_id: user!.id,
        club_id: selectedClub,
        role: selectedClubRole,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Request Submitted",
        description: "Your club join request has been submitted for review.",
      });
      setClubDialogOpen(false);
      setSelectedClub("");
      queryClient.invalidateQueries({ queryKey: ["role-requests"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Check if user already has the SPECIFIC role they're requesting in the selected team
  const hasExistingTeamRole = selectedTeam && selectedTeamRole && userRoles?.some(r => r.team_id === selectedTeam && r.role === selectedTeamRole);

  const teamRequestMutation = useMutation({
    mutationFn: async () => {
      // Double-check on submit - only block if they already have this specific role
      if (userRoles?.some(r => r.team_id === selectedTeam && r.role === selectedTeamRole)) {
        throw new Error("You already have this role in this team");
      }
      const team = teams?.find((t) => t.id === selectedTeam);
      const { error } = await supabase.from("role_requests").insert({
        user_id: user!.id,
        team_id: selectedTeam,
        club_id: team?.club_id,
        role: selectedTeamRole,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Request Submitted",
        description: "Your team join request has been submitted for review.",
      });
      setTeamDialogOpen(false);
      setSelectedTeam("");
      queryClient.invalidateQueries({ queryKey: ["role-requests"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return <PageLoading message="Loading home..." />;
  }

  return (
    <div className="py-6 space-y-6">
      {/* Welcome Section */}
      <section className="space-y-1">
        <h1 className="text-2xl font-bold">
          Welcome, {profile?.display_name?.split(" ")[0]}! 👋
        </h1>
        <p className="text-muted-foreground">
          {activeThemeData 
            ? `Here's what's coming up @ ${activeThemeData.clubName}`
            : "Here's what's coming up"
          }
        </p>
      </section>

      {/* Game Timer Widget - shown when game in progress */}
      {/* Only members of the SPECIFIC team with active timer can see this widget */}
      {/* Only coaches/team_admins of that team can edit, others view read-only */}
      {(() => {
        // Check if there's a timer running
        const timerStateRaw = typeof window !== 'undefined' ? localStorage.getItem('pitch-board-timer-state') : null;
        if (!timerStateRaw) {
          return null;
        }
        
        // Parse timer state to get the team ID
        let timerTeamId: string | null = null;
        try {
          const parsed = JSON.parse(timerStateRaw);
          timerTeamId = parsed.teamId;
        } catch {
          return null; // Invalid timer state
        }
        
        if (!timerTeamId) {
          return null; // No team associated with timer
        }
        
        // Check if user is a member of THIS SPECIFIC team (any role counts for viewing)
        const isTeamMember = userRoles?.some(r => r.team_id === timerTeamId);
        
        // Club admins of the club that owns this team can also view
        // Find the team to get its club_id
        const timerTeamData = mySoccerTeams?.find(t => t.id === timerTeamId) || 
                              readOnlySoccerTeams?.find(t => t.id === timerTeamId);
        const isClubAdminOfTeam = timerTeamData && userRoles?.some(r => 
          r.role === 'club_admin' && r.club_id === timerTeamData.club_id
        );
        
        // Only show to: app admins, actual team members, or club admins of that team's club
        const canViewWidget = isAppAdmin || isTeamMember || isClubAdminOfTeam;
        
        if (!canViewWidget) {
          return null;
        }
        
        // Check if user has EDIT access (coach or team_admin of THIS team, or app_admin)
        const hasEditAccess = isAppAdmin || userRoles?.some(r => 
          r.team_id === timerTeamId && (r.role === "coach" || r.role === "team_admin")
        );
        
        return (
          <>
            <GameTimerWidget 
              onOpenPitchBoard={hasEditAccess ? openPitchBoard : undefined}
              readOnly={!hasEditAccess}
            />
            <PendingSubWidget 
              readOnly={!hasEditAccess}
              onAcceptSub={() => {
                if (!hasEditAccess) return;
                // Open pitch board for the active game team
                const timerState = localStorage.getItem('pitch-board-timer-state');
                if (timerState) {
                  try {
                    const parsed = JSON.parse(timerState);
                    if (parsed.teamId && parsed.teamName) {
                      openPitchBoard(parsed.teamId, parsed.teamName, false);
                    }
                  } catch {
                    // Ignore parsing errors
                  }
                }
              }} 
            />
          </>
        );
      })()}

      {/* Account Recovery Banner */}
      {user && (
        <AccountRecoveryBanner 
          userId={user.id} 
          onRecovered={() => queryClient.invalidateQueries()}
        />
      )}
      {!isInstalled && showInstallCard && isReady && (
        <Card 
          className="border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
          onClick={() => {
            if (canPrompt) {
              installApp();
              dismissInstallCard();
            } else {
              setInstallDialogOpen(true);
            }
          }}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10 shrink-0">
                <Smartphone className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">Install Ignite App</p>
                <p className="text-sm text-muted-foreground">
                  {isIOS 
                    ? "Tap to see how to install" 
                    : canPrompt 
                      ? "Tap to add to your home screen"
                      : "Tap to see how to install"}
                </p>
              </div>
              <Button 
                size="sm" 
                variant={canPrompt ? "default" : "outline"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (canPrompt) {
                    installApp();
                    dismissInstallCard();
                  } else {
                    setInstallDialogOpen(true);
                  }
                }} 
                className="shrink-0"
              >
                {canPrompt ? (
                  <><Download className="h-4 w-4 mr-1" /> Install</>
                ) : (
                  "How to Install"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Install Instructions Dialog */}
      <ResponsiveDialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Install Ignite App</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Add Ignite to your home screen for quick access
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 py-4">
            {isIOS ? (
              <>
                <p className="text-sm text-muted-foreground">Follow these steps to install on your iPhone/iPad:</p>
                <ol className="list-decimal list-inside space-y-3 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="font-medium">1.</span>
                    <span>Tap the <strong>Share</strong> button (square with arrow) at the bottom of Safari</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-medium">2.</span>
                    <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-medium">3.</span>
                    <span>Tap <strong>"Add"</strong> in the top right corner</span>
                  </li>
                </ol>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Follow these steps to install:</p>
                <ol className="list-decimal list-inside space-y-3 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="font-medium">1.</span>
                    <span>Tap the <strong>menu icon</strong> (three dots) in your browser</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-medium">2.</span>
                    <span>Tap <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-medium">3.</span>
                    <span>Confirm by tapping <strong>"Install"</strong></span>
                  </li>
                </ol>
              </>
            )}
          </div>
          <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => {
              setInstallDialogOpen(false);
              setShowInstallCard(false);
            }}>
              Don't show again
            </Button>
            <Button onClick={() => setInstallDialogOpen(false)}>
              Got it
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Points Card */}
      <Card className={`${hasClubTheme ? 'gradient-themed' : 'gradient-emerald'} border-0`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-primary-foreground/80 text-sm font-medium">Ignite Points</p>
                {!hasProAccess && !isAppAdmin && (
                  <Badge variant="outline" className="text-xs bg-primary-foreground/10 border-primary-foreground/30 text-primary-foreground py-0 h-5">
                    <Lock className="h-3 w-3 mr-1" />
                    Pro
                  </Badge>
                )}
              </div>
              <p className="text-3xl font-bold text-primary-foreground">
                {profile?.ignite_points || 0}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {latestPendingRedemption ? (
                <Button
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-600 text-white gap-1.5"
                  onClick={() => setClaimDialogOpen(true)}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark as Claimed
                </Button>
              ) : (profile?.ignite_points || 0) >= 20 || profile?.has_sausage_reward ? (
                <Link to="/profile">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1.5"
                  >
                    <Gift className="h-4 w-4" />
                    View Rewards
                  </Button>
                </Link>
              ) : null}
            </div>
          </div>
          {!latestPendingRedemption && !profile?.has_sausage_reward && (profile?.ignite_points || 0) < 20 && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-primary-foreground/70 text-sm">
                💡 {20 - (profile?.ignite_points || 0)} more points to unlock rewards!
              </p>
              <Link to="/profile">
                <Button size="sm" variant="ghost" className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10 h-7 px-2">
                  <Gift className="h-3.5 w-3.5 mr-1" />
                  Browse
                </Button>
              </Link>
            </div>
          )}
          {latestPendingRedemption && (
            <p className="text-primary-foreground/80 text-sm mt-2">
              🎁 You have a reward ready to claim: {latestPendingRedemption.club_rewards?.name}
            </p>
          )}
          {!latestPendingRedemption && ((profile?.ignite_points || 0) >= 20 || profile?.has_sausage_reward) && (
            <p className="text-primary-foreground/80 text-sm mt-2">
              🎁 You have rewards available! Tap to browse and redeem.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Reward Claim QR Dialog */}
      {(latestPendingRedemption || profile?.has_sausage_reward) && user && (
        <RewardClaimQRDialog
          open={rewardQROpen}
          onOpenChange={setRewardQROpen}
          rewardName={latestPendingRedemption?.club_rewards?.name || "Free Sausage"}
          clubName={latestPendingRedemption?.clubs?.name || "Club"}
          redemptionId={latestPendingRedemption?.id || `sausage-${user.id}`}
          qrCodeUrl={latestPendingRedemption?.club_rewards?.qr_code_url || null}
          userName={profile?.display_name || undefined}
          userId={user.id}
        />
      )}

      {/* Upgrade Banner for Free Users - only show when hasProAccess is explicitly false (not undefined/loading) */}
      {hasProAccess === false && userRoles && userRoles.length > 0 && userClubs.length > 0 && (() => {
        const isAnyAdmin = userRoles.some(r => r.role === "club_admin" || r.role === "team_admin");
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
                      {isAnyAdmin ? "Unlock Pro Features" : "Pro Features Available"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {isAnyAdmin 
                        ? "Get access to Vault, Media, Rewards & more"
                        : "Contact your club or team admin to unlock Pro features"
                      }
                    </p>
                  </div>
                </div>
                {isAnyAdmin && (
                  <Button size="sm" className="shrink-0" onClick={handleUpgradeClick}>
                    Upgrade
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Club Selection Dialog for Upgrade */}
      <ResponsiveDialog open={upgradeDialogOpen} onOpenChange={setUpgradeDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Select Club to Upgrade</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Choose which club you'd like to upgrade to Pro.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Select Club</Label>
              <Select value={selectedUpgradeClub} onValueChange={setSelectedUpgradeClub}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a club..." />
                </SelectTrigger>
                <SelectContent>
                  {userClubs.map((club) => (
                    <SelectItem key={club.id} value={club.id}>
                      <span className="flex items-center gap-2">
                        <span>{getSportEmoji(club.sport)}</span>
                        {club.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                if (selectedUpgradeClub) {
                  navigate(`/clubs/${selectedUpgradeClub}/upgrade`);
                  setUpgradeDialogOpen(false);
                }
              }}
              disabled={!selectedUpgradeClub}
            >
              Continue to Upgrade
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Quick Actions */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <Button 
            variant="outline" 
            className="w-full h-auto py-4 flex flex-col gap-2"
            onClick={() => navigate("/clubs", { state: { fromCreateTeam: true } })}
          >
            <UserPlus className="h-5 w-5 text-primary" />
            <span className="text-sm">Create Team or Club</span>
          </Button>
          <Button 
            variant="outline" 
            className="w-full h-auto py-4 flex flex-col gap-2"
            onClick={() => setTeamDialogOpen(true)}
          >
            <UserPlus className="h-5 w-5 text-primary" />
            <span className="text-sm">Join Team</span>
          </Button>
          <Button 
            variant="outline" 
            className="w-full h-auto py-4 flex flex-col gap-2 relative"
            disabled={!hasProAccess && !isAppAdmin}
            onClick={() => {
              if (hasProAccess || isAppAdmin) {
                navigate("/vault");
              }
            }}
          >
            <div className="flex items-center gap-1">
              <FolderOpen className="h-5 w-5 text-primary" />
              {!hasProAccess && !isAppAdmin && (
                <Lock className="h-3 w-3 text-muted-foreground" />
              )}
            </div>
            <span className="text-sm flex items-center gap-1">
              Access Vault
              {!hasProAccess && !isAppAdmin && (
                <Badge variant="secondary" className="text-[8px] px-1 py-0">PRO</Badge>
              )}
            </span>
          </Button>
          <Link to="/events/new">
            <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2">
              <Plus className="h-5 w-5 text-primary" />
              <span className="text-sm">New Event</span>
            </Button>
          </Link>
        </div>
      </section>

      {/* Join Team/Club Dialogs */}
      <ResponsiveDialog open={clubDialogOpen} onOpenChange={setClubDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Request to Join Club</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Select a club and role to request membership.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Select Club</Label>
              <SearchableSelect
                options={clubs?.map((club) => ({
                  value: club.id,
                  label: club.name,
                  icon: <span>{getSportEmoji(club.sport)}</span>,
                })) || []}
                value={selectedClub}
                onValueChange={setSelectedClub}
                placeholder="Choose a club..."
                searchPlaceholder="Search clubs..."
                emptyMessage="No clubs found."
              />
            </div>
            <div className="space-y-2">
              <Label>Select Role</Label>
              <Select value={selectedClubRole} onValueChange={(v) => setSelectedClubRole(v as ClubRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clubRoleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              className="w-full sm:w-auto"
              onClick={() => clubRequestMutation.mutate()}
              disabled={!selectedClub || clubRequestMutation.isPending}
            >
              {clubRequestMutation.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Request to Join Team</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Select a team and role to request membership.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Select Club (optional)</Label>
              <SearchableSelect
                options={[
                  { value: "all", label: "All clubs" },
                  ...(clubs?.map((club) => ({
                    value: club.id,
                    label: club.name,
                    icon: <span>{getSportEmoji(club.sport)}</span>,
                  })) || [])
                ]}
                value={selectedClubForTeam || "all"}
                onValueChange={(v) => {
                  setSelectedClubForTeam(v);
                  setSelectedTeam(""); // Reset team when club changes
                }}
                placeholder="All clubs..."
                searchPlaceholder="Search clubs..."
                emptyMessage="No clubs found."
              />
            </div>
            <div className="space-y-2">
              <Label>Select Team</Label>
              <SearchableSelect
                options={teams
                  ?.filter(team => !selectedClubForTeam || selectedClubForTeam === "all" || team.club_id === selectedClubForTeam)
                  .map((team) => ({
                    value: team.id,
                    label: `${team.name} (${team.clubs?.name})`,
                    icon: <span>{getSportEmoji(team.clubs?.sport)}</span>,
                  })) || []}
                value={selectedTeam}
                onValueChange={setSelectedTeam}
                placeholder="Choose a team..."
                searchPlaceholder="Search teams..."
                emptyMessage="No teams found."
              />
            </div>
            <div className="space-y-2">
              <Label>Select Role</Label>
              <Select value={selectedTeamRole} onValueChange={(v) => setSelectedTeamRole(v as TeamRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {teamRoleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <ResponsiveDialogFooter>
            {hasExistingTeamRole && (
              <p className="text-sm text-destructive mb-2">You already have this role in this team</p>
            )}
            <Button
              className="w-full sm:w-auto"
              onClick={() => teamRequestMutation.mutate()}
              disabled={!selectedTeam || teamRequestMutation.isPending || hasExistingTeamRole}
            >
              {teamRequestMutation.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* My Soccer Teams - Pitch Board Access (last 2 used) */}
      {displayedTeams.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pitch Board</h2>
            {sortedTeams.length > 2 && (
              <button 
                onClick={() => setPitchBoardsExpanded(!pitchBoardsExpanded)}
                className="text-sm text-primary hover:underline"
              >
                {pitchBoardsExpanded ? "Show less" : "View all"}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {displayedTeams.map((team) => (
              <Card 
                key={team.id}
                className="hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => openPitchBoard(team.id, team.name, team.readOnly)}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 relative">
                  {team.readOnly && (
                    <Badge variant="secondary" className="absolute top-1 right-1 text-xs px-1 py-0">
                      View
                    </Badge>
                  )}
                  <LayoutGrid className="h-6 w-6 text-primary" />
                  <span className="text-sm font-medium text-center truncate w-full">{team.name}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Events */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Upcoming Events</h2>
          <Link to="/events" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>

        {events?.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No upcoming events</p>
              <p className="text-sm text-muted-foreground mt-1">
                {userClubs && userClubs.length > 0 
                  ? "No events scheduled yet" 
                  : "Join a club or create one to see events here"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {events?.map((event) => (
              <Card key={event.id} className={`hover:border-primary/50 transition-colors ${event.is_cancelled ? 'opacity-60' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/events/${event.id}`} className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={eventTypeColors[event.type]} variant="secondary">
                          {event.type}
                        </Badge>
                        {event.is_cancelled && (
                          <Badge variant="destructive">Cancelled</Badge>
                        )}
                        {event.teams?.name && (
                          <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
                            <span>{getSportEmoji(event.clubs?.sport)}</span>
                            {event.teams.name}
                          </span>
                        )}
                      </div>
                      <h3 className={`font-semibold truncate ${event.is_cancelled ? 'line-through' : ''}`}>{event.title}</h3>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatEventDate(event.event_date)}
                        </span>
                      </div>
                      {event.suburb && (
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          {event.suburb}
                        </span>
                      )}
                    </Link>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Quick RSVP Button - only for non-cancelled events */}
                      {!event.is_cancelled && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setQuickRsvpEvent(event);
                          }}
                        >
                          {getRsvpIcon(getUserRsvpStatus(event.id))}
                          RSVP
                        </Button>
                      )}
                      {canManageEvent(event) && (
                        <>
                          <Link to={`/events/${event.id}/edit`} onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          {!event.is_cancelled && (
                            <>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-primary"
                                disabled={loadingRemindCount}
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setLoadingRemindCount(true);
                                  
                                  // Fetch count of non-RSVP members first
                                  const { data: rsvps } = await supabase
                                    .from("rsvps")
                                    .select("user_id")
                                    .eq("event_id", event.id);
                                  
                                  const rsvpUserIds = rsvps?.map(r => r.user_id) || [];
                                  
                                  let memberQuery = supabase.from("user_roles").select("user_id");
                                  if (event.team_id) {
                                    memberQuery = memberQuery.eq("team_id", event.team_id);
                                  } else {
                                    memberQuery = memberQuery.eq("club_id", event.club_id);
                                  }
                                  
                                  const { data: members } = await memberQuery;
                                  const allMemberIds = [...new Set(members?.map(m => m.user_id) || [])];
                                  const count = allMemberIds.filter(id => !rsvpUserIds.includes(id)).length;
                                  
                                  setNonRsvpCount(count);
                                  setEventToRemind(event);
                                  setRemindDialogOpen(true);
                                  setLoadingRemindCount(false);
                                }}
                              >
                                {loadingRemindCount ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Bell className="h-4 w-4" />
                                )}
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-warning"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setEventToCancel(event);
                                  setCancelDialogOpen(true);
                                }}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEventToDelete(event);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Club Sponsor Section - shown when a club is selected, or carousel when no filter */}
      {activeClubFilter ? (
        <ClubSponsorSection clubId={activeClubFilter} />
      ) : (
        <MultiClubSponsorCarousel />
      )}
      
      {/* App Ads - shown when configured, may override or supplement sponsor carousel */}
      <SponsorOrAdCarousel location="home" activeClubFilter={activeClubFilter} />

      {/* Pitch Board Loading Overlay */}
      {pitchBoardLoading && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: '#2d5a27' }}>
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-primary">
                <Flame className="h-8 w-8 text-primary-foreground" />
              </div>
              <div className="animate-bounce">
                <SoccerBall size={48} readOnly />
              </div>
            </div>
            <Loader2 className="h-6 w-6 animate-spin text-white" />
            <p className="text-lg font-medium text-white">Loading Pitch Board...</p>
          </div>
        </div>,
        document.body
      )}
      {/* Pitch Board Modal - Lazy loaded */}
      {pitchBoardTeam && (
        <Suspense fallback={
          createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: '#2d5a27' }}>
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-primary">
                    <Flame className="h-8 w-8 text-primary-foreground" />
                  </div>
                  <div className="animate-bounce">
                    <SoccerBall size={48} readOnly />
                  </div>
                </div>
                <Loader2 className="h-6 w-6 animate-spin text-white" />
                <p className="text-lg font-medium text-white">Loading Pitch Board...</p>
              </div>
            </div>,
            document.body
          )
        }>
          <PitchBoard
            teamId={pitchBoardTeam.id}
            teamName={pitchBoardTeam.name}
            members={pitchBoardTeam.members}
            onClose={() => setPitchBoardTeam(null)}
            readOnly={pitchBoardTeam.readOnly}
            initialLinkedEventId={pitchBoardTeam.linkedEventId}
          />
        </Suspense>
      )}

      {/* Delete Event Dialog */}
      {eventToDelete && (eventToDelete.is_recurring || eventToDelete.parent_event_id) ? (
        <RecurringEventActionDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open) setEventToDelete(null);
          }}
          title="Delete Event?"
          description="This will permanently delete the event(s) and all RSVPs. This action cannot be undone."
          actionLabel="Delete"
          actionVariant="destructive"
          onSingleAction={() => deleteEventMutation.mutate({ eventId: eventToDelete.id, deleteType: 'single' })}
          onSeriesAction={() => deleteEventMutation.mutate({ eventId: eventToDelete.id, deleteType: 'series' })}
          isPending={deleteEventMutation.isPending}
        />
      ) : eventToDelete && (
        <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setEventToDelete(null);
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Event?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this event and all RSVPs. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => deleteEventMutation.mutate({ eventId: eventToDelete.id, deleteType: 'single' })} 
                className="bg-destructive text-destructive-foreground"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Cancel Event Dialog */}
      {eventToCancel && (eventToCancel.is_recurring || eventToCancel.parent_event_id) ? (
        <RecurringCancelEventDialog
          open={cancelDialogOpen}
          onOpenChange={(open) => {
            setCancelDialogOpen(open);
            if (!open) setEventToCancel(null);
          }}
          eventTitle={eventToCancel?.title || ""}
          teamId={eventToCancel?.team_id}
          clubId={eventToCancel?.club_id}
          onSingleAction={(customMessage, sendPushNotification) => 
            cancelEventMutation.mutate({ cancelType: 'single', customMessage, sendPushNotification })
          }
          onSeriesAction={(customMessage, sendPushNotification) => 
            cancelEventMutation.mutate({ cancelType: 'series', customMessage, sendPushNotification })
          }
          isPending={cancelEventMutation.isPending}
        />
      ) : eventToCancel && (
        <CancelEventConfirmDialog
          open={cancelDialogOpen}
          onOpenChange={(open) => {
            setCancelDialogOpen(open);
            if (!open) setEventToCancel(null);
          }}
          eventId={eventToCancel?.id || ""}
          eventTitle={eventToCancel?.title || ""}
          teamId={eventToCancel?.team_id}
          clubId={eventToCancel?.club_id}
          onConfirm={(customMessage, sendPushNotification) => 
            cancelEventMutation.mutate({ cancelType: 'single', customMessage, sendPushNotification })
          }
          isPending={cancelEventMutation.isPending}
        />
      )}

      {/* Remind Dialog */}
      <AlertDialog 
        open={remindDialogOpen} 
        onOpenChange={(open) => {
          setRemindDialogOpen(open);
          if (!open) setEventToRemind(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Reminders?</AlertDialogTitle>
            <AlertDialogDescription>
              {nonRsvpCount === 0 
                ? "Everyone has already RSVPed to this event!"
                : `This will send a reminder notification to ${nonRsvpCount} member${nonRsvpCount === 1 ? '' : 's'} who haven't RSVPed yet.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {nonRsvpCount !== 0 && (
              <AlertDialogAction 
                onClick={() => remindMutation.mutate()}
                disabled={remindMutation.isPending}
              >
                {remindMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Sending...
                  </>
                ) : (
                  "Send Reminders"
                )}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {quickRsvpEvent && (
        <QuickRSVPDialog
          open={!!quickRsvpEvent}
          onOpenChange={(open) => !open && setQuickRsvpEvent(null)}
          eventId={quickRsvpEvent.id}
          eventTitle={quickRsvpEvent.title}
          eventDate={quickRsvpEvent.event_date}
          eventType={quickRsvpEvent.type}
          teamId={quickRsvpEvent.team_id}
          suburb={quickRsvpEvent.suburb}
          opponent={quickRsvpEvent.opponent}
        />
      )}

      {/* Claim Reward Confirmation Dialog */}
      <AlertDialog 
        open={claimDialogOpen} 
        onOpenChange={(open) => {
          if (!claimMutation.isPending) {
            setClaimDialogOpen(open);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Reward as Claimed?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm that <strong>{latestPendingRedemption?.club_rewards?.name}</strong> has been given to the member.
              <br /><br />
              This will mark the reward as fulfilled and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={claimMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (latestPendingRedemption) {
                  claimMutation.mutate({
                    id: latestPendingRedemption.id,
                    club_id: latestPendingRedemption.club_id,
                    reward_name: latestPendingRedemption.club_rewards?.name || "reward",
                  });
                }
              }}
              disabled={claimMutation.isPending}
            >
              {claimMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {claimMutation.isPending ? "Confirming..." : "Confirm Claimed"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
