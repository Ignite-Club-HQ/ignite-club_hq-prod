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
import { ArrowLeft, Users, CheckCircle2, Circle, Loader2, Plus, Trash2, UserPlus, MessageSquare, Baby, Bell, DollarSign, Check, Share2, Flame, Eye, ChevronDown, Shield, Trophy, Hand, Lock } from "lucide-react";
import { exportEventIcs } from "@/lib/icsExport";
import { queueRsvp } from "@/lib/rsvpQueue";
import {
  adminSaveChildRsvp,
  adminUpdateRsvpStatus,
  adminUpsertRsvp,
  saveGuardianChildRsvp,
  saveParentMiniLeaguePlayerRsvp,
  savePersonalRsvp,
} from "@/features/events/eventRsvpWorkflow";
import { completeEventRsvp } from "@/features/events/eventRsvpCompletion";
import { eventKeys } from "@/features/events/eventQueryKeys";
import { refreshEventDuties } from "@/features/events/eventDutyCacheCompletion";
import { refreshEventPayments } from "@/features/events/eventPaymentCacheCompletion";
import {
  fetchCanManageEvent,
  fetchEventProAccess,
  fetchEventProFootballAccess,
  fetchIsAppAdmin,
} from "@/features/events/eventAccessRepository";
import {
  bucketAttendance,
  bucketNonResponders,
  rsvpAttendanceIdentity,
} from "@/features/events/attendanceGroupingPolicy";
import {
  calculateAttendanceNonResponders,
  prepareAttendanceRsvps,
  shouldDisplayAttendanceRsvp,
} from "@/features/events/attendanceAudiencePolicy";
import {
  cancelEventRows,
  SeriesCancellationPartialError,
} from "@/features/events/eventCancellationWorkflow";
import { TrainingDefaultControl } from "@/components/event/TrainingDefaultControl";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { refreshEventCaches } from "@/lib/eventCacheRefresh";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { friendlyMutationError } from "@/lib/friendlyMutationError";
import { format, parseISO, isSameDay } from "date-fns";
import { EventLocationDetails, EventLocationMap } from "@/components/event/EventLocationPresentation";
import { EventDateCalendarRow } from "@/components/event/EventDateCalendarRow";
import { exportEventToCalendar } from "@/features/events/eventCalendarExport";
import { EventPassiveFacts } from "@/components/event/EventPassiveFacts";
import { EventAttendanceSummary } from "@/components/event/EventAttendanceSummary";
import { calculateAttendanceSummary } from "@/features/events/attendanceSummaryPolicy";
import { resolvePitchBoardActions } from "@/features/events/pitchBoardActionPolicy";
import { PitchBoardActions } from "@/components/event/PitchBoardActions";
import { EventsHeaderSponsorStrip } from "@/components/events/EventsHeaderSponsorStrip";
import { EventGuestsManager } from "@/components/EventGuestsManager";
import { EventGroupsManager } from "@/components/EventGroupsManager";
import { AttendanceSection } from "@/components/event/AttendanceSection";
import { useEventGroupMap } from "@/hooks/useEventGroupMap";
import { useEventViewTracking } from "@/hooks/useEventViews";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { resolveRsvpAudience, shouldPromptParent, shouldPromptPlayer, isParentFirstEvent } from "@/lib/rsvpAudience";
import { resolveRsvpChildren, resolveEventChildRoster } from "@/lib/resolveEventChildScope";


import { AdminRsvpChanger } from "@/components/event/AdminRsvpChanger";

import { AttendanceRow } from "@/components/event/AttendanceRow";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
import { PostRsvpNotificationPrompt } from "@/components/PostRsvpNotificationPrompt";
import { formatMatchArrivalTime, getMatchArrivalMinutes, getMatchArrivalDate } from "@/lib/matchArrivalTime";
import { formatRelativePast } from "@/lib/formatRelativeTime";
import { EventMatchScoreSection } from "@/components/event/EventMatchScoreSection";
import { resolveMatchScoreSection } from "@/features/events/matchScoreSectionPolicy";
import { isEventUpcomingForActions, resolveEventAdminActions } from "@/features/events/eventAdminActionPolicy";
import { EventAdminActions } from "@/components/event/EventAdminActions";
import { EventReminderDialog, EventResendInvitesDialog } from "@/components/event/EventNotificationDialogs";
import { EventCancellationDialog, EventDeletionDialog } from "@/components/event/EventLifecycleDialogs";
import { EventNoteSection } from "@/components/event/EventNoteSection";


// Lazy load PitchBoard for game events
const PitchBoard = lazy(() => import("@/components/pitch/PitchBoard"));
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
import { isNetballSport, isBasketballSport } from "@/lib/sportDetection";
import { resolveEventRecipients, eventRecipientContext } from "@/features/events/eventRecipientPolicy";
import { sendBulkEventReminders, sendIndividualEventReminder } from "@/features/events/eventReminderWorkflow";
import { persistResentEventInvites } from "@/features/events/eventInviteResendWorkflow";
import { completeEventDuty, DutyNotificationPartialError } from "@/features/events/eventDutyCompletionWorkflow";
import { setEventPaymentStatus } from "@/features/events/eventPaymentWorkflow";
import { EventIdentityHeader } from "@/components/event/EventIdentityHeader";
import { resolveEventCapabilities } from "@/features/events/eventCapabilities";
import { fetchEventDetail } from "@/features/events/eventDetailRepository";
import { fetchEventRsvps } from "@/features/events/eventRsvpRepository";
import { fetchEventDuties, fetchEventGuests } from "@/features/events/eventSupportingReadsRepository";
import {
  fetchEventPayments,
  fetchMatchCaptain,
  fetchMatchGoalkeepers,
  fetchPlayerOfMatch,
} from "@/features/events/eventPaymentAwardRepository";
import {
  fetchTargetedAttendanceRoster,
  mergeTargetedChildren,
  selectScopedChildRoster,
  selectTargetedReminderMembers,
} from "@/features/events/targetedAttendanceRepository";

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
    queryKey: eventKeys.recentReminders(id!),
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
    queryKey: eventKeys.detail(id!),
    queryFn: () => fetchEventDetail(supabase, id!),
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
      queryClient.refetchQueries({ queryKey: eventKeys.detail(id) });
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
    queryKey: eventKeys.rsvps(id!),
    queryFn: () => fetchEventRsvps(supabase, id!, selectCachedProfilesByIds),
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
    queryFn: () => fetchEventGuests(supabase, id!, selectCachedProfilesByIds),
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
    queryKey: eventKeys.duties(id!),
    queryFn: () => fetchEventDuties(supabase, id!),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Check if user is app admin (global override)
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: () => fetchIsAppAdmin(supabase, user!.id),
    enabled: !!user,
  });

  // Check if user is admin for this event
  const { data: isAdmin } = useQuery({
    queryKey: ["event-admin-check", id, user?.id, event?.club_id, event?.team_id, event?.mini_league_id],
    queryFn: () => event
      ? fetchCanManageEvent(supabase, user!.id, {
          clubId: event.club_id,
          teamId: event.team_id,
          miniLeagueId: event.mini_league_id,
        })
      : false,
    enabled: !!user && !!event,
  });

  // Check if team has Pro Football subscription (for pitch board) or club has Pro Football
  const { data: hasProFootball, isLoading: isLoadingTeamPro } = useQuery({
    queryKey: ["team-pro-football-status", event?.team_id, event?.club_id],
    queryFn: () => fetchEventProFootballAccess(
      supabase,
      event!.team_id!,
      event?.club_id,
    ),
    enabled: !!event?.team_id,
  });
  
  // Check if team/club has Pro subscription (for other features like RSVP reminders)
  const { data: hasTeamPro, isLoading: isLoadingHasTeamPro } = useQuery({
    queryKey: ["team-pro-status", event?.team_id, event?.club_id],
    queryFn: () => fetchEventProAccess(
      supabase,
      event?.team_id,
      event?.club_id,
    ),
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
  const { canManageEvent, canOperateMatch } = resolveEventCapabilities({
    isEventManager: isAdmin,
    isAppAdmin,
    isSubsManagerForEvent,
  });
  const canManagePitchBoard = canOperateMatch;
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
      
      const { data, error } = await query;
      if (error) throw error;
      
      // Group roles by user_id, keeping track of every team_id we've seen for them.
      // `role_team_pairs` preserves WHICH team each role was held on, so targeted
      // club-wide events can scope role labels/filters to the invited teams only.
      const userRolesMap = new Map<
        string,
        { profile: any; roles: string[]; teamIds: Set<string>; pairs: { role: string; team_id: string | null }[] }
      >();
      data.filter(m => m.profiles).forEach(m => {
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
      await saveParentMiniLeaguePlayerRsvp(supabase, {
        eventId: id!, parentUserId: user!.id, playerId, status,
        existingRsvpId: existing?.id ?? null,
      });
    },
    onSuccess: () => {
      completeEventRsvp(queryClient, { eventId: id!, includeGroups: true });
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
    enabled: !!id && !!targetTeamIdsForFetch && canManageEvent,
    staleTime: 60_000,
    queryFn: () => fetchTargetedAttendanceRoster(supabase, id!),
  });
  const scopedChildRoster = useMemo(
    () => selectScopedChildRoster(scopedRosterQuery.data),
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
    return mergeTargetedChildren(base, scopedChildRoster);
  }, [allChildrenOnTeamRaw, scopedChildRoster, targetTeamIdsForFetch]);



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

  // Recipients for on-demand reminders. For a targeted club-wide event the
  // audience is NOT "everyone in the club": only members holding a role on a
  // targeted team, plus parents/guardians of children assigned to those teams.
  // Club-level admins/committee who have no tie to a targeted team are not
  // nagged (they can still see the event). Team / mini-league / untargeted
  // club-wide events keep the previous behaviour.
  const reminderMembers = useMemo(() => {
    if (event?.team_id || !targetTeamIdsForFetch) return members;
    return selectTargetedReminderMembers(
      members,
      targetTeamIdsForFetch,
      allChildrenOnTeam,
      childGuardiansOnTeam,
    );
  }, [members, event?.team_id, targetTeamIdsForFetch, allChildrenOnTeam, childGuardiansOnTeam]);

  // Get existing RSVPs for children (any guardian's RSVP for the child counts)
  const myChildIds = new Set((childrenOnTeam || []).map((c: any) => c.id));
  const childRsvps = rsvps?.filter((r) => r.child_id && myChildIds.has(r.child_id)) || [];

  // Fetch event payments (admin only)
  const { data: payments } = useQuery({
    queryKey: eventKeys.payments(id!),
    queryFn: () => fetchEventPayments(supabase, id!),
    enabled: !!id && canManageEvent,
  });

  // Create set of paid user IDs for quick lookup
  const paidUserIds = new Set(payments?.map(p => p.user_id) || []);

  // Match awards: captain, POTM, goalkeepers — used to show inline icons next to attendees
  const isGameEvent = event?.type === "game" && !!event?.team_id;
  const { data: matchCaptainRow } = useQuery({
    queryKey: ["match-captain", id, "marker"],
    enabled: !!id && isGameEvent,
    queryFn: () => fetchMatchCaptain(supabase, id!),
  });
  const { data: potmRow } = useQuery({
    queryKey: ["player-of-match", id, "marker"],
    enabled: !!id && isGameEvent,
    queryFn: () => fetchPlayerOfMatch(supabase, id!),
  });
  const { data: goalkeeperRows = [] } = useQuery({
    queryKey: ["match-goalkeepers", id],
    enabled: !!id && isGameEvent,
    queryFn: () => fetchMatchGoalkeepers(supabase, id!),
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

            refreshEventPayments(queryClient, id!);
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
      refreshEventPayments(queryClient, id!);
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
      const { queued, rsvpId } = await savePersonalRsvp(supabase, {
        eventId: id!,
        userId: user!.id,
        status,
        notes: rsvpNotes || null,
        existingRsvpId: myRsvp?.id || null,
        online: navigator.onLine,
      }, queueRsvp);
      if (queued) return;

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
      completeEventRsvp(queryClient, {
        eventId: id!, teamId: event?.team_id, includeGroups: true,
        includePitch: true, includePoints: true,
      });
      

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
      const { rsvpId } = await saveGuardianChildRsvp(supabase, {
        eventId: id!,
        guardianUserId: user!.id,
        childId,
        status,
        existingRsvpId: existingRsvp?.id ?? null,
      });

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
      completeEventRsvp(queryClient, {
        eventId: id!, teamId: event?.team_id, includeGroups: true,
        includePitch: true, includePoints: true,
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
      await adminUpsertRsvp(supabase, {
        eventId: id!, actingUserId: user!.id,
        subjectUserId: childId ? (parentUserId || user!.id) : user!.id,
        status,
        childId,
        miniLeaguePlayerId: childId ? null : playerId,
      });
    },
    onSuccess: (_, variables) => {
      completeEventRsvp(queryClient, {
        eventId: id!, teamId: event?.team_id, includeGroups: true, includePitch: true,
      });
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
      await adminUpdateRsvpStatus(supabase, { rsvpId, status, actingUserId: user!.id });
    },
    onSuccess: (_, variables) => {
      completeEventRsvp(queryClient, {
        eventId: id!, teamId: event?.team_id, includeGroups: true, includePitch: true,
      });
      
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
      await adminUpsertRsvp(supabase, {
        eventId: id!, actingUserId: user!.id, subjectUserId: memberId, status,
      });
    },
    onSuccess: (_, variables) => {
      completeEventRsvp(queryClient, {
        eventId: id!, teamId: event?.team_id, includePitch: true,
      });
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
      await adminSaveChildRsvp(supabase, {
        eventId: id!, parentUserId, childId, status,
      });
    },
    onSuccess: (_, variables) => {
      completeEventRsvp(queryClient, {
        eventId: id!, teamId: event?.team_id, includePitch: true,
      });
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
      await setEventPaymentStatus(supabase, {
        eventId: id!, userId, isPaid,
        amount: event?.amount || 0,
        paidAt: new Date().toISOString(),
      });
    },
    onSuccess: (_, variables) => {
      refreshEventPayments(queryClient, id!);
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
      refreshEventDuties(queryClient, id!);
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
      refreshEventDuties(queryClient, id!);
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

      return completeEventDuty(supabase, {
        dutyId,
        eventId: id!,
        completedAt: new Date().toISOString(),
        actorId: user?.id,
        memberName: profile?.display_name || "A member",
        dutyName: duty?.name,
        eventTitle: event?.title,
        teamId: event?.team_id,
        clubId: event?.club_id,
      });
    },
    onSuccess: (result) => {
      refreshEventDuties(queryClient, id!);
      if (result?.outcome === "completed") {
        toast({ title: "Duty completed!" });
      }
    },

    onError: (error) => {
      if (error instanceof DutyNotificationPartialError) {
        // The duty IS completed — never roll back or reopen it, and never
        // report a total failure.
        refreshEventDuties(queryClient, id!);
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
      refreshEventDuties(queryClient, id!);
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
      refreshEventDuties(queryClient, id!);
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
      refreshEventDuties(queryClient, id!);
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



  const cancelEventMutation = useMutation({
    mutationFn: async ({ cancelType, customMessage, sendPushNotification }: { cancelType: 'single' | 'series'; customMessage?: string; sendPushNotification?: boolean }) => {
      console.log("[CancelEvent] Starting cancel mutation", { cancelType, eventId: id, miniLeagueId: event?.mini_league_id });

      await cancelEventRows(supabase, {
        eventId: id!,
        cancelType,
        isRecurring: !!event?.is_recurring,
        parentEventId: event?.parent_event_id,
      });


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
      queryClient.invalidateQueries({ queryKey: eventKeys.detail(id!) });
      refreshEventCaches(queryClient, user?.id);
      toast({ title: "Event cancelled", description: "A message has been posted to the chat" });
    },
    onError: (error) => {
      console.error("[CancelEvent] Mutation error:", error);
      if (error instanceof SeriesCancellationPartialError) {
        // Part of the series IS cancelled — never roll back client-side, and
        // never report either complete success or complete failure.
        setCancelDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: eventKeys.detail(id!) });
        queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
        queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(id!) });
        queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(id!) });
        queryClient.invalidateQueries({ queryKey: eventKeys.groups(id!) });
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
      const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
      return sendBulkEventReminders(supabase, {
        eventId: id!,
        title: event?.title || "Event",
        recipientContext: eventRecipientContext(event, id!),
        cooldownSince: since,
      });
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
      const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
      return sendIndividualEventReminder(supabase, {
        eventId: id!,
        title: event?.title || "Event",
        displayName,
        cooldownSince: since,
        userId,
        childId,
      });
    },
    onSuccess: ({ displayName, count, isChild, recipientKey }) => {
      const now = new Date().toISOString();
      setRecentlyReminded((prev) => {
        const next = new Map(prev);
        next.set(recipientKey, now);
        return next;
      });
      // Refresh the 24h cooldown set so the "Reminded" state survives a page reload
      queryClient.invalidateQueries({ queryKey: eventKeys.recentReminders(id!) });
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
      const newMembers = await persistResentEventInvites(supabase, {
        eventId: id,
        title: event.title,
        creatorId: event.created_by,
        recipientContext: eventRecipientContext(event, id),
      });

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
              onClick={() => queryClient.invalidateQueries({ queryKey: eventKeys.detail(id!) })}
            >
              Try again
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate('/')}>Go Home</Button>
        </div>
      </div>
    );
  }

  const pitchBoardActions = resolvePitchBoardActions({
    eventType: event.type,
    hasTeam: !!event.team_id,
    supportedSport: isSoccerClub,
    accessLoading: isPitchBoardAccessLoading,
    canAccess: canAccessPitchBoard,
    membersLoading: isTeamMembersForPitchLoading,
    hasTeamMembers: !!teamMembers,
    canViewReadOnly: canViewPitchBoardReadOnly,
    eventTimeMs: parseISO(event.event_date).getTime(),
    nowMs: Date.now(),
  });
  const adminActions = resolveEventAdminActions({
    canManageEvent,
    isCancelled: !!event.is_cancelled,
    isUpcoming: isEventUpcomingForActions({
      eventDate: event.event_date,
      endTime: event.end_time,
      startTime: event.start_time,
      nowMs: Date.now(),
    }),
    canSendReminders,
    proLoading: isLoadingHasTeamPro,
  });


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

        <EventAdminActions
          model={adminActions}
          eventTypeLabel={eventTypeLabel}
          onEdit={() => navigate(`/events/${id}/edit`)}
          onRemind={() => setReminderDialogOpen(true)}
          onResend={() => setResendDialogOpen(true)}
          onCancel={() => setCancelDialogOpen(true)}
          onDelete={() => setDeleteDialogOpen(true)}
        />

        <EventReminderDialog
          open={reminderDialogOpen}
          onOpenChange={setReminderDialogOpen}
          onShare={() => { setReminderDialogOpen(false); handleShareReminderLink(); }}
          onSend={() => remindMutation.mutate()}
          isPending={remindMutation.isPending}
          actionsDisabled={attendanceActionsDisabled}
        />
        <EventResendInvitesDialog
          open={resendDialogOpen}
          onOpenChange={setResendDialogOpen}
          onSend={() => resendInvitesMutation.mutate()}
          isPending={resendInvitesMutation.isPending}
          actionsDisabled={attendanceActionsDisabled}
        />

        <EventCancellationDialog
          recurring={!!(event.is_recurring || event.parent_event_id)}
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          event={event}
          isPending={cancelEventMutation.isPending}
          onCancel={(cancelType, customMessage, sendPushNotification) =>
            cancelEventMutation.mutate({ cancelType, customMessage, sendPushNotification })
          }
        />
        <EventDeletionDialog
          recurring={!!(event.is_recurring || event.parent_event_id)}
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          eventTypeLabel={eventTypeLabel}
          isPending={deletePending}
          onDelete={handleConfirmDelete}
        />
      </div>

      {/* Event Info */}
      <EventIdentityHeader
        title={event.title}
        clubName={event.clubs?.name}
        teamName={event.teams?.name}
        isCancelled={event.is_cancelled}
      />

      {/* Details Card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <EventDateCalendarRow eventDate={event.event_date} onExport={async () => {
            try {
              await exportEventToCalendar(exportEventIcs, event, getShareUrl("event", id!));
              toast({ title: "Calendar file ready", description: "Open it to add this event to your calendar." });
            } catch (err) {
              toast({ title: "Couldn't export event", description: (err as Error).message, variant: "destructive" });
            }
          }} />
          <EventLocationDetails
            address={event.address}
            suburb={event.suburb}
            state={event.state}
            postcode={event.postcode}
            locationName={(event as any).location_name}
            legacyLocation={(event as any).location}
          />
          <EventPassiveFacts
            eventType={event.type}
            opponent={event.opponent}
            arrivalTime={formatMatchArrivalTime(event as any)}
            arrivalMinutes={getMatchArrivalMinutes(event as any)}
            price={eventPrice ? Number(eventPrice) : null}
          />
          <EventAttendanceSummary summary={calculateAttendanceSummary({
            eventType: event.type,
            rsvps,
            guestCount: eventGuests?.length || 0,
            playerUserIds: (playerMembers || []).map((member: any) => member.id),
            attendanceUnavailable,
          })} />

          <PitchBoardActions {...pitchBoardActions} onOpen={() => setShowPitchBoard(true)} />
        </CardContent>
      </Card>

      <EventMatchScoreSection
        model={resolveMatchScoreSection({
          eventType: event.type,
          teamId: event.team_id,
          isTeamMember,
          canManageEvent,
          canOperateMatch,
          opponent: event.opponent,
          title: event.title,
        })}
        eventId={event.id}
        teamId={event.team_id}
        teamName={event.teams?.name}
        sport={event.clubs?.sport}
      />

      {/* Map */}
      <EventLocationMap
        address={event.address}
        suburb={event.suburb}
        state={event.state}
        postcode={event.postcode}
        locationName={(event as any).location_name}
        legacyLocation={(event as any).location}
      />

      {/* Mini League Matches — PRIMARY section for league events, placed at top */}
      {isMiniLeagueEvent && event.mini_league_id && (
        <>
          <Separator />
          <section className="space-y-3">
            <EventGroupsManager
              eventId={id!}
              miniLeagueId={event.mini_league_id}
              isAdmin={canManageEvent}
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
        canEdit={canManageEvent}
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
                            disabled={childRsvpMutation.isPending || attendanceActionsDisabled}
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
          isAdmin={canManageEvent}
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


        // Targeted club-wide event: only attendees inside the event audience
        // may appear in any bucket. Also hydrate child names from the scoped
        // roster so authorised managers never see "Unknown".
        const scopedChildIds = new Set((allChildrenOnTeam || []).map((c: any) => c.id));
        const scopedAdultIds = new Set((attendanceMembers || []).map((m: any) => m.id));
        const isTargetedScope = !!targetTeamIdsForFetch;
        const prepareRsvps = (list: any[]) => prepareAttendanceRsvps(list, {
          targeted: isTargetedScope,
          scopedChildIds,
          scopedAdultIds,
          scopedChildNames,
        });
        const filterRsvp = (rsvp: any) => shouldDisplayAttendanceRsvp(rsvp, {
          showAll: effectiveShowAll,
          miniLeague: isMiniLeagueEvent,
          playerUserIds,
        });
        const goingRsvps = prepareRsvps(rsvps?.filter((r) => r.status === "going" && filterRsvp(r)) || []);
        const maybeRsvps = prepareRsvps(rsvps?.filter((r) => r.status === "maybe" && filterRsvp(r)) || []);
        const notGoingRsvps = prepareRsvps(rsvps?.filter((r) => r.status === "not_going" && filterRsvp(r)) || []);


        const nonResponders = calculateAttendanceNonResponders({
          rsvps: rsvps ?? [],
          miniLeague: isMiniLeagueEvent,
          showAll: effectiveShowAll,
          miniLeaguePlayers,
          miniLeagueAdults,
          visibleMembers: effectiveShowAll ? attendanceMembers : attendancePlayerMembers,
          children: allChildrenOnTeam,
          childGuardians: childGuardiansOnTeam,
          reminderMembers,
        });
        const notResponded = nonResponders.adults;
        const notRespondedChildren = nonResponders.children;

        const totalNotResponded = isMiniLeagueEvent
          ? notRespondedChildren.length + notResponded.length
          : notResponded.length + notRespondedChildren.length;

        // Always derive non-responder IDs from ALL members (not filtered by "Show all roles")
        // so admins can always send reminders, regardless of the visible roster filter.
        const allNotRespondedForReminders = nonResponders.reminderAdults;


        const renderAttendee = (rsvp: any, status: RsvpStatus) => (
          <AttendeeCard
            key={rsvp.id}
            rsvp={rsvp}
            hasPaid={status !== "not_going" ? paidUserIds.has(rsvp.user_id) : undefined}
            isAdmin={canManageEvent}
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
                  const roles: string[] = membersWithRoles?.find((m: any) => m.id === rsvp.user_id)?.roles ?? [];
                  // While the roster is filtered to players only, show the role
                  // that qualified them ("player") rather than their first role.
                  if (!effectiveShowAll && roles.includes("player")) return "player";
                  return roles[0];
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
        const renderBucket = (rsvpList: any[], status: RsvpStatus, includeGuests = false) => {
          if (!groupMap.isActive) {
            return (
              <div className="divide-y divide-border/50">
                {rsvpList.map((rsvp: any) => renderAttendee(rsvp, status))}
                {includeGuests && guestNodes}
              </div>
            );
          }
          const buckets = bucketAttendance(
            rsvpList,
            groupMap.orderedGroups,
            rsvpAttendanceIdentity,
            groupMap.groupOf,
          );
          return (
            <div className="space-y-3">
              {buckets.map((g) => {
                const items = g.items;
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
              const remindBtn = canManageEvent && canRemind ? (() => {
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


              const editBtn = canManageEvent ? (
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
              const remindBtn = canManageEvent ? (() => {
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
              const editBtn = canManageEvent ? (
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
                    const roles: string[] = member.roles ?? [];
                    const shown = !effectiveShowAll && roles.includes("player") ? "player" : roles[0];
                    return shown ? String(shown).replace(/_/g, " ") : null;
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

        const notRespondedNode = groupMap.isActive ? (() => {
          const buckets = bucketNonResponders(
            notRespondedChildren,
            notResponded,
            groupMap.orderedGroups,
            (child: any) => ({
              childId: isMiniLeagueEvent ? (child.child_id || child.id) : child.id,
              userId: null,
            }),
            (member: any) => ({ userId: member.id, childId: null }),
            groupMap.groupOf,
          );
          return (
            <div className="space-y-3">
              {buckets.map((g) => {
                const kids = g.children;
                const adults = g.adults;
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
            {canManageEvent && event.type === "training" && goingRsvps.length > 0 && (() => {
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
              isAdmin={canManageEvent}
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
            isAdmin={canManageEvent}
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
                isAdmin={canManageEvent}
                rsvps={rsvps || []}
              />
            );
          })()}
          {(isAppAdmin || hasTeamPro === true) && (
            <PlayerOfMatchSelector
              eventId={id!}
              clubId={event.club_id}
              teamId={event.team_id}
              isAdmin={canManageEvent}
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
    </div>
  );
}
