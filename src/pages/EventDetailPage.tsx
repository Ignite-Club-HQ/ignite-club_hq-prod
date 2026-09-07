import { useState, useEffect, useMemo, lazy, Suspense, useRef, useCallback } from "react";
import { useDeleteEvent } from "@/hooks/useDeleteEvent";

import { abortAllInFlightRestGets } from "@/lib/supabaseAuthRetry";
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
import { refreshEventCaches } from "@/lib/eventCacheRefresh";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { friendlyMutationError } from "@/lib/friendlyMutationError";
import { format, parseISO, isSameDay } from "date-fns";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";
import { EventsHeaderSponsorStrip } from "@/components/events/EventsHeaderSponsorStrip";
import { EventGuestsManager } from "@/components/EventGuestsManager";
import { EventGroupsManager } from "@/components/EventGroupsManager";
import { AttendanceSection } from "@/components/event/AttendanceSection";
import { useEventGroupMap } from "@/hooks/useEventGroupMap";
import { useEventViewTracking } from "@/hooks/useEventViews";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { resolveRsvpAudience, shouldPromptPlayer, shouldPromptSelf, isParentFirstEvent } from "@/lib/rsvpAudience";
import { resolveRsvpChildren, resolveEventChildRoster } from "@/lib/resolveEventChildScope";


import { AdminRsvpChanger } from "@/components/event/AdminRsvpChanger";

import { AttendanceRow } from "@/components/event/AttendanceRow";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
import { RsvpNoteSheet } from "@/components/rsvp/RsvpNoteSheet";
import { PostRsvpNotificationPrompt } from "@/components/PostRsvpNotificationPrompt";
import { formatMatchArrivalTime, getMatchArrivalMinutes, getMatchArrivalDate } from "@/lib/matchArrivalTime";
import { formatRelativePast } from "@/lib/formatRelativeTime";
import { MatchScoreCard } from "@/components/event/MatchScoreCard";
import { EventNoteSection } from "@/components/event/EventNoteSection";


// Lazy load PitchBoard for game events
const PitchBoard = lazyWithRetry(() => import("@/components/pitch/PitchBoard"));
// NetballBoard / BasketballBoard archived — football-only build (see archive/sports/)
import {
  clearPitchBoardOpenFlag,
  shouldRestorePitchBoardForCurrentPath,
} from "@/components/pitch/pitchBoardOpenFlag";

// Close handler used by all game-board variants. Clears both the React modal
// state AND the persisted "open" flag so PitchBoardResumeRedirect won't
// re-open the board after a phone lock/unlock once the user has explicitly
// closed it from the event page.
const closePitchBoardWithFlag = (setShow: (v: boolean) => void) => () => {
  setShow(false);
  clearPitchBoardOpenFlag();
};
import { hasGameBoardSupport } from "@/lib/sportDetection";
import { resolveEventRecipients, eventRecipientContext } from "@/features/events/eventRecipientPolicy";
import { resolveReminderRecipients, applyReminderCooldown, normalizeRecipientIds } from "@/features/events/reminderRecipients";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

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

// Role labels shown on the attendance list must reflect the role the person
// holds *for this event's audience*. A parent of a junior who also plays in a
// senior team must not be badged "Player" on a junior fixture.
const ROLE_LABEL_PRIORITY = [
  "club_admin",
  "association_admin",
  "committee_member",
  "team_admin",
  "coach",
  "league_admin",
  "competition_admin",
  "parent",
  "player",
  "basic_user",
];

const pickRoleByPriority = (roles: string[]): string | undefined => {
  if (roles.length === 0) return undefined;
  for (const r of ROLE_LABEL_PRIORITY) if (roles.includes(r)) return r;
  return roles[0];
};

const resolveAttendeeRoleLabel = (
  member: { roles?: string[]; role_team_pairs?: { role: string; team_id: string | null }[] } | undefined,
  event: any,
): string | undefined => {
  if (!member) return undefined;
  const pairs = member.role_team_pairs ?? [];
  const scopeTeams: string[] | null = event?.team_id
    ? [event.team_id as string]
    : Array.isArray(event?.target_team_ids) && event.target_team_ids.length > 0
      ? (event.target_team_ids as string[])
      : null;

  if (scopeTeams) {
    const scoped = pairs.filter((p) => p.team_id && scopeTeams.includes(p.team_id)).map((p) => p.role);
    const inScope = pickRoleByPriority(scoped);
    if (inScope) return inScope;
    // No team-scoped role — fall back to their club-level role only.
    const clubLevel = pairs.filter((p) => !p.team_id).map((p) => p.role);
    const clubRole = pickRoleByPriority(clubLevel);
    if (clubRole) return clubRole;
    // Synthetic members (e.g. linked parents with no user_roles rows) carry a
    // roles array but no pairs — use it rather than showing no badge at all.
    if (pairs.length === 0) return pickRoleByPriority(member.roles ?? []);
    return undefined;
  }


  // Untargeted club-wide event: no single team scope, so prefer the most
  // representative role rather than whichever row came back first.
  return pickRoleByPriority(member.roles ?? pairs.map((p) => p.role));
};


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

  // Watchdog: after an Android WebView background freeze the event fetch can
  // stay permanently pending (its abort timer was frozen), leaving this page
  // stuck on skeletons until a force-quit. While we have no event and are
  // still loading, abort zombie REST GETs and re-issue every 6s.
  const isStuckOnEventSpinner = !event && isLoading;
  useEffect(() => {
    if (!isStuckOnEventSpinner || !id) return;
    const kick = () => {
      const aborted = abortAllInFlightRestGets("event-detail-watchdog");
      console.warn("[EventDetailPage] watchdog-refetch", {
        t: new Date().toISOString(),
        eventId: id,
        abortedInFlight: aborted,
      });
      queryClient.refetchQueries({ queryKey: ["event", id] });
    };
    const timer = setInterval(kick, 6000);
    return () => clearInterval(timer);
  }, [isStuckOnEventSpinner, id, queryClient]);




  const {
    data: rsvps,
    error: rsvpsError,
    isLoading: rsvpsLoading,
    isFetching: rsvpsFetching,
    refetch: refetchRsvps,
  } = useQuery({
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
        const { data: profiles } = await selectCachedProfilesByIds(userIds);
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

  // Attendance read health. A failed RSVP read must never be presented as a
  // valid empty roster: we surface an alert + retry and disable every
  // attendance-dependent action until a successful read lands. Cached data is
  // kept visible (and stable) during a background refetch.
  const attendanceUnavailable = !!rsvpsError && !rsvps;
  const attendanceInitialLoading = (rsvpsLoading || (rsvpsFetching && !rsvps)) && !rsvpsError;
  const attendanceActionsDisabled = attendanceUnavailable || attendanceInitialLoading;

  const attendanceAlert = (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      <span>Attendance couldn’t be loaded. Check your connection and try again.</span>
      <Button
        variant="outline"
        size="sm"
        className="h-7"
        onClick={() => { void refetchRsvps(); }}
      >
        Try again
      </Button>
    </div>
  );



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
        const { data: profiles } = await selectCachedProfilesByIds(adderIds);
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

  // Event sharing is available on Free and Pro — no gate.
  const canShareEvent = true;
  const gateEventShare = (): boolean => true;

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
  const isSoccerClub = hasGameBoardSupport(event?.clubs?.sport);

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
  // Netball + basketball game boards archived — football-only build.
  const canAccessSoccerBoard = canManagePitchBoard && event?.type === 'game' && !!event?.team_id && !!isSoccerClub && hasProFootball === true;
  const canAccessNetballBoard = false;
  const canAccessBasketballBoard = false;
  const canAccessPitchBoard = canAccessSoccerBoard;

  const wantOpenPitchBoard =
    searchParams.get("openPitchBoard") === "1" ||
    shouldRestorePitchBoardForCurrentPath(window.location.pathname);


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

  // Keep proven access sticky while the board is open. Native resume aborts
  // and restarts active queries; transient false/undefined access results must
  // not unmount the restored board and reveal the event page underneath it.
  const rawPitchBoardAccess = canAccessSoccerBoard || canViewPitchBoardReadOnly;
  const pitchBoardAccessEverGrantedRef = useRef(false);
  if (rawPitchBoardAccess) pitchBoardAccessEverGrantedRef.current = true;
  const pitchBoardAccessGranted =
    rawPitchBoardAccess || (showPitchBoard && pitchBoardAccessEverGrantedRef.current);

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
        .select("user_id, role, team_id, profiles:user_id (id, display_name, avatar_url)");

      if (event?.team_id) {
        query.eq("team_id", event.team_id);
      } else {
        query.eq("club_id", event!.club_id);
      }

      // The club bot holds roles so it can post in chats, but it is not a
      // real member — never surface it in attendance lists.
      const [{ data, error }, { data: clubRow }] = await Promise.all([
        query,
        supabase.from("clubs").select("bot_user_id").eq("id", event!.club_id).maybeSingle(),
      ]);
      if (error) throw error;
      const botUserId = clubRow?.bot_user_id ?? null;

      
      // Group roles by user_id, keeping track of every team_id we've seen for them.
      // `role_team_pairs` preserves WHICH team each role was held on, so targeted
      // club-wide events can scope role labels/filters to the invited teams only.
      const userRolesMap = new Map<
        string,
        { profile: any; roles: string[]; teamIds: Set<string>; pairs: { role: string; team_id: string | null }[] }
      >();
      data.filter(m => m.profiles && m.user_id !== botUserId).forEach(m => {
        const existing = userRolesMap.get(m.user_id);
        if (existing) {
          if (!existing.roles.includes(m.role)) existing.roles.push(m.role);
          if (m.team_id) existing.teamIds.add(m.team_id);
          existing.pairs.push({ role: m.role, team_id: m.team_id ?? null });
        } else {
          userRolesMap.set(m.user_id, {
            profile: m.profiles,
            roles: [m.role],
            teamIds: new Set(m.team_id ? [m.team_id] : []),
            pairs: [{ role: m.role, team_id: m.team_id ?? null }],
          });
        }
      });
      
      return Array.from(userRolesMap.entries()).map(([, data]) => ({
        ...data.profile,
        roles: data.roles,
        team_ids: Array.from(data.teamIds),
        role_team_pairs: data.pairs,
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
      const { data, error } = await selectCachedProfilesByIds(parentIds);
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

  // For club-wide events with target_team_ids, narrow the attendance roster
  // to users tied to one of the targeted teams (via user_roles.team_id) OR
  // club-level admins/committee (who can access every targeted event). Other
  // consumers (duty roster, admin queries) keep using the full `members` list.
  const attendanceMembers = useMemo(() => {
    const targeted = ((event as any)?.target_team_ids ?? null) as string[] | null;
    if (event?.team_id || !targeted || targeted.length === 0) return members;
    const targetSet = new Set(targeted);
    const CLUB_LEVEL = new Set(["club_admin", "app_admin", "committee_member"]);
    return (members ?? [])
      .map((m: any) => {
        const pairs: { role: string; team_id: string | null }[] = m.role_team_pairs ?? [];
        // Only roles held on a targeted team (or club-level roles with no team)
        // count for this event — a player role on an uninvited team must not
        // make the member show up as a player here.
        const scopedRoles = Array.from(
          new Set(
            pairs
              .filter((p) => (p.team_id ? targetSet.has(p.team_id) : CLUB_LEVEL.has(p.role)))
              .map((p) => p.role),
          ),
        );
        return scopedRoles.length ? { ...m, roles: scopedRoles } : null;
      })
      .filter(Boolean) as any[];
  }, [members, event?.team_id, (event as any)?.target_team_ids]);

  const attendancePlayerMembers = attendanceMembers?.filter((m: any) => m.roles?.includes("player")) || [];


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
      const { data: profiles, error: profilesError } = await selectCachedProfilesByIds(filteredUserIds);
      if (profilesError) throw profilesError;

      return (profiles || []).slice().sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
    },
    enabled: !!event?.mini_league_id && !!id,
  });

  // Fetch children for parent RSVP — scoped via the shared resolver:
  // team event → that team; targeted club-wide → intersection with targets;
  // unscoped club-wide → children in teams of this club only.
  const childrenTargetKey = useMemo(() => {
    if (event?.team_id) return "";
    const t = ((event as any)?.target_team_ids ?? null) as string[] | null;
    return Array.isArray(t) && t.length > 0 ? [...t].sort().join(",") : "";
  }, [event?.team_id, (event as any)?.target_team_ids]);
  const { data: childrenOnTeam } = useQuery({
    queryKey: [
      "children-on-team",
      event?.team_id,
      event?.club_id,
      (event as any)?.adults_only,
      (event as any)?.rsvp_audience,
      childrenTargetKey,
      user?.id,
    ],
    queryFn: () =>
      resolveRsvpChildren({
        event: event as any,
        userId: user?.id ?? null,
        teamDefaultAudience: (event as any)?.teams?.default_rsvp_audience ?? null,
      }),
    enabled: !!user && !!(event?.team_id || event?.club_id),
  });



  // Fetch ALL children assigned to this event's team (for not responded list).
  // For club-wide events with `target_team_ids`, fetch children across every
  // targeted team so their child players still appear in No Response.
  const targetTeamIdsForFetch = useMemo(() => {
    if (event?.team_id) return null;
    const t = ((event as any)?.target_team_ids ?? null) as string[] | null;
    return Array.isArray(t) && t.length > 0 ? t : null;
  }, [event?.team_id, (event as any)?.target_team_ids]);

  // Event managers (club admin / committee / target-team admin) cannot read
  // other members' `children` rows directly under RLS. A narrowly scoped
  // SECURITY DEFINER RPC returns the minimum roster for THIS event only.
  const scopedRosterQuery = useQuery({
    queryKey: ["targeted-event-roster", id],
    enabled: !!id && !!targetTeamIdsForFetch && !!(isAdmin || isAppAdmin),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_targeted_event_attendance_roster", {
        p_event_id: id!,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        kind: string;
        person_id: string;
        display_name: string | null;
        parent_id: string | null;
        team_ids: string[] | null;
      }>;
    },
  });
  const scopedChildRoster = useMemo(
    () => (scopedRosterQuery.data ?? []).filter((r) => r.kind === "child"),
    [scopedRosterQuery.data],
  );
  const scopedChildNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of scopedChildRoster) if (r.display_name) m.set(r.person_id, r.display_name);
    return m;
  }, [scopedChildRoster]);

  // Grouping for club-wide events (by age level or by team). For targeted
  // club-wide events, use the scoped roster RPC for person→team mappings so
  // client-side RLS on children/user_roles cannot collapse everyone to Other.
  const eventGrouping = (event as any)?.rsvp_grouping as
    | "level"
    | "team"
    | null
    | undefined;
  const eventTargetTeamIds = ((event as any)?.target_team_ids ?? null) as
    | string[]
    | null;
  const groupMap = useEventGroupMap({
    clubId: event?.club_id ?? null,
    grouping: eventGrouping ?? null,
    targetTeamIds: eventTargetTeamIds,
    scopedRosterRows: targetTeamIdsForFetch ? scopedRosterQuery.data ?? null : null,
    enabled: !!event && !event.team_id && !!event.club_id &&
      (eventGrouping === "level" || eventGrouping === "team") &&
      (!targetTeamIdsForFetch || scopedRosterQuery.isSuccess),
  });

  const { data: allChildrenOnTeamRaw } = useQuery({
    queryKey: [
      "all-children-on-team",
      event?.team_id,
      event?.club_id,
      (event as any)?.adults_only,
      (event as any)?.rsvp_audience,
      targetTeamIdsForFetch ? [...targetTeamIdsForFetch].sort().join(",") : "",
    ],
    queryFn: () =>
      resolveEventChildRoster({
        event: event as any,
        teamDefaultAudience: (event as any)?.teams?.default_rsvp_audience ?? null,
      }),
    enabled: !!event && !!(event.team_id || event.club_id),
  });


  // Merge the RLS-visible children with the scoped RPC roster so event
  // managers see every targeted player (and never "Unknown").
  const allChildrenOnTeam = useMemo(() => {
    const base = allChildrenOnTeamRaw || [];
    if (!targetTeamIdsForFetch || scopedChildRoster.length === 0) return base;
    const byId = new Map<string, any>();
    for (const c of base) byId.set(c.id, c);
    for (const r of scopedChildRoster) {
      const existing = byId.get(r.person_id);
      if (existing) {
        if (!existing.name && r.display_name) existing.name = r.display_name;
      } else {
        byId.set(r.person_id, { id: r.person_id, name: r.display_name, parent_id: r.parent_id });
      }
    }
    return [...byId.values()];
  }, [allChildrenOnTeamRaw, scopedChildRoster, targetTeamIdsForFetch]);



  // Fetch guardians for children on this team (so guardians are excluded from "not responded" when their child has RSVP'd).
  // Club-scoped: guardians linked to the child at another club are not part of this event's audience.
  const childIdsOnTeam = (allChildrenOnTeam || []).map((c: any) => c.id);
  const { data: childGuardiansOnTeam } = useQuery({
    queryKey: ["child-guardians-on-team", event?.team_id, event?.club_id, childIdsOnTeam.join(",")],
    queryFn: async () => {
      if (childIdsOnTeam.length === 0) return [];
      if (!event?.club_id) return [];
      const { data, error } = await supabase.rpc("club_scoped_child_guardians", {
        p_child_ids: childIdsOnTeam,
        p_club_id: event.club_id,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: childIdsOnTeam.length > 0,
  });

  // Adults linked to an in-scope child are part of the event audience even
  // when they hold NO `user_roles` row that the members query can see:
  //  - team events query user_roles by team_id, so a parent whose only role
  //    row is club-level (team_id IS NULL) or sits on another team is missing;
  //  - parents added via child linking may hold no role row at all.
  // Without this fetch those parents can never appear in the roster — which is
  // exactly the "not all parents showed even with Show all roles" report.
  const linkedAdultIdsForAttendance = useMemo(() => {
    const ids = new Set<string>();
    (allChildrenOnTeam || []).forEach((c: any) => {
      if (c.parent_id) ids.add(c.parent_id);
    });
    (childGuardiansOnTeam || []).forEach((cg: any) => {
      if (cg.guardian_id) ids.add(cg.guardian_id);
    });
    (membersWithRoles || []).forEach((m: any) => ids.delete(m.id));
    return Array.from(ids).sort();
  }, [allChildrenOnTeam, childGuardiansOnTeam, membersWithRoles]);

  const { data: linkedAdultProfiles } = useQuery({
    queryKey: ["event-linked-adult-profiles", event?.id, linkedAdultIdsForAttendance.join(",")],
    queryFn: async () => {
      if (linkedAdultIdsForAttendance.length === 0) return [];
      const { data, error } = await selectCachedProfilesByIds(linkedAdultIdsForAttendance);
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        roles: ["parent"],
        team_ids: [],
        role_team_pairs: [],
      }));
    },
    enabled: !!event && linkedAdultIdsForAttendance.length > 0,
  });




  // Recipients for on-demand reminders. For a targeted club-wide event the
  // audience is NOT "everyone in the club": only members holding a role on a
  // targeted team, plus parents/guardians of children assigned to those teams.
  // Club-level admins/committee who have no tie to a targeted team are not
  // nagged (they can still see the event). Team / mini-league / untargeted
  // club-wide events keep the previous behaviour.
  const reminderMembers = useMemo(() => {
    // Parents linked only via a child (no visible role row) still owe a
    // response, so they must be reachable by reminders too.
    const roleless = linkedAdultProfiles || [];
    if (event?.team_id || !targetTeamIdsForFetch) return [...(members ?? []), ...roleless];
    const targetSet = new Set(targetTeamIdsForFetch);
    const linkedAdultIds = new Set<string>();
    (allChildrenOnTeam || []).forEach((c: any) => {
      if (c.parent_id) linkedAdultIds.add(c.parent_id);
    });
    (childGuardiansOnTeam || []).forEach((cg: any) => {
      if (cg.guardian_id) linkedAdultIds.add(cg.guardian_id);
    });
    return [...(members ?? []), ...roleless].filter((m: any) => {
      const pairs: { role: string; team_id: string | null }[] = m.role_team_pairs ?? [];
      if (pairs.some((p) => p.team_id && targetSet.has(p.team_id))) return true;
      return linkedAdultIds.has(m.id);
    });
  }, [members, event?.team_id, targetTeamIdsForFetch, allChildrenOnTeam, childGuardiansOnTeam, linkedAdultProfiles]);


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

  // Active payment-status listener cleanup (CONFIRMED DEFECT 2).
  // Stored in a ref so a new listener disposes the previous one and unmount
  // always tears the active listener down exactly once (cleanup is idempotent).
  const paymentListenerCleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const dispose = paymentListenerCleanupRef.current;
      paymentListenerCleanupRef.current = null;
      dispose?.();
    };
  }, []);

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
        // Dispose any listener from a previous Pay Now tap before registering.
        const previousDispose = paymentListenerCleanupRef.current;
        paymentListenerCleanupRef.current = null;
        previousDispose?.();

        const clearActiveListener = () => {
          const dispose = paymentListenerCleanupRef.current;
          paymentListenerCleanupRef.current = null;
          dispose?.();
        };

        const dispose = listenForPaymentStatus(result.payment_id, async (status) => {
          // Terminal callback: the listener is done — drop the stored ref.
          clearActiveListener();
          if (!isMountedRef.current) return;

          if (status === "paid") {
            // CONFIRMED DEFECT 1: functions.invoke resolves with { data, error }
            // instead of throwing, so the returned error must be inspected.
            let confirmError: unknown = null;
            try {
              const { error } = await supabase.functions.invoke("confirm-event-payment", {
                body: {
                  event_id: event.id,
                  amount: eventPrice,
                  payment_id: result.payment_id,
                },
              });
              confirmError = error ?? null;
            } catch (err) {
              confirmError = err;
            }

            if (!isMountedRef.current) return;

            if (confirmError) {
              console.error("Failed to confirm event payment server-side:", confirmError);
              toast({
                title: "Payment confirmation incomplete",
                description:
                  "Your payment may have been received, but we could not update the event. Please contact your club before trying again.",
                variant: "destructive",
              });
              return;
            }

            queryClient.invalidateQueries({ queryKey: ["event-payments", id] });
            toast({ title: "Payment successful!" });
          } else {
            toast({ title: "Payment failed", variant: "destructive" });
          }
        });

        // A terminal callback can fire synchronously during registration; only
        // store the disposer if the listener is still considered active.
        if (isMountedRef.current) {
          paymentListenerCleanupRef.current = dispose;
        } else {
          dispose();
        }


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

  // Optional RSVP note (Heja-style): the RSVP itself stays one tap; the note is
  // an optional follow-up written after answering.
  const [noteTarget, setNoteTarget] = useState<
    { kind: "self" | "child"; childId?: string; subjectName: string } | null
  >(null);

  const saveRsvpNoteMutation = useMutation({
    mutationFn: async ({ childId, note }: { childId?: string; note: string | null }) => {
      const target = childId
        ? childRsvps.find((r) => r.child_id === childId)
        : myRsvp;
      if (!target) throw new Error("Please choose a response first.");
      const { error } = await supabase
        .from("rsvps")
        .update({ notes: note })
        .eq("id", target.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't save note",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
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

  // Thrown when the duty row committed as completed but the admin/coach
  // notification insert failed. Records explicitly that the duty is committed.
  class DutyNotificationPartialError extends Error {
    dutyCommitted = true as const;
    constructor(public underlying: string) {
      super(underlying);
      this.name = "DutyNotificationPartialError";
    }
  }

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
      // Duty update failed outright — no notifications, complete failure.
      if (error) throw error;
      // No row updated: the duty is no longer open (idempotent/concurrent
      // outcome). Do not notify; just refresh so current state is displayed.
      if (!updatedDuty) return { outcome: "noop" as const };

      // Notify team/club admins and coaches about duty completion
      if (event && duty) {
        const memberName = profile?.display_name || "A member";
        
        // Get admins/coaches for this team/event
        const roleQuery = event.team_id 
          ? supabase.from("user_roles").select("user_id").eq("team_id", event.team_id).in("role", ["team_admin", "coach", "club_admin", "committee_member"])
          : supabase.from("user_roles").select("user_id").eq("club_id", event.club_id).in("role", ["club_admin", "committee_member"]);
        
        const { data: admins, error: adminsError } = await roleQuery;

        if (adminsError) {
          throw new DutyNotificationPartialError(adminsError.message);
        }

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
            // 23505 = duplicate/idempotency conflict, intentionally tolerated.
            if (notificationError && notificationError.code !== "23505") {
              throw new DutyNotificationPartialError(notificationError.message);
            }
          }
        }
      }
      return { outcome: "completed" as const };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      if (result?.outcome === "completed") {
        toast({ title: "Duty completed!" });
      }
    },

    onError: (error) => {
      if (error instanceof DutyNotificationPartialError) {
        // The duty IS completed — never roll back or reopen it, and never
        // report a total failure.
        queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
        toast({
          title: "Duty completed — notification failed",
          description: `The duty was marked complete, but administrators couldn't be notified. ${error.underlying}`,
          variant: "destructive",
        });
        return;
      }
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

  // ---- Event deletion ----------------------------------------------------
  // One awaited request per confirmation. The dialog stays open and disabled
  // while pending; navigation and the success toast happen only after the
  // database confirms the row is gone (see useDeleteEvent).
  const { deleteEvent, isPending: deletePending } = useDeleteEvent({
    entityLabel: eventTypeLabel,
    onDeleted: () => {
      setDeleteDialogOpen(false);
      navigate(-1);
    },
  });

  const handleConfirmDelete = (deleteType: 'single' | 'series') => {
    void deleteEvent(
      event
        ? { id: id!, is_recurring: event.is_recurring, parent_event_id: event.parent_event_id }
        : null,
      deleteType,
    );
  };



  // Thrown when a recurring-series cancellation committed only one of its two
  // writes. Records explicitly which mutation committed — never inferred from
  // error text.
  class SeriesCancellationPartialError extends Error {
    constructor(
      public childrenCommitted: boolean,
      public parentCommitted: boolean,
      public underlying: string,
    ) {
      super(underlying);
      this.name = "SeriesCancellationPartialError";
    }
  }

  const cancelEventMutation = useMutation({
    mutationFn: async ({ cancelType, customMessage, sendPushNotification }: { cancelType: 'single' | 'series'; customMessage?: string; sendPushNotification?: boolean }) => {
      console.log("[CancelEvent] Starting cancel mutation", { cancelType, eventId: id, miniLeagueId: event?.mini_league_id });

      const isSeries =
        cancelType === 'series' && (!!event?.parent_event_id || !!event?.is_recurring);

      if (isSeries) {
        // Either arrangement: current event is a child (use its parent id) or
        // the current event IS the recurring parent (use its own id).
        const seriesRootId = event?.parent_event_id || id!;

        const { error: childrenError } = await supabase
          .from("events")
          .update({ is_cancelled: true, chat_cancel_post_handled: true })
          .eq("parent_event_id", seriesRootId);
        const { error: parentError } = await supabase
          .from("events")
          .update({ is_cancelled: true, chat_cancel_post_handled: true })
          .eq("id", seriesRootId);

        const childrenCancellationSucceeded = !childrenError;
        const parentCancellationSucceeded = !parentError;

        if (childrenError) console.error("[CancelEvent] Error cancelling children:", childrenError);
        if (parentError) console.error("[CancelEvent] Error cancelling parent:", parentError);

        // A. Neither write succeeded — complete failure, no chat message.
        if (!childrenCancellationSucceeded && !parentCancellationSucceeded) {
          throw childrenError ?? parentError;
        }

        // C. Exactly one write succeeded — partial state, no chat message.
        if (!childrenCancellationSucceeded || !parentCancellationSucceeded) {
          throw new SeriesCancellationPartialError(
            childrenCancellationSucceeded,
            parentCancellationSucceeded,
            (childrenError ?? parentError)!.message,
          );
        }
        // B. Both succeeded — fall through to normal success behaviour.
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
      refreshEventCaches(queryClient, user?.id);
      toast({ title: "Event cancelled", description: "A message has been posted to the chat" });
    },
    onError: (error) => {
      console.error("[CancelEvent] Mutation error:", error);
      if (error instanceof SeriesCancellationPartialError) {
        // Part of the series IS cancelled — never roll back client-side, and
        // never report either complete success or complete failure.
        setCancelDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["event", id] });
        queryClient.invalidateQueries({ queryKey: ["events"] });
        queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
        queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
        queryClient.invalidateQueries({ queryKey: ["event-groups", id] });
        const cancelled = error.childrenCommitted
          ? "The repeat occurrences were cancelled"
          : "The main recurring event was cancelled";
        const failed = error.childrenCommitted
          ? "the main recurring event could not be cancelled"
          : "the repeat occurrences could not be cancelled";
        toast({
          title: "Series cancellation incomplete",
          description: `${cancelled}, but ${failed}. No cancellation message was posted. ${error.underlying}`,
          variant: "destructive",
        });
        return;
      }
      toast(friendlyMutationError(error, {
        title: "Failed to cancel event",
        description: (error as any)?.message || "An unexpected error occurred",
      }));
    },

  });

  const remindMutation = useMutation({
    mutationFn: async () => {
      // Get all RSVPs for this event
      const { data: existingRsvps, error: rsvpError } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", id!);
      if (rsvpError) throw rsvpError;

      
      const rsvpUserIds = existingRsvps?.map(r => r.user_id) || [];
      
      // Resolve the eligible audience through the shared recipient policy so
      // targeted club-wide events never nag uninvited teams or unrelated
      // club officials.
      const allMemberIds = await resolveEventRecipients(
        supabase,
        eventRecipientContext(event, id!),
      );

      
      // Find members who haven't RSVPed
      const nonRsvpMembers = allMemberIds.filter(memberId => !rsvpUserIds.includes(memberId));
      
      if (nonRsvpMembers.length === 0) {
        throw new Error("Everyone has already RSVPed!");
      }
      
      // Check for reminders sent in the last 24 hours to avoid spamming members
      const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
      const { data: existingNotifications, error: cooldownError } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_reminder")
        .eq("related_id", id!)
        .in("user_id", nonRsvpMembers)
        .gte("created_at", since);
      if (cooldownError) throw cooldownError;

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
      let recipientIds: string[] = normalizeRecipientIds([userId]);

      if (childId) {
        // Both reads are authoritative — a failure in either must fail closed.
        // Guardians are club-scoped: only guardians who belong to this event's
        // club are reminded (a parent linked at another club is not notified).
        const [guardiansRes, childRes] = await Promise.all([
          event?.club_id
            ? supabase
                .rpc("club_scoped_child_guardians", { p_child_ids: [childId], p_club_id: event.club_id })
                .then((res) => ({
                  data: (res.data as { guardian_id: string }[] | null) ?? null,
                  error: res.error,
                }))
            : supabase.from("child_guardians").select("guardian_id").eq("child_id", childId),
          supabase.from("children").select("parent_id").eq("id", childId).maybeSingle(),
        ]);


        const resolved = resolveReminderRecipients({
          userId,
          guardians: guardiansRes.data,
          guardiansError: guardiansRes.error,
          child: childRes.data,
          childError: childRes.error,
        });
        if (resolved.status === "error") throw new Error(resolved.message);
        recipientIds = resolved.recipientIds;
      }

      if (recipientIds.length === 0) {
        throw new Error(`${displayName} has no linked parents to remind`);
      }

      // 24h cooldown — skip recipients who were reminded in the last 24 hours
      const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
      const { data: existing, error: cooldownError } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_reminder")
        .eq("related_id", id!)
        .in("user_id", recipientIds)
        .gte("created_at", since);

      const afterCooldown = applyReminderCooldown({
        recipientIds,
        recentlyRemindedRows: existing,
        cooldownError,
      });
      if (afterCooldown.status === "error") throw new Error(afterCooldown.message);
      const toRemind = afterCooldown.recipientIds;

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

      // Shared recipient policy (same audience as bulk reminders)
      const resolved = await resolveEventRecipients(
        supabase,
        eventRecipientContext(event, id),
      );

      // Exclude the creator
      const allMemberIds = resolved.filter(uid => uid !== event.created_by);

      // Find members who already have a notification for this event
      const { data: existingNotifications, error: existingError } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_invite")
        .eq("related_id", id)
        .in("user_id", allMemberIds.length > 0 ? allMemberIds : ['no-match']);
      if (existingError) throw existingError;


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
                disabled={remindMutation.isPending || attendanceActionsDisabled}
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
                disabled={resendInvitesMutation.isPending || attendanceActionsDisabled}
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
            onSingleAction={() => handleConfirmDelete('single')}
            onSeriesAction={() => handleConfirmDelete('series')}
            isPending={deletePending}
            keepOpenOnAction

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
                  onClick={(e) => { e.preventDefault(); handleConfirmDelete('single'); }}
                  disabled={deletePending}

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

            })() : attendanceUnavailable ? (
              <span className="text-destructive">Attendance unavailable</span>
            ) : <span>Loading...</span>}
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
          {(isPitchBoardAccessLoading || (canAccessPitchBoard && isTeamMembersForPitchLoading)) && event.type === "game" && !!event.team_id && isSoccerClub && (
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

      {/* Slim sponsor strip (matches Media header width/style; per-club opt-in) */}
      <div className="max-w-lg mx-auto w-full">
        <EventsHeaderSponsorStrip activeClubFilter={event.club_id} />
      </div>


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
        // Mixed teams: an adult who holds role='player' in this event's scope
        // is prompted for themselves even on a players_only audience.
        const viewerIsAdultPlayer = !!user?.id && (
          (event as any)?.team_id
            ? !!teamPlayerAdultIds?.has(user.id)
            : !!clubPlayerAdultIds?.has(user.id)
        );
        const promptParent = isMiniLeagueEvent ? true : shouldPromptSelf(audience, viewerIsAdultPlayer);
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
                            disabled={childRsvpMutation.isPending || attendanceActionsDisabled}
                          >
                            <span>{icon}</span>
                            <span className="text-xs">{label}</span>
                          </Button>
                        ))}
                      </div>
                      {childRsvp && (
                        <button
                          type="button"
                          onClick={() =>
                            setNoteTarget({ kind: "child", childId: child.id, subjectName: child.name })
                          }
                          className="flex w-full items-start gap-2 rounded-lg border border-dashed border-border/70 px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40 touch-manipulation"
                        >
                          <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span className={(childRsvp as any).notes ? "text-foreground" : undefined}>
                            {(childRsvp as any).notes || "Add a note…"}
                          </span>
                        </button>
                      )}

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
                  disabled={rsvpMutation.isPending || attendanceActionsDisabled || myRsvp?.status === value}
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

            {myRsvp && (
              <button
                type="button"
                onClick={() => setNoteTarget({ kind: "self", subjectName: "You" })}
                className="flex w-full items-start gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/40 touch-manipulation"
              >
                <MessageSquare className="h-4 w-4 mt-0.5 shrink-0" />
                <span className={(myRsvp as any).notes ? "text-foreground" : undefined}>
                  {(myRsvp as any).notes || "Add a note…"}
                </span>
              </button>
            )}


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
                          disabled={parentLeaguePlayerRsvpMutation.isPending || attendanceActionsDisabled}
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
        // Attendance read failed and we have nothing cached: show the alert +
        // retry instead of an empty roster (which would read as "no responses").
        if (attendanceUnavailable) return attendanceAlert;
        // Initial load: attendance-specific loading state, never a zero count.
        if (!rsvps && attendanceInitialLoading) {
          return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading attendance…
            </div>
          );
        }

        // Get player user IDs for filtering
        const playerUserIds = new Set(playerMembers?.map((m: any) => m.id) || []);

        // Audience gate for the DEFAULT (players-only) view.
        //
        // `parents_only` events have no player responders at all — the adults
        // ARE the audience, so their self-RSVPs must show without the toggle.
        // On every other audience (including `players_and_parents`) the default
        // list stays players/children only: non-player adults appear only when
        // "Show all roles" is checked.
        const attendanceAudience = resolveRsvpAudience(
          (event as any)?.rsvp_audience,
          (event as any)?.teams?.default_rsvp_audience,
        );
        const adultsAreTheAudience = attendanceAudience === "parents_only";

        const filterRsvp = (rsvp: any) => {
          if (effectiveShowAll) return true;
          if (isMiniLeagueEvent) {
            // Kids-only by default: hide adult/parent self-RSVPs.
            return !!rsvp.child_id || !!rsvp.mini_league_player_id;
          }
          if (rsvp.mini_league_player_id) return true;
          if (rsvp.child_id) return true;
          if (adultsAreTheAudience) return true;
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
        // Targeted club-wide event: only attendees inside the event audience
        // may appear in any bucket. Also hydrate child names from the scoped
        // roster so authorised managers never see "Unknown".
        const scopedChildIds = new Set((allChildrenOnTeam || []).map((c: any) => c.id));
        const scopedAdultIds = new Set((attendanceMembers || []).map((m: any) => m.id));
        // Parents/guardians of in-scope children are part of the event audience
        // even when they hold no team-scoped role — without this their RSVPs
        // vanish from the buckets (only "certain parents" appeared).
        (allChildrenOnTeam || []).forEach((c: any) => {
          if (c.parent_id) scopedAdultIds.add(c.parent_id);
        });
        (childGuardiansOnTeam || []).forEach((cg: any) => {
          if (cg.guardian_id) scopedAdultIds.add(cg.guardian_id);
        });
        const isTargetedScope = !!targetTeamIdsForFetch;
        const inTargetScope = (r: any) => {
          if (!isTargetedScope) return true;
          const childId = r.child_id || r.mini_league_players?.child_id || null;
          if (childId) return scopedChildIds.has(childId);
          return !r.user_id || scopedAdultIds.has(r.user_id);
        };
        const hydrateRsvp = (r: any) => {
          const childId = r.child_id;
          if (!childId || r.children?.name) return r;
          const name = scopedChildNames.get(childId);
          return name ? { ...r, children: { ...(r.children ?? {}), name } } : r;
        };
        const prepareRsvps = (list: any[]) => dedupeRsvps(list.filter(inTargetScope)).map(hydrateRsvp);
        const goingRsvps = prepareRsvps(rsvps?.filter((r) => r.status === "going" && filterRsvp(r)) || []);
        const maybeRsvps = prepareRsvps(rsvps?.filter((r) => r.status === "maybe" && filterRsvp(r)) || []);
        const notGoingRsvps = prepareRsvps(rsvps?.filter((r) => r.status === "not_going" && filterRsvp(r)) || []);


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
          // "Show all roles" must include every parent/guardian of an in-scope
          // child — including those with no role row on this team (they are
          // fetched separately as `linkedAdultProfiles`).
          const baseMembersToShow = effectiveShowAll ? attendanceMembers : attendancePlayerMembers;
          const adultPool = [...(members || []), ...(linkedAdultProfiles || [])];
          const membersToShow = effectiveShowAll
            ? [
                ...(baseMembersToShow || []),
                ...(adultPool.filter(
                  (m: any, i: number) =>
                    scopedAdultIds.has(m.id) &&
                    !(baseMembersToShow || []).some((b: any) => b.id === m.id) &&
                    adultPool.findIndex((a: any) => a.id === m.id) === i,
                )),
              ]
            : baseMembersToShow;
          // A child's response only covers the parent when the parent is a pure
          // proxy (players_only). On `players_and_parents` / `parents_only` the
          // adult owes their OWN response, so they must stay in "Not responded"
          // until they answer — otherwise they silently disappear from the list.
          const parentCoveredByChild = attendanceAudience === "players_only";
          const parentIdsWithRespondedChildren = new Set<string>();
          if (parentCoveredByChild) {
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
          }
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
          : (reminderMembers?.filter((m: any) =>
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


        const renderAttendee = (rsvp: any, status: RsvpStatus) => (
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
              ? (() => {
                  const member = membersWithRoles?.find((m: any) => m.id === rsvp.user_id);
                  // Always resolve against the event's team scope — a "player"
                  // role on a different team must never label them here.
                  return resolveAttendeeRoleLabel(member, event);
                })()
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
        );

        const guestNodes = eventGuests?.map((guest: any) => (
          <AttendanceRow
            key={guest.id}
            name={guest.guest_name}
            roleLabel="Guest"
            roleTone="guest"
            secondaryLine={`Guest of ${guest.added_by_name}`}
          />
        ));

        // Group key for an RSVP row. Prefer child_id (including linked
        // mini-league players) so parents responding on behalf of a child
        // land in that child's team/level group, not the parent's.
        const rsvpGroupKey = (rsvp: any) => {
          const childId = rsvp.child_id || rsvp.mini_league_players?.child_id || null;
          return groupMap.groupOf({
            userId: childId ? null : rsvp.user_id,
            childId,
          });
        };

        const renderBucket = (rsvpList: any[], status: RsvpStatus, includeGuests = false) => {
          if (!groupMap.isActive) {
            return (
              <div className="divide-y divide-border/50">
                {rsvpList.map((rsvp: any) => renderAttendee(rsvp, status))}
                {includeGuests && guestNodes}
              </div>
            );
          }
          const buckets = new Map<string, any[]>();
          for (const r of rsvpList) {
            const g = rsvpGroupKey(r);
            if (!g) continue; // out of the event audience — never show
            const arr = buckets.get(g.key) ?? [];
            arr.push(r);
            buckets.set(g.key, arr);
          }
          return (
            <div className="space-y-3">
              {groupMap.orderedGroups.map((g) => {
                const items = buckets.get(g.key) ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={g.key}>
                    <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.label} <span className="text-muted-foreground/70">({items.length})</span>
                    </div>
                    <div className="divide-y divide-border/50">
                      {items.map((rsvp: any) => renderAttendee(rsvp, status))}
                    </div>
                  </div>
                );
              })}
              {includeGuests && (guestNodes?.length ?? 0) > 0 && (
                <div>
                  <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Guests
                  </div>
                  <div className="divide-y divide-border/50">{guestNodes}</div>
                </div>
              )}
            </div>
          );
        };


        const renderNotRespondedChild = (child: any) => {
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
        };

        const renderNotRespondedAdult = (member: any) => {
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
                  roleLabel={(() => {
                    const label = resolveAttendeeRoleLabel(member, event);
                    return label ? String(label).replace(/_/g, " ") : null;
                  })()}

                  roleTone="neutral"
                  rightSlot={
                    <>
                      {remindBtn}
                      {editBtn}
                    </>
                  }
                />
              );
        };

        const childGroupKey = (child: any) => {
          const childId = isMiniLeagueEvent ? (child.child_id || child.id) : child.id;
          return groupMap.groupOf({ childId, userId: null });
        };
        const adultGroupKey = (member: any) =>
          groupMap.groupOf({ userId: member.id, childId: null });

        const notRespondedNode = groupMap.isActive ? (() => {
          const childBuckets = new Map<string, any[]>();
          for (const c of notRespondedChildren) {
            const g = childGroupKey(c);
            if (!g) continue;
            const arr = childBuckets.get(g.key) ?? [];
            arr.push(c);
            childBuckets.set(g.key, arr);
          }
          const adultBuckets = new Map<string, any[]>();
          for (const m of notResponded) {
            const g = adultGroupKey(m);
            if (!g) continue;
            const arr = adultBuckets.get(g.key) ?? [];
            arr.push(m);
            adultBuckets.set(g.key, arr);
          }
          return (
            <div className="space-y-3">
              {groupMap.orderedGroups.map((g) => {
                const kids = childBuckets.get(g.key) ?? [];
                const adults = adultBuckets.get(g.key) ?? [];
                const total = kids.length + adults.length;
                if (total === 0) return null;
                return (
                  <div key={g.key}>
                    <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.label} <span className="text-muted-foreground/70">({total})</span>
                    </div>
                    <div className="divide-y divide-border/50">
                      {kids.map(renderNotRespondedChild)}
                      {adults.map(renderNotRespondedAdult)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })() : (
          <div className="divide-y divide-border/50">
            {notRespondedChildren.map(renderNotRespondedChild)}
            {notResponded.map(renderNotRespondedAdult)}
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
            {/* Grouped attendance failed to load (e.g. permission denied) —
                never present a failed response as a valid empty roster. */}
            {(groupMap.isActive && groupMap.isError) || (isTargetedScope && scopedRosterQuery.isError) ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              >
                <span>Grouped attendance couldn’t be loaded. The list below may be incomplete.</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    if (groupMap.isError) groupMap.refetch();
                    if (scopedRosterQuery.isError) scopedRosterQuery.refetch();
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : null}
            {/* Grouping (by age level or team) is folded into each bucket
                inside AttendanceSection below — no separate breakdown card. */}

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
          {(isAppAdmin || hasTeamPro === true) && (
            <PlayerOfMatchSelector
              eventId={id!}
              clubId={event.club_id}
              teamId={event.team_id}
              isAdmin={isAdmin || isAppAdmin || false}
              rsvps={rsvps || []}
              childrenOnTeam={allChildrenOnTeam || childrenOnTeam}
            />
          )}
        </>
      )}

      {/* Player of Match Pro upgrade prompt — shown to admins on free clubs */}
      {event.type === "game" && event.team_id && isAdmin && !isAppAdmin && !isLoadingHasTeamPro && hasTeamPro !== true && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-5 w-5 text-amber-500" />
              Player of the Match
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-start gap-2">
              <Lock className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Player of the Match is a Pro feature</p>
                <p className="text-xs text-muted-foreground">
                  Upgrade to Pro to select and award Player of the Match, complete with points, vouchers, and automatic notifications.
                </p>
              </div>
            </div>
            {event.club_id && (
              <Button
                size="sm"
                onClick={() => navigate(`/clubs/${event.club_id}/upgrade`)}
                className="gap-1.5"
              >
                <Lock className="h-3.5 w-3.5" />
                Upgrade to Pro
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Duties Pro upgrade prompt — shown to admins on free clubs so they know duties exist behind Pro */}
      {event.type === "game" && !isMiniLeagueEvent && isAdmin && !isAppAdmin && !isLoadingHasTeamPro && hasTeamPro !== true && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Duty Roster</h2>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Lock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Match-day duties are a Pro feature</p>
                <p className="text-xs text-muted-foreground">
                  Upgrade to Pro to add and assign duties like Canteen/BBQ, Umpire/Referee, Snacks, Linesperson, Scorer and more — with automatic reminders and points for volunteers.
                </p>
              </div>
            </div>
            {event.club_id && (
              <Button
                size="sm"
                onClick={() => navigate(`/clubs/${event.club_id}/upgrade`)}
                className="gap-1.5"
              >
                <Lock className="h-3.5 w-3.5" />
                Upgrade to Pro
              </Button>
            )}
          </div>
        </section>
      )}

      {/* Duties Section (only for non-mini-league games — mini league duties are auto-created via Generate Matches) */}
      {event.type === "game" && !isMiniLeagueEvent && (isAppAdmin || hasTeamPro === true) && (

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
              // Soccer/football clubs get Referee / Linesperson / Subs Manager;
              // other sports get Umpire / Scorer instead.
              sport={event.clubs?.sport ?? null}
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
      {showPitchBoard && isSoccerClub && pitchBoardAccessGranted && teamMembers && event?.team_id && createPortal(
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

      {/* Netball + Basketball Game Board modals archived — football-only build */}

      {/* Post-RSVP Notification Prompt - only show if push is NOT enabled */}
      {user && event && notificationNudge.hasPushEnabled === false && (
        <PostRsvpNotificationPrompt
          open={showPostRsvpNudge}
          onClose={() => setShowPostRsvpNudge(false)}
          userId={user.id}
          eventTitle={event.title}
        />
      )}

      {noteTarget && (() => {
        const targetRsvp = noteTarget.kind === "child"
          ? childRsvps.find((r) => r.child_id === noteTarget.childId)
          : myRsvp;
        const statusLabel = targetRsvp?.status
          ? rsvpOptions.find((o) => o.value === targetRsvp.status)?.label ?? null
          : null;
        return (
          <RsvpNoteSheet
            open
            onOpenChange={(open) => { if (!open) setNoteTarget(null); }}
            subjectName={noteTarget.subjectName}
            statusLabel={statusLabel}
            initialNote={(targetRsvp as any)?.notes ?? null}
            onSave={async (note) => {
              await saveRsvpNoteMutation.mutateAsync({ childId: noteTarget.childId, note });
            }}
          />
        );
      })()}

    </div>
  );
}
