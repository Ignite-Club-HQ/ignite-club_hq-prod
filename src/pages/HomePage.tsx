import { useState, lazy, Suspense, useMemo, useEffect } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Capacitor } from "@capacitor/core";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import SoccerBall from "@/components/pitch/SoccerBall";
import { Calendar, MapPin, Users, Clock, Plus, UserPlus, UserCheck, Download, Smartphone, LayoutGrid, Pencil, Trash2, XCircle, X, CheckCircle2, HelpCircle, Minus, Loader2, Flame, Gift, Lock, FolderOpen, Crown, Bell } from "lucide-react";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { RewardClaimQRDialog } from "@/components/RewardClaimQRDialog";
import { RecurringEventActionDialog } from "@/components/RecurringEventActionDialog";
import { CancelEventConfirmDialog } from "@/components/CancelEventConfirmDialog";
import { RecurringCancelEventDialog } from "@/components/RecurringCancelEventDialog";
import { AccountRecoveryBanner } from "@/components/AccountRecoveryBanner";
import { NativeAppDownloadBanner } from "@/components/NativeAppDownloadBanner";
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

import { MiniLeagueGameWidgets } from "@/components/MiniLeagueGameWidgets";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/components/AppStoreDownloadGuide";
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
import { MobileCardSelect } from "@/components/MobileCardSelect";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { recordPointsHistory } from "@/lib/pointsHistory";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { getSportEmoji } from "@/lib/sportEmojis";
import { findNearbyGameEvent } from "@/hooks/useNearbyGameEvent";
import { useClubTheme, hasClubThemeCached } from "@/hooks/useClubTheme";
import { ClubSponsorSection } from "@/components/ClubSponsorSection";
import { MultiClubSponsorCarousel } from "@/components/MultiClubSponsorCarousel";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";
import { UpcomingClassesWidget } from "@/components/UpcomingClassesWidget";
import { MyTeamsScroll } from "@/components/MyTeamsScroll";

type EventType = "game" | "training" | "social";
type TeamRole = "player" | "parent" | "coach" | "team_admin";
type ClubRole = "club_admin";
type LeagueRole = "league_admin" | "parent";

interface MiniLeague {
  id: string;
  name: string;
  club_id: string;
  clubs: { name: string; sport: string | null };
}

interface Event {
  id: string;
  title: string;
  type: EventType;
  event_date: string;
  address: string | null;
  location_name: string | null;
  suburb: string | null;
  club_id: string;
  team_id: string | null;
  mini_league_id: string | null;
  is_cancelled: boolean;
  is_recurring: boolean;
  parent_event_id: string | null;
  amount: number | null;
  opponent: string | null;
  teams: { name: string } | null;
  clubs: { name: string; sport: string | null };
}

interface Club {
  id: string;
  name: string;
  sport: string | null;
  class_mode_enabled: boolean;
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

const leagueRoleOptions: { value: LeagueRole; label: string }[] = [
  { value: "league_admin", label: "League Admin" },
  { value: "parent", label: "Parent" },
];

function formatEventDate(dateStr: string) {
  const date = parseISO(dateStr);
  if (isToday(date)) return `Today at ${format(date, "h:mm a")}`;
  if (isTomorrow(date)) return `Tomorrow at ${format(date, "h:mm a")}`;
  return format(date, "EEE, MMM d 'at' h:mm a");
}

export default function HomePage() {
  const { user, profile, refreshProfile } = useAuth();
  usePageTitle("Home");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isNativeApp = Capacitor.isNativePlatform();
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
  const [selectedLeagueRole, setSelectedLeagueRole] = useState<LeagueRole>("league_admin");
  // Track if user selected a league (prefixed with "league_") or team in the unified dropdown
  const isLeagueSelected = selectedTeam.startsWith("league_");
  const actualLeagueId = isLeagueSelected ? selectedTeam.replace("league_", "") : null;
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
  const [earnPointsOpen, setEarnPointsOpen] = useState(false);
  const [selectedUpgradeClub, setSelectedUpgradeClub] = useState<string>("");
  const [remindDialogOpen, setRemindDialogOpen] = useState(false);
  const [eventToRemind, setEventToRemind] = useState<Event | null>(null);
  const [nonRsvpCount, setNonRsvpCount] = useState(0);
  const [loadingRemindCount, setLoadingRemindCount] = useState(false);
  const [rewardsDialogOpen, setRewardsDialogOpen] = useState(false);
  const [selectedRewardClubId, setSelectedRewardClubId] = useState<string | null>(null);
  const [selectedReward, setSelectedReward] = useState<any>(null);
  const [confirmRedeemDialogOpen, setConfirmRedeemDialogOpen] = useState(false);
  const [selectedRedeemFor, setSelectedRedeemFor] = useState<string>("myself");

  // Get user's accessible team, club, and mini league IDs for event filtering
  const { data: userMemberships } = useQuery({
    queryKey: ["user-memberships-for-events", user?.id],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id, role")
        .eq("user_id", user!.id);
      
      if (!roles) return { teamIds: [], clubIds: [], clubAdminClubIds: [], leagueAdminClubIds: [], miniLeagueIds: [] };
      
      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id) as string[];
      const clubIds = new Set<string>();
      const clubAdminClubIds = new Set<string>();
      const leagueAdminClubIds = new Set<string>();
      
      // Direct club roles
      roles.forEach(r => {
        if (r.club_id) {
          clubIds.add(r.club_id);
          // Track club admin roles for team event visibility
          if (r.role === 'club_admin' || r.role === 'app_admin') {
            clubAdminClubIds.add(r.club_id);
          }
          // Track club admin roles for league access
          if (r.role === 'club_admin' || r.role === 'league_admin' || r.role === 'app_admin') {
            leagueAdminClubIds.add(r.club_id);
          }
        }
      });
      
      // Get club IDs from team memberships
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        teams?.forEach(t => clubIds.add(t.club_id));
      }
      
      // Get mini league IDs where user is a parent (has a player)
      const { data: playerLeagues } = await supabase
        .from("mini_league_players")
        .select("mini_league_id")
        .eq("parent_user_id", user!.id);
      
      const miniLeagueIds = playerLeagues?.map(p => p.mini_league_id) || [];
      
      // Also get mini leagues where user is league admin via club_admin role
      const { data: adminLeagues } = await supabase
        .from("mini_leagues")
        .select("id")
        .in("club_id", Array.from(leagueAdminClubIds));
      
      // Add leagues where user is admin
      adminLeagues?.forEach(l => {
        if (!miniLeagueIds.includes(l.id)) {
          miniLeagueIds.push(l.id);
        }
      });
      
      return { 
        teamIds, 
        clubIds: Array.from(clubIds), 
        clubAdminClubIds: Array.from(clubAdminClubIds),
        leagueAdminClubIds: Array.from(leagueAdminClubIds),
        miniLeagueIds 
      };
    },
    enabled: !!user,
  });

  const { data: allEvents, isLoading } = useQuery({
    queryKey: ["upcoming-events", user?.id, userMemberships?.teamIds, userMemberships?.clubIds, userMemberships?.miniLeagueIds],
    queryFn: async () => {
      if (!userMemberships) return [];
      
      const { teamIds, clubIds, miniLeagueIds } = userMemberships;
      if (teamIds.length === 0 && clubIds.length === 0 && miniLeagueIds.length === 0) return [];
      
      const now = new Date();
      
      const { data, error } = await supabase
        .from("events")
        .select(`
          id,
          title,
          type,
          event_date,
          address,
          location_name,
          suburb,
          club_id,
          team_id,
          mini_league_id,
          is_cancelled,
          is_recurring,
          parent_event_id,
          amount,
          opponent,
          teams (name),
          clubs (name, sport)
        `)
        .gte("event_date", now.toISOString())
        .order("event_date", { ascending: true })
        .limit(50);

      if (error) throw error;
      
      // Filter to only show events user is invited to:
      // - Team events: user must be a member of that team OR a club admin of the team's club
      // - Mini League events: user must be a league admin or have a player in that league
      // - Club-wide events (no team_id, no mini_league_id): user must be a member of that club
      const { clubAdminClubIds } = userMemberships;
      const filtered = (data as (Event & { mini_league_id: string | null })[]).filter(event => {
        if (event.mini_league_id) {
          // Mini League event - user must be league admin or have a player in this league
          return miniLeagueIds.includes(event.mini_league_id);
        } else if (event.team_id) {
          // Team event - user must be a member of this team OR a club admin of the team's club
          return teamIds.includes(event.team_id) || clubAdminClubIds.includes(event.club_id);
        } else {
          // Club-wide event - user must be a member of this club
          return clubIds.includes(event.club_id);
        }
      });
      
      return filtered as Event[];
    },
    enabled: !!user && !!userMemberships,
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
        return <><CheckCircle2 className="h-4 w-4 mr-1 text-primary" aria-hidden="true" /><span className="sr-only">Going - </span></>;
      case "not_going":
        return <><X className="h-4 w-4 mr-1 text-destructive" aria-hidden="true" /><span className="sr-only">Not going - </span></>;
      case "maybe":
        return <><HelpCircle className="h-4 w-4 mr-1 text-warning" aria-hidden="true" /><span className="sr-only">Maybe - </span></>;
      default:
        return <><Minus className="h-4 w-4 mr-1 text-muted-foreground" aria-hidden="true" /><span className="sr-only">No response - </span></>;
    }
  };

  // Fetch user roles to check admin permissions
  const { data: userRoles, isLoading: isLoadingUserRoles } = useQuery({
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
    staleTime: 5 * 60 * 1000, // Prevent refetch flash on app resume
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
        .select("id, name, sport, points_display_name, points_icon_url")
        .in("id", clubIds)
        .order("name");

      return clubs || [];
    },
    enabled: !!user && !!userRoles,
  });

  // Check if user has Pro access (via club or team subscription)
  // Logic: Club Pro → all teams inherit; Free club → check team subscription
  const { data: hasProAccess, isLoading: isLoadingProAccess } = useQuery({
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
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes to prevent flash on re-renders
    placeholderData: (prev) => prev, // Keep previous data during key changes to prevent flash
  });
  
  // Show PRO badge only after we've confirmed they don't have Pro access
  // Must wait for both userRoles AND hasProAccess queries to complete to prevent flash
  // Also require userRoles to be defined — when user is briefly undefined on app resume,
  // disabled queries have isLoading=false AND data=undefined, which would cause a false flash
  const showProBadge = !!userRoles && !isLoadingUserRoles && !isLoadingProAccess && !hasProAccess && !isAppAdmin;

  // Fetch clubs for rewards with Pro status
  const { data: rewardClubs = [] } = useQuery({
    queryKey: ["reward-clubs-home", user?.id, activeClubFilter],
    queryFn: async () => {
      // If active club filter, only return that club
      if (activeClubFilter) {
        const { data: club } = await supabase
          .from("clubs")
          .select("id, name, logo_url")
          .eq("id", activeClubFilter)
          .single();

        if (!club) return [];

        const { data: subscription } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("club_id", activeClubFilter)
          .maybeSingle();

        const hasPro = subscription?.is_pro || subscription?.is_pro_football || 
                       subscription?.admin_pro_override || subscription?.admin_pro_football_override;
        return [{ ...club, hasPro: !!hasPro }];
      }

      // Get all user's clubs
      if (!userRoles) return [];
      const clubIds = new Set<string>();
      userRoles.forEach(role => {
        if (role.club_id) clubIds.add(role.club_id);
      });

      const teamIds = userRoles.filter(r => r.team_id).map(r => r.team_id) as string[];
      if (teamIds.length > 0) {
        const { data: teamsData } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        teamsData?.forEach(t => {
          if (t.club_id) clubIds.add(t.club_id);
        });
      }

      if (clubIds.size === 0) return [];

      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name, logo_url")
        .in("id", Array.from(clubIds));

      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("club_id", Array.from(clubIds));

      return (clubs || []).map(club => {
        const sub = subscriptions?.find(s => s.club_id === club.id);
        const hasPro = sub?.is_pro || sub?.is_pro_football || sub?.admin_pro_override || sub?.admin_pro_football_override;
        return { ...club, hasPro: !!hasPro };
      });
    },
    enabled: !!user,
  });

  // Fetch rewards for selected club
  const { data: availableRewards = [], isLoading: rewardsLoading } = useQuery({
    queryKey: ["home-available-rewards", selectedRewardClubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_rewards")
        .select("*, sponsors(id, name, logo_url)")
        .eq("club_id", selectedRewardClubId!)
        .eq("is_active", true)
        .neq("reward_type", "player_of_match")
        .order("points_required", { ascending: true });
      return data || [];
    },
    enabled: !!selectedRewardClubId,
  });

  // Fetch the minimum reward threshold across user's clubs
  const { data: minRewardThreshold = null } = useQuery<number | null>({
    queryKey: ["min-reward-threshold", rewardClubs.map((c: any) => c.id)],
    queryFn: async () => {
      const proClubIds = rewardClubs.filter((c: any) => isAppAdmin || c.hasPro).map((c: any) => c.id);
      if (proClubIds.length === 0) return null;
      const { data } = await supabase
        .from("club_rewards")
        .select("points_required")
        .in("club_id", proClubIds)
        .eq("is_active", true)
        .neq("reward_type", "player_of_match")
        .order("points_required", { ascending: true })
        .limit(1);
      return data?.[0]?.points_required ?? null;
    },
    enabled: rewardClubs.length > 0,
  });

  const { data: userChildren = [] } = useQuery({
    queryKey: ["user-children-home", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("children")
        .select("id, name, ignite_points")
        .eq("parent_id", user!.id)
        .order("name");
      return data || [];
    },
    enabled: !!user,
  });

  // Handle opening rewards dialog
  const handleBrowseRewards = () => {
    const proClubs = rewardClubs.filter((club: any) => isAppAdmin || club.hasPro);
    
    // In club mode with single Pro club, auto-select it
    if (activeClubFilter && proClubs.length === 1) {
      setSelectedRewardClubId(proClubs[0].id);
      setRewardsDialogOpen(true);
    } else if (proClubs.length === 1) {
      // Only one Pro club total
      setSelectedRewardClubId(proClubs[0].id);
      setRewardsDialogOpen(true);
    } else if (proClubs.length > 1) {
      // Multiple clubs - show club selection first
      setRewardsDialogOpen(true);
    }
  };

  // Redeem mutation
  const redeemMutation = useMutation({
    mutationFn: async ({ reward, forChildId }: { reward: any; forChildId: string | null }) => {
      let pointsSource: { id: string; points: number; isChild: boolean };
      let childName: string | null = null;
      
      if (forChildId) {
        const child = userChildren.find(c => c.id === forChildId);
        if (!child) throw new Error("Child not found");
        if (child.ignite_points < reward.points_required) {
          throw new Error(`${child.name} doesn't have enough points`);
        }
        pointsSource = { id: forChildId, points: child.ignite_points, isChild: true };
        childName = child.name;
      } else {
        const currentPoints = profile?.ignite_points || 0;
        if (currentPoints < reward.points_required) {
          throw new Error("Not enough points");
        }
        pointsSource = { id: user!.id, points: currentPoints, isChild: false };
      }

      const { error: redemptionError } = await supabase
        .from("reward_redemptions")
        .insert({
          user_id: user!.id,
          reward_id: reward.id,
          club_id: reward.club_id,
          points_spent: reward.points_required,
          child_id: forChildId,
        });

      if (redemptionError) throw redemptionError;

      const remainingPoints = pointsSource.points - reward.points_required;

      if (pointsSource.isChild) {
        const { error: updateError } = await supabase
          .from("children")
          .update({ ignite_points: remainingPoints })
          .eq("id", pointsSource.id);
        if (updateError) throw updateError;

        // Record in points history for child
        await recordPointsHistory({
          childId: pointsSource.id,
          clubId: reward.club_id,
          amount: -reward.points_required,
          balanceAfter: remainingPoints,
          sourceType: 'redemption',
          sourceId: reward.id,
          description: `Redeemed: ${reward.name}`,
        });
      } else {
         const { error: updateError } = await supabase
           .from("profiles")
           .update({
             ignite_points: remainingPoints,
           })
           .eq("id", user!.id);
        if (updateError) throw updateError;

        // Record in points history
        await recordPointsHistory({
          userId: user!.id,
          clubId: reward.club_id,
          amount: -reward.points_required,
          balanceAfter: remainingPoints,
          sourceType: 'redemption',
          sourceId: reward.id,
          description: `Redeemed: ${reward.name}`,
        });
      }

      // Get club details for email
      const { data: club } = await supabase
        .from("clubs")
        .select("name, logo_url")
        .eq("id", reward.club_id)
        .single();

      // Send email notification
      try {
        await supabase.functions.invoke('send-reward-redeemed-email', {
          body: {
            recipientUserId: user!.id,
            rewardName: reward.name,
            pointsSpent: reward.points_required,
            remainingPoints,
            clubName: club?.name || 'Your Club',
            rewardDescription: reward.description,
            sponsorName: reward.sponsors?.name,
            showQrCode: reward.show_qr_code,
            clubLogoUrl: club?.logo_url,
            rewardLogoUrl: reward.logo_url,
            redeemedForChildName: childName || undefined,
          },
        });
      } catch (emailErr) {
        console.error("Failed to send reward redeemed email:", emailErr);
        // Don't throw - redemption was still successful
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-redemptions-home"] });
      queryClient.invalidateQueries({ queryKey: ["user-children-home"] });
      refreshProfile();
      setConfirmRedeemDialogOpen(false);
      setSelectedReward(null);
      setSelectedRedeemFor("myself");
      setRewardsDialogOpen(false);
      setSelectedRewardClubId(null);
      toast({
        title: "Reward Redeemed!",
        description: "Show this to a club admin to claim your reward.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to redeem reward",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
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
      
      // Get all members who should RSVP - handle mini-league events differently
      let allMemberIds: string[] = [];
      
      if (eventToRemind.mini_league_id) {
        // Get mini league to find the club_id
        const { data: league } = await supabase
          .from("mini_leagues")
          .select("club_id")
          .eq("id", eventToRemind.mini_league_id)
          .single();
        
        if (league) {
          // Get all parent user IDs from mini league players
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", eventToRemind.mini_league_id)
            .not("parent_user_id", "is", null);
          
          const parentIds = (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[]) || [];
          
          // Get club admins, league admins, and coaches
          const { data: adminRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin", "coach"]);
          
          const adminIds = adminRoles?.map(r => r.user_id) || [];
          
          allMemberIds = [...new Set([...parentIds, ...adminIds])];
        }
      } else {
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (eventToRemind.team_id) {
          memberQuery = memberQuery.eq("team_id", eventToRemind.team_id);
        } else {
          memberQuery = memberQuery.eq("club_id", eventToRemind.club_id);
        }
        
        const { data: allMembers } = await memberQuery;
        allMemberIds = [...new Set(allMembers?.map(m => m.user_id) || [])];
      }
      
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
        description: count ? `${count} member${count === 1 ? '' : 's'} reminded to RSVP` : "Reminders have been sent",
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

  const { data: clubs, error: clubsError, isLoading: clubsLoading } = useQuery({
    queryKey: ["all-clubs"],
    queryFn: async () => {
      console.log("[HomePage] Fetching all clubs...");
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name, sport, class_mode_enabled")
        .order("name");
      if (error) {
        console.error("[HomePage] Error fetching clubs:", error);
        throw error;
      }
      console.log("[HomePage] Fetched clubs:", data?.length);
      return data as Club[];
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const { data: teams, error: teamsError, isLoading: teamsLoading } = useQuery({
    queryKey: ["all-teams"],
    queryFn: async () => {
      console.log("[HomePage] Fetching all teams...");
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, club_id, clubs (name, sport)")
        .order("name");
      if (error) {
        console.error("[HomePage] Error fetching teams:", error);
        throw error;
      }
      console.log("[HomePage] Fetched teams:", data?.length);
      return data as Team[];
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Fetch all mini leagues for join request dropdown
  const { data: miniLeagues, error: miniLeaguesError } = useQuery({
    queryKey: ["all-mini-leagues"],
    queryFn: async () => {
      console.log("[HomePage] Fetching all mini leagues...");
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("id, name, club_id, clubs (name, sport)")
        .order("name");
      if (error) {
        console.error("[HomePage] Error fetching mini leagues:", error);
        throw error;
      }
      console.log("[HomePage] Fetched mini leagues:", data?.length);
      return data as MiniLeague[];
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
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
          if (t.club_id && proFootballClubIds.has(t.club_id)) {
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
          if (t.club_id && proFootballClubIds.has(t.club_id)) {
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

  // Only show teams where user has EDIT access (coach/team_admin) - not read-only teams
  // View-only users can still access pitch boards via event detail page or timer widget
  const allAvailableTeams = [
    ...(mySoccerTeams || []).map(t => ({ ...t, readOnly: false })),
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

  // Listen for notification-triggered pitch board opens
  useEffect(() => {
    const handleOpenPitchBoard = () => {
      try {
        const timerStateRaw = localStorage.getItem('pitch-board-timer-state');
        if (!timerStateRaw) return;
        const parsed = JSON.parse(timerStateRaw);
        if (parsed?.teamId && parsed?.teamName) {
          openPitchBoard(parsed.teamId, parsed.teamName, false);
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('open-pitch-board', handleOpenPitchBoard);
    return () => window.removeEventListener('open-pitch-board', handleOpenPitchBoard);
  }, []);

  const clubRequestMutation = useMutation({
    mutationFn: async () => {
      // Use activeClubFilter if in club mode, otherwise use selectedClub
      const clubToJoin = activeClubFilter || selectedClub;
      if (!clubToJoin) throw new Error("No club selected");
      
      const { error } = await supabase.from("role_requests").insert({
        user_id: user!.id,
        club_id: clubToJoin,
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

  // Check if user already has the SPECIFIC role they're requesting in the selected team/league
  const hasExistingTeamRole = !isLeagueSelected && selectedTeam && selectedTeamRole && userRoles?.some(r => r.team_id === selectedTeam && r.role === selectedTeamRole);
  
  // Check if user already has the league role (league roles are stored with club_id)
  const selectedLeagueData = actualLeagueId ? miniLeagues?.find(l => l.id === actualLeagueId) : null;
  const hasExistingLeagueRole = isLeagueSelected && actualLeagueId && selectedLeagueRole && userRoles?.some(r => r.club_id === selectedLeagueData?.club_id && r.role === selectedLeagueRole);

  const teamRequestMutation = useMutation({
    mutationFn: async () => {
      if (isLeagueSelected && actualLeagueId) {
        // Handle league join request
        const league = miniLeagues?.find((l) => l.id === actualLeagueId);
        if (!league) throw new Error("League not found");
        
        // Check for existing role
        if (userRoles?.some(r => r.club_id === league.club_id && r.role === selectedLeagueRole)) {
          throw new Error("You already have this role in this league");
        }
        
        const { error } = await supabase.from("role_requests").insert({
          user_id: user!.id,
          mini_league_id: actualLeagueId,
          club_id: league.club_id,
          role: selectedLeagueRole,
          status: "pending",
        });
        if (error) throw error;
      } else {
        // Handle team join request
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
      }
    },
    onSuccess: () => {
      toast({
        title: "Request Submitted",
        description: isLeagueSelected 
          ? "Your league join request has been submitted for review."
          : "Your team join request has been submitted for review.",
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

  // Don't block entire page on events loading - show skeleton/loading state inline instead
  // This prevents the "double flash" issue on login where the page loads, then shows loading, then loads again

  return (
    <div className="py-6 space-y-5">
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
        
        // Check if user has EDIT access (coach or team_admin of THIS team, club_admin of team's club, or app_admin)
        const hasEditAccess = isAppAdmin || isClubAdminOfTeam || userRoles?.some(r => 
          r.team_id === timerTeamId && (r.role === "coach" || r.role === "team_admin")
        );
        
        return (
          <GameTimerWidget 
            onOpenPitchBoard={(teamId, teamName) => openPitchBoard(teamId, teamName, !hasEditAccess)}
            readOnly={!hasEditAccess}
          />
        );
      })()}

      {/* Mini League Live Matches Widget */}
      <MiniLeagueGameWidgets activeClubFilter={activeClubFilter} />

      {/* Account Recovery Banner */}
      {user && (
        <AccountRecoveryBanner 
          userId={user.id} 
          onRecovered={() => queryClient.invalidateQueries()}
        />
      )}

      {/* Native App Download Banner - for mobile browser users */}
      <NativeAppDownloadBanner />

      {/* Upcoming Schedule - #1 use case */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Upcoming Schedule</h2>
          <Link to="/events" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>

        <div aria-live="polite" aria-busy={isLoading} aria-label={`Upcoming schedule${events?.length ? `, ${events.length} event${events.length === 1 ? '' : 's'}` : ''}`}>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="space-y-2 animate-pulse">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-16 bg-muted rounded" />
                      <div className="h-4 w-24 bg-muted rounded" />
                    </div>
                    <div className="h-5 w-48 bg-muted rounded" />
                    <div className="h-4 w-32 bg-muted rounded" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : events?.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Nothing scheduled</p>
              <p className="text-sm text-muted-foreground mt-1">
                {userClubs && userClubs.length > 0 
                  ? "Nothing scheduled yet" 
                  : "Join a club or create one to see your schedule"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {events?.map((event) => {
              const typeColorMap: Record<string, string> = {
                game: 'border-l-destructive',
                training: 'border-l-primary',
                social: 'border-l-warning',
              };
              const typeBorderClass = typeColorMap[event.type] || 'border-l-primary';
              
              return (
              <Card 
                key={event.id} 
                className={`hover:border-primary/50 transition-colors border-l-4 ${typeBorderClass} ${event.is_cancelled ? 'opacity-60' : ''}`}
                role="article"
                aria-label={`${event.title}${event.is_cancelled ? ' (cancelled)' : ''}, ${formatEventDate(event.event_date)}`}
              >
                <CardContent className="p-4">
                  {/* Line 1: Title + Club/Team badge + RSVP */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Link to={`/events/${event.id}`} className="font-semibold truncate hover:text-primary transition-colors">
                        {event.title}{event.opponent ? ` vs ${event.opponent}` : ''}
                      </Link>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {event.teams?.name || event.clubs?.name}
                      </Badge>
                      {event.is_cancelled && (
                        <Badge variant="destructive" className="text-xs shrink-0">
                          Cancelled
                        </Badge>
                      )}
                    </div>
                    <button
                      className="flex items-center text-xs font-medium hover:opacity-80 transition-opacity shrink-0"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setQuickRsvpEvent(event);
                      }}
                      aria-label={`RSVP status: ${getUserRsvpStatus(event.id) || 'No response'}. Tap to change.`}
                    >
                      {getRsvpIcon(getUserRsvpStatus(event.id))}
                    </button>
                  </div>
                  {/* Line 2: Date + Location + Admin actions */}
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground min-w-0">
                      <span className="flex items-center gap-1 shrink-0">
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatEventDate(event.event_date)}
                      </span>
                      {(event.location_name || event.suburb) && (
                        <span className="flex items-center gap-1 truncate">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{event.location_name || event.suburb}</span>
                        </span>
                      )}
                    </div>
                    {/* Admin actions */}
                    {(isAppAdmin || userRoles?.some(r => 
                      (r.team_id === event.team_id && (r.role === "coach" || r.role === "team_admin")) ||
                      (r.club_id === event.club_id && r.role === "club_admin") ||
                      (r.role === "league_admin" && r.club_id === event.club_id)
                    )) && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            navigate(`/events/${event.id}/edit`);
                          }}
                          aria-label={`Edit ${event.title}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {!event.is_cancelled && (
                          <>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="h-7 w-7"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setLoadingRemindCount(true);
                                
                                const { data: rsvps } = await supabase
                                  .from("rsvps")
                                  .select("user_id")
                                  .eq("event_id", event.id)
                                  .is("child_id", null);
                                const rsvpUserIds = rsvps?.map(r => r.user_id) || [];
                                
                                let allMemberIds: string[] = [];
                                
                                if (event.mini_league_id) {
                                  const { data: players } = await supabase
                                    .from("mini_league_players")
                                    .select("parent_user_id")
                                    .eq("mini_league_id", event.mini_league_id);
                                  const parentIds = players?.map(p => p.parent_user_id).filter(Boolean) as string[] || [];
                                  
                                  const { data: league } = await supabase
                                    .from("mini_leagues")
                                    .select("club_id")
                                    .eq("id", event.mini_league_id)
                                    .single();
                                  
                                  if (league) {
                                    const { data: adminRoles } = await supabase
                                      .from("user_roles")
                                      .select("user_id")
                                      .eq("club_id", league.club_id)
                                      .in("role", ["club_admin", "league_admin", "coach"]);
                                    
                                    const adminIds = adminRoles?.map(r => r.user_id) || [];
                                    allMemberIds = [...new Set([...parentIds, ...adminIds])];
                                  }
                                } else {
                                  let memberQuery = supabase.from("user_roles").select("user_id");
                                  if (event.team_id) {
                                    memberQuery = memberQuery.eq("team_id", event.team_id);
                                  } else {
                                    memberQuery = memberQuery.eq("club_id", event.club_id);
                                  }
                                  
                                  const { data: members } = await memberQuery;
                                  allMemberIds = [...new Set(members?.map(m => m.user_id) || [])];
                                }
                                const count = allMemberIds.filter(id => !rsvpUserIds.includes(id)).length;
                                
                                setNonRsvpCount(count);
                                setEventToRemind(event);
                                setRemindDialogOpen(true);
                                setLoadingRemindCount(false);
                              }}
                            >
                              {loadingRemindCount ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Bell className="h-3 w-3" />
                              )}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="h-7 w-7 text-warning"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEventToCancel(event);
                                setCancelDialogOpen(true);
                              }}
                            >
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEventToDelete(event);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
        </div>
      </section>

      {/* My Teams & Leagues */}
      <MyTeamsScroll />

      {/* Upcoming Classes Widget - for parents with enrolled children */}
      <UpcomingClassesWidget />

      {/* Quick Actions - Role-aware smart grid */}
      {(() => {
        const canCreateTeam = true; // All users can create teams (non-admins go through approval)
        const canCreateEvents = isAppAdmin || userRoles?.some(r => 
          ['club_admin', 'team_admin', 'coach', 'league_admin', 'committee_member'].includes(r.role)
        );
        const hasVaultRoleAccess = isAppAdmin || userRoles?.some(r => 
          ['club_admin', 'team_admin', 'coach', 'league_admin', 'committee_member'].includes(r.role)
        );
        const canAccessVault = (hasProAccess || isAppAdmin) && hasVaultRoleAccess;

        // Build actions list dynamically
        const actions: { key: string; icon: React.ReactNode; label: string; onClick: () => void }[] = [];

        // Join Team - always visible
        actions.push({
          key: "join",
          icon: <UserCheck className="h-5 w-5 text-foreground" aria-hidden="true" />,
          label: activeClubFilter && clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled ? "Join Class" : "Join Team",
          onClick: () => setTeamDialogOpen(true),
        });

        // Create Event - admin/coach only
        if (canCreateEvents) {
          actions.push({
            key: "event",
            icon: <Plus className="h-5 w-5 text-foreground" aria-hidden="true" />,
            label: "New Event",
            onClick: () => navigate('/events/new'),
          });
        }

        // File Vault - Pro + admin role
        if (canAccessVault) {
          actions.push({
            key: "vault",
            icon: <FolderOpen className="h-5 w-5 text-foreground" aria-hidden="true" />,
            label: "File Vault",
            onClick: () => navigate("/vault"),
          });
        }

        // Create Team - available to all users
        actions.push({
          key: "create-team",
          icon: <UserPlus className="h-5 w-5 text-foreground" aria-hidden="true" />,
          label: activeClubFilter ? "Create Team" : "Create Team or Club",
          onClick: () => {
            if (activeClubFilter) {
              navigate(`/clubs/${activeClubFilter}`, { state: { fromCreateTeam: true } });
            } else {
              navigate("/clubs", { state: { fromCreateTeam: true } });
            }
          },
        });

        if (actions.length === 0) return null;

        // Use 2 columns for 2+ actions, single column for 1
        const gridCols = actions.length >= 2 ? "grid-cols-2" : "grid-cols-1";

        return (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Quick Actions</h2>
            <div className={`grid ${gridCols} gap-3`}>
              {actions.map(action => (
                <Button
                  key={action.key}
                  variant="outline"
                  className="w-full h-auto min-h-[4rem] py-4 flex flex-col gap-2"
                  aria-label={action.label}
                  onClick={action.onClick}
                >
                  {action.icon}
                  <span className="text-sm">{action.label}</span>
                </Button>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Pitch Boards - below Quick Actions */}
      {displayedTeams.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pitch Boards</h2>
            {sortedTeams.length > 2 && (
              <button 
                onClick={() => setPitchBoardsExpanded(!pitchBoardsExpanded)}
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                aria-expanded={pitchBoardsExpanded}
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
                role="button"
                tabIndex={0}
                aria-label={`Open pitch board for ${team.name}${team.readOnly ? ' (view only)' : ''}`}
                onClick={() => openPitchBoard(team.id, team.name, team.readOnly)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openPitchBoard(team.id, team.name, team.readOnly);
                  }
                }}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 relative">
                  {team.readOnly && (
                    <Badge variant="secondary" className="absolute top-1 right-1 text-xs px-1 py-0">
                      View
                    </Badge>
                  )}
                  <LayoutGrid className="h-6 w-6 text-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium text-center w-full" title={team.name}>
                    <span className="block truncate">{team.name}</span>
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

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
            {/* Only show club selector if not in club mode */}
            {!activeClubFilter ? (
              <MobileCardSelect
                value={selectedClub}
                onValueChange={setSelectedClub}
                options={clubs?.map((club) => ({
                  value: club.id,
                  label: club.name,
                  icon: <span>{getSportEmoji(club.sport)}</span>,
                })) || []}
                label={`Select Club ${clubs ? `(${clubs.length} available)` : "(loading...)"}`}
                placeholder="Choose a club..."
                searchable
                searchPlaceholder="Search clubs..."
                emptyMessage={clubsLoading ? "Loading clubs..." : clubsError ? `Error: ${clubsError.message}` : "No clubs found."}
              />
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Club</label>
                <div className="flex items-center gap-2 p-4 rounded-xl border-2 border-primary bg-primary/5">
                  <span>{getSportEmoji(clubs?.find(c => c.id === activeClubFilter)?.sport)}</span>
                  <span className="font-medium">{clubs?.find(c => c.id === activeClubFilter)?.name}</span>
                </div>
              </div>
            )}
            <MobileCardSelect
              value={selectedClubRole}
              onValueChange={(v) => setSelectedClubRole(v as ClubRole)}
              options={clubRoleOptions}
              label="Select Role"
              placeholder="Choose a role..."
            />
          </div>
          <ResponsiveDialogFooter>
            <Button
              className="w-full sm:w-auto"
              onClick={() => clubRequestMutation.mutate()}
              disabled={!(activeClubFilter || selectedClub) || clubRequestMutation.isPending}
            >
              {clubRequestMutation.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {activeClubFilter && clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled ? "Request to Join Class" : "Request to Join Team"}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {activeClubFilter && clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled
                ? "Select a class and role to request membership."
                : "Select a team and role to request membership."}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 pt-4">
            {/* Only show club filter if not in club mode */}
            {!activeClubFilter && (
              <MobileCardSelect
                value={selectedClubForTeam || "all"}
                onValueChange={(v) => {
                  setSelectedClubForTeam(v);
                  setSelectedTeam(""); // Reset selection when club changes
                }}
                options={[
                  { value: "all", label: "All clubs" },
                  ...(clubs?.map((club) => ({
                    value: club.id,
                    label: club.name,
                    icon: <span>{getSportEmoji(club.sport)}</span>,
                  })) || [])
                ]}
                label="Select Club (optional)"
                placeholder="All clubs..."
                searchable
                searchPlaceholder="Search clubs..."
                emptyMessage="No clubs found."
              />
            )}
            <MobileCardSelect
              value={selectedTeam}
              onValueChange={setSelectedTeam}
              options={[
                // Teams section
                ...(teams
                  ?.filter(team => {
                    if (activeClubFilter) {
                      return team.club_id === activeClubFilter;
                    }
                    return !selectedClubForTeam || selectedClubForTeam === "all" || team.club_id === selectedClubForTeam;
                  })
                  .map((team) => ({
                    value: team.id,
                    label: activeClubFilter ? team.name : `${team.name} (${team.clubs?.name})`,
                    icon: <span>{getSportEmoji(team.clubs?.sport)}</span>,
                  })) || []),
                // Mini Leagues section - prefixed with "league_" to distinguish from teams
                ...(miniLeagues
                  ?.filter(league => {
                    if (activeClubFilter) {
                      return league.club_id === activeClubFilter;
                    }
                    return !selectedClubForTeam || selectedClubForTeam === "all" || league.club_id === selectedClubForTeam;
                  })
                  .map((league) => ({
                    value: `league_${league.id}`,
                    label: activeClubFilter 
                      ? `⭐ ${league.name} (League)` 
                      : `⭐ ${league.name} (${league.clubs?.name}) - League`,
                    icon: <span>⭐</span>,
                  })) || []),
              ]}
              label={activeClubFilter && clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled ? "Select Class" : "Select Team"}
              placeholder={activeClubFilter && clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled ? "Choose a class..." : "Choose a team..."}
              searchable
              searchPlaceholder={activeClubFilter && clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled ? "Search classes..." : "Search teams..."}
              emptyMessage={activeClubFilter && clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled ? "No classes found." : "No teams found."}
            />
            {isLeagueSelected ? (
              <MobileCardSelect
                value={selectedLeagueRole}
                onValueChange={(v) => setSelectedLeagueRole(v as LeagueRole)}
                options={leagueRoleOptions}
                label="Select Role"
                placeholder="Choose a role..."
              />
            ) : (
              <MobileCardSelect
                value={selectedTeamRole}
                onValueChange={(v) => setSelectedTeamRole(v as TeamRole)}
                options={teamRoleOptions}
                label="Select Role"
                placeholder="Choose a role..."
              />
            )}
          </div>
          <ResponsiveDialogFooter>
            {(hasExistingTeamRole || hasExistingLeagueRole) && (
              <p className="text-sm text-destructive mb-2">
                You already have this role in this {isLeagueSelected ? "league" : "team"}
              </p>
            )}
            <Button
              className="w-full sm:w-auto"
              onClick={() => teamRequestMutation.mutate()}
              disabled={!selectedTeam || teamRequestMutation.isPending || hasExistingTeamRole || hasExistingLeagueRole}
            >
              {teamRequestMutation.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Points & Rewards - Compact Banner */}
      <section className="space-y-1">
        <Card className="border bg-card">
          <CardContent className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-primary/15">
                  <Flame className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-muted-foreground">{(userClubs[0] as any)?.points_display_name || 'Ignite Points'}</span>
                    {showProBadge && (
                      <Badge variant="outline" className="text-[10px] py-0 h-4 border-muted-foreground/30">
                        <Lock className="h-2.5 w-2.5 mr-0.5" />
                        Pro
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold">{profile?.ignite_points || 0}</span>
                    {minRewardThreshold !== null && (profile?.ignite_points || 0) < minRewardThreshold && (
                      <span className="text-xs text-muted-foreground">
                        · {minRewardThreshold - (profile?.ignite_points || 0)} to next reward
                      </span>
                    )}
                    {minRewardThreshold !== null && (profile?.ignite_points || 0) >= minRewardThreshold && (
                      <span className="text-xs text-primary font-medium">
                        · Rewards available!
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {latestPendingRedemption ? (
                  <Button
                    size="sm"
                    className="bg-amber-500 hover:bg-amber-600 text-white gap-1 h-8 text-xs"
                    onClick={() => setClaimDialogOpen(true)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Claim
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 h-8 text-xs text-muted-foreground hover:text-foreground"
                    onClick={handleBrowseRewards}
                  >
                    <Gift className="h-3.5 w-3.5" />
                    Browse
                  </Button>
                )}
              </div>
            </div>
            {minRewardThreshold !== null && (profile?.ignite_points || 0) < minRewardThreshold && (
              <div className="mt-2">
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, ((profile?.ignite_points || 0) / minRewardThreshold) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {latestPendingRedemption && (
              <p className="text-xs text-muted-foreground mt-1.5">
                🎁 Ready to claim: {latestPendingRedemption.club_rewards?.name}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Reward Claim QR Dialog */}
      {latestPendingRedemption && user && (
        <RewardClaimQRDialog
          open={rewardQROpen}
          onOpenChange={setRewardQROpen}
          rewardName={latestPendingRedemption.club_rewards?.name || "Reward"}
          clubName={latestPendingRedemption.clubs?.name || "Club"}
          redemptionId={latestPendingRedemption.id}
          qrCodeUrl={latestPendingRedemption?.club_rewards?.qr_code_url || null}
          userName={profile?.display_name || undefined}
          userId={user.id}
        />
      )}

      {/* Rewards Browse Dialog */}
      <ResponsiveDialog 
        open={rewardsDialogOpen} 
        onOpenChange={(open) => {
          setRewardsDialogOpen(open);
          if (!open) {
            setSelectedRewardClubId(null);
          }
        }}
      >
        <ResponsiveDialogContent className="max-w-md sm:max-h-[85vh]">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" />
              {selectedRewardClubId ? "Available Rewards" : "Select Club"}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {selectedRewardClubId 
                ? `You have ${profile?.ignite_points || 0} points${userChildren.length > 0 ? " (+ children's points)" : ""}`
                : "Choose a club to view rewards"
              }
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          
          <div className="flex-1 overflow-y-auto space-y-3 pt-2 pb-4">
            {!selectedRewardClubId ? (
              // Club selection view
              <div className="space-y-2">
                {rewardClubs.filter((club: any) => isAppAdmin || club.hasPro).map((club: any) => (
                  <button
                    key={club.id}
                    onClick={() => setSelectedRewardClubId(club.id)}
                    className="flex items-center justify-between w-full p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left"
                  >
                    <span className="font-medium">{club.name}</span>
                    <Gift className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
                {rewardClubs.filter((club: any) => isAppAdmin || club.hasPro).length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No clubs with Pro subscription found.
                  </p>
                )}
              </div>
            ) : rewardsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : availableRewards.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No rewards available yet. Check back later!
              </p>
            ) : (
              <div className="space-y-2">
                {availableRewards.map((reward: any) => {
                  const currentPoints = profile?.ignite_points || 0;
                  const canAfford = currentPoints >= reward.points_required ||
                    userChildren.some((c: any) => c.ignite_points >= reward.points_required);
                  
                  return (
                    <button
                      key={reward.id}
                      onClick={() => {
                        if (canAfford) {
                          setSelectedReward(reward);
                          setConfirmRedeemDialogOpen(true);
                        }
                      }}
                      disabled={!canAfford}
                      className={`flex items-center justify-between w-full p-3 rounded-lg text-left transition-colors ${
                        canAfford
                          ? "bg-muted/50 hover:bg-muted cursor-pointer"
                          : "bg-muted/20 opacity-60 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{reward.name}</span>
                          {reward.sponsors?.name && (
                            <Badge variant="outline" className="text-xs">
                              {reward.sponsors.name}
                            </Badge>
                          )}
                        </div>
                        {reward.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{reward.description}</p>
                        )}
                      </div>
                      <Badge variant={canAfford ? "default" : "secondary"} className="ml-2 shrink-0">
                        {reward.points_required} pts
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Confirm Redeem Dialog */}
      <AlertDialog 
        open={confirmRedeemDialogOpen} 
        onOpenChange={(open) => {
          if (!redeemMutation.isPending) {
            setConfirmRedeemDialogOpen(open);
            if (!open) {
              setSelectedReward(null);
              setSelectedRedeemFor("myself");
            }
          }
        }}
      >
        <AlertDialogContent className="z-[200]">
          <AlertDialogHeader>
            <AlertDialogTitle>Redeem Reward?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm redemption of <strong>{selectedReward?.name}</strong> for{" "}
              <strong>{selectedReward?.points_required} points</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {userChildren.length > 0 && (
            <div className="space-y-2 py-2">
              <Label>Redeem for</Label>
              <Select value={selectedRedeemFor} onValueChange={setSelectedRedeemFor}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="myself">
                    Myself ({profile?.ignite_points || 0} pts)
                  </SelectItem>
                  {userChildren.map((child: any) => (
                    <SelectItem key={child.id} value={child.id}>
                      {child.name} ({child.ignite_points} pts)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          
          <AlertDialogFooter>
            <AlertDialogCancel disabled={redeemMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={() => {
                if (selectedReward) {
                  const forChildId = selectedRedeemFor === "myself" ? null : selectedRedeemFor;
                  redeemMutation.mutate({ reward: selectedReward, forChildId });
                }
              }}
              disabled={redeemMutation.isPending}
            >
              {redeemMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Gift className="h-4 w-4 mr-2" />
              )}
              {redeemMutation.isPending ? "Redeeming..." : "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pro Upgrade Card */}
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

      {/* My Soccer Teams - Pitch Board Access (last 2 used) */}
      {displayedTeams.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pitch Boards</h2>
            {sortedTeams.length > 2 && (
              <button 
                onClick={() => setPitchBoardsExpanded(!pitchBoardsExpanded)}
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                aria-expanded={pitchBoardsExpanded}
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
                role="button"
                tabIndex={0}
                aria-label={`Open pitch board for ${team.name}${team.readOnly ? ' (view only)' : ''}`}
                onClick={() => openPitchBoard(team.id, team.name, team.readOnly)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openPitchBoard(team.id, team.name, team.readOnly);
                  }
                }}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 relative">
                  {team.readOnly && (
                    <Badge variant="secondary" className="absolute top-1 right-1 text-xs px-1 py-0">
                      View
                    </Badge>
                  )}
                  <LayoutGrid className="h-6 w-6 text-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium text-center w-full" title={team.name}>
                    <span className="block truncate">{team.name}</span>
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Club Sponsor Section - shown when a club is selected (not class-mode), or carousel when no filter */}
      {activeClubFilter ? (
        !clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled && (
          <ClubSponsorSection clubId={activeClubFilter} />
        )
      ) : (
        <MultiClubSponsorCarousel />
      )}
      
      {/* App Ads - shown when configured, may override or supplement sponsor carousel */}
      {!(activeClubFilter && clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled) && (
        <SponsorOrAdCarousel location="home" activeClubFilter={activeClubFilter} />
      )}

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
          title={`Delete ${getEventTypeLabel(eventToDelete?.type, { miniLeagueId: eventToDelete?.mini_league_id })}?`}
          description={`This will permanently delete the ${getEventTypeLabel(eventToDelete?.type, { miniLeagueId: eventToDelete?.mini_league_id }).toLowerCase()}(s) and all RSVPs. This action cannot be undone.`}
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
              <AlertDialogTitle>Delete {getEventTypeLabel(eventToDelete?.type, { miniLeagueId: eventToDelete?.mini_league_id })}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this {getEventTypeLabel(eventToDelete?.type, { miniLeagueId: eventToDelete?.mini_league_id }).toLowerCase()} and all RSVPs. This action cannot be undone.
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
          miniLeagueId={eventToCancel?.mini_league_id}
          eventType={eventToCancel?.type}
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
          miniLeagueId={eventToCancel?.mini_league_id}
          eventType={eventToCancel?.type}
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
          clubId={quickRsvpEvent.club_id}
          clubName={quickRsvpEvent.clubs?.name || "Your club"}
          eventAmount={quickRsvpEvent.amount}
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
