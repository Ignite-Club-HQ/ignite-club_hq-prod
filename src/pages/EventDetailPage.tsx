import { useState, useEffect, lazy, Suspense, useRef } from "react";
import { Share } from "@capacitor/share";
import { createMemberCheckout, listenForPaymentStatus } from "@/lib/memberCheckout";
import { Capacitor } from "@capacitor/core";
import { getShareUrl } from "@/lib/shareUtils";
import { defaultMinutesPerHalfForTeamName } from "@/lib/teamAgeDefaults";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, MapPin, Users, CheckCircle2, Circle, Loader2, Plus, Trash2, UserPlus, MessageSquare, Baby, Pencil, XCircle, Bell, DollarSign, Check, Share2, Play, Flame, MoreVertical, Eye, ChevronDown, CalendarPlus, Shield, Trophy, Hand, Lock } from "lucide-react";
import { exportEventIcs } from "@/lib/icsExport";
import { queueRsvp } from "@/lib/rsvpQueue";
import { TrainingDefaultControl } from "@/components/event/TrainingDefaultControl";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { RecurringEventActionDialog } from "@/components/RecurringEventActionDialog";
import { CancelEventConfirmDialog } from "@/components/CancelEventConfirmDialog";
import { RecurringCancelEventDialog } from "@/components/RecurringCancelEventDialog";
import { AddDutySheet } from "@/components/AddDutySheet";
import { AssignDutySheet } from "@/components/AssignDutySheet";
import PlayerOfMatchSelector from "@/components/PlayerOfMatchSelector";
import MatchCaptainSelector from "@/components/MatchCaptainSelector";
import MatchGoalkeepersSelector from "@/components/MatchGoalkeepersSelector";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { friendlyMutationError } from "@/lib/friendlyMutationError";
import { ToastAction } from "@/components/ui/toast";
import { format, parseISO, isSameDay } from "date-fns";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";
import { EventSponsorsSection } from "@/components/EventSponsorsSection";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";
import { EventGuestsManager } from "@/components/EventGuestsManager";
import { EventGroupsManager } from "@/components/EventGroupsManager";
import { AttendanceSection } from "@/components/event/AttendanceSection";
import { useEventViewTracking } from "@/hooks/useEventViews";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { resolveRsvpAudience, shouldPromptParent, shouldPromptPlayer, isParentFirstEvent } from "@/lib/rsvpAudience";

import { AdminRsvpChanger } from "@/components/event/AdminRsvpChanger";

import { AttendanceRow } from "@/components/event/AttendanceRow";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
import { PostRsvpNotificationPrompt } from "@/components/PostRsvpNotificationPrompt";
import { formatMatchArrivalTime, getMatchArrivalMinutes, getMatchArrivalDate } from "@/lib/matchArrivalTime";
import { formatRelativePast } from "@/lib/formatRelativeTime";
import { MatchScoreCard } from "@/components/event/MatchScoreCard";
import { EventNoteSection } from "@/components/event/EventNoteSection";


// Lazy load PitchBoard for game events
const PitchBoard = lazy(() => import("@/components/pitch/PitchBoard"));
const NetballBoard = lazy(() => import("@/components/netball/NetballBoard"));
const BasketballBoard = lazy(() => import("@/components/basketball/BasketballBoard"));
import { clearPitchBoardOpenFlag } from "@/components/pitch/pitchBoardOpenFlag";

// Close handler used by all game-board variants. Clears both the React modal
// state AND the persisted "open" flag so PitchBoardResumeRedirect won't
// re-open the board after a phone lock/unlock once the user has explicitly
// closed it from the event page.
const closePitchBoardWithFlag = (setShow: (v: boolean) => void) => () => {
  setShow(false);
  clearPitchBoardOpenFlag();
};
import { isNetballSport, isBasketballSport } from "@/lib/sportDetection";

type EventType = "game" | "training" | "social";
type RsvpStatus = "going" | "maybe" | "not_going";
type DutyStatus = "open" | "completed";

const PRESET_DUTIES = ["Canteen/BBQ", "Linesperson", "Linemarker", "Referee"];

const eventTypeColors: Record<EventType, string> = {
  game: "bg-destructive/20 text-destructive",
  training: "bg-primary/20 text-primary",
  social: "bg-warning/20 text-warning",
};

const rsvpOptions: { value: RsvpStatus; label: string; icon: string }[] = [
  { value: "going", label: "Going", icon: "✅" },
  { value: "maybe", label: "Maybe", icon: "🤔" },
  { value: "not_going", label: "Can't Go", icon: "❌" },
];

const normalizeDutyName = (name: string | null | undefined) => name?.trim().toLowerCase() ?? "";

// Helper component for attendee display with payment status and admin RSVP controls
const AttendeeCard = ({ 
  rsvp, 
  hasPaid, 
  isAdmin, 
  showPrice, 
  onTogglePayment,
  isPending,
  isMiniLeague,
  onChangeStatus,
  currentStatus,
  memberRole,
  isCaptain,
  isPotm,
  isGoalkeeper,
}: {
  rsvp: any; 
  hasPaid?: boolean;
  isAdmin?: boolean;
  showPrice?: boolean;
  onTogglePayment?: () => void;
  isPending?: boolean;
  isMiniLeague?: boolean;
  onChangeStatus?: (status: RsvpStatus) => void;
  currentStatus?: RsvpStatus;
  memberRole?: string;
  isCaptain?: boolean;
  isPotm?: boolean;
  isGoalkeeper?: boolean;
}) => {
  const isChildRsvp = !!rsvp.child_id;
  const isMiniLeaguePlayerRsvp = !!rsvp.mini_league_player_id;
  const displayName = isMiniLeaguePlayerRsvp 
    ? rsvp.mini_league_players?.name 
    : isChildRsvp 
      ? rsvp.children?.name 
      : rsvp.profiles?.display_name;
  const avatarInitial = displayName?.charAt(0)?.toUpperCase() || "?";

  const matchIcons = (isCaptain || isPotm || isGoalkeeper) ? (
    <span className="inline-flex items-center gap-1 shrink-0">
      {isCaptain && (
        <span title="Captain" className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">
          <Shield className="h-3 w-3" />
        </span>
      )}
      {isGoalkeeper && (
        <span title="Goalkeeper" className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Hand className="h-3 w-3" />
        </span>
      )}
      {isPotm && (
        <span title="Player of the Match" className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Trophy className="h-3 w-3" />
        </span>
      )}
    </span>
  ) : null;

  return (
    <AttendanceRow
      name={displayName || "Unknown"}
      avatarUrl={!isChildRsvp && !isMiniLeaguePlayerRsvp ? rsvp.profiles?.avatar_url || null : null}
      avatarFallback={avatarInitial}
      roleLabel={
        isChildRsvp && !isMiniLeague
          ? "Child"
          : !isChildRsvp && !isMiniLeaguePlayerRsvp && memberRole
          ? String(memberRole).replace(/_/g, " ")
          : null
      }
      roleTone={isChildRsvp && !isMiniLeague ? "child" : "neutral"}
      secondaryLine={rsvp.notes || null}
      rightSlot={
        <>
          {matchIcons}
          {showPrice && hasPaid && (
            <Badge variant="default" className="text-[10px] h-5 px-1.5 bg-primary shrink-0">
              <Check className="h-3 w-3 mr-0.5" />
              Paid
            </Badge>
          )}
          {isAdmin && onChangeStatus && currentStatus && (
            <AdminRsvpChanger
              currentStatus={currentStatus}
              playerName={displayName || "Unknown"}
              onChangeStatus={onChangeStatus}
              isPending={isPending}
            />
          )}
          {isAdmin && showPrice && onTogglePayment && (
            <Button
              variant={hasPaid ? "secondary" : "outline"}
              size="sm"
              onClick={onTogglePayment}
              disabled={isPending}
              className="h-8 px-2 shrink-0"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : hasPaid ? (
                <Check className="h-4 w-4" />
              ) : (
                <>
                  <DollarSign className="h-4 w-4 mr-1" />
                  <span className="text-xs">Mark Paid</span>
                </>
              )}
            </Button>
          )}
        </>
      }
    />
  );
};

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addDutyOpen, setAddDutyOpen] = useState(false);
  const [newDutyName, setNewDutyName] = useState("");
  const [selectedPresetDuty, setSelectedPresetDuty] = useState<string>("");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedDutyId, setSelectedDutyId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [showAllRoles, setShowAllRoles] = useState(false);
  
  // Rich RSVP state
  const [rsvpNotes, setRsvpNotes] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [resendDialogOpen, setResendDialogOpen] = useState(false);
  const [showPitchBoard, setShowPitchBoard] = useState(false);
  
  // Mini league player overrides for match generation
  const [playerOverrides, setPlayerOverrides] = useState<Record<string, boolean>>({});
  const isSharingEventRef = useRef(false);
  const [showPostRsvpNudge, setShowPostRsvpNudge] = useState(false);
  const [recentlyReminded, setRecentlyReminded] = useState<Map<string, string>>(new Map());

  // 24-hour reminder cooldown — fetch event_reminder notifications sent in the last 24h
  // so the "Reminded {time ago}" state persists across sessions/devices and we can block re-reminding.
  const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const { data: recentReminderMap } = useQuery({
    queryKey: ["event-recent-reminders", id],
    enabled: !!id,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
      const { data, error } = await supabase
        .from("notifications")
        .select("user_id, created_at")
        .eq("type", "event_reminder")
        .eq("related_id", id!)
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const map = new Map<string, string>();
      for (const n of (data || []) as { user_id: string; created_at: string }[]) {
        // first occurrence is latest due to DESC order
        if (!map.has(n.user_id)) map.set(n.user_id, n.created_at);
      }
      return map;
    },
  });
  const notificationNudge = useNotificationNudge(user?.id, "event");

  // Track when user views this event
  useEventViewTracking(id, user?.id);

  const { data: event, isLoading, error: eventError, isFetching: isEventFetching } = useQuery({
    queryKey: ["event", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(`*, teams (name, default_match_arrival_minutes, default_rsvp_audience), clubs!club_id (name, is_pro, sport)`)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
    retry: (failureCount, err: any) => {
      // Telemetry: log every retry so we can quantify how often the transient
      // failure path (resume-race / 5xx / token rotation) is hit in the wild.
      try {
        console.warn("[EventDetailPage] event fetch retry", {
          eventId: id,
          userId: user?.id,
          attempt: failureCount + 1,
          code: err?.code,
          status: err?.status,
          message: err?.message,
        });
      } catch {}
      return failureCount < 3;
    },
    retryDelay: (attempt) => Math.min(500 * attempt, 2000),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });


  const { data: rsvps } = useQuery({
    queryKey: ["event-rsvps", id],
    queryFn: async () => {
      // Fetch rsvps first
      const { data: rsvpData, error: rsvpError } = await supabase
        .from("rsvps")
        .select(`*, mini_league_players (id, name, child_id)`)
        .eq("event_id", id!);
      if (rsvpError) throw rsvpError;
      
      // Now fetch related profiles and children separately to avoid FK detection issues
      const userIds = rsvpData.filter(r => r.user_id).map(r => r.user_id);
      const childIds = rsvpData.filter(r => r.child_id).map(r => r.child_id);
      
      let profilesMap: Record<string, { display_name: string | null; avatar_url: string | null }> = {};
      let childrenMap: Record<string, { id: string; name: string }> = {};
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", userIds);
        if (profiles) {
          profilesMap = Object.fromEntries(profiles.map(p => [p.id, { display_name: p.display_name, avatar_url: p.avatar_url }]));
        }
      }
      
      if (childIds.length > 0) {
        const { data: children } = await supabase
          .from("children")
          .select("id, name")
          .in("id", childIds);
        if (children) {
          childrenMap = Object.fromEntries(children.map(c => [c.id, { id: c.id, name: c.name }]));
        }
      }
      
      // Combine the data
      return rsvpData.map(rsvp => ({
        ...rsvp,
        profiles: rsvp.user_id ? profilesMap[rsvp.user_id] || null : null,
        children: rsvp.child_id ? childrenMap[rsvp.child_id] || null : null,
      }));
    },
    enabled: !!id,
  });

  // Fetch event guests for attending count and RSVP list
  const { data: eventGuests } = useQuery({
    queryKey: ["event-guests", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_guests")
        .select("*")
        .eq("event_id", id!);
      if (error) throw error;
      
      // Fetch adder profiles
      const adderIds = [...new Set(data.map(g => g.added_by))];
      let adderMap: Record<string, string> = {};
      if (adderIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", adderIds);
        if (profiles) {
          adderMap = Object.fromEntries(profiles.map(p => [p.id, p.display_name || "A member"]));
        }
      }
      
      return data.map(g => ({ ...g, added_by_name: adderMap[g.added_by] || "A member" }));
    },
    enabled: !!id,
  });

  // Adult players on this team — used to count "players attending" for
  // match/training events so the attending number doesn't include parents who
  // RSVP'd for themselves alongside their child.
  const { data: teamPlayerAdultIds } = useQuery({
    queryKey: ["team-player-adult-ids", (event as any)?.team_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", (event as any).team_id)
        .eq("role", "player");
      if (error) throw error;
      return new Set((data || []).map((r: any) => r.user_id as string));
    },
    enabled: !!(event as any)?.team_id,
    staleTime: 60_000,
  });

  // For club-wide events (no team_id), identify adult players via any
  // role='player' assignment within the club so we can exclude parents
  // from the "players attending" count.
  const { data: clubPlayerAdultIds } = useQuery({
    queryKey: ["club-player-adult-ids", (event as any)?.club_id, (event as any)?.team_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", (event as any).club_id)
        .eq("role", "player");
      if (error) throw error;
      return new Set((data || []).map((r: any) => r.user_id as string));
    },
    enabled: !!(event as any)?.club_id && !(event as any)?.team_id,
    staleTime: 60_000,
  });


  // Populate form with existing RSVP data
  const myRsvp = rsvps?.find((r) => r.user_id === user?.id && !r.child_id);
  
  useEffect(() => {
    if (myRsvp) {
      setRsvpNotes((myRsvp as any).notes || "");
    }
  }, [myRsvp?.id]);

  const { data: duties, isLoading: isDutiesLoading } = useQuery({
    queryKey: ["event-duties", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("duties")
        .select(`*, profiles:assigned_to (display_name, avatar_url)`)
        .eq("event_id", id!);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Check if user is app admin (global override)
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

  // Check if user is admin for this event
  const { data: isAdmin } = useQuery({
    queryKey: ["event-admin-check", id, user?.id, event?.club_id, event?.team_id, event?.mini_league_id],
    queryFn: async () => {
      if (!event) return false;
      
      // First check for club_admin role (always applies to club events)
      const { data: clubAdminData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("club_id", event.club_id)
        .in("role", ["club_admin", "committee_member"])
        .limit(1);
      
      if (clubAdminData && clubAdminData.length > 0) return true;
      
      // For team-specific events, also check team_admin/coach roles
      if (event.team_id) {
        const { data: teamRoleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("team_id", event.team_id)
          .in("role", ["team_admin", "coach"]);
        
        if (teamRoleData && teamRoleData.length > 0) return true;
      }
      
      // For mini-league events, also check league_admin/coach roles
      if (event.mini_league_id) {
        const { data: leagueAdminData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("club_id", event.club_id)
          .in("role", ["league_admin", "coach", "committee_member"]);
        
        if (leagueAdminData && leagueAdminData.length > 0) return true;
      }
      
      return false;
    },
    enabled: !!user && !!event,
  });

  // Check if team has Pro Football subscription (for pitch board) or club has Pro Football
  const { data: hasProFootball, isLoading: isLoadingTeamPro } = useQuery({
    queryKey: ["team-pro-football-status", event?.team_id, event?.club_id],
    queryFn: async () => {
      if (!event?.team_id) return false;
      
      // Check team-level Pro Football
      const { data: teamSub } = await supabase
        .from("team_subscriptions")
        .select("is_pro_football, admin_pro_football_override")
        .eq("team_id", event.team_id)
        .maybeSingle();
      
      if (teamSub?.is_pro_football || teamSub?.admin_pro_football_override) return true;
      
      // Check club-level Pro Football
      if (event?.club_id) {
        const { data: clubSub } = await supabase
          .from("club_subscriptions")
          .select("is_pro_football, admin_pro_football_override")
          .eq("club_id", event.club_id)
          .maybeSingle();
        
        if (clubSub?.is_pro_football || clubSub?.admin_pro_football_override) return true;
      }
      
      return false;
    },
    enabled: !!event?.team_id,
  });
  
  // Check if team/club has Pro subscription (for other features like RSVP reminders)
  const { data: hasTeamPro, isLoading: isLoadingHasTeamPro } = useQuery({
    queryKey: ["team-pro-status", event?.team_id, event?.club_id],
    queryFn: async () => {
      // First check team-level subscription
      if (event?.team_id) {
        const { data: teamSub } = await supabase
          .from("team_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("team_id", event.team_id)
          .maybeSingle();
        if (teamSub?.is_pro || teamSub?.is_pro_football || teamSub?.admin_pro_override || teamSub?.admin_pro_football_override) {
          return true;
        }
      }
      
      // Then check club-level subscription
      if (event?.club_id) {
        const { data: clubSub } = await supabase
          .from("club_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("club_id", event.club_id)
          .maybeSingle();
        if (clubSub?.is_pro || clubSub?.is_pro_football || clubSub?.admin_pro_override || clubSub?.admin_pro_football_override) {
          return true;
        }
      }
      
      return false;
    },
    enabled: !!event?.team_id || !!event?.club_id,
  });

  // Pro feature check: duty points only for Pro clubs/teams or app_admin
  const canAwardDutyPoints = isAppAdmin || hasTeamPro === true;
  
  // Pro feature check for RSVP reminders - check team OR club subscription
  const canSendReminders = !isLoadingHasTeamPro && hasTeamPro === true;

  // Pro gate for event sharing
  const canShareEvent = !!isAppAdmin || hasTeamPro === true;
  const gateEventShare = (): boolean => {
    if (canShareEvent) return true;
    toast({
      title: "Event sharing is a Pro feature",
      description: event?.club_id
        ? "Upgrade your club to Pro to share events."
        : "Contact your club admin to upgrade to Pro.",
      variant: "destructive",
    });
    if (event?.club_id) navigate(`/clubs/${event.club_id}/upgrade`);
    return false;
  };

  const gateReminders = (): boolean => {
    if (isLoadingHasTeamPro) return false;
    if (hasTeamPro === true) return true;
    toast({
      title: "Reminders are a Pro feature",
      description: event?.club_id
        ? "Upgrade your club to Pro to send reminders."
        : "Contact your club admin to upgrade to Pro.",
      variant: "destructive",
    });
    if (event?.club_id) navigate(`/clubs/${event.club_id}/upgrade`);
    return false;
  };


  // Check if club is soccer/football for pitch board
  const isSoccerClub = event?.clubs?.sport?.toLowerCase().includes('soccer') || 
                       event?.clubs?.sport?.toLowerCase().includes('football');
  const isNetballClub = isNetballSport(event?.clubs?.sport);
  const isBasketballClub = isBasketballSport(event?.clubs?.sport);

  const localSubsManagerForEvent = !!duties?.some(
    (d: any) => normalizeDutyName(d.name) === "subs manager" && d.assigned_to === user?.id
  );
  const { data: directSubsManagerForEvent = false, isLoading: isDirectSubsManagerLoading } = useQuery({
    queryKey: ["event-subs-manager-direct", id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("duties")
        .select("id, name")
        .eq("event_id", id!)
        .eq("assigned_to", user!.id);
      if (error) throw error;
      return (data || []).some((d: any) => normalizeDutyName(d.name) === "subs manager");
    },
    enabled: !!id && !!user,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const isSubsManagerForEvent = localSubsManagerForEvent || directSubsManagerForEvent;
  const canManagePitchBoard = !!(isAdmin || isAppAdmin || isSubsManagerForEvent);
  const isPitchBoardAccessLoading = isLoadingTeamPro || isDirectSubsManagerLoading || isDutiesLoading;

  // Check if user can access pitch board (coach/admin/Subs Manager) - requires Pro Football for soccer.
  // Netball + basketball game boards are still in beta and restricted to app admins only.
  const canAccessSoccerBoard = canManagePitchBoard && event?.type === 'game' && !!event?.team_id && !!isSoccerClub && hasProFootball === true;
  const canAccessNetballBoard = canManagePitchBoard && event?.type === 'game' && !!event?.team_id && !!isNetballClub && !!isAppAdmin;
  const canAccessBasketballBoard = canManagePitchBoard && event?.type === 'game' && !!event?.team_id && !!isBasketballClub && !!isAppAdmin;
  const canAccessPitchBoard = canAccessSoccerBoard || canAccessNetballBoard || canAccessBasketballBoard;

  const wantOpenPitchBoard = searchParams.get("openPitchBoard") === "1";


  // Check if user is a team member (for read-only pitch board access)
  const { data: isTeamMember } = useQuery({
    queryKey: ["is-team-member", event?.team_id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("team_id", event!.team_id!)
        .limit(1)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && !!event?.team_id && !canAccessPitchBoard,
  });

  // Check if a game is currently in progress (for read-only spectator mode)
  const { data: activeGameSummary } = useQuery({
    queryKey: ["active-game-summary", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("game_summaries")
        .select("id, is_active, pitch_state, timer_state")
        .eq("event_id", id!)
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    enabled: !!id && !!isTeamMember && !canAccessPitchBoard && event?.type === 'game' && !!isSoccerClub && hasProFootball === true,
    refetchInterval: 30000, // Poll every 30s to detect game start
  });

  const canViewPitchBoardReadOnly = !!isTeamMember && !canAccessPitchBoard && !!activeGameSummary;

  // Fetch team members for pitch board (adults + children)
  // STRICT: Only includes players whose RSVP status is "going" for this event.
  // Players with status "maybe", "not_going", or no response are excluded.
  // Adults (coaches/admins) are always included so they can run the board.
  const { data: teamMembers, isLoading: isTeamMembersForPitchLoading } = useQuery({
    queryKey: ["team-members-for-pitch", event?.team_id, event?.id],
    queryFn: async () => {
      const [rolesResult, childrenResult, goingRsvpsResult] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id, role, profiles:user_id (id, display_name, avatar_url)")
          .eq("team_id", event!.team_id!),
        supabase.rpc("get_team_children_for_pitch_board", {
          p_team_id: event!.team_id!,
        }),
        supabase
          .from("rsvps")
          .select("user_id, child_id, status")
          .eq("event_id", event!.id)
          .eq("status", "going"),
      ]);

      if (rolesResult.error) throw rolesResult.error;
      if (goingRsvpsResult.error) throw goingRsvpsResult.error;

      const goingChildIds = new Set(
        (goingRsvpsResult.data || [])
          .map(r => r.child_id)
          .filter((id): id is string => !!id)
      );
      const goingAdultIds = new Set(
        (goingRsvpsResult.data || [])
          .map(r => r.user_id)
          .filter((id): id is string => !!id)
      );

      // Adults: include coaches/admins always (they may run the board even if
      // not personally RSVP'd as players); include other roles (e.g. "player")
      // only when they have a "going" RSVP.
      const STAFF_ROLES = new Set(["team_admin", "coach", "club_admin", "app_admin"]);
      const adultMembers = (rolesResult.data || [])
        .filter(m => STAFF_ROLES.has(m.role) || goingAdultIds.has(m.user_id))
        .map(m => ({
          user_id: m.user_id,
          role: m.role,
          profiles: m.profiles,
        }));

      // Children: only include those with a "going" RSVP.
      const childMembers = (childrenResult.data || [])
        .filter(child => goingChildIds.has(child.child_id))
        .map(child => ({
          user_id: child.child_id,
          role: "player" as string,
          profiles: {
            id: child.child_id,
            display_name: child.child_name,
            avatar_url: null,
          },
        }));

      return [...adultMembers, ...childMembers];
    },
    enabled: !!event?.team_id && !!event?.id && !!(canAccessPitchBoard || canViewPitchBoardReadOnly),
  });

  // Auto-open the pitch board when navigated here from the home Next Up
  // Start Game CTA (or any other deep-link with ?openPitchBoard=1). Waits
  // for access flags + teamMembers to resolve so we don't open a board the
  // user can't actually use.
  useEffect(() => {
    if (!wantOpenPitchBoard) return;
    if (!event || !teamMembers) return;
    if (!(canAccessPitchBoard || canViewPitchBoardReadOnly)) return;
    setShowPitchBoard(true);
    const next = new URLSearchParams(searchParams);
    next.delete("openPitchBoard");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantOpenPitchBoard, event?.id, canAccessPitchBoard, canViewPitchBoardReadOnly, !!teamMembers]);

  // Fetch team subscription for pitch board settings
  const { data: teamSubscription } = useQuery({
    queryKey: ["team-subscription-for-pitch", event?.team_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_subscriptions")
        .select("*")
        .eq("team_id", event!.team_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!event?.team_id && !!(canAccessPitchBoard || canViewPitchBoardReadOnly),
  });

  // Fetch team/club members for duty assignment and not responded list (with roles)
  const { data: membersWithRoles } = useQuery({
    queryKey: ["event-members-with-roles", event?.club_id, event?.team_id],
    queryFn: async () => {
      const query = supabase
        .from("user_roles")
        .select("user_id, role, profiles:user_id (id, display_name, avatar_url)");
      
      if (event?.team_id) {
        query.eq("team_id", event.team_id);
      } else {
        query.eq("club_id", event!.club_id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      // Group roles by user_id
      const userRolesMap = new Map<string, { profile: any; roles: string[] }>();
      data.filter(m => m.profiles).forEach(m => {
        const existing = userRolesMap.get(m.user_id);
        if (existing) {
          if (!existing.roles.includes(m.role)) {
            existing.roles.push(m.role);
          }
        } else {
          userRolesMap.set(m.user_id, { profile: m.profiles, roles: [m.role] });
        }
      });
      
      return Array.from(userRolesMap.entries()).map(([userId, data]) => ({
        ...data.profile,
        roles: data.roles,
      }));
    },
    enabled: !!event,
  });

  // Fetch mini-league players for mini-league events (for not responded list).
  // We enrich each player with `is_pending` = no parent has accepted the app yet
  // (no parent_user_id, linked child has no parent_id, and no guardians).
  const { data: miniLeaguePlayers } = useQuery({
    queryKey: ["mini-league-players-for-event", event?.mini_league_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("id, name, parent_user_id, child_id")
        .eq("mini_league_id", event!.mini_league_id!);
      if (error) throw error;
      const players = data || [];

      const childIds = Array.from(
        new Set(players.map((p: any) => p.child_id).filter((id: string | null): id is string => !!id)),
      );

      let childParentMap = new Map<string, string | null>();
      let guardianCountMap = new Map<string, number>();
      if (childIds.length > 0) {
        const [childrenRes, guardiansRes] = await Promise.all([
          supabase.from("children").select("id, parent_id").in("id", childIds),
          supabase.from("child_guardians").select("child_id").in("child_id", childIds),
        ]);
        (childrenRes.data || []).forEach((c: any) => childParentMap.set(c.id, c.parent_id));
        (guardiansRes.data || []).forEach((g: any) => {
          guardianCountMap.set(g.child_id, (guardianCountMap.get(g.child_id) || 0) + 1);
        });
      }

      return players.map((p: any) => {
        const childParent = p.child_id ? childParentMap.get(p.child_id) : null;
        const guardianCount = p.child_id ? (guardianCountMap.get(p.child_id) || 0) : 0;
        const is_pending = !p.parent_user_id && !childParent && guardianCount === 0;
        return { ...p, is_pending };
      });
    },
    enabled: !!event?.mini_league_id,
  });

  // Fetch adult profiles linked to this mini-league (parents of league players).
  // Used by the Attendance "Show all roles" toggle on mini-league events.
  const { data: miniLeagueAdults } = useQuery({
    queryKey: ["mini-league-adults-for-event", event?.mini_league_id],
    queryFn: async () => {
      const parentIds = Array.from(
        new Set(
          (miniLeaguePlayers || [])
            .map((p: any) => p.parent_user_id)
            .filter((id: string | null): id is string => !!id),
        ),
      );
      if (parentIds.length === 0) return [] as Array<{ id: string; display_name: string | null; avatar_url: string | null; roles: string[] }>;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", parentIds);
      if (error) throw error;
      return (data || []).map((p: any) => ({ ...p, roles: ["parent"] }));
    },
    enabled: !!event?.mini_league_id && !!miniLeaguePlayers,
  });


  // Mini-league players owned by current parent (for self-serve per-player RSVP)
  const { data: myMiniLeaguePlayers } = useQuery({
    queryKey: ["my-mini-league-players-for-event", event?.mini_league_id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("id, name, child_id")
        .eq("mini_league_id", event!.mini_league_id!)
        .eq("parent_user_id", user!.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!event?.mini_league_id && !!user?.id,
  });

  const parentLeaguePlayerRsvpMutation = useMutation({
    mutationFn: async ({ playerId, status }: { playerId: string; status: RsvpStatus }) => {
      const existing = rsvps?.find((r) => r.mini_league_player_id === playerId);
      if (existing) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status, source: "user" })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rsvps").insert({
          event_id: id!,
          user_id: user!.id,
          mini_league_player_id: playerId,
          status,
          source: "user",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["event-groups", id] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update RSVP", description: err.message, variant: "destructive" });
    },
  });

  // For social events, always show all members; for training/games, use toggle
  const isSocialEvent = event?.type === "social";
  const effectiveShowAll = isSocialEvent ? true : showAllRoles;
  const isMiniLeagueEvent = !!event?.mini_league_id;
  const eventTypeLabel = isMiniLeagueEvent ? "Match Day" : getEventTypeLabel(event?.type);

  const restrictedEventRoles = Array.isArray((event as any)?.restricted_to_roles)
    ? ((event as any).restricted_to_roles as string[])
    : [];
  const hasRestrictedEventRoles = restrictedEventRoles.length > 0;
  const roleRestrictedMembers = membersWithRoles?.filter((m: any) => {
    if (!hasRestrictedEventRoles) return true;
    return (m.roles ?? []).some((role: string) =>
      restrictedEventRoles.includes(role) || role === "club_admin" || role === "app_admin",
    );
  }) || [];

  // Filter members based on showAllRoles toggle / event role restrictions
  const members = hasRestrictedEventRoles ? roleRestrictedMembers : membersWithRoles;
  const playerMembers = members?.filter((m: any) => m.roles?.includes("player")) || [];

  // Fetch mini league duty assignees (RSVP'd parents + club admins + league admins, excluding players)
  const { data: miniLeagueDutyAssignees } = useQuery({
    queryKey: ["mini-league-duty-assignees-session", event?.mini_league_id, id],
    queryFn: async () => {
      const miniLeagueId = event!.mini_league_id!;
      
      // Get mini league to find the club_id
      const { data: league, error: leagueError } = await supabase
        .from("mini_leagues")
        .select("club_id")
        .eq("id", miniLeagueId)
        .single();
      if (leagueError) throw leagueError;
      
      // Get RSVPs for this event (only user RSVPs, not children/players)
      const { data: eventRsvps, error: rsvpError } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", id!)
        .eq("status", "going")
        .not("user_id", "is", null);
      if (rsvpError) throw rsvpError;
      
      const rsvpUserIds = new Set(eventRsvps?.map(r => r.user_id).filter(Boolean) as string[]);
      
      // Get all parent user IDs from mini league players who RSVP'd
      const { data: playersData, error: playersError } = await supabase
        .from("mini_league_players")
        .select("parent_user_id")
        .eq("mini_league_id", miniLeagueId)
        .not("parent_user_id", "is", null);
      if (playersError) throw playersError;
      
      // Only include parents who RSVP'd going
      const parentIds = [...new Set(
        (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[])
          .filter(parentId => rsvpUserIds.has(parentId))
      )];
      
      // Get club admins and league admins who RSVP'd
      const { data: adminRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", league.club_id)
        .in("role", ["club_admin", "league_admin"]);
      if (rolesError) throw rolesError;
      
      // Only include admins who RSVP'd going
      const adminIds = (adminRoles?.map(r => r.user_id) || [])
        .filter(adminId => rsvpUserIds.has(adminId));
      
      // Combine all unique IDs
      const allUserIds = [...new Set([...parentIds, ...adminIds])];
      
      // Exclude app admins from the list
      const { data: appAdmins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "app_admin");
      const appAdminIds = new Set(appAdmins?.map(r => r.user_id) || []);
      const filteredUserIds = allUserIds.filter(id => !appAdminIds.has(id));
      if (!filteredUserIds.length) return [];
      
      // Fetch profiles for all these users
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", filteredUserIds)
        .order("display_name");
      if (profilesError) throw profilesError;
      
      return profiles || [];
    },
    enabled: !!event?.mini_league_id && !!id,
  });

  // Fetch children for parent RSVP - team-assigned children for team events, all children for club-wide events
  const { data: childrenOnTeam } = useQuery({
    queryKey: ["children-on-team", event?.team_id, event?.club_id, event?.type, user?.id],
    queryFn: async () => {
      // Get children where user is parent OR guardian
      const [ownChildren, guardianLinks] = await Promise.all([
        // Direct children (parent_id)
        event?.team_id
          ? supabase
              .from("children")
              .select("id, name, child_team_assignments!inner (team_id)")
              .eq("parent_id", user!.id)
              .eq("child_team_assignments.team_id", event.team_id)
          : supabase
              .from("children")
              .select("id, name")
              .eq("parent_id", user!.id),
        // Guardian-linked children
        supabase
          .from("child_guardians")
          .select("child_id, children!inner (id, name)")
          .eq("guardian_id", user!.id),
      ]);

      const directChildren = ownChildren.data || [];
      const guardianChildren = (guardianLinks.data || []).map((g: any) => g.children).filter(Boolean);

      // If team event, filter guardian children to those on the team
      let filteredGuardianChildren = guardianChildren;
      if (event?.team_id && guardianChildren.length > 0) {
        const guardianChildIds = guardianChildren.map((c: any) => c.id);
        const { data: assignments } = await supabase
          .from("child_team_assignments")
          .select("child_id")
          .eq("team_id", event.team_id)
          .in("child_id", guardianChildIds);
        const assignedIds = new Set((assignments || []).map((a: any) => a.child_id));
        filteredGuardianChildren = guardianChildren.filter((c: any) => assignedIds.has(c.id));
      }

      // Deduplicate by child id
      const seen = new Set<string>();
      const all = [...directChildren, ...filteredGuardianChildren].filter((c: any) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

      return all;
    },
    enabled: !!user && !!(event?.team_id || event?.club_id),
  });

  // Fetch ALL children assigned to this event's team (for not responded list)
  const { data: allChildrenOnTeam } = useQuery({
    queryKey: ["all-children-on-team", event?.team_id],
    queryFn: async () => {
      if (!event?.team_id) return [];
      
      const { data, error } = await supabase
        .from("child_team_assignments")
        .select(`
          child_id,
          children (id, name, parent_id)
        `)
        .eq("team_id", event.team_id);

      if (error) throw error;
      return data?.map(d => d.children).filter(Boolean) || [];
    },
    enabled: !!event?.team_id,
  });

  // Fetch guardians for children on this team (so guardians are excluded from "not responded" when their child has RSVP'd)
  const childIdsOnTeam = (allChildrenOnTeam || []).map((c: any) => c.id);
  const { data: childGuardiansOnTeam } = useQuery({
    queryKey: ["child-guardians-on-team", event?.team_id, childIdsOnTeam.join(",")],
    queryFn: async () => {
      if (childIdsOnTeam.length === 0) return [];
      const { data, error } = await supabase
        .from("child_guardians")
        .select("child_id, guardian_id")
        .in("child_id", childIdsOnTeam);
      if (error) throw error;
      return data || [];
    },
    enabled: childIdsOnTeam.length > 0,
  });

  // Get existing RSVPs for children (any guardian's RSVP for the child counts)
  const myChildIds = new Set((childrenOnTeam || []).map((c: any) => c.id));
  const childRsvps = rsvps?.filter((r) => r.child_id && myChildIds.has(r.child_id)) || [];

  // Fetch event payments (admin only)
  const { data: payments } = useQuery({
    queryKey: ["event-payments", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_payments")
        .select("user_id")
        .eq("event_id", id!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!id && !!(isAdmin || isAppAdmin),
  });

  // Create set of paid user IDs for quick lookup
  const paidUserIds = new Set(payments?.map(p => p.user_id) || []);

  // Match awards: captain, POTM, goalkeepers — used to show inline icons next to attendees
  const isGameEvent = event?.type === "game" && !!event?.team_id;
  const { data: matchCaptainRow } = useQuery({
    queryKey: ["match-captain", id, "marker"],
    enabled: !!id && isGameEvent,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_captains")
        .select("user_id, child_id")
        .eq("event_id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: potmRow } = useQuery({
    queryKey: ["player-of-match", id, "marker"],
    enabled: !!id && isGameEvent,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_of_match")
        .select("user_id, child_id")
        .eq("event_id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: goalkeeperRows = [] } = useQuery({
    queryKey: ["match-goalkeepers", id],
    enabled: !!id && isGameEvent,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_goalkeepers" as any)
        .select("user_id, child_id")
        .eq("event_id", id!);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
  const captainUserId = matchCaptainRow?.user_id || null;
  const captainChildId = matchCaptainRow?.child_id || null;
  const potmUserId = potmRow?.user_id || null;
  const potmChildId = potmRow?.child_id || null;
  const gkUserIds = new Set((goalkeeperRows as any[]).map((g) => g.user_id).filter(Boolean));
  const gkChildIds = new Set((goalkeeperRows as any[]).map((g) => g.child_id).filter(Boolean));

  // Check if event has a price (social events only)
  const eventPrice = event?.type === "social" ? event?.amount : null;
  const showPaymentStatus = eventPrice && eventPrice > 0;

  // Check if user has paid
  const userHasPaid = user ? paidUserIds.has(user.id) : false;

  // Payment checkout state
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const handlePayNow = async () => {
    if (!event || !user || !eventPrice) return;
    
    setIsProcessingPayment(true);
    try {
      const amountCents = Math.round(eventPrice * 100);
      const isNative = Capacitor.isNativePlatform();

      const result = await createMemberCheckout({
        club_id: event.club_id,
        title: event.title,
        amount_cents: amountCents,
        type: "event",
        payer_email: user.email || undefined,
        description: `Event payment: ${event.title}`,
        success_url: isNative
          ? "igniteclubhq://payment-success"
          : `${window.location.origin}/events/${event.id}?payment=success`,
        cancel_url: isNative
          ? "igniteclubhq://payment-cancel"
          : `${window.location.origin}/events/${event.id}?payment=cancelled`,
        metadata: {
          event_id: event.id,
          club_id: event.club_id,
          ...(event.team_id ? { team_id: event.team_id } : {}),
        },
      });

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.url) {
        listenForPaymentStatus(result.payment_id, async (status) => {
          if (status === "paid") {
            try {
              await supabase.functions.invoke("confirm-event-payment", {
                body: {
                  event_id: event.id,
                  amount: eventPrice,
                  payment_id: result.payment_id,
                },
              });
            } catch (err) {
              console.error("Failed to confirm event payment server-side:", err);
            }
            queryClient.invalidateQueries({ queryKey: ["event-payments", id] });
            toast({ title: "Payment successful!" });
          } else {
            toast({ title: "Payment failed", variant: "destructive" });
          }
        });

        if (isNative) {
          import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(result.url));
        } else {
          window.location.href = result.url;
        }
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      toast({
        title: "Payment Error",
        description: error.message || "Failed to start payment process",
        variant: "destructive",
      });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Check for payment success/cancel from URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    
    if (paymentStatus === 'success') {
      toast({
        title: "Payment Successful!",
        description: "Your payment has been processed. Thank you!",
      });
      // Remove the query param from URL
      window.history.replaceState({}, '', `/events/${id}`);
      // Refetch payments
      queryClient.invalidateQueries({ queryKey: ["event-payments", id] });
    } else if (paymentStatus === 'cancelled') {
      toast({
        title: "Payment Cancelled",
        description: "Your payment was cancelled.",
        variant: "destructive",
      });
      window.history.replaceState({}, '', `/events/${id}`);
    }
  }, [id, toast, queryClient]);


  const rsvpMutation = useMutation({
    mutationFn: async (status: RsvpStatus) => {
      let rsvpId: string | null = null;

      // Offline path: queue the RSVP, return early
      if (!navigator.onLine) {
        queueRsvp({
          eventId: id!,
          userId: user!.id,
          status,
          notes: rsvpNotes || null,
          existingRsvpId: myRsvp?.id || null,
        });
        return;
      }

      if (myRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({
            status,
            notes: rsvpNotes || null,
            source: "user",
          })
          .eq("id", myRsvp.id);
        if (error) throw error;
        rsvpId = myRsvp.id;
      } else {
        const { data: newRsvp, error } = await supabase.from("rsvps").insert({
          event_id: id!,
          user_id: user!.id,
          status,
          notes: rsvpNotes || null,
          source: "user",
        }).select("id").single();
        if (error) throw error;
        rsvpId = newRsvp?.id || null;
      }

      // Fire-and-forget: don't block UI for points calculation
      if (status === "going" && rsvpId && event) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs?.name || "Your club",
        }).catch(console.error);
      }

      // RSVP notifications are handled by the on_rsvp_notify_admins database trigger
    },
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["event-groups", id] });
      queryClient.invalidateQueries({ queryKey: ["team-members-for-pitch", event?.team_id, event?.id] });
      // Refresh points history & rank after fire-and-forget early-RSVP bonus award.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["points-history"] });
        queryClient.invalidateQueries({ queryKey: ["points-rank"] });
        queryClient.invalidateQueries({ queryKey: ["points-rank-seasoned"] });
      }, 1500);
      

      // Show post-RSVP notification nudge if user hasn't enabled push
      if (notificationNudge.hasPushEnabled === false) {
        setTimeout(() => setShowPostRsvpNudge(true), 800);
      }

      // Auto-trigger payment for paid social events when RSVPing "going"
      if (
        status === "going" &&
        showPaymentStatus &&
        !userHasPaid &&
        !isProcessingPayment
      ) {
        // Small delay so user sees the RSVP confirmation first
        setTimeout(() => {
          handlePayNow();
        }, 600);
      }
    },
  });

  // Child RSVP mutation
  const childRsvpMutation = useMutation({
    mutationFn: async ({ childId, status, childName }: { childId: string; status: RsvpStatus; childName?: string }) => {
      const existingRsvp = childRsvps.find((r) => r.child_id === childId);
      let rsvpId: string | null = null;
      
      if (existingRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status, source: "user" })
          .eq("id", existingRsvp.id);
        if (error) throw error;
        rsvpId = existingRsvp.id;
      } else {
        const { data: newRsvp, error } = await supabase.from("rsvps").insert({
          event_id: id!,
          user_id: user!.id,
          child_id: childId,
          status,
          source: "user",
        }).select("id").maybeSingle();
        if (error) throw error;
        // If trigger redirected insert→update on duplicate, look up the canonical row.
        if (newRsvp?.id) {
          rsvpId = newRsvp.id;
        } else {
          const { data: existing } = await supabase
            .from("rsvps")
            .select("id")
            .eq("event_id", id!)
            .eq("child_id", childId)
            .maybeSingle();
          rsvpId = existing?.id ?? null;
        }
      }

      // Fire-and-forget: award early RSVP points for child
      if (status === "going" && rsvpId && event) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          childId,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs?.name || "Your club",
        }).catch(console.error);
      }

      // RSVP notifications are handled by the on_rsvp_notify_admins database trigger
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["event-groups", id] });
      queryClient.invalidateQueries({ queryKey: ["team-members-for-pitch", event?.team_id, event?.id] });
      // Refresh points history & rank after fire-and-forget child early-RSVP bonus award.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["points-history"] });
        queryClient.invalidateQueries({ queryKey: ["points-rank"] });
        queryClient.invalidateQueries({ queryKey: ["points-rank-seasoned"] });
      }, 1500);
    },
  });

  // Admin RSVP mutation for mini-league players (club/league admins can change player RSVPs)
  const adminRsvpMutation = useMutation({
    mutationFn: async ({ 
      playerId, 
      playerName, 
      childId, 
      parentUserId,
      status 
    }: { 
      playerId: string; 
      playerName: string;
      childId: string | null;
      parentUserId: string | null;
      status: RsvpStatus;
    }) => {
      if (childId) {
        const { error } = await supabase.rpc('admin_upsert_rsvp', {
          p_event_id: id!,
          p_user_id: parentUserId || user!.id,
          p_status: status,
          p_acting_user_id: user!.id,
          p_child_id: childId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('admin_upsert_rsvp', {
          p_event_id: id!,
          p_user_id: user!.id,
          p_status: status,
          p_acting_user_id: user!.id,
          p_mini_league_player_id: playerId,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["event-groups", id] });
      queryClient.invalidateQueries({ queryKey: ["team-members-for-pitch", event?.team_id, event?.id] });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to update RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to update existing RSVP status by RSVP ID
  const adminUpdateRsvpMutation = useMutation({
    mutationFn: async ({ rsvpId, status, playerName }: { rsvpId: string; status: RsvpStatus; playerName: string }) => {
      const { error } = await supabase.rpc('admin_update_rsvp_status', {
        p_rsvp_id: rsvpId,
        p_status: status,
        p_acting_user_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["event-groups", id] });
      queryClient.invalidateQueries({ queryKey: ["team-members-for-pitch", event?.team_id, event?.id] });
      
    },
    onError: (error) => {
      toast({ 
        title: "Failed to update RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to create RSVP for a member who hasn't responded (for team/club events)
  const rsvpForMemberMutation = useMutation({
    mutationFn: async ({ memberId, memberName, status }: { memberId: string; memberName: string; status: RsvpStatus }) => {
      const { error } = await supabase.rpc('admin_upsert_rsvp', {
        p_event_id: id!,
        p_user_id: memberId,
        p_status: status,
        p_acting_user_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["team-members-for-pitch", event?.team_id, event?.id] });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to set RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to create RSVP for a child who hasn't responded (for team events)
  const rsvpForChildMutation = useMutation({
    mutationFn: async ({ childId, childName, parentUserId, status }: { childId: string; childName: string; parentUserId: string; status: RsvpStatus }) => {
      // Check if RSVP already exists for this child
      const { data: existingRsvp } = await supabase
        .from("rsvps")
        .select("id")
        .eq("event_id", id!)
        .eq("child_id", childId)
        .maybeSingle();
      
      if (existingRsvp) {
        // Update existing RSVP
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", existingRsvp.id);
        if (error) throw error;
      } else {
        // Create new RSVP for child
        const { error } = await supabase
          .from("rsvps")
          .insert({ event_id: id!, user_id: parentUserId, child_id: childId, status });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["team-members-for-pitch", event?.team_id, event?.id] });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to set RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Toggle payment status mutation
  const togglePaymentMutation = useMutation({
    mutationFn: async ({ userId, isPaid }: { userId: string; isPaid: boolean }) => {
      if (isPaid) {
        // Remove payment record
        const { error } = await supabase
          .from("event_payments")
          .delete()
          .eq("event_id", id!)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        // Add payment record
        const { error } = await supabase
          .from("event_payments")
          .insert({
            event_id: id!,
            user_id: userId,
            amount: event?.amount || 0,
            payment_status: "paid",
            paid_at: new Date().toISOString(),
          });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["event-payments", id] });
      toast({ title: variables.isPaid ? "Payment removed" : "Marked as paid" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to update payment", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Add duty mutation
  const addDutyMutation = useMutation({
    mutationFn: async (args: { dutyName: string; startTime?: string; endTime?: string }) => {
      // Combine event date with optional HH:MM times into ISO timestamps
      const buildTs = (hhmm?: string): string | null => {
        if (!hhmm || !event) return null;
        const base = new Date(event.start_time || event.event_date);
        if (Number.isNaN(base.getTime())) return null;
        const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
        if (Number.isNaN(h) || Number.isNaN(m)) return null;
        const d = new Date(base);
        d.setHours(h, m, 0, 0);
        return d.toISOString();
      };
      const start_time = buildTs(args.startTime);
      const end_time = buildTs(args.endTime);
      const { error } = await supabase
        .from("duties")
        .insert({ event_id: id!, name: args.dutyName, start_time, end_time } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      setNewDutyName("");
      setSelectedPresetDuty("");
      setAddDutyOpen(false);
      toast({ title: "Duty added" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to add duty", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Claim duty mutation
  const claimDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      const { error } = await supabase
        .from("duties")
        .update({ assigned_to: user?.id })
        .eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      toast({ title: "Duty claimed!" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to claim duty", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Complete duty mutation
  const completeDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      // Get duty details before updating
      const duty = duties?.find(d => d.id === dutyId);

      // Guard against premature completion — duties can only be marked complete
      // from match arrival time (for games) or event start time onwards.
      if (event) {
        const earliest = event.type === "game"
          ? (getMatchArrivalDate(event as any) ?? new Date(event.start_time || event.event_date))
          : new Date(event.start_time || event.event_date);
        if (!Number.isNaN(earliest.getTime()) && new Date() < earliest) {
          throw new Error(
            `This duty can't be completed yet — it's available from ${format(earliest, "EEE d MMM, h:mm a")}.`
          );
        }
      }

      const { data: updatedDuty, error } = await supabase
        .from("duties")
        .update({ status: "completed" as DutyStatus, completed_at: new Date().toISOString() })
        .eq("id", dutyId)
        .eq("status", "open")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!updatedDuty) return;

      // Notify team/club admins and coaches about duty completion
      if (event && duty) {
        const memberName = profile?.display_name || "A member";
        
        // Get admins/coaches for this team/event
        const roleQuery = event.team_id 
          ? supabase.from("user_roles").select("user_id").eq("team_id", event.team_id).in("role", ["team_admin", "coach", "club_admin", "committee_member"])
          : supabase.from("user_roles").select("user_id").eq("club_id", event.club_id).in("role", ["club_admin", "committee_member"]);
        
        const { data: admins } = await roleQuery;
        
        if (admins && admins.length > 0) {
          const recipientIds = Array.from(
            new Set(admins.map(a => a.user_id).filter((userId): userId is string => !!userId && userId !== user?.id))
          );
          const message = `${memberName} completed ${duty.name} for ${event.title}`;
          const notifications = recipientIds.map(userId => ({
              user_id: userId,
              type: "duty_completed",
              message,
              related_id: id,
            }));
          
          if (notifications.length > 0) {
            const { error: notificationError } = await supabase.from("notifications").insert(notifications);
            if (notificationError && notificationError.code !== "23505") throw notificationError;
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      toast({ title: "Duty completed!" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to complete duty", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Undo duty completion (in case of accidental tap)
  const uncompleteDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      const { error } = await supabase
        .from("duties")
        .update({ status: "open" as DutyStatus, completed_at: null })
        .eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      toast({ title: "Marked as not complete" });
    },
    onError: (error) => {
      toast({
        title: "Failed to undo",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      const { error } = await supabase.from("duties").delete().eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      toast({ title: "Duty removed" });
    },
  });

  const assignDutyMutation = useMutation({
    mutationFn: async (userId: string | null) => {
      if (!selectedDutyId) return;
      
      // Get the duty to check if it was previously unassigned
      const { data: dutyBefore } = await supabase
        .from("duties")
        .select("assigned_to")
        .eq("id", selectedDutyId)
        .single();
      
      const { error } = await supabase
        .from("duties")
        .update({ assigned_to: userId })
        .eq("id", selectedDutyId);
      if (error) throw error;

      // Points are now awarded 24 hours after the game via scheduled job
      // Just notify the assigned user about the duty assignment
      if (userId && (!dutyBefore?.assigned_to || dutyBefore.assigned_to !== userId)) {
        await supabase.from("notifications").insert({
          user_id: userId,
          type: "duty_assigned",
          message: "You've been assigned a duty. Points will be awarded 24 hours after the game! 🔥",
          related_id: id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      setAssignDialogOpen(false);
      setSelectedDutyId(null);
      setSelectedUserId("");
      toast({ title: "Duty assigned" });
    },
  });

  const [pendingDeleteTimeout, setPendingDeleteTimeout] = useState<NodeJS.Timeout | null>(null);
  const [pendingDeleteType, setPendingDeleteType] = useState<'single' | 'series' | null>(null);

  const performActualDelete = async (deleteType: 'single' | 'series') => {
    if (deleteType === 'series' && event?.parent_event_id) {
      await supabase.from("events").delete().eq("parent_event_id", event.parent_event_id);
      await supabase.from("events").delete().eq("id", event.parent_event_id);
    } else if (deleteType === 'series' && event?.is_recurring) {
      await supabase.from("events").delete().eq("parent_event_id", id!);
      await supabase.from("events").delete().eq("id", id!);
    } else {
      await supabase.from("events").delete().eq("id", id!);
    }
  };

  const handleDeleteWithUndo = (deleteType: 'single' | 'series') => {
    // Navigate away immediately
    navigate(-1);
    
    // Set pending delete type
    setPendingDeleteType(deleteType);
    
    // Show toast with undo option
    const timeoutId = setTimeout(async () => {
      await performActualDelete(deleteType);
      setPendingDeleteTimeout(null);
      setPendingDeleteType(null);
    }, 6000);
    
    setPendingDeleteTimeout(timeoutId);
    
    toast({
      title: "Event deleted",
      description: deleteType === 'series' ? "Entire series deleted" : "Event deleted",
      action: (
        <ToastAction
          altText="Undo deletion"
          onClick={() => {
            if (pendingDeleteTimeout) {
              clearTimeout(pendingDeleteTimeout);
            }
            clearTimeout(timeoutId);
            setPendingDeleteTimeout(null);
            setPendingDeleteType(null);
            // Navigate back to the event
            navigate(`/events/${id}`);
            toast({ title: "Deletion cancelled" });
          }}
        >
          Undo
        </ToastAction>
      ),
      duration: 6000,
    });
  };

  const deleteEventMutation = useMutation({
    mutationFn: async (deleteType: 'single' | 'series') => {
      handleDeleteWithUndo(deleteType);
    },
  });

  const cancelEventMutation = useMutation({
    mutationFn: async ({ cancelType, customMessage, sendPushNotification }: { cancelType: 'single' | 'series'; customMessage?: string; sendPushNotification?: boolean }) => {
      console.log("[CancelEvent] Starting cancel mutation", { cancelType, eventId: id, miniLeagueId: event?.mini_league_id });
      
      if (cancelType === 'series' && event?.parent_event_id) {
        // Cancel parent and all children
        const { error: err1 } = await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("parent_event_id", event.parent_event_id);
        const { error: err2 } = await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("id", event.parent_event_id);
        if (err1) { console.error("[CancelEvent] Error cancelling children:", err1); throw err1; }
        if (err2) { console.error("[CancelEvent] Error cancelling parent:", err2); throw err2; }
      } else if (cancelType === 'series' && event?.is_recurring) {
        // This is the parent - cancel all children and this event
        const { error: err1 } = await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("parent_event_id", id!);
        const { error: err2 } = await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("id", id!);
        if (err1) { console.error("[CancelEvent] Error cancelling children:", err1); throw err1; }
        if (err2) { console.error("[CancelEvent] Error cancelling this event:", err2); throw err2; }
      } else {
        // Just cancel this single event
        console.log("[CancelEvent] Cancelling single event:", id);
        const { data, error } = await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("id", id!);
        console.log("[CancelEvent] Update result:", { data, error });
        if (error) {
          console.error("[CancelEvent] Error cancelling event:", error);
          throw error;
        }
      }

      // Get member count for notifications - handle mini-league events differently
      let uniqueMembers: string[] = [];
      
      if (event?.mini_league_id) {
        // Get mini league to find the club_id
        const { data: league } = await supabase
          .from("mini_leagues")
          .select("club_id")
          .eq("id", event.mini_league_id)
          .single();
        
        if (league) {
          // Get all parent user IDs from mini league players
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", event.mini_league_id)
            .not("parent_user_id", "is", null);
          
          const parentIds = (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[]) || [];
          
          // Get club admins, league admins, and coaches
          const { data: adminRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin", "coach"]);
          
          const adminIds = adminRoles?.map(r => r.user_id) || [];
          
          uniqueMembers = [...new Set([...parentIds, ...adminIds])];
        }
      } else {
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (event?.team_id) {
          memberQuery = memberQuery.eq("team_id", event.team_id);
        } else if (event?.club_id) {
          memberQuery = memberQuery.eq("club_id", event.club_id);
        }
        const { data: members } = await memberQuery;
        uniqueMembers = [...new Set(members?.map(m => m.user_id) || [])];
      }

      // Always post cancellation message to team, club, or mini-league chat
      if (user && event) {
        const eventPath = `/events/${event.id}`;
        const cancellationMessage = customMessage 
          ? `📢 Event Cancelled: "${event.title}"\n\n${customMessage}\n\nView event: ${eventPath}`
          : `📢 Event Cancelled: "${event.title}"\n\nView event: ${eventPath}`;

        if (event.mini_league_id) {
          // Post to mini-league chat group
          const { data: chatGroup } = await supabase
            .from("chat_groups")
            .select("id")
            .eq("mini_league_id", event.mini_league_id)
            .maybeSingle();
          
          if (chatGroup) {
            const { error: msgError } = await supabase.from("group_messages").insert({
              group_id: chatGroup.id,
              author_id: user.id,
              text: cancellationMessage,
            });
            if (msgError) {
              console.error("Failed to post cancellation to league chat:", msgError);
            }
          }
        } else if (event.team_id) {
          const { error: msgError } = await supabase.from("team_messages").insert({
            team_id: event.team_id,
            author_id: user.id,
            text: cancellationMessage,
          });
          if (msgError) {
            console.error("Failed to post cancellation to team chat:", msgError);
          }
        } else if (event.club_id) {
          const { error: msgError } = await supabase.from("club_messages").insert({
            club_id: event.club_id,
            author_id: user.id,
            text: cancellationMessage,
          });
          if (msgError) {
            console.error("Failed to post cancellation to club chat:", msgError);
          }
        }
      }

      // Notifications are created automatically by the on_event_cancelled DB trigger
      // No need to manually insert them here - that was causing duplicates

      return uniqueMembers.length;
    },
    onSuccess: () => {
      console.log("[CancelEvent] Success - event cancelled");
      setCancelDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["event", id] });
      toast({ title: "Event cancelled", description: "A message has been posted to the chat" });
    },
    onError: (error) => {
      console.error("[CancelEvent] Mutation error:", error);
      toast(friendlyMutationError(error, {
        title: "Failed to cancel event",
        description: (error as any)?.message || "An unexpected error occurred",
      }));
    },
  });

  const remindMutation = useMutation({
    mutationFn: async () => {
      // Get all RSVPs for this event
      const { data: existingRsvps } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", id!);
      
      const rsvpUserIds = existingRsvps?.map(r => r.user_id) || [];
      
      // Get all members who should RSVP - handle mini-league events differently
      let allMemberIds: string[] = [];
      
      if (event?.mini_league_id) {
        // Get mini league to find the club_id
        const { data: league } = await supabase
          .from("mini_leagues")
          .select("club_id")
          .eq("id", event.mini_league_id)
          .single();
        
        if (league) {
          // Get all parent user IDs from mini league players
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", event.mini_league_id)
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
        let memberQuery = supabase.from("user_roles").select("user_id, role");
        if (event?.team_id) {
          memberQuery = memberQuery.eq("team_id", event.team_id);
        } else if (event?.club_id) {
          memberQuery = memberQuery.eq("club_id", event.club_id);
        }
        
        const { data: allMembers } = await memberQuery;
        const restricted = Array.isArray((event as any)?.restricted_to_roles)
          ? ((event as any).restricted_to_roles as string[])
          : [];
        const rows = restricted.length > 0
          ? (allMembers || []).filter((m: any) => restricted.includes(m.role) || m.role === "club_admin" || m.role === "app_admin")
          : (allMembers || []);
        allMemberIds = [...new Set(rows.map((m: any) => m.user_id) || [])];
      }
      
      // Find members who haven't RSVPed
      const nonRsvpMembers = allMemberIds.filter(memberId => !rsvpUserIds.includes(memberId));
      
      if (nonRsvpMembers.length === 0) {
        throw new Error("Everyone has already RSVPed!");
      }
      
      // Check for reminders sent in the last 24 hours to avoid spamming members
      const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
      const { data: existingNotifications } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_reminder")
        .eq("related_id", id!)
        .in("user_id", nonRsvpMembers)
        .gte("created_at", since);

      const existingNotificationUserIds = existingNotifications?.map(n => n.user_id) || [];
      const membersToNotify = nonRsvpMembers.filter(memberId => !existingNotificationUserIds.includes(memberId));

      if (membersToNotify.length === 0) {
        throw new Error("All non-responders were already reminded in the last 24 hours");
      }
      
      // Create notifications - the DB trigger (on_notification_created) handles push dispatch
      const notifications = membersToNotify.map(userId => ({
        user_id: userId,
        type: "event_reminder",
        message: `Reminder: Please RSVP for "${event?.title}"`,
        related_id: id,
      }));
      
      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) throw error;
      
      return membersToNotify.length;
    },
    onSuccess: (count) => {
      toast({ 
        title: "Reminders sent", 
        description: `${count} member${count !== 1 ? 's' : ''} have been reminded to RSVP` 
      });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to send reminders", variant: "destructive" });
    },
  });

  // Individual remind mutation - sends reminder to a single member or all guardians of a child.
  // For mini-league players, userId may be empty when mini_league_players.parent_user_id is NULL;
  // in that case we derive recipients entirely from the linked child (children.parent_id + child_guardians).
  const individualRemindMutation = useMutation({
    mutationFn: async ({ userId, displayName, childId }: { userId?: string; displayName: string; childId?: string }) => {
      let recipientIds: string[] = userId ? [userId] : [];

      if (childId) {
        const [{ data: guardians }, { data: childRow }] = await Promise.all([
          supabase.from("child_guardians").select("guardian_id").eq("child_id", childId),
          supabase.from("children").select("parent_id").eq("id", childId).maybeSingle(),
        ]);
        const guardianIds = (guardians?.map((g) => g.guardian_id).filter(Boolean) as string[]) || [];
        if (childRow?.parent_id) guardianIds.push(childRow.parent_id);
        recipientIds = Array.from(new Set([...recipientIds, ...guardianIds]));
      }

      if (recipientIds.length === 0) {
        throw new Error(`${displayName} has no linked parents to remind`);
      }

      // 24h cooldown — skip recipients who were reminded in the last 24 hours
      const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
      const { data: existing } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_reminder")
        .eq("related_id", id!)
        .in("user_id", recipientIds)
        .gte("created_at", since);

      const alreadyReminded = new Set((existing || []).map((r: any) => r.user_id));
      const toRemind = recipientIds.filter((uid) => !alreadyReminded.has(uid));

      if (toRemind.length === 0) {
        throw new Error(`${displayName}${recipientIds.length > 1 ? "'s parents have" : " has"} been reminded in the last 24 hours`);
      }

      const { error } = await supabase.from("notifications").insert(
        toRemind.map((uid) => ({
          user_id: uid,
          type: "event_reminder",
          message: `Reminder: Please RSVP for "${event?.title}"`,
          related_id: id,
        }))
      );
      if (error) throw error;
      return { displayName, count: toRemind.length, isChild: !!childId, recipientKey: userId || childId || displayName };
    },
    onSuccess: ({ displayName, count, isChild, recipientKey }) => {
      const now = new Date().toISOString();
      setRecentlyReminded((prev) => {
        const next = new Map(prev);
        next.set(recipientKey, now);
        return next;
      });
      // Refresh the 24h cooldown set so the "Reminded" state survives a page reload
      queryClient.invalidateQueries({ queryKey: ["event-recent-reminders", id] });
      const description = isChild
        ? `${count} parent${count !== 1 ? "s" : ""} of ${displayName} ${count !== 1 ? "have" : "has"} been reminded to RSVP`
        : `${displayName} has been reminded to RSVP`;
      toast({ title: "Reminder sent", description });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to send reminder", variant: "destructive" });
    },
  });


  // Share event reminder link via native share
  const handleShareReminderLink = async () => {
    if (!gateEventShare()) return;
    const shareUrl = getShareUrl("event", id!);
    const shareText = `Reminder: Please RSVP for "${event?.title}"`;
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: shareText,
          text: shareText,
          url: shareUrl,
          dialogTitle: 'Share Reminder',
        });
      } else if (navigator.share) {
        await navigator.share({
          title: shareText,
          text: shareText,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        toast({ title: "Reminder link copied to clipboard!" });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        toast({ title: "Reminder link copied to clipboard!" });
      }
    }
  };


  // Resend event invites to members who haven't been notified yet
  const resendInvitesMutation = useMutation({
    mutationFn: async () => {
      if (!event || !id) throw new Error("No event");

      // Get all current team/club members
      let allMemberIds: string[] = [];
      if (event.mini_league_id) {
        const { data: league } = await supabase
          .from("mini_leagues")
          .select("club_id")
          .eq("id", event.mini_league_id)
          .single();
        if (league) {
          const [playersRes, adminsRes] = await Promise.all([
            supabase
              .from("mini_league_players")
              .select("parent_user_id")
              .eq("mini_league_id", event.mini_league_id)
              .not("parent_user_id", "is", null),
            supabase
              .from("user_roles")
              .select("user_id")
              .eq("club_id", league.club_id)
              .in("role", ["club_admin", "league_admin", "coach"]),
          ]);
          const parentIds = (playersRes.data?.map(p => p.parent_user_id).filter(Boolean) as string[]) || [];
          const adminIds = adminsRes.data?.map(r => r.user_id) || [];
          allMemberIds = [...new Set([...parentIds, ...adminIds])];
        }
      } else {
        let memberQuery = supabase.from("user_roles").select("user_id, role");
        if (event.team_id) {
          memberQuery = memberQuery.eq("team_id", event.team_id);
        } else if (event.club_id) {
          memberQuery = memberQuery.eq("club_id", event.club_id);
        }
        const { data: members } = await memberQuery;
        const restricted = Array.isArray((event as any)?.restricted_to_roles)
          ? ((event as any).restricted_to_roles as string[])
          : [];
        const rows = restricted.length > 0
          ? (members || []).filter((m: any) => restricted.includes(m.role) || m.role === "club_admin" || m.role === "app_admin")
          : (members || []);
        allMemberIds = [...new Set(rows.map((m: any) => m.user_id) || [])];
      }

      // Exclude the creator
      allMemberIds = allMemberIds.filter(uid => uid !== event.created_by);

      // Find members who already have a notification for this event
      const { data: existingNotifications } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_invite")
        .eq("related_id", id)
        .in("user_id", allMemberIds.length > 0 ? allMemberIds : ['no-match']);

      const alreadyNotified = new Set(existingNotifications?.map(n => n.user_id) || []);
      const newMembers = allMemberIds.filter(uid => !alreadyNotified.has(uid));

      if (newMembers.length === 0) {
        throw new Error("All members have already been notified about this event!");
      }

      // Insert notifications with skip_push
      const notificationRows = newMembers.map(userId => ({
        user_id: userId,
        type: "event_invite",
        message: `You've been invited to: ${event.title}`,
        related_id: id,
        skip_push: true,
      }));

      const { error: insertError } = await supabase
        .from("notifications")
        .insert(notificationRows);
      if (insertError) throw insertError;

      // Send push notifications
      for (const userId of newMembers) {
        supabase.functions.invoke("send-push-notification", {
          body: {
            userId,
            title: "Ignite",
            body: `You've been invited to: ${event.title}`,
            url: `/events/${id}`,
            tag: `event-invite-${id}`,
            notificationType: "event_invite",
          },
        }).catch(console.error);
      }

      return newMembers.length;
    },
    onSuccess: (count) => {
      setResendDialogOpen(false);
      toast({
        title: "Invites sent",
        description: `${count} new member${count !== 1 ? 's' : ''} have been notified`,
      });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to resend invites", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="py-6 space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!event) {
    // A real RLS-deny / deleted-row resolves the query with `data === null`
    // and no error. A transient network/auth race resolves with an error
    // after react-query's retries are exhausted. Show different copy so we
    // don't tell a legitimate team member their event is "not available"
    // when the lookup actually just failed.
    const transientFailure = !!eventError && !isEventFetching;
    return (
      <div className="py-12 text-center space-y-4 px-6">
        <div className="text-5xl">{transientFailure ? "⚠️" : "📋"}</div>
        <h2 className="text-xl font-bold text-foreground">
          {transientFailure ? "Couldn't load this event" : "Event Not Available"}
        </h2>
        <p className="text-muted-foreground max-w-sm mx-auto">
          {transientFailure
            ? "Something went wrong fetching this event. Check your connection and try again."
            : "This event may have been removed, or it's for a specific team or group you're not part of. If you think this is a mistake, check with your club admin."}
        </p>
        <div className="flex gap-2 justify-center mt-4">
          {transientFailure && (
            <Button
              variant="default"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["event", id] })}
            >
              Try again
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate('/')}>Go Home</Button>
        </div>
      </div>
    );
  }


  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => {
          navigate('/events');
        }}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Badge className={eventTypeColors[event.type as EventType]} variant="secondary">
          {eventTypeLabel}
        </Badge>
        
        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={async () => {
            if (isSharingEventRef.current) return;
            if (!gateEventShare()) return;
            isSharingEventRef.current = true;

            const shareUrl = getShareUrl("event", id!);
            
            

            try {
              if (Capacitor.isNativePlatform()) {
                await Share.share({
                  url: shareUrl,
                  dialogTitle: 'Share Event',
                });
              } else if (navigator.share) {
                await navigator.share({
                  url: shareUrl,
                });
              } else {
                await navigator.clipboard.writeText(shareUrl);
                toast({ title: "Link copied to clipboard!" });
              }
            } catch (err) {
              if ((err as Error).name !== 'AbortError') {
                await navigator.clipboard.writeText(shareUrl);
                toast({ title: "Link copied to clipboard!" });
              }
            } finally {
              isSharingEventRef.current = false;
            }
          }}
        >
          <Share2 className="h-5 w-5" />
        </Button>

        {/* Admin actions dropdown */}
        {(isAdmin || isAppAdmin) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              {!event.is_cancelled && (
                <>
                  <DropdownMenuItem onClick={() => navigate(`/events/${id}/edit`)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit {eventTypeLabel}
                  </DropdownMenuItem>
                  {(() => {
                     const eventDateStr = event.event_date?.split('T')[0] || event.event_date;
                     const isUpcoming = new Date(eventDateStr + 'T' + (event.end_time || event.start_time || '23:59')) >= new Date();
                    return (
                      <>
                        {isUpcoming && (canSendReminders ? (
                          <DropdownMenuItem onClick={() => {
                            setReminderDialogOpen(true);
                          }}>
                            <Bell className="h-4 w-4 mr-2 text-primary" />
                            Send Reminders
                          </DropdownMenuItem>
                        ) : !isLoadingHasTeamPro && (
                          <DropdownMenuItem disabled>
                            <Bell className="h-4 w-4 mr-2" />
                            Send Reminders
                            <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">Pro</Badge>
                          </DropdownMenuItem>
                        ))}
                        {isUpcoming && (
                          <DropdownMenuItem onClick={() => setResendDialogOpen(true)}>
                            <UserPlus className="h-4 w-4 mr-2 text-primary" />
                            Resend Invites
                          </DropdownMenuItem>
                        )}
                      </>
                    );
                  })()}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => setCancelDialogOpen(true)}
                    className="text-warning focus:text-warning"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel {eventTypeLabel}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem 
                onClick={() => setDeleteDialogOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete {eventTypeLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Reminder Dialog */}
        <AlertDialog open={reminderDialogOpen} onOpenChange={setReminderDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send RSVP Reminders?</AlertDialogTitle>
              <AlertDialogDescription>
                This will send a notification to all team members who haven't responded to this event yet.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="w-full sm:w-auto gap-1.5"
                onClick={() => {
                  setReminderDialogOpen(false);
                  handleShareReminderLink();
                }}
              >
                <Share2 className="h-4 w-4" />
                Share via...
              </Button>
              <AlertDialogCancel className="w-full sm:w-auto">Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => remindMutation.mutate()}
                disabled={remindMutation.isPending}
                className="w-full sm:w-auto"
              >
                {remindMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send In-App"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Resend Invites Dialog */}
        <AlertDialog open={resendDialogOpen} onOpenChange={setResendDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Resend Event Invites?</AlertDialogTitle>
              <AlertDialogDescription>
                This will send notifications to any new members who haven't been notified about this event yet.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => resendInvitesMutation.mutate()}
                disabled={resendInvitesMutation.isPending}
              >
                {resendInvitesMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send Invites"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Cancel Dialog - handles both single and recurring */}
        {(event.is_recurring || event.parent_event_id) ? (
          <RecurringCancelEventDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            eventTitle={event.title}
            teamId={event.team_id}
            clubId={event.club_id}
            miniLeagueId={event.mini_league_id}
            eventType={event.type}
            onSingleAction={(customMessage, sendPushNotification) => 
              cancelEventMutation.mutate({ cancelType: 'single', customMessage, sendPushNotification })
            }
            onSeriesAction={(customMessage, sendPushNotification) => 
              cancelEventMutation.mutate({ cancelType: 'series', customMessage, sendPushNotification })
            }
            isPending={cancelEventMutation.isPending}
          />
        ) : (
          <CancelEventConfirmDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            eventId={event.id}
            eventTitle={event.title}
            teamId={event.team_id}
            clubId={event.club_id}
            miniLeagueId={event.mini_league_id}
            eventType={event.type}
            onConfirm={(customMessage, sendPushNotification) => 
              cancelEventMutation.mutate({ cancelType: 'single', customMessage, sendPushNotification })
            }
            isPending={cancelEventMutation.isPending}
          />
        )}

        {/* Delete Dialog - handles both single and recurring */}
        {(event.is_recurring || event.parent_event_id) ? (
          <RecurringEventActionDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            title={`Delete ${eventTypeLabel}?`}
            description={`This will permanently delete the ${eventTypeLabel.toLowerCase()}(s) and all RSVPs. This action cannot be undone.`}
            actionLabel="Delete"
            actionVariant="destructive"
            onSingleAction={() => deleteEventMutation.mutate('single')}
            onSeriesAction={() => deleteEventMutation.mutate('series')}
            isPending={deleteEventMutation.isPending}
          />
        ) : (
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {eventTypeLabel}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this {eventTypeLabel.toLowerCase()} and all RSVPs. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={() => deleteEventMutation.mutate('single')} 
                  className="bg-destructive text-destructive-foreground"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Event Info */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{event.title}</h1>
          {event.is_cancelled && (
            <Badge variant="destructive">Cancelled</Badge>
          )}
        </div>
        <p className="text-muted-foreground">{event.clubs?.name}</p>
        {event.teams?.name && (
          <Badge variant="outline">{event.teams.name}</Badge>
        )}
      </div>

      {/* Details Card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-primary" />
            <span className="flex-1">{format(parseISO(event.event_date), "EEEE, MMMM d 'at' h:mm a")}</span>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8 -mr-2"
              aria-label="Add to calendar"
              title="Add to calendar"
              onClick={async () => {
                try {
                  await exportEventIcs({
                    id: event.id,
                    title: event.title,
                    type: event.type,
                    event_date: event.event_date,
                    start_time: (event as any).start_time,
                    end_time: (event as any).end_time,
                    description: event.description,
                    location_name: (event as any).location_name,
                    address: event.address,
                    suburb: (event as any).suburb,
                    state: (event as any).state,
                    postcode: (event as any).postcode,
                    is_cancelled: event.is_cancelled,
                    updated_at: (event as any).updated_at,
                    url: getShareUrl("event", id!),
                  });
                  toast({ title: "Calendar file ready", description: "Open it to add this event to your calendar." });
                } catch (err) {
                  toast({ title: "Couldn't export event", description: (err as Error).message, variant: "destructive" });
                }
              }}
            >
              <CalendarPlus className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
          {event.address ? (
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p>{event.address}</p>
                <p className="text-muted-foreground">
                  {[event.suburb, event.state, event.postcode].filter(Boolean).join(", ")}
                </p>
              </div>
            </div>
          ) : ((event as any).location_name || (event as any).location) ? (
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                {(event as any).location_name && <p>{(event as any).location_name}</p>}
                {(event as any).location && (event as any).location !== (event as any).location_name && (
                  <p className="text-muted-foreground">{(event as any).location}</p>
                )}
              </div>
            </div>
          ) : null}
          {event.type === "game" && event.opponent && (
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-primary" />
              <span>vs {event.opponent}</span>
            </div>
          )}
          {event.type === "game" && (() => {
            const mins = getMatchArrivalMinutes(event as any);
            const arrivalTime = formatMatchArrivalTime(event as any);
            if (mins == null || !arrivalTime) return null;
            return (
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-warning" />
                <span>
                  Arrive by {arrivalTime}{" "}
                  <span className="text-muted-foreground">({mins} min before kickoff)</span>
                </span>
              </div>
            );
          })()}
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-primary" />
            {rsvps ? (() => {
              const goingRsvps = rsvps.filter(r => r.status === "going");
              const guestCount = eventGuests?.length || 0;
              if (event.type === "social") {
                const adults = goingRsvps.filter(r => r.child_id == null).length + guestCount;
                const children = goingRsvps.filter(r => r.child_id != null).length;
                const total = adults + children;
                return (
                  <span>
                    {total} attending
                    {(adults > 0 || children > 0) && (
                      <span className="text-muted-foreground">
                        {" "}· {adults} adult{adults === 1 ? "" : "s"}, {children} {children === 1 ? "child" : "children"}
                      </span>
                    )}
                  </span>
                );
              }
              // Players-only count: mirror the same filter the Going list uses
              // (child RSVP, mini-league player, or adult RSVP whose membership
              // includes the "player" role) so the header and "Going (N)" tab
              // always agree.
              const playerUserIds = new Set((playerMembers || []).map((m: any) => m.id));
              const _seenKeys = new Set<string>();
              const playerGoing = goingRsvps.filter((r: any) => {
                const isPlayer = r.child_id || r.mini_league_player_id || (r.user_id && playerUserIds.has(r.user_id));
                if (!isPlayer) return false;
                const linkedChildId = r.child_id || r.mini_league_players?.child_id || null;
                const key = linkedChildId ? `c:${linkedChildId}` : r.mini_league_player_id ? `m:${r.mini_league_player_id}` : `u:${r.user_id}`;
                if (_seenKeys.has(key)) return false;
                _seenKeys.add(key);
                return true;
              }).length;
              const count = playerGoing + guestCount;
              return <span>{count} {count === 1 ? "player" : "players"} attending</span>;

            })() : <span>Loading...</span>}
          </div>

          {/* Price for social events */}
          {event.type === "social" && eventPrice && eventPrice > 0 && (
            <div className="flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-primary" />
              <span>${Number(eventPrice).toFixed(2)} per person</span>
            </div>
          )}
          {/* Pitch Board / Start Game button for game events.
              Admins & coaches can open it for any upcoming game (not just on
              game day) so they can pre-set the lineup and auto-sub plan
              ahead of time. Past games (>3h after kickoff) stay hidden. */}
          {(isPitchBoardAccessLoading || (canAccessPitchBoard && isTeamMembersForPitchLoading)) && event.type === "game" && !!event.team_id && (isSoccerClub || isNetballClub || isBasketballClub) && (
            <Button variant="outline" className="w-full mt-2" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Checking match access…
            </Button>
          )}
          {!isPitchBoardAccessLoading && canAccessPitchBoard && teamMembers && (() => {
            const eventTime = parseISO(event.event_date);
            const now = new Date();
            const minutesUntilKickoff = (eventTime.getTime() - now.getTime()) / (1000 * 60);
            const isWithin120Min = minutesUntilKickoff <= 120 && minutesUntilKickoff > 0;
            const hasStarted = minutesUntilKickoff <= 0;
            const isPastGame = hasStarted && minutesUntilKickoff < -180; // more than 3 hours ago

            // Don't show any pitch board button for past games
            if (isPastGame) return null;

            // Live / imminent: prominent CTA
            if (hasStarted || isWithin120Min) {
              return (
                <Button
                  variant="default"
                  size="lg"
                  className="w-full mt-2 h-14 text-lg font-bold gap-3"
                  onClick={() => setShowPitchBoard(true)}
                >
                  <Play className="h-5 w-5" />
                  {hasStarted ? "Open Match" : "Start Game"}
                </Button>
              );
            }

            // Future game: pre-prep lineup & auto-subs
            return (
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={() => setShowPitchBoard(true)}
              >
                <Play className="h-4 w-4 mr-2" />
                Prepare Lineup &amp; Auto-Subs
              </Button>
            );
          })()}
          {/* Read-only "Watch Live" button for parents when game is in progress */}
          {canViewPitchBoardReadOnly && teamMembers && (
            <Button
              variant="default"
              size="lg"
              className="w-full mt-2 h-14 text-lg font-bold gap-3"
              onClick={() => setShowPitchBoard(true)}
            >
              <Play className="h-5 w-5" />
              Open Pitch Board
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Match Score — viewable by team members; editable by team admins/coaches/club admins, app admins, and the Subs Manager assigned to the event */}
      {event.type === "game" && event.team_id && (isTeamMember || isAdmin || isAppAdmin) && (() => {
        const canEditScore = !!(isAdmin || isAppAdmin || isSubsManagerForEvent);
        // Fallback: derive opponent from title (e.g. "Round 4: Wolves v Stirling District")
        const derivedOpponent = (() => {
          if (event.opponent) return event.opponent;
          const m = (event.title || "").split(/\s+(?:v|vs|versus)\.?\s+/i);
          return m.length > 1 ? m[m.length - 1].trim() : null;
        })();
        return (
          <MatchScoreCard
            eventId={event.id}
            teamId={event.team_id}
            teamName={event.teams?.name || "Our Team"}
            opponent={derivedOpponent}
            sport={event.clubs?.sport}
            canEdit={canEditScore}
          />
        );
      })()}

      {/* Map */}
      {(() => {
        const mapAddress =
          event.address ||
          (event as any).location ||
          (event as any).location_name ||
          null;
        if (!mapAddress) return null;
        return (
          <GoogleMapEmbed
            address={mapAddress}
            className="w-full h-48 rounded-lg border"
          />
        );
      })()}

      {/* Mini League Matches — PRIMARY section for league events, placed at top */}
      {isMiniLeagueEvent && event.mini_league_id && (
        <>
          <Separator />
          <section className="space-y-3">
            <EventGroupsManager
              eventId={id!}
              miniLeagueId={event.mini_league_id}
              isAdmin={isAdmin || isAppAdmin || false}
              playerOverrides={playerOverrides}
            />
          </section>
        </>
      )}

      {/* Event Sponsors (Pro only) */}
      <EventSponsorsSection eventId={id!} clubId={event.club_id} />

      {/* Event-detail sponsor/ad strip (per-club opt-in; hidden when off) */}
      <SponsorOrAdCarousel location="event-detail" activeClubFilter={event.club_id} />


      {/* Event Views are now surfaced inside the unified Attendance section below */}

      {event.description && (
        <p className="text-muted-foreground whitespace-pre-line">{event.description}</p>
      )}

      {/* Event Note (coach/admin pinned info, notifies attendees) */}
      <EventNoteSection
        eventId={id!}
        note={(event as any).coach_note}
        noteUpdatedAt={(event as any).coach_note_updated_at}
        noteAuthor={(event as any).coach_note_author}
        canEdit={!!(isAdmin || isAppAdmin)}
      />


      {/* Notification Nudge for events */}
      {notificationNudge.shouldShowNudge && !myRsvp && (
        <NotificationNudgeBanner
          message="Turn on notifications so you never miss match updates"
          onDismiss={notificationNudge.dismiss}
          userId={user?.id}
        />
      )}

      {/* RSVP Section */}
      {(() => {
        const audience = resolveRsvpAudience(
          (event as any)?.rsvp_audience,
          (event as any)?.teams?.default_rsvp_audience,
        );
        const promptParent = isMiniLeagueEvent ? true : shouldPromptParent(audience);
        const promptPlayer = isMiniLeagueEvent ? true : shouldPromptPlayer(audience);
        const childrenBlock = (!isMiniLeagueEvent && promptPlayer && !hasRestrictedEventRoles && childrenOnTeam && childrenOnTeam.length > 0) ? (() => {
          const unrespondedChildren = childrenOnTeam.filter(
            (c: any) => !childRsvps.find((r) => r.child_id === c.id),
          );
          const unrespondedCount = unrespondedChildren.length;
          const goingCount = childRsvps.filter(r => r.status === "going").length;
          const maybeCount = childRsvps.filter(r => r.status === "maybe").length;
          return (
            <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50 bg-muted/30">
                <Baby className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">Children's RSVP</h2>
                <div className="ml-auto flex items-center gap-2 text-xs">
                  {unrespondedCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
                      <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
                      </span>
                      {unrespondedCount === 1 && childrenOnTeam.length === 1
                        ? `${unrespondedChildren[0].name} awaiting`
                        : `${unrespondedCount} awaiting`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {goingCount > 0 && `${goingCount} going`}
                      {maybeCount > 0 && `${goingCount > 0 ? " · " : ""}${maybeCount} maybe`}
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-3 p-3">
                {childrenOnTeam.map((child: any) => {
                  const childRsvp = childRsvps.find((r) => r.child_id === child.id);
                  const isUnresponded = !childRsvp;
                  return (
                    <div key={child.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                              {child.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium">{child.name}</span>
                          {isUnresponded && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive"
                              aria-label="Awaiting your response"
                            >
                              <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
                              </span>
                              Awaiting response
                            </span>
                          )}
                        </div>
                        {childRsvp && (
                          <div className="flex items-center gap-1.5">
                            {(childRsvp as any).source === "default" && (
                              <span
                                title="Auto-applied from training default. Tap a button to confirm."
                                className="rounded-full bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5"
                              >
                                Auto
                              </span>
                            )}
                            <Badge variant={childRsvp.status === "going" ? "default" : "secondary"} className="text-xs">
                              {childRsvp.status === "going" ? "Going" : childRsvp.status === "maybe" ? "Maybe" : "Not Going"}
                            </Badge>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {rsvpOptions.map(({ value, label, icon }) => (
                          <Button
                            key={value}
                            variant={childRsvp?.status === value ? "default" : "outline"}
                            size="sm"
                            className="flex flex-col h-auto py-2"
                            onClick={() => childRsvpMutation.mutate({ childId: child.id, status: value, childName: child.name })}
                            disabled={childRsvpMutation.isPending}
                          >
                            <span>{icon}</span>
                            <span className="text-xs">{label}</span>
                          </Button>
                        ))}
                      </div>
                      <TrainingDefaultControl
                        teamId={event?.team_id ?? null}
                        childId={child.id}
                        subjectName={child.name}
                        currentRsvpStatus={(childRsvp?.status as any) ?? null}
                        isTraining={event?.type === "training"}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })() : null;

        const parentFirstHeading = isParentFirstEvent(event as any);
        const parentBlock = promptParent ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className={isMiniLeagueEvent ? "text-lg font-semibold" : ((childrenBlock && !parentFirstHeading) ? "text-sm font-semibold text-muted-foreground uppercase tracking-wide" : "text-lg font-semibold")}>
                {isMiniLeagueEvent ? "Attendance" : "Your RSVP"}
              </h2>
              {(myRsvp as any)?.source === "default" && (
                <span
                  title="Auto-applied from your training default. Tap a button to confirm."
                  className="rounded-full bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5"
                >
                  Auto
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {rsvpOptions.map(({ value, label, icon }) => (
                <Button
                  key={value}
                  variant={myRsvp?.status === value ? "default" : "outline"}
                  className="flex flex-col h-auto py-3"
                  onClick={() => myRsvp?.status !== value && rsvpMutation.mutate(value)}
                  disabled={rsvpMutation.isPending || myRsvp?.status === value}
                >
                  <span className="text-lg">{icon}</span>
                  <span className="text-xs mt-1">{label}</span>
                </Button>
              ))}
            </div>

            <TrainingDefaultControl
              teamId={event?.team_id ?? null}
              userId={user?.id ?? null}
              subjectName="You"
              currentRsvpStatus={(myRsvp?.status as any) ?? null}
              isTraining={event?.type === "training"}
            />

            <Card className="border-dashed">
              <CardContent className="p-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rsvpNotes" className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Note to organiser (with your RSVP)
                  </Label>
                  <Textarea
                    id="rsvpNotes"
                    placeholder="Any notes for the organizer (e.g., arriving late, bringing equipment)..."
                    value={rsvpNotes}
                    onChange={(e) => setRsvpNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>

            {showPaymentStatus && myRsvp?.status === "going" && (
              <Card className={userHasPaid ? "border-green-500/30 bg-green-500/5" : "border-warning/30 bg-warning/5"}>
                <CardContent className="p-4">
                  {userHasPaid ? (
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-green-500/20">
                        <Check className="h-5 w-5 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium text-green-600">Payment Complete</p>
                        <p className="text-sm text-muted-foreground">You've paid ${Number(eventPrice).toFixed(2)} for this event</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-warning/20">
                          <DollarSign className="h-5 w-5 text-warning" />
                        </div>
                        <div>
                          <p className="font-medium">Payment Required</p>
                          <p className="text-sm text-muted-foreground">${Number(eventPrice).toFixed(2)} per person</p>
                        </div>
                      </div>
                      <Button
                        onClick={handlePayNow}
                        disabled={isProcessingPayment}
                        className="shrink-0"
                      >
                        {isProcessingPayment ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <DollarSign className="h-4 w-4 mr-2" />
                            Pay Now
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        ) : null;

        const parentFirst = isParentFirstEvent(event as any);
        return (
      <section className="space-y-4">
        {parentFirst ? parentBlock : childrenBlock}
        {childrenBlock && parentBlock && <Separator />}
        {parentFirst ? childrenBlock : parentBlock}

        {/* Mini-league: parent's per-player RSVP */}
        {isMiniLeagueEvent && myMiniLeaguePlayers && myMiniLeaguePlayers.length > 0 && (
          <div className="pt-2">
            <Separator />
            <div className="mt-3 rounded-xl border border-border/50 bg-muted/20 p-3 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Baby className="h-4 w-4 text-primary" />
                Your players
              </h3>
              {myMiniLeaguePlayers.map((player: any) => {
                const playerRsvp = rsvps?.find((r) => r.mini_league_player_id === player.id);
                return (
                  <div key={player.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                            {player.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium">{player.name}</span>
                      </div>
                      {playerRsvp && (
                        <Badge variant={playerRsvp.status === "going" ? "default" : "secondary"} className="text-xs">
                          {playerRsvp.status === "going" ? "Going" : playerRsvp.status === "maybe" ? "Maybe" : "Not Going"}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {rsvpOptions.map(({ value, label, icon }) => (
                        <Button
                          key={value}
                          variant={playerRsvp?.status === value ? "default" : "outline"}
                          size="sm"
                          className="flex flex-col h-auto py-2"
                          onClick={() => parentLeaguePlayerRsvpMutation.mutate({ playerId: player.id, status: value })}
                          disabled={parentLeaguePlayerRsvpMutation.isPending}
                        >
                          <span>{icon}</span>
                          <span className="text-xs">{label}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
        );
      })()}


      {/* Guest Management Section - only for social events with guests enabled */}
      {event.type === "social" && event.allow_guests && myRsvp?.status === "going" && (
        <EventGuestsManager
          eventId={event.id}
          clubId={event.club_id}
          maxGuestsPerMember={event.max_guests_per_member || 2}
          isAdmin={isAdmin || isAppAdmin}
        />
      )}


      {/* Mini League Matches - rendered earlier for mini league events (moved above Responses) */}
      {!isMiniLeagueEvent && event.mini_league_id && null}

      <Separator />

      {/* Unified Attendance section — replaces standalone Responses + Event Views */}
      {(() => {
        // Get player user IDs for filtering
        const playerUserIds = new Set(playerMembers?.map((m: any) => m.id) || []);


        const filterRsvp = (rsvp: any) => {
          if (effectiveShowAll) return true;
          if (isMiniLeagueEvent) {
            // Kids-only by default: hide adult/parent self-RSVPs.
            return !!rsvp.child_id || !!rsvp.mini_league_player_id;
          }
          if (rsvp.mini_league_player_id) return true;
          if (rsvp.child_id) return true;
          return playerUserIds.has(rsvp.user_id);
        };

        // Dedupe duplicate RSVP rows for the same player/adult (e.g. co-parent
        // double-RSVPs or accidental duplicate inserts) so the list and the
        // header count always agree.
        const dedupeRsvps = (list: any[]) => {
          const seen = new Set<string>();
          return list.filter((r: any) => {
            // Prefer child_id (direct or via linked mini-league player) so the
            // same underlying child isn't shown twice when both an mlp RSVP
            // and a child RSVP exist.
            const linkedChildId = r.child_id || r.mini_league_players?.child_id || null;
            const key = linkedChildId
              ? `c:${linkedChildId}`
              : r.mini_league_player_id
                ? `m:${r.mini_league_player_id}`
                : `u:${r.user_id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        };
        const goingRsvps = dedupeRsvps(rsvps?.filter((r) => r.status === "going" && filterRsvp(r)) || []);
        const maybeRsvps = dedupeRsvps(rsvps?.filter((r) => r.status === "maybe" && filterRsvp(r)) || []);
        const notGoingRsvps = dedupeRsvps(rsvps?.filter((r) => r.status === "not_going" && filterRsvp(r)) || []);

        const respondedUserIds = new Set(rsvps?.filter(r => !r.child_id).map(r => r.user_id) || []);
        const respondedChildIds = new Set(rsvps?.filter(r => r.child_id).map(r => r.child_id) || []);
        const respondedMiniLeaguePlayerIds = new Set(
          rsvps?.filter(r => r.mini_league_player_id).map(r => r.mini_league_player_id) || []
        );

        let notResponded: any[] = [];
        let notRespondedChildren: any[] = [];

        if (isMiniLeagueEvent && miniLeaguePlayers) {
          notRespondedChildren = miniLeaguePlayers.filter((player: any) => {
            // A player only counts as "responded" if an RSVP exists for that specific
            // player (mini_league_player_id) or for their linked child (child_id).
            // The parent's own adult RSVP says nothing about whether the player is
            // attending, so do NOT hide the player just because their parent_user_id
            // has any RSVP on the event.
            if (respondedMiniLeaguePlayerIds.has(player.id)) return false;
            if (player.child_id && respondedChildIds.has(player.child_id)) return false;
            return true;
          });
          // Adults bucket only when "Show all roles" is on.
          if (effectiveShowAll) {
            notResponded = (miniLeagueAdults || []).filter(
              (adult: any) => !respondedUserIds.has(adult.id),
            );
          }
        } else {
          const membersToShow = effectiveShowAll ? members : playerMembers;
          const parentIdsWithRespondedChildren = new Set<string>();
          (allChildrenOnTeam || []).forEach((child: any) => {
            if (child.parent_id && respondedChildIds.has(child.id)) {
              parentIdsWithRespondedChildren.add(child.parent_id);
            }
          });
          (childGuardiansOnTeam || []).forEach((cg: any) => {
            if (cg.guardian_id && respondedChildIds.has(cg.child_id)) {
              parentIdsWithRespondedChildren.add(cg.guardian_id);
            }
          });
          notResponded = membersToShow?.filter((m: any) =>
            !respondedUserIds.has(m.id) && !parentIdsWithRespondedChildren.has(m.id)
          ) || [];
          notRespondedChildren = allChildrenOnTeam?.filter((child: any) => !respondedChildIds.has(child.id)) || [];
        }

        const totalNotResponded = isMiniLeagueEvent
          ? notRespondedChildren.length + notResponded.length
          : notResponded.length + notRespondedChildren.length;

        // Always derive non-responder IDs from ALL members (not filtered by "Show all roles")
        // so admins can always send reminders, regardless of the visible roster filter.
        const allNotRespondedForReminders = isMiniLeagueEvent
          ? (miniLeagueAdults || []).filter((adult: any) => !respondedUserIds.has(adult.id))
          : (members?.filter((m: any) =>
              !respondedUserIds.has(m.id) &&
              !(new Set<string>([
                ...((allChildrenOnTeam || [])
                  .filter((c: any) => respondedChildIds.has(c.id))
                  .map((c: any) => c.parent_id)
                  .filter(Boolean)),
                ...((childGuardiansOnTeam || [])
                  .filter((cg: any) => respondedChildIds.has(cg.child_id))
                  .map((cg: any) => cg.guardian_id)
                  .filter(Boolean)),
              ])).has(m.id)
            ) || []);


        const renderBucket = (rsvpList: any[], status: RsvpStatus, includeGuests = false) => (
          <div className="divide-y divide-border/50">
            {rsvpList.map((rsvp: any) => (
              <AttendeeCard
                key={rsvp.id}
                rsvp={rsvp}
                hasPaid={status !== "not_going" ? paidUserIds.has(rsvp.user_id) : undefined}
                isAdmin={isAdmin || isAppAdmin}
                showPrice={status !== "not_going" && !!showPaymentStatus}
                onTogglePayment={status !== "not_going" ? () => togglePaymentMutation.mutate({
                  userId: rsvp.user_id,
                  isPaid: paidUserIds.has(rsvp.user_id)
                }) : undefined}
                isPending={togglePaymentMutation.isPending || adminUpdateRsvpMutation.isPending}
                isMiniLeague={isMiniLeagueEvent}
                currentStatus={status}
                onChangeStatus={(newStatus) => adminUpdateRsvpMutation.mutate({
                  rsvpId: rsvp.id,
                  status: newStatus,
                  playerName: rsvp.mini_league_player_id
                    ? rsvp.mini_league_players?.name
                    : (rsvp.child_id ? rsvp.children?.name : rsvp.profiles?.display_name)
                })}
                memberRole={!rsvp.child_id && !rsvp.mini_league_player_id
                  ? membersWithRoles?.find((m: any) => m.id === rsvp.user_id)?.roles?.[0]
                  : undefined}
                isCaptain={
                  isGameEvent && (
                    (!!rsvp.user_id && rsvp.user_id === captainUserId) ||
                    (!!rsvp.child_id && rsvp.child_id === captainChildId)
                  )
                }
                isPotm={
                  isGameEvent && (
                    (!!rsvp.user_id && rsvp.user_id === potmUserId) ||
                    (!!rsvp.child_id && rsvp.child_id === potmChildId)
                  )
                }
                isGoalkeeper={
                  isGameEvent && (
                    (!!rsvp.user_id && gkUserIds.has(rsvp.user_id)) ||
                    (!!rsvp.child_id && gkChildIds.has(rsvp.child_id))
                  )
                }
              />
            ))}
            {includeGuests && eventGuests?.map((guest: any) => (
              <AttendanceRow
                key={guest.id}
                name={guest.guest_name}
                roleLabel="Guest"
                roleTone="guest"
                secondaryLine={`Guest of ${guest.added_by_name}`}
              />
            ))}
          </div>
        );

        const notRespondedNode = (
          <div className="divide-y divide-border/50">
            {notRespondedChildren.map((child: any) => {
              // For mini-league players: parent_user_id may be null; we still allow remind via
              // the linked child (children.parent_id + child_guardians).
              const isPendingChild = isMiniLeagueEvent ? !!child.is_pending : false;
              const remindParentId: string | undefined = isMiniLeagueEvent ? child.parent_user_id : child.parent_id;
              const remindChildId: string | undefined = isMiniLeagueEvent ? child.child_id : (child.child_id || child.id);
              const recipientKey = remindParentId || remindChildId || child.id;
              // No one to remind if the child is pending (no parent has accepted the app yet).
              const canRemind = !isPendingChild && !!(remindParentId || remindChildId);
              const remindBtn = (isAdmin || isAppAdmin) && canRemind ? (() => {
                const isLoadingThis = individualRemindMutation.isPending && individualRemindMutation.variables?.userId === remindParentId && individualRemindMutation.variables?.childId === remindChildId;
                const lastRemindedAt = recentlyReminded.get(recipientKey) || (remindParentId ? recentReminderMap?.get(remindParentId) : null) || null;
                const wasReminded = !!lastRemindedAt;
                const remindedLabel = lastRemindedAt ? `Reminded ${formatRelativePast(lastRemindedAt)}` : "Reminded";
                const isProBlocked = !canSendReminders && !wasReminded;
                return (
                  <Button
                    variant={wasReminded ? "secondary" : isProBlocked ? "outline" : "default"}
                    size="sm"
                    className={`h-8 px-2.5 shrink-0 gap-1 ${isProBlocked ? "opacity-60 cursor-not-allowed" : ""}`}
                    onClick={() => {
                      if (!gateReminders()) return;
                      individualRemindMutation.mutate({ userId: remindParentId, displayName: child.name || "Unknown", childId: remindChildId });
                    }}
                    disabled={isLoadingThis || wasReminded}
                    title={wasReminded ? remindedLabel : isProBlocked ? "Pro required — upgrade to send reminders" : "Remind all parents"}
                  >
                    {isLoadingThis ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : wasReminded ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : isProBlocked ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <Bell className="h-3.5 w-3.5" />
                    )}
                    <span className="text-xs">{wasReminded ? remindedLabel : isProBlocked ? "Pro" : "Remind"}</span>
                  </Button>
                );
              })() : null;


              const editBtn = (isAdmin || isAppAdmin) ? (
                <AdminRsvpChanger
                  currentStatus={null}
                  playerName={child.name || "Unknown"}
                  onChangeStatus={(status) => {
                    if (isMiniLeagueEvent) {
                      adminRsvpMutation.mutate({
                        playerId: child.id,
                        playerName: child.name,
                        childId: child.child_id,
                        parentUserId: child.parent_user_id,
                        status,
                      });
                    } else {
                      rsvpForChildMutation.mutate({
                        childId: child.id,
                        childName: child.name,
                        parentUserId: child.parent_id,
                        status,
                      });
                    }
                  }}
                  isPending={adminRsvpMutation.isPending || rsvpForChildMutation.isPending}
                />
              ) : null;
              return (
                <AttendanceRow
                  key={`child-${child.id}`}
                  name={child.name || "Unknown"}
                  roleLabel={!isMiniLeagueEvent ? "Child" : null}
                  roleTone="child"
                  isPending={isPendingChild}
                  rightSlot={
                    <>
                      {remindBtn}
                      {editBtn}
                    </>
                  }
                />
              );
            })}
            {notResponded.map((member: any) => {
              const remindBtn = (isAdmin || isAppAdmin) ? (() => {
                const isLoadingThis = individualRemindMutation.isPending && individualRemindMutation.variables?.userId === member.id;
                const lastRemindedAt = recentlyReminded.get(member.id) || recentReminderMap?.get(member.id) || null;
                const wasReminded = !!lastRemindedAt;
                const remindedLabel = lastRemindedAt ? `Reminded ${formatRelativePast(lastRemindedAt)}` : "Reminded";
                const isProBlocked = !canSendReminders && !wasReminded;
                return (
                  <Button
                    variant={wasReminded ? "secondary" : isProBlocked ? "outline" : "default"}
                    size="sm"
                    className={`h-8 px-2.5 shrink-0 gap-1 ${isProBlocked ? "opacity-60 cursor-not-allowed" : ""}`}
                    onClick={() => {
                      if (!gateReminders()) return;
                      individualRemindMutation.mutate({ userId: member.id, displayName: member.display_name || "Unknown" });
                    }}
                    disabled={isLoadingThis || wasReminded}
                    title={wasReminded ? remindedLabel : isProBlocked ? "Pro required — upgrade to send reminders" : "Send reminder"}
                  >
                    {isLoadingThis ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : wasReminded ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : isProBlocked ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <Bell className="h-3.5 w-3.5" />
                    )}
                    <span className="text-xs">{wasReminded ? remindedLabel : isProBlocked ? "Pro" : "Remind"}</span>
                  </Button>
                );
              })() : null;
              const editBtn = (isAdmin || isAppAdmin) ? (
                <AdminRsvpChanger
                  currentStatus={null}
                  playerName={member.display_name || "Unknown"}
                  onChangeStatus={(status) => rsvpForMemberMutation.mutate({
                    memberId: member.id,
                    memberName: member.display_name,
                    status,
                  })}
                  isPending={rsvpForMemberMutation.isPending}
                />
              ) : null;
              return (
                <AttendanceRow
                  key={member.id}
                  name={member.display_name || "Unknown"}
                  avatarUrl={member.avatar_url}
                  roleLabel={member.roles?.[0] ? String(member.roles[0]).replace(/_/g, " ") : null}
                  roleTone="neutral"
                  rightSlot={
                    <>
                      {remindBtn}
                      {editBtn}
                    </>
                  }
                />
              );
            })}
          </div>
        );

        const goingTotal = goingRsvps.length + (eventGuests?.length || 0);
        const trackableMembers = (members?.length || 0);

        return (
          <div className="space-y-3">
            {/* "Show all" filter retained for training/game events */}
            {!isSocialEvent && (
              <div className="flex items-center justify-end gap-2">
                <Checkbox
                  id="showAllRoles"
                  checked={showAllRoles}
                  onCheckedChange={(checked) => setShowAllRoles(checked === true)}
                />
                <Label htmlFor="showAllRoles" className="text-xs cursor-pointer text-muted-foreground">Show all roles</Label>
              </div>
            )}
            {/* Phase 2: Confirmed vs Auto split for coaches on trainings */}
            {(isAdmin || isAppAdmin) && event.type === "training" && goingRsvps.length > 0 && (() => {
              const auto = goingRsvps.filter((r: any) => r.source === "default").length;
              const confirmed = goingRsvps.length - auto;
              return (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    {confirmed} confirmed
                  </span>
                  {auto > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2 py-1">
                      <span className="h-2 w-2 rounded-full border border-primary" />
                      {auto} on default
                    </span>
                  )}
                </div>
              );
            })()}
            <AttendanceSection
              eventId={id!}
              isAdmin={isAdmin || isAppAdmin}
              hasMembers={trackableMembers > 0 || (allChildrenOnTeam?.length || 0) > 0}
              counts={{
                going: goingTotal,
                maybe: maybeRsvps.length,
                notGoing: notGoingRsvps.length,
                notResponded: totalNotResponded,
              }}
              goingContent={renderBucket(goingRsvps, "going", true)}
              maybeContent={renderBucket(maybeRsvps, "maybe")}
              notGoingContent={renderBucket(notGoingRsvps, "not_going")}
              notRespondedContent={notRespondedNode}
              notRespondedUserIds={allNotRespondedForReminders.map((m: any) => m.id)}
              canSendReminders={canSendReminders}
              trackableMembersCount={isMiniLeagueEvent ? (miniLeagueAdults?.length ?? 0) : trackableMembers}
              addressableMembers={(() => {
                if (isMiniLeagueEvent) return miniLeagueAdults ?? [];
                const restricted = (event as any)?.restricted_to_roles as string[] | null | undefined;
                if (restricted && restricted.length > 0) {
                  const allowed = new Set(restricted);
                  return (members ?? []).filter((m: any) =>
                    (m.roles ?? []).some((r: string) =>
                      allowed.has(r) || r === "club_admin" || r === "app_admin",
                    ),
                  );
                }
                return members;
              })()}
              onShareLink={handleShareReminderLink}
              onProRequired={gateReminders}
              eventType={event.type}
            />
          </div>
        );
      })()}


      {/* Player of Match Section (only for games) */}
      {event.type === "game" && event.team_id && (
        <>
          <Separator />
          <MatchCaptainSelector
            eventId={id!}
            teamId={event.team_id}
            isAdmin={isAdmin || isAppAdmin || false}
            rsvps={rsvps || []}
          />
          {(() => {
            const sport = (event.clubs?.sport || '').toLowerCase();
            const hasGoalkeeper = ['soccer','football','futsal','netball','hockey','handball','water polo','waterpolo','lacrosse','rugby'].some(k => sport.includes(k));
            if (!hasGoalkeeper) return null;
            return (
              <MatchGoalkeepersSelector
                eventId={id!}
                teamId={event.team_id}
                isAdmin={isAdmin || isAppAdmin || false}
                rsvps={rsvps || []}
              />
            );
          })()}
          <PlayerOfMatchSelector
            eventId={id!}
            clubId={event.club_id}
            teamId={event.team_id}
            isAdmin={isAdmin || isAppAdmin || false}
            rsvps={rsvps || []}
            childrenOnTeam={allChildrenOnTeam || childrenOnTeam}
          />
        </>
      )}

      {/* Duties Section (only for non-mini-league games — mini league duties are auto-created via Generate Matches) */}
      {event.type === "game" && !isMiniLeagueEvent && (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Duty Roster</h2>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setAddDutyOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Duty
                </Button>
              )}
            </div>
            
            <AddDutySheet
              open={addDutyOpen}
              onOpenChange={setAddDutyOpen}
              onAddDuty={(dutyName, opts) => addDutyMutation.mutate({ dutyName, startTime: opts?.startTime, endTime: opts?.endTime })}
              isPending={addDutyMutation.isPending}
              isMiniLeague={!!event?.mini_league_id}
              context="session"
            />
            {duties?.length === 0 ? (
              <p className="text-muted-foreground text-sm">No duties assigned for this event</p>
            ) : (
              <div className="space-y-2">
                {duties?.map((duty) => (
                  <Card key={duty.id} className={duty.status === "completed" ? "opacity-60" : ""}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {duty.status === "completed" ? (
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground" />
                        )}
                        <div>
                          <p className="font-medium">{duty.name}</p>
                          {(duty as any).start_time && (
                            <p className="text-xs text-muted-foreground whitespace-nowrap">
                              {format(new Date((duty as any).start_time), "h:mm a")}
                              {(duty as any).end_time ? ` – ${format(new Date((duty as any).end_time), "h:mm a")}` : ""}
                            </p>
                          )}

                          {duty.profiles ? (
                            <p className="text-sm text-muted-foreground">
                              {duty.profiles.display_name}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground">Unassigned</p>
                          )}
                          {duty.status === "completed" && (duty.assigned_to === user?.id || isAdmin) && (
                            <button
                              type="button"
                              onClick={() => uncompleteDutyMutation.mutate(duty.id)}
                              disabled={uncompleteDutyMutation.isPending}
                              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground mt-0.5 disabled:opacity-50"
                            >
                              {uncompleteDutyMutation.isPending ? "Reopening…" : "Marked by mistake? Reopen"}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isAdmin && duty.status === "open" && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setSelectedDutyId(duty.id);
                                setSelectedUserId(duty.assigned_to || "");
                                setAssignDialogOpen(true);
                              }}
                            >
                              <UserPlus className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteDutyMutation.mutate(duty.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                        {duty.status === "open" && !duty.assigned_to && !isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => claimDutyMutation.mutate(duty.id)}
                            disabled={claimDutyMutation.isPending}
                          >
                            Claim
                          </Button>
                        )}
                        {duty.status === "open" && (duty.assigned_to === user?.id || isAdmin) && (() => {
                          const earliest = event?.type === "game"
                            ? (getMatchArrivalDate(event as any) ?? new Date(event.start_time || event.event_date))
                            : new Date(event!.start_time || event!.event_date);
                          const tooEarly = !Number.isNaN(earliest.getTime()) && new Date() < earliest;
                          return (
                            <div className="flex flex-col items-end gap-1">
                              <Button
                                size="sm"
                                onClick={() => completeDutyMutation.mutate(duty.id)}
                                disabled={completeDutyMutation.isPending || tooEarly}
                                title={tooEarly ? `Available from ${format(earliest, "EEE d MMM, h:mm a")}` : undefined}
                              >
                                {completeDutyMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Complete"
                                )}
                              </Button>
                              {tooEarly && (
                                <span className="text-[10px] text-muted-foreground">
                                  Available {format(earliest, "EEE d MMM, h:mm a")}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        {duty.status === "completed" && (
                          <Badge variant="secondary" className="bg-primary/20 text-primary gap-1">
                            <Check className="h-3 w-3" />
                            Completed
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Assign Duty Sheet */}
      <AssignDutySheet
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        dutyName={duties?.find(d => d.id === selectedDutyId)?.name || "Duty"}
        currentAssignee={selectedUserId || null}
        members={
          isMiniLeagueEvent
            ? (miniLeagueDutyAssignees?.map((m: any) => ({
                id: m.id,
                display_name: m.display_name,
                avatar_url: m.avatar_url,
              })) || [])
            : (members?.map((m: any) => ({
                id: m.id,
                display_name: m.display_name,
                avatar_url: m.avatar_url,
              })) || [])
        }
        onAssign={(userId) => assignDutyMutation.mutate(userId)}
        isPending={assignDutyMutation.isPending}
      />

      {/* Pitch Board Modal — soccer */}
      {showPitchBoard && isSoccerClub && (canAccessSoccerBoard || canViewPitchBoardReadOnly) && teamMembers && event?.team_id && createPortal(
        <Suspense fallback={
          <div className="fixed inset-0 top-0 left-0 right-0 bottom-0 w-screen h-screen flex items-center justify-center" style={{ backgroundColor: '#2d5a27', zIndex: 999999 }}>
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary">
                  <Flame className="h-8 w-8 text-primary-foreground" />
                </div>
                <span className="text-4xl">⚽</span>
              </div>
              <Loader2 className="h-6 w-6 animate-spin text-white" />
              <p className="text-sm text-white/80">Loading pitch board...</p>
            </div>
          </div>
        }>
          <PitchBoard
            teamId={event.team_id}
            teamName={event.teams?.name || "Team"}
            members={teamMembers.map(m => ({
              id: m.user_id,
              user_id: m.user_id,
              role: m.role,
              profiles: m.profiles
            }))}
            onClose={closePitchBoardWithFlag(setShowPitchBoard)}
            disableAutoSubs={teamSubscription?.disable_auto_subs || false}
            initialRotationSpeed={teamSubscription?.rotation_speed || 1}
            initialDisablePositionSwaps={teamSubscription?.disable_position_swaps || false}
            initialDisableBatchSubs={teamSubscription?.disable_batch_subs || false}
            initialRotateGkAtHalftime={teamSubscription?.rotate_gk_at_halftime ?? true}
            initialMinutesPerHalf={teamSubscription?.minutes_per_half || defaultMinutesPerHalfForTeamName(event.teams?.name)}
            initialMaxSpreadMinutes={(teamSubscription as any)?.max_spread_minutes ?? 5}
            initialTeamSize={teamSubscription?.team_size}
            initialFormation={teamSubscription?.formation || undefined}
            initialLinkedEventId={id}
            initialShowMatchHeader={teamSubscription?.show_match_header ?? true}
            initialShowLineupPicker={teamSubscription?.show_lineup_picker || false}
            initialMode={event?.type === "training" ? "training" : "match"}
            readOnly={!!canViewPitchBoardReadOnly && !isSubsManagerForEvent}
            isSubsManager={isSubsManagerForEvent}
          />
        </Suspense>,
        document.body
      )}

      {/* Game Board Modal — netball */}
      {showPitchBoard && isNetballClub && canAccessNetballBoard && teamMembers && event?.team_id && createPortal(
        <Suspense fallback={
          <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-background">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }>
          <div className="fixed inset-0 z-[999999] bg-background">
            <NetballBoard
              teamId={event.team_id}
              teamName={event.teams?.name || "Team"}
              eventId={id}
              members={teamMembers.map(m => ({
                id: m.user_id,
                user_id: m.user_id,
                role: m.role,
                profiles: m.profiles
              }))}
              onClose={closePitchBoardWithFlag(setShowPitchBoard)}
            />
          </div>
        </Suspense>,
        document.body
      )}

      {/* Game Board Modal — basketball */}
      {showPitchBoard && isBasketballClub && canAccessBasketballBoard && teamMembers && event?.team_id && createPortal(
        <Suspense fallback={
          <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-background">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }>
          <div className="fixed inset-0 z-[999999] bg-background">
            <BasketballBoard
              teamId={event.team_id}
              teamName={event.teams?.name || "Team"}
              eventId={id}
              members={teamMembers.map(m => ({
                id: m.user_id,
                user_id: m.user_id,
                role: m.role,
                profiles: m.profiles
              }))}
              onClose={closePitchBoardWithFlag(setShowPitchBoard)}
            />
          </div>
        </Suspense>,
        document.body
      )}
      {/* Post-RSVP Notification Prompt - only show if push is NOT enabled */}
      {user && event && notificationNudge.hasPushEnabled === false && (
        <PostRsvpNotificationPrompt
          open={showPostRsvpNudge}
          onClose={() => setShowPostRsvpNudge(false)}
          userId={user.id}
          eventTitle={event.title}
        />
      )}
    </div>
  );
}
