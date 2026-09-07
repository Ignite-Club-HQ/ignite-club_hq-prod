import { useState, lazy, Suspense, useMemo, useEffect, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useScheduleBroadcastListener } from "@/hooks/useScheduleBroadcastListener";
import { Capacitor } from "@capacitor/core";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import SoccerBall from "@/components/pitch/SoccerBall";
import { Calendar, MapPin, Users, Clock, Plus, UserPlus, UserCheck, Download, Smartphone, LayoutGrid, X, CheckCircle2, HelpCircle, Minus, Loader2, Flame, Gift, Lock, FolderOpen, Crown, Bell, ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
// Lazy-loaded to keep them out of the HomePage critical path. Each is only
// mounted when the user opens a specific dialog / lands on a banner-eligible
// state, so the chunk fetch happens on demand.
const RewardClaimQRDialog = lazyWithRetry(() => import("@/components/RewardClaimQRDialog").then(m => ({ default: m.RewardClaimQRDialog })));
const AccountRecoveryBanner = lazyWithRetry(() => import("@/components/AccountRecoveryBanner").then(m => ({ default: m.AccountRecoveryBanner })));
const NativeAppDownloadBanner = lazyWithRetry(() => import("@/components/NativeAppDownloadBanner").then(m => ({ default: m.NativeAppDownloadBanner })));
const HomeInviteFlow = lazyWithRetry(() => import("@/components/HomeInviteFlow"));
const QuickRSVPDialog = lazyWithRetry(() => import("@/components/QuickRSVPDialog").then(m => ({ default: m.QuickRSVPDialog })));

// Warm the dialog chunks after first paint so opening them feels instant.
// idle callback keeps this off the critical path.
if (typeof window !== "undefined") {
  const warm = () => {
    void import("@/components/HomeInviteFlow").catch(() => {});
    void import("@/components/NativeAppDownloadBanner").catch(() => {});
    void import("@/components/AccountRecoveryBanner").catch(() => {});
    void import("@/components/RewardClaimQRDialog").catch(() => {});
  };
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(warm, { timeout: 4000 });
  } else {
    window.setTimeout(warm, 2500);
  }
}
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageLoading } from "@/components/ui/page-loading";

// Lazy load PitchBoard - it's a heavy 4k+ line component with Fabric.js
const PitchBoard = lazyWithRetry(() => import("@/components/pitch/PitchBoard"));
const GameTimerWidget = lazyWithRetry(() => import("@/components/pitch/GameTimerWidget"));
import { clearPitchBoardOpenFlag } from "@/components/pitch/pitchBoardOpenFlag";
// CourtBoardResumeCard archived (basketball/netball only) — soccer resume handled by GameTimerWidget

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { mark as coldMark, snapshotStages } from "@/lib/coldStartMarks";
import { logHomeOpenLatency, resetHomeOpenLog } from "@/lib/homeOpenLatency";
import { recordPointsHistory } from "@/lib/pointsHistory";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { getSportEmoji } from "@/lib/sportEmojis";
import { findNearbyGameEvent } from "@/hooks/useNearbyGameEvent";
import { useClubTheme, hasClubThemeCached } from "@/hooks/useClubTheme";
import { useUserClubPoints, useChildrenClubPoints } from "@/hooks/useClubPoints";
import { ClubSponsorSection } from "@/components/ClubSponsorSection";
import { MultiClubSponsorCarousel } from "@/components/MultiClubSponsorCarousel";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";
import { UpcomingClassesWidget } from "@/components/UpcomingClassesWidget";
// Eager prefetch: kick the chunk request off at module-eval time so it's in flight
// before the section becomes visible. Still lazy() so it doesn't block first paint.
const myTeamsCarouselImport = () =>
  import("@/components/MyTeamsPremiumCarousel").then((m) => ({ default: m.MyTeamsPremiumCarousel }));
// Fire the request immediately (don't await — let it stream alongside other resources).
myTeamsCarouselImport();
const MyTeamsPremiumCarousel = lazy(myTeamsCarouselImport);
// Eagerly imported: these render alongside the rest of the first Home paint —
// a lazy chunk made them appear noticeably after everything else.
import ClubLinksSection from "@/components/home/ClubLinksSection";
import ClubNewsSection from "@/components/home/ClubNewsSection";


import { NextUpCarousel } from "@/components/NextUpCarousel";
import { getCachedNextUp, setCachedNextUp, clearCachedNextUp } from "@/lib/nextUpEventsCache";
import { ContactClubButton } from "@/components/ContactClubButton";

import { HomeQuickActionsFab } from "@/components/HomeQuickActionsFab";
import { DesktopActionBar } from "@/components/home/DesktopActionBar";
import { HomeWelcomeGetStarted } from "@/components/home/HomeWelcomeGetStarted";
import { ClubSetupProgressCard } from "@/components/club/ClubSetupProgressCard";

import { LazyMount } from "@/components/LazyMount";
import { readHomeSponsorHint } from "@/lib/homeSponsorHint";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

type EventType = "game" | "training" | "social";
type TeamRole = "player" | "parent" | "coach" | "team_admin";
type LeagueRole = "league_admin" | "parent";

function HomeMyTeamsSkeleton() {
  return (
    <section className="space-y-2.5" aria-hidden="true">
      <h2 className="text-xl font-bold px-1 tracking-tight">My Teams</h2>
      <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 pb-2 pr-4">
          {[1, 2].map((i) => (
            <div key={i} className="shrink-0 w-[85vw] max-w-[320px] h-[212px] rounded-lg bg-card border border-border/60 p-4 space-y-3 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted/80" />
                </div>
              </div>
              <div className="rounded-md bg-muted/40 h-[62px] p-3 space-y-2">
                <div className="h-3 w-4/5 rounded bg-muted" />
                <div className="h-3 w-3/5 rounded bg-muted/80" />
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-border/40 h-[36px]">
                <div className="h-7 w-7 rounded-full bg-muted" />
                <div className="h-3 w-24 rounded bg-muted/80" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HomeInitialSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-6 w-24 rounded bg-muted animate-pulse" />
          <div className="h-4 w-16 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-[340px] overflow-hidden rounded-lg bg-card border border-border/50 p-4 space-y-3 animate-pulse">
          <div className="ml-auto h-5 w-16 rounded-full bg-muted" />
          <div className="h-7 w-2/3 rounded bg-muted" />
          <div className="h-4 w-4/5 rounded bg-muted/80" />
          <div className="h-4 w-3/5 rounded bg-muted/80" />
          <div className="h-4 w-full rounded bg-muted/70" />
          <div className="pt-28 space-y-2">
            <div className="h-4 w-1/2 rounded bg-muted/70" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-9 rounded-full bg-muted" />
              <div className="h-9 rounded-full bg-muted" />
              <div className="h-9 rounded-full bg-muted" />
            </div>
            <div className="h-12 rounded-xl bg-muted/50" />
          </div>
        </div>
        {/* Reserve dot row so My Teams below stays at a stable Y position. */}
        <div className="h-[24px]" aria-hidden="true" />
      </section>
      <HomeMyTeamsSkeleton />
    </div>
  );
}

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
  start_time?: string | null;
  address: string | null;
  location_name: string | null;
  suburb: string | null;
  club_id: string;
  team_id: string | null;
  mini_league_id: string | null;
  is_cancelled: boolean;
  is_bye?: boolean;
  is_recurring: boolean;
  parent_event_id: string | null;
  amount: number | null;
  opponent: string | null;
  arrival_minutes_before: number | null;
  teams: { name: string; default_match_arrival_minutes: number | null } | null;
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

const leagueRoleOptions: { value: LeagueRole; label: string }[] = [
  { value: "league_admin", label: "League Admin" },
  { value: "parent", label: "Parent" },
];

export function formatEventDate(dateStr: string) {
  const date = parseISO(dateStr);
  if (isToday(date)) return `Today at ${format(date, "h:mm a")}`;
  if (isTomorrow(date)) return `Tomorrow at ${format(date, "h:mm a")}`;
  return format(date, "EEE, MMM d 'at' h:mm a");
}

export function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getEventLocalDateKey(dateStr: string) {
  // Treat any timestamp with a time component (ISO "T" or Postgres space form
  // like "2026-06-06 23:30:00+00") as an absolute instant and convert to the
  // viewer's local date. Only date-only strings ("YYYY-MM-DD") are taken at
  // face value. Without this, a UTC-evening event reads as "yesterday" in
  // AEST and gets dropped from Next Up.
  const hasTimeComponent = dateStr.includes("T") || /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(dateStr);
  if (hasTimeComponent) {
    const parsed = new Date(dateStr);
    if (!Number.isNaN(parsed.getTime())) {
      return getLocalDateKey(parsed);
    }
  }
  return dateStr.slice(0, 10);
}

export function getEventStartMs(event: Pick<Event, "event_date" | "start_time">) {
  // Prefer event_date when it already carries a time component — for recurring
  // occurrences this is the canonical per-instance kickoff. `start_time` on a
  // recurring child often retains the *series template's* original date
  // (e.g. "2026-04-29 06:15:00+00" for a June 10 training), which would make
  // the event look like it kicked off months ago and get filtered out of
  // Next Up before its real kickoff arrives.
  const eventDateHasTime =
    !!event.event_date && /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(event.event_date);

  if (event.start_time) {
    const isFullTimestamp = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(event.start_time);
    if (isFullTimestamp) {
      // If start_time's local date disagrees with event_date's local date,
      // trust event_date (the per-instance kickoff) and ignore the stale
      // series-template date carried on start_time.
      if (eventDateHasTime) {
        const eventLocal = getEventLocalDateKey(event.event_date);
        const startLocal = getEventLocalDateKey(event.start_time);
        if (eventLocal !== startLocal) {
          const ed = new Date(event.event_date);
          return Number.isNaN(ed.getTime()) ? Number.NaN : ed.getTime();
        }
      }
      const start = new Date(event.start_time);
      return start.getTime();
    }
    // Time-only string ("19:30") — combine with the event's local date.
    const start = new Date(`${getEventLocalDateKey(event.event_date)}T${event.start_time}`);
    return start.getTime();
  }

  const parsed = new Date(event.event_date);
  return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed.getTime();
}

export function isStillUpcomingForNextUp(event: Pick<Event, "event_date" | "start_time">, nowMs: number) {
  const todayKey = getLocalDateKey(new Date(nowMs));
  const eventKey = getEventLocalDateKey(event.event_date);
  if (eventKey < todayKey) return false;

  const startMs = getEventStartMs(event);
  if (eventKey === todayKey && !Number.isNaN(startMs) && startMs + 30 * 60 * 1000 < nowMs) {
    return false;
  }

  return true;
}

export function selectVisibleHomeEvents(
  allEvents: Event[] | undefined,
  activeClubFilter: string | null,
  nowMs: number,
  limit = 10,
) {
  if (!allEvents) return [];

  const freshEvents = allEvents.filter((event) =>
    isStillUpcomingForNextUp(event, nowMs)
  );

  if (!activeClubFilter) {
    return freshEvents.slice(0, limit);
  }

  return freshEvents
    .filter((event) => event.club_id === activeClubFilter)
    .slice(0, limit);
}

export default function HomePage() {
  const { user, profile, refreshProfile, initialized } = useAuth();
  
  usePageTitle("Home");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isNativeApp = Capacitor.isNativePlatform();
  const { activeClubFilter, activeClubTeamIds, activeThemeData } = useClubTheme();
  const [nowTick, setNowTick] = useState(() => Date.now());
  const lastHomeRefreshRef = useRef(0);
  
  // Use cached theme state to prevent gradient flash on initial render
  const [initialHasClubTheme] = useState(hasClubThemeCached);
  const hasClubTheme = activeThemeData || initialHasClubTheme;
  
  // Only show install card on first login if app is not already installed
  const installCardDismissedKey = `ignite-install-dismissed-${user?.id}`;
  const [showInstallCard, setShowInstallCard] = useState(() => {
    if (!user?.id) return false;
    return localStorage.getItem(installCardDismissedKey) !== 'true';
  });

  // One-time post-signup welcome toast (flag set by CompleteProfilePage).
  useEffect(() => {
    try {
      const name = sessionStorage.getItem("ignite_show_welcome_toast");
      if (!name) return;
      sessionStorage.removeItem("ignite_show_welcome_toast");
      toast({
        title: `Welcome to Ignite, ${name}! 🎉`,
        description: "Tap the + button to start a club, team or event — or check your notifications for pending invites.",
      });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const dismissInstallCard = () => {
    setShowInstallCard(false);
    if (user?.id) {
      localStorage.setItem(installCardDismissedKey, 'true');
    }
  };
  
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [memberInviteOpen, setMemberInviteOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [selectedClubForTeam, setSelectedClubForTeam] = useState<string>("");
  const [selectedTeamRole, setSelectedTeamRole] = useState<TeamRole>("parent");
  const [selectedChildForLink, setSelectedChildForLink] = useState<string>("");
  const [newChildName, setNewChildName] = useState<string>("");
  const [selectedLeagueRole, setSelectedLeagueRole] = useState<LeagueRole>("league_admin");
  // Track if user selected a league (prefixed with "league_") or team in the unified dropdown
  const isLeagueSelected = selectedTeam.startsWith("league_");
  const actualLeagueId = isLeagueSelected ? selectedTeam.replace("league_", "") : null;
  const [pitchBoardTeam, setPitchBoardTeam] = useState<{ id: string; name: string; members: Array<{ id: string; user_id: string; role: string; profiles: { display_name: string | null; avatar_url: string | null } | null }>; readOnly: boolean; linkedEventId?: string | null } | null>(null);
  const [pitchBoardLoading, setPitchBoardLoading] = useState(false);
  const [pitchBoardsExpanded, setPitchBoardsExpanded] = useState(false);
  const [quickRsvpEvent, setQuickRsvpEvent] = useState<Event | null>(null);
  const [rewardQROpen, setRewardQROpen] = useState(false);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  
  const [selectedUpgradeClub, setSelectedUpgradeClub] = useState<string>("");
  const [rewardsDialogOpen, setRewardsDialogOpen] = useState(false);
  const [selectedRewardClubId, setSelectedRewardClubId] = useState<string | null>(null);
  const [selectedReward, setSelectedReward] = useState<any>(null);
  const [confirmRedeemDialogOpen, setConfirmRedeemDialogOpen] = useState(false);
  const [selectedRedeemFor, setSelectedRedeemFor] = useState<string>("myself");

  // Hydrate from localStorage so returning to home after a long absence (or a
  // cold open after React Query's gcTime evicted the cache) paints the Next Up
  // cards instantly instead of flashing a skeleton while the consolidated
  // memberships+events query refetches. Mirrors MyTeamsPremiumCarousel.
  const nextUpCachedSnapshot = useMemo(
    () => getCachedNextUp<{ memberships: any; events: Event[]; cachedAt: number }>(user?.id),
    [user?.id],
  );

  // Home perf: mark mount + track primary-query return + first paint. See
  // src/lib/homeOpenLatency.ts. Best-effort; one sample per open.
  // We capture per-open timestamps locally because `coldMark` is
  // first-write-wins per JS session — relying on it made every subsequent
  // home open report the FIRST open's `query_ms` / `first_paint_ms`.
  const homeOpenStartRef = useRef<number>(Date.now());
  const homeMountTsRef = useRef<number>(Date.now());
  const homeQueryReturnTsRef = useRef<number | null>(null);
  const homeFirstPaintTsRef = useRef<number | null>(null);
  const homePerfLoggedRef = useRef(false);
  useEffect(() => {
    const now = Date.now();
    homeOpenStartRef.current = now;
    homeMountTsRef.current = now;
    homeQueryReturnTsRef.current = null;
    homeFirstPaintTsRef.current = null;
    homePerfLoggedRef.current = false;
    coldMark("home_mount");
    return () => { resetHomeOpenLog(); };
  }, []);

  // CONSOLIDATED: Fetch user memberships AND events in a single query to eliminate waterfall
  const { data: membershipAndEvents, isLoading, isFetching, isFetched } = useQuery({
    queryKey: ["user-memberships-and-events", user?.id],
    queryFn: async () => {
      // Step 1: Fetch user roles.
      // CRITICAL: throw on error (do NOT silently return empty). On resume from
      // background / phone unlock, the access token can be mid-rotation and
      // this call may transiently fail or return null under RLS. Returning
      // `{ events: [] }` here would *overwrite* the previously cached events
      // with an empty list (placeholderData only helps when there is no data)
      // — which is exactly the bug where the Next Up cards disappeared after
      // returning to the app. Throwing lets React Query keep the last good
      // data and retry.
      const fetchRoles = async () => {
        const res = await supabase
          .from("user_roles")
          .select("club_id, team_id, role")
          .eq("user_id", user!.id);
        if (res.error) throw res.error;
        if (!res.data) {
          // .data is [] (not null) on a successful zero-row response, so reaching
          // here means something went wrong upstream — throw so we don't poison
          // the cache with empty events on resume races.
          throw new Error("user_roles fetch returned null data");
        }
        return res.data;
      };

      let roles = await fetchRoles();

      // RESUME RACE: after a phone unlock / app resume the access token can be
      // expired-but-not-yet-rotated. RLS then legitimately returns ZERO rows
      // with NO error, which previously flipped Home into the "set up your
      // club" new-user empty state and blanked Next Up (a full app kill fixed
      // it because auth was restored before the first fetch).
      // An empty result is only trusted when it is *verified*: a live session
      // must exist, and if the last known snapshot had memberships we force a
      // single-flight refresh and re-read before believing the user has none.
      if (roles.length === 0) {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session) {
          throw new Error("empty memberships with no active session (resume race)");
        }

        const snapshotMemberships = nextUpCachedSnapshot?.memberships as
          | { clubIds?: string[]; teamIds?: string[] }
          | undefined;
        const hadMemberships =
          (snapshotMemberships?.clubIds?.length ?? 0) > 0 ||
          (snapshotMemberships?.teamIds?.length ?? 0) > 0;

        if (hadMemberships) {
          const { refreshSessionOnce } = await import("@/lib/refreshSessionOnce");
          let refreshed = false;
          try {
            await refreshSessionOnce();
            refreshed = true;
          } catch {
            refreshed = false;
          }
          if (!refreshed) {
            // Could not prove the token is current — do NOT accept the empty
            // read; throw so React Query retries and keeps the last good data.
            throw new Error("empty memberships and session refresh failed (resume race)");
          }
          roles = await fetchRoles();
          if (roles.length === 0) {
            // Verified-empty (fresh token): the user really has no memberships.
            // Drop the stale snapshot so it can't resurrect old cards.
            clearCachedNextUp(user!.id);
          }
        }
      }

      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id) as string[];
      const clubIds = new Set<string>();
      const clubAdminClubIds = new Set<string>();
      const leagueAdminClubIds = new Set<string>();

      roles.forEach(r => {
        if (r.club_id) {
          clubIds.add(r.club_id);
          if (r.role === 'club_admin' || r.role === 'app_admin') {
            clubAdminClubIds.add(r.club_id);
          }
          if (r.role === 'league_admin') {
            leagueAdminClubIds.add(r.club_id);
          }
        }
      });

      // Step 2: Fetch team clubs, player leagues, admin leagues, AND events in parallel
      const now = new Date();
      const todayStr = getLocalDateKey(now);
      const leagueAdminArr = Array.from(leagueAdminClubIds);

      // Scope the events fetch to clubs/teams the user is already known to
      // belong to (from `roles`). Without this scope the query pulled the
      // global next 50 events ordered by date, which on multi-club accounts
      // (e.g. a user in a high-volume club + a quieter club) was being
      // saturated by the busy club's training events — silently starving
      // the quieter club's fixtures out of the Next Up window. RLS already
      // restricts visibility, but it does NOT cap per-club volume, so the
      // limit-50 cut-off would land before the quieter club's next event
      // (manifesting as an empty Next Up after switching club themes).
      const clubIdsFromRolesArr = Array.from(clubIds);

      // PER-SCOPE FAN-OUT. A single `.or(club_id.in..., team_id.in...)` query
      // with one global `.limit()` starves quiet clubs: on a multi-club
      // account the busy club's recurring training consumed all 100 rows and
      // the quiet club's only fixture (ranked #116) never reached the client,
      // leaving Next Up empty under that club's theme. Each club (and each
      // team whose club is not already in scope) now gets its own bounded
      // query, all issued in the same Promise.all so there is no new
      // waterfall.
      // Per-scope caps: clubs carry club-wide events for every team, teams are
      // narrower. Neither can starve the other because the cap is per query.
      const CLUB_EVENTS_LIMIT = 30;
      const TEAM_EVENTS_LIMIT = 20;
      // Overall bound on the merged carousel payload (applied AFTER merge+sort
      // so the earliest events across every scope always survive).
      const MERGED_EVENTS_CAP = 100;
      // Concurrency cap — a user in many clubs/teams must not fire 30 requests
      // at once (mobile connection limits + Postgres pool pressure).
      const EVENTS_QUERY_BATCH_SIZE = 8;
      // Pass the select string through a plain-string helper so supabase-js
      // does not re-parse it at the type level for every query in the loop
      // (that is a known tsc blow-up). Row shape is pinned via .returns<T>().
      const sel = (s: string): string => s;
      const EVENT_SELECT =
        "id, title, type, event_date, start_time, address, location_name, suburb, club_id, team_id, mini_league_id, target_team_ids, is_cancelled, is_bye, is_recurring, parent_event_id, amount, opponent, arrival_minutes_before, adults_only, restricted_to_roles, rsvp_audience, teams (name, default_match_arrival_minutes), clubs!club_id (name, sport)";
      // event_date is a TIMESTAMP. For users east of UTC (e.g. AU/NZ),
      // today's local-morning fixtures are stored as YESTERDAY's UTC date
      // (e.g. 9am Adelaide June 13 = 23:30 UTC June 12). Comparing against
      // today's local YYYY-MM-DD therefore excludes them at the server, so
      // morning home-team games disappeared from Next Up while still
      // appearing on the Schedule page (which uses a wider window). Widen the
      // lower bound by one day; the client-side `isStillUpcomingForNextUp`
      // strictly filters past events using local date + start_time, so this
      // only admits candidates that may belong to today locally.
      const eventsLowerBound = getLocalDateKey(
        new Date(now.getTime() - 24 * 60 * 60 * 1000)
      );

      type HomeEventRow = Event & { mini_league_id: string | null };

      const scopedEventsQuery = (column: "club_id" | "team_id", value: string, rowLimit: number) =>
        supabase
          .from("events")
          .select(sel(EVENT_SELECT))
          .eq(column, value)
          .gte("event_date", eventsLowerBound)
          .order("event_date", { ascending: true })
          .limit(rowLimit)
          .returns<HomeEventRow[]>();

      // Builders are lazy (the request only fires when awaited), so we keep
      // thunks and run them in bounded batches below.
      const eventQueryThunks: Array<() => PromiseLike<{ data: HomeEventRow[] | null; error: any }>> = [
        ...clubIdsFromRolesArr.map(
          (clubId) => () => scopedEventsQuery("club_id", clubId, CLUB_EVENTS_LIMIT),
        ),
        // Team events are normally covered by their club's query, but a team can
        // sit in a club the user has no direct role in — fetch those separately
        // so they are not lost. De-duplication by event id happens on merge.
        ...teamIds.map(
          (teamId) => () => scopedEventsQuery("team_id", teamId, TEAM_EVENTS_LIMIT),
        ),
      ];

      const runEventQueries = async () => {
        const out: { data: HomeEventRow[] | null; error: any }[] = [];
        for (let i = 0; i < eventQueryThunks.length; i += EVENTS_QUERY_BATCH_SIZE) {
          const batch = eventQueryThunks.slice(i, i + EVENTS_QUERY_BATCH_SIZE);
          out.push(...(await Promise.all(batch.map((run) => run()))));
        }
        return out;
      };

      const [
        teamsResult,
        playerLeaguesResult,
        adminLeaguesResult,
        activeClubsResult,
        eventResults,
      ] = await Promise.all([
        teamIds.length > 0
          ? supabase.from("teams").select("id, club_id").in("id", teamIds).is("deleted_at", null)
          : Promise.resolve({ data: [] as { id: string; club_id: string }[], error: null as any }),
        supabase.from("mini_league_players").select("mini_league_id").eq("parent_user_id", user!.id),
        leagueAdminArr.length > 0
          ? supabase.from("mini_leagues").select("id").in("club_id", leagueAdminArr)
          : Promise.resolve({ data: [] as { id: string }[], error: null as any }),
        // Filter out soft-deleted clubs from role-derived memberships. Without
        // this, deleting a club leaves orphan user_roles rows that still make
        // the user look like a member (empty-state welcome hidden, ghost
        // carousel entries) because user_roles isn't cleared by the soft-
        // delete trigger.
        clubIdsFromRolesArr.length > 0
          ? supabase.from("clubs").select("id").in("id", clubIdsFromRolesArr).is("deleted_at", null)
          : Promise.resolve({ data: [] as { id: string }[], error: null as any }),
        runEventQueries(),
      ]);

      // Same protection as every other leg: if ANY per-scope events query
      // failed (RLS race on resume, token rotation), throw so React Query
      // preserves the previous Next Up data instead of caching a partial or
      // empty list.
      const mergedEventsById = new Map<string, HomeEventRow>();
      for (const res of eventResults) {
        if (res.error) throw res.error;
        if (!res.data) throw new Error("events fetch returned null data");
        for (const row of res.data) mergedEventsById.set(row.id, row);
      }
      // Merge → sort → cap. Capping only after the global sort guarantees the
      // soonest events from every scope survive the bound.
      const mergedEvents = Array.from(mergedEventsById.values())
        .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
        .slice(0, MERGED_EVENTS_CAP);
      const eventsResult = { data: mergedEvents, error: null as any };


      // Validate every parallel result before using any of it. A transient
      // failure (token refresh, RLS race, network blip) must throw so React
      // Query keeps its last good cache instead of caching an empty/partial
      // membership snapshot. Legitimate empty arrays stay successful.
      if ((teamsResult as any).error) throw (teamsResult as any).error;
      if (!teamsResult.data) throw new Error("teams fetch returned null data");
      if ((playerLeaguesResult as any).error) throw (playerLeaguesResult as any).error;
      if (!playerLeaguesResult.data) throw new Error("mini_league_players fetch returned null data");
      if ((adminLeaguesResult as any).error) throw (adminLeaguesResult as any).error;
      if (!adminLeaguesResult.data) throw new Error("mini_leagues fetch returned null data");
      // Same protection on the events fetch — if it failed (RLS race on
      // resume), throw so React Query preserves the previous Next Up data
      // instead of replacing it with an empty list.
      if ((eventsResult as any).error) throw (eventsResult as any).error;
      if (!eventsResult.data) throw new Error("events fetch returned null data");
      if ((activeClubsResult as any).error) throw (activeClubsResult as any).error;
      if (!activeClubsResult.data) throw new Error("clubs fetch returned null data");

      // Drop soft-deleted role-club ids from the membership sets.
      const activeClubIdSet = new Set(((activeClubsResult as any).data || []).map((c: any) => c.id as string));
      const filteredClubIds = new Set<string>();
      clubIds.forEach((id) => { if (activeClubIdSet.has(id)) filteredClubIds.add(id); });
      const filteredClubAdmin = new Set<string>();
      clubAdminClubIds.forEach((id) => { if (activeClubIdSet.has(id)) filteredClubAdmin.add(id); });
      const filteredLeagueAdmin = new Set<string>();
      leagueAdminClubIds.forEach((id) => { if (activeClubIdSet.has(id)) filteredLeagueAdmin.add(id); });

      // Team-derived memberships must also be filtered. A deleted club can leave
      // user_roles rows with team_id populated; counting the raw teamIds keeps
      // the new-user welcome hidden even after the club itself is filtered out.
      const filteredTeamIds = new Set<string>();
      (teamsResult.data || []).forEach((t: any) => {
        if (!activeClubIdSet.has(t.club_id)) return;
        filteredTeamIds.add(t.id);
        filteredClubIds.add(t.club_id);
      });

      const miniLeagueIds = (playerLeaguesResult.data || []).map((p: any) => p.mini_league_id);
      (adminLeaguesResult.data || []).forEach((l: any) => {
        if (!miniLeagueIds.includes(l.id)) miniLeagueIds.push(l.id);
      });

      // Drop role rows whose club has been soft-deleted so downstream
      // consumers (userRoles derivation, admin gates) don't grant admin
      // powers on a ghost club.
      const activeRoles = roles.filter((r: any) => !r.club_id || activeClubIdSet.has(r.club_id));

      const memberships = {
        teamIds: Array.from(filteredTeamIds),
        clubIds: Array.from(filteredClubIds),
        clubAdminClubIds: Array.from(filteredClubAdmin),
        leagueAdminClubIds: Array.from(filteredLeagueAdmin),
        miniLeagueIds,
        roles: activeRoles as { role: string; club_id: string | null; team_id: string | null }[],
      };

      // Step 3: Filter events client-side
      const clubIdsArr = Array.from(filteredClubIds);
      const nowMs = now.getTime();
      const filtered = ((eventsResult.data || []) as (Event & { mini_league_id: string | null })[]).filter(event => {
        // Defensive client-side past-date filter. The server query already
        // restricts to event_date >= today, but on iOS the React Query cache
        // (with placeholderData + no window-focus refetch on WebView resume)
        // can keep yesterday's data alive into the next day. Re-filter on
        // render so stale past events never leak into Next Up.
        if (!isStillUpcomingForNextUp(event, nowMs)) return false;
        if (event.mini_league_id) {
          return miniLeagueIds.includes(event.mini_league_id);
        } else if (event.team_id) {
          return teamIds.includes(event.team_id);
        } else {
          return clubIdsArr.includes(event.club_id);
        }
      });

      // Limit recurring series to next 3 upcoming occurrences
      const { filterRecurringEvents } = await import("@/lib/filterRecurringEvents");
      const limited = filterRecurringEvents(filtered);

      return { memberships, events: limited as Event[] };
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    placeholderData: (prev) => prev,
    // Seed from the localStorage snapshot so first paint after a long absence
    // shows real cards instead of a skeleton. `initialDataUpdatedAt` is the
    // snapshot's capture time, so React Query still considers it stale and
    // kicks off a background refetch (refetchOnMount: "always" below).
    initialData: nextUpCachedSnapshot
      ? { memberships: nextUpCachedSnapshot.memberships, events: nextUpCachedSnapshot.events }
      : undefined,
    initialDataUpdatedAt: nextUpCachedSnapshot?.cachedAt,
    // Retry on transient resume-race failures so cards reappear automatically
    // after a brief token-rotation window instead of staying blank.
    retry: 2,
    retryDelay: (attempt) => Math.min(500 * attempt, 2000),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });

  // Persist the latest snapshot whenever the query resolves so the next cold
  // open / long-absence return can hydrate instantly via `initialData` above.
  // NEVER let an empty membership result overwrite a non-empty snapshot: a
  // resume-race read (expired token, zero RLS rows, no error) would otherwise
  // poison the cache and make the next open paint the new-user empty state.
  // The verified-empty path in the queryFn clears the snapshot explicitly, so
  // genuine "left every club" states still persist.
  useEffect(() => {
    if (!user?.id || !membershipAndEvents) return;
    const m = membershipAndEvents.memberships as { clubIds?: string[]; teamIds?: string[] } | undefined;
    const isEmpty = (m?.clubIds?.length ?? 0) === 0 && (m?.teamIds?.length ?? 0) === 0;
    if (isEmpty) {
      const stored = getCachedNextUp<{ memberships: { clubIds?: string[]; teamIds?: string[] } }>(user.id);
      const storedHadMemberships =
        (stored?.memberships?.clubIds?.length ?? 0) > 0 ||
        (stored?.memberships?.teamIds?.length ?? 0) > 0;
      if (storedHadMemberships) return;
    }
    setCachedNextUp(user.id, {
      memberships: membershipAndEvents.memberships,
      events: membershipAndEvents.events,
      cachedAt: Date.now(),
    });
  }, [user?.id, membershipAndEvents]);

  // Derive memberships and events from consolidated query
  const userMemberships = membershipAndEvents?.memberships;
  const allEvents = membershipAndEvents?.events;

  // Listen for server-side schedule refresh broadcasts so the home dashboard
  // re-fetches events automatically when an admin pushes a refresh.
  useScheduleBroadcastListener(userMemberships?.clubIds);

  // Filter events by active club theme
  const events = useMemo(() => {
    return selectVisibleHomeEvents(allEvents, activeClubFilter, nowTick);
  }, [allEvents, activeClubFilter, nowTick]);

  useEffect(() => {
    const refreshHomeEvents = () => {
      const now = Date.now();
      setNowTick(now);
      if (now - lastHomeRefreshRef.current < 30_000) return;
      lastHomeRefreshRef.current = now;
      queryClient.invalidateQueries({ queryKey: ["user-memberships-and-events", user?.id] });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshHomeEvents();
    };

    document.addEventListener("visibilitychange", onVisibility);
    let removeNativeListener: (() => void) | undefined;

    if (isNativeApp) {
      void import("@capacitor/app").then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) refreshHomeEvents();
        })
      ).then((handle) => {
        removeNativeListener = () => { void handle.remove(); };
      }).catch(() => {});
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      removeNativeListener?.();
    };
  }, [isNativeApp, queryClient, user?.id]);

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
    staleTime: 2 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const getUserRsvpStatus = (eventId: string) => {
    return userRsvps?.find(r => r.event_id === eventId)?.status || null;
  };

  const getRsvpLabel = (status: string | null): string => {
    switch (status) {
      case "going": return "Going";
      case "not_going": return "Not going";
      case "maybe": return "Maybe";
      default: return "RSVP";
    }
  };

  const getRsvpIcon = (status: string | null) => {
    switch (status) {
      case "going":
        return <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />;
      case "not_going":
        return <X className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />;
      case "maybe":
        return <HelpCircle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />;
      default:
        return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
    }
  };

  // Derive userRoles from the consolidated memberships query (avoids redundant user_roles fetch)
  const userRoles = userMemberships?.roles || null;
  const isLoadingUserRoles = isLoading;

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
          clubs!club_id (name)
        `)
        .eq("user_id", user!.id)
        .eq("status", "pending")
        .order("redeemed_at", { ascending: false })
        .limit(1);
      return data || [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const latestPendingRedemption = pendingRedemptions[0] as {
    id: string;
    club_id: string;
    club_rewards: { name: string; qr_code_url: string | null; show_qr_code: boolean } | null;
    clubs: { name: string } | null;
  } | undefined;

  const isAppAdmin = userRoles?.some(r => r.role === "app_admin");

  // Get user's clubs (for upgrade selection) - uses memberships data to avoid extra user_roles fetch
  const { data: userClubs = [] } = useQuery({
    queryKey: ["user-clubs-for-upgrade", user?.id, userMemberships?.clubIds],
    queryFn: async () => {
      const clubIds = userMemberships?.clubIds || [];
      if (clubIds.length === 0) return [];

      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name, sport, points_display_name, points_icon_url")
        .in("id", clubIds)
        .is("deleted_at", null)
        .order("name");

      return clubs || [];
    },
    enabled: !!user && !!userMemberships && (userMemberships?.clubIds?.length ?? 0) > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Get user's active (non-deleted) team memberships — used for empty-state gating
  const { data: activeTeamIds = [] } = useQuery({
    queryKey: ["user-active-team-ids", user?.id, userMemberships?.teamIds],
    queryFn: async () => {
      const teamIds = userMemberships?.teamIds || [];
      if (teamIds.length === 0) return [];
      const { data } = await supabase
        .from("teams")
        .select("id")
        .in("id", teamIds)
        .is("deleted_at", null);
      return (data || []).map((t: any) => t.id as string);
    },
    enabled: !!user && !!userMemberships && (userMemberships?.teamIds?.length ?? 0) > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Check if user has Pro access - uses memberships data to avoid re-fetching user_roles
  const { data: hasProAccess, isLoading: isLoadingProAccess } = useQuery({
    queryKey: ["user-has-pro-access", user?.id, userMemberships?.clubIds, userMemberships?.teamIds],
    queryFn: async () => {
      if (!userMemberships) return false;
      const { clubIds, teamIds } = userMemberships;
      if (clubIds.length === 0 && teamIds.length === 0) return false;

      // Check club subs, team subs, and teams table (for trial is_pro) in parallel
      const [clubSubsResult, teamSubsResult, teamsResult] = await Promise.all([
        clubIds.length > 0
          ? supabase.from("club_subscriptions").select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override").in("club_id", clubIds)
          : Promise.resolve({ data: [] }),
        teamIds.length > 0
          ? supabase.from("team_subscriptions").select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override").in("team_id", teamIds)
          : Promise.resolve({ data: [] }),
        teamIds.length > 0
          ? supabase.from("teams").select("id, is_pro").in("id", teamIds).is("deleted_at", null)
          : Promise.resolve({ data: [] }),
      ]);

      const hasClubPro = (clubSubsResult.data || []).some((s: any) => s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override);
      if (hasClubPro) return true;

      const hasTeamPro = (teamSubsResult.data || []).some((s: any) => s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override);
      if (hasTeamPro) return true;

      // Fallback: check teams.is_pro (set by website trial signup)
      const hasTeamLegacyPro = (teamsResult.data || []).some((t: any) => t.is_pro);
      return hasTeamLegacyPro;
    },
    enabled: !!user && !!userMemberships,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  
  const showProBadge = !!userRoles && !isLoadingUserRoles && !isLoadingProAccess && !hasProAccess && !isAppAdmin;

  // Fetch clubs for rewards with Pro status - uses memberships data
  const { data: rewardClubs = [] } = useQuery({
    queryKey: ["reward-clubs-home", user?.id, activeClubFilter, userMemberships?.clubIds],
    queryFn: async () => {
      if (activeClubFilter) {
        const [clubResult, subResult] = await Promise.all([
          supabase.from("clubs").select("id, name, logo_url").eq("id", activeClubFilter).single(),
          supabase.from("club_subscriptions").select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override").eq("club_id", activeClubFilter).maybeSingle(),
        ]);
        if (!clubResult.data) return [];
        const hasPro = subResult.data?.is_pro || subResult.data?.is_pro_football || subResult.data?.admin_pro_override || subResult.data?.admin_pro_football_override;
        return [{ ...clubResult.data, hasPro: !!hasPro }];
      }

      const clubIds = userMemberships?.clubIds || [];
      if (clubIds.length === 0) return [];

      const [clubsResult, subsResult] = await Promise.all([
        supabase.from("clubs").select("id, name, logo_url").in("id", clubIds),
        supabase.from("club_subscriptions").select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override").in("club_id", clubIds),
      ]);

      return (clubsResult.data || []).map(club => {
        const sub = (subsResult.data || []).find((s: any) => s.club_id === club.id);
        const hasPro = sub?.is_pro || sub?.is_pro_football || sub?.admin_pro_override || sub?.admin_pro_football_override;
        return { ...club, hasPro: !!hasPro };
      });
    },
    enabled: !!user && !!userMemberships,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Rewards are per-club. Lock if none of the user's relevant clubs have Pro
  // (scoped to activeClubFilter when set, otherwise any club). App admins bypass.
  const hasAnyRewardClubPro = rewardClubs.some((c: any) => c.hasPro);
  const isRewardsProLocked = !isAppAdmin && userClubs.length > 0 && rewardClubs.length > 0 && !hasAnyRewardClubPro;

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
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Fetch the next reward info across user's clubs
  const { data: nextRewardInfo = null } = useQuery<{ points_required: number; name: string } | null>({
    queryKey: ["next-reward-info", rewardClubs.map((c: any) => c.id)],
    queryFn: async () => {
      const proClubIds = rewardClubs.filter((c: any) => isAppAdmin || c.hasPro).map((c: any) => c.id);
      if (proClubIds.length === 0) return null;
      const { data } = await supabase
        .from("club_rewards")
        .select("points_required, name")
        .in("club_id", proClubIds)
        .eq("is_active", true)
        .neq("reward_type", "player_of_match")
        .order("points_required", { ascending: true })
        .limit(1);
      return data?.[0] ? { points_required: data[0].points_required, name: data[0].name } : null;
    },
    enabled: rewardClubs.length > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const minRewardThreshold = nextRewardInfo?.points_required ?? null;

  const { data: userChildren = [] } = useQuery({
    queryKey: ["user-children-home", user?.id],
    queryFn: async () => {
      const ownedPromise = supabase
        .from("children")
        .select("id, name, ignite_points")
        .eq("parent_id", user!.id);

      const guardianLinksPromise = supabase
        .from("child_guardians")
        .select("child_id, children:child_id!inner(id, name, ignite_points)")
        .eq("guardian_id", user!.id);

      const [{ data: owned }, { data: guardianLinks }] = await Promise.all([
        ownedPromise,
        guardianLinksPromise,
      ]);

      const merged = new Map<string, any>();
      (owned || []).forEach((child: any) => merged.set(child.id, child));
      (guardianLinks || []).forEach((row: any) => {
        const child = row.children;
        if (child) merged.set(child.id, child);
      });

      return Array.from(merged.values()).sort((a: any, b: any) => a.name.localeCompare(b.name));
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // ---- Per-club reward balances ------------------------------------------------
  // Reward points are stored per-club. When the user has selected a club via the
  // header switcher (`activeClubFilter`), points displays scope to that club.
  // When no club is selected ("All Clubs" mode), fall back to the legacy global
  // totals on profiles/children — this preserves the multi-club summary view.
  const childIdsForPoints = useMemo(
    () => userChildren.map((c: any) => c.id),
    [userChildren],
  );
  const { data: userClubPoints, isLoading: userClubPointsLoading } = useUserClubPoints(
    user?.id ?? null,
    activeClubFilter,
  );
  const { data: childrenClubPointsMap } = useChildrenClubPoints(
    childIdsForPoints,
    activeClubFilter,
  );

  // Resolved balances used for display + redemption gating.
  const myPoints = activeClubFilter
    ? (userClubPoints ?? 0)
    : (profile?.ignite_points || 0);
  // Only treat as "loading" on first paint of a club switch — once the query
  // has data (even stale via placeholderData) show the value immediately.
  const myPointsLoading = !!activeClubFilter && userClubPointsLoading && userClubPoints === undefined;
  const childPointsFor = (child: any): number => {
    if (activeClubFilter) {
      return childrenClubPointsMap?.get(child.id) ?? 0;
    }
    return child.ignite_points || 0;
  };
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

  // Stable per-attempt idempotency key so retries/double taps can't double-spend.
  const redeemAttemptKeyRef = useRef<string | null>(null);

  // Redeem mutation
  const redeemMutation = useMutation({
    mutationFn: async ({
      reward,
      forChildId,
      idempotencyKey,
    }: { reward: any; forChildId: string | null; idempotencyKey?: string }) => {
      // Single authoritative transaction: authorisation, balance lock, deduction,
      // redemption row and points history all commit or roll back together.
      const { data, error } = await (supabase as any).rpc("redeem_club_reward", {
        _reward_id: reward.id,
        _child_id: forChildId,
        _idempotency_key: idempotencyKey ?? null,
      });

      if (error) throw error;

      const result = (data ?? {}) as {
        redemption_id: string;
        reward_id: string;
        club_id: string;
        points_spent: number;
        remaining_points: number;
        child_id: string | null;
        child_name: string | null;
      };

      // Best-effort email — never rolls back the committed redemption.
      try {
        const { data: club } = await supabase
          .from("clubs")
          .select("name, logo_url")
          .eq("id", result.club_id)
          .maybeSingle();

        await supabase.rpc('send_reward_redeemed_email_rpc', {
          _reward_name: reward.name,
          _points_spent: result.points_spent,
          _remaining_points: result.remaining_points,
          _club_name: club?.name || 'Your Club',
          _reward_description: reward.description ?? null,
          _sponsor_name: reward.sponsors?.name ?? null,
          _show_qr_code: !!reward.show_qr_code,
          _club_logo_url: club?.logo_url ?? null,
          _reward_logo_url: reward.logo_url ?? null,
          _redeemed_for_child_name: result.child_name || null,
        });
      } catch (emailErr) {
        console.error("Failed to send reward redeemed email:", emailErr);
      }

      return result;
    },

    onSuccess: () => {
      redeemAttemptKeyRef.current = null;

      queryClient.invalidateQueries({ queryKey: ["pending-redemptions-home"] });
      queryClient.invalidateQueries({ queryKey: ["user-children-home"] });
      queryClient.invalidateQueries({ queryKey: ["user-club-points"] });
      queryClient.invalidateQueries({ queryKey: ["children-club-points"] });
      queryClient.invalidateQueries({ queryKey: ["points-history"] });
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

    // Prefer the currently active club filter so the upgrade page matches the club shown in the header
    if (activeClubFilter) {
      if (userClubs.some(c => c.id === activeClubFilter)) {
        navigate(`/clubs/${activeClubFilter}/upgrade`);
        return;
      }
      // Filtered club not found in user's clubs — fallback to no club
      navigate("/clubs");
      return;
    }

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



  // Mutation to mark reward as claimed.
  // Failures after the fulfilment update are tagged so the UI never claims the
  // reward itself failed when only notifications did.
  class RewardNotificationError extends Error {
    fulfilmentSucceeded = true;
  }

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
      const { data: clubAdmins, error: adminsError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", redemption.club_id)
        .eq("role", "club_admin");

      if (adminsError) {
        throw new RewardNotificationError(
          `The reward was marked as fulfilled, but administrators could not be notified: ${adminsError.message}`
        );
      }

      if (clubAdmins && clubAdmins.length > 0) {
        const notifications = clubAdmins
          .filter(admin => admin.user_id !== user!.id)
          .map(admin => ({
            user_id: admin.user_id,
            type: "reward_claimed",
            message: `${claimerName} marked their "${redemption.reward_name}" reward as claimed`,
            related_id: redemption.id,
            club_id: redemption.club_id,
          }));

        if (notifications.length > 0) {
          const { error: notifyError } = await supabase
            .from("notifications")
            .insert(notifications);
          if (notifyError) {
            throw new RewardNotificationError(
              `The reward was marked as fulfilled, but administrator notifications failed: ${notifyError.message}`
            );
          }
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
      const fulfilled = !!error?.fulfilmentSucceeded;
      if (fulfilled) {
        // Fulfilment committed — keep the pending list in sync and close the dialog.
        queryClient.invalidateQueries({ queryKey: ["pending-redemptions-home"] });
        setClaimDialogOpen(false);
      }
      toast({
        title: fulfilled ? "Reward fulfilled — notification failed" : "Failed to claim reward",
        description: error?.message || "Please try again",
        variant: "destructive",
      });
    },

  });


  // Only fetch all clubs/teams/leagues when join dialogs are open (lazy loading)
  const { data: clubs, error: clubsError, isLoading: clubsLoading } = useQuery({
    queryKey: ["all-clubs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name, sport, class_mode_enabled")
        .is("deleted_at", null)
        .is("purged_at", null)
        .not("name", "ilike", "%test%")
        .not("name", "ilike", "%demo%")
        .not("name", "ilike", "%sample%")
        .order("name");
      if (error) throw error;
      return data as Club[];
    },
    enabled: !!user && (teamDialogOpen || !!activeClubFilter),
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
  });

  const { data: teams, error: teamsError, isLoading: teamsLoading } = useQuery({
    queryKey: ["all-teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, club_id, clubs!club_id!inner (name, sport, deleted_at, purged_at)")
        .is("deleted_at", null)
        .is("clubs.deleted_at", null)
        .is("clubs.purged_at", null)
        .not("name", "ilike", "%test%")
        .not("name", "ilike", "%demo%")
        .not("name", "ilike", "%sample%")
        .not("clubs.name", "ilike", "%test%")
        .not("clubs.name", "ilike", "%demo%")
        .not("clubs.name", "ilike", "%sample%")
        .order("name");
      if (error) throw error;
      return data as Team[];
    },
    enabled: !!user && teamDialogOpen,
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
  });

  const { data: miniLeagues, error: miniLeaguesError } = useQuery({
    queryKey: ["all-mini-leagues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("id, name, club_id, clubs!club_id!inner (name, sport, deleted_at, purged_at)")
        .is("clubs.deleted_at", null)
        .is("clubs.purged_at", null)
        .not("clubs.name", "ilike", "%test%")
        .not("clubs.name", "ilike", "%demo%")
        .not("clubs.name", "ilike", "%sample%")
        .order("name");
      if (error) throw error;
      return data as MiniLeague[];
    },
    enabled: !!user && teamDialogOpen,
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
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
        .select("id, name, club_id, clubs!club_id (id, name, sport)")
        .in("id", coachAdminTeamIds)
        .is("deleted_at", null);
      
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
    enabled: !!user && !!userMemberships && (userMemberships?.teamIds?.length ?? 0) > 0,

    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
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
        .select("id, name, club_id, clubs!club_id (id, name, sport)")
        .is("deleted_at", null);
      
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
    enabled: !!user && !!userMemberships && ((userMemberships?.teamIds?.length ?? 0) > 0 || (userMemberships?.clubIds?.length ?? 0) > 0),

    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
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
    staleTime: 2 * 60 * 1000,
    placeholderData: (prev) => prev,
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
      
      // Fetch roster and check for nearby game in parallel
      const [membersResult, childrenResult, nearbyEventId] = await Promise.all([
        supabase
          .from("user_roles")
          .select("*, profiles (display_name, avatar_url)")
          .eq("team_id", teamId),
        supabase.rpc("get_team_children_for_pitch_board", {
          p_team_id: teamId,
        }),
        findNearbyGameEvent(teamId)
      ]);

      // STRICT match-day filter: when launched in the context of a match
      // (linkedEventId), only include players whose RSVP for that event is
      // "going". Adults (staff) are always included so they can run the
      // board. Without an event link we keep the full roster.
      let goingChildIds: Set<string> | null = null;
      let goingAdultIds: Set<string> | null = null;
      if (nearbyEventId) {
        const { data: rsvpRows } = await supabase
          .from("rsvps")
          .select("user_id, child_id, status")
          .eq("event_id", nearbyEventId)
          .eq("status", "going");
        goingChildIds = new Set(
          (rsvpRows || []).map(r => r.child_id).filter((v): v is string => !!v)
        );
        goingAdultIds = new Set(
          (rsvpRows || []).map(r => r.user_id).filter((v): v is string => !!v)
        );
      }

      const STAFF_ROLES = new Set(["team_admin", "coach", "club_admin", "app_admin"]);
      const teamMembers = (membersResult.data || [])
        .filter((member) =>
          !goingAdultIds
            ? true
            : STAFF_ROLES.has(member.role) || goingAdultIds.has(member.user_id)
        )
        .map((member) => ({
          id: member.id,
          user_id: member.user_id,
          role: member.role,
          profiles: member.profiles,
        }));

      const teamChildren = (childrenResult.data || [])
        .filter((child) => (goingChildIds ? goingChildIds.has(child.child_id) : true))
        .map((child) => ({
          id: `child-${child.child_id}`,
          user_id: child.child_id,
          role: "player",
          profiles: {
            display_name: child.child_name,
            avatar_url: null,
          },
        }));
      
      setPitchBoardTeam({ 
        id: teamId, 
        name: teamName, 
        members: [...teamMembers, ...teamChildren], 
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

  // Cold-start / warm-resume restore: if the pitch board was open as a
  // modal on home when the WebView was torn down (phone lock/unlock kills
  // iOS WebView; Android may kill the process under memory pressure),
  // re-open it now using the persisted context. We listen for both mount
  // and `appStateChange isActive=true` so a warm resume that lost in-memory
  // React state (but kept localStorage) is also recovered.
  useEffect(() => {
    let cancelled = false;

    const tryRestore = () => {
      if (cancelled) return;
      if (pitchBoardTeam) return; // already open
      try {
        const flag = localStorage.getItem('ignite-pitch-board-open');
        if (flag !== 'true') return;
        const storedPath = localStorage.getItem('ignite-pitch-board-open-path');
        // Only auto-open the modal when the persisted path is home — if it's
        // an event route, PitchBoardResumeRedirect will navigate there instead.
        if (storedPath && storedPath !== '/' && storedPath !== '/home' && !storedPath.startsWith('/?') && !storedPath.startsWith('/home?')) return;
        const ctxRaw = localStorage.getItem('ignite-pitch-board-last-context');
        if (!ctxRaw) return;
        const ctx = JSON.parse(ctxRaw);
        if (ctx?.teamId && ctx?.teamName) {
          openPitchBoard(ctx.teamId, ctx.teamName, !!ctx.readOnly);
        }
      } catch { /* ignore */ }
    };

    tryRestore();

    let removeListener: (() => void) | undefined;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) tryRestore();
        });
        if (cancelled) {
          void handle.remove();
        } else {
          removeListener = () => { void handle.remove(); };
        }
      } catch { /* native unavailable */ }
    })();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') tryRestore();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      removeListener?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);





  // Fetch children on the selected team for parent linking
  const showChildLinker = !isLeagueSelected && selectedTeam && selectedTeamRole === "parent";
  const { data: teamChildren } = useQuery({
    queryKey: ["team-children-for-link", selectedTeam],
    queryFn: async () => {
      const [{ data: assignedData, error: assignedError }, { data: pendingInvites, error: pendingError }] = await Promise.all([
        supabase
          .from("child_team_assignments")
          .select("child_id, children(id, name)")
          .eq("team_id", selectedTeam),
        supabase
          .from("pending_invites")
          .select("id, metadata")
          .eq("team_id", selectedTeam)
          .eq("status", "pending"),
      ]);

      if (assignedError) throw assignedError;
      if (pendingError) throw pendingError;

      const childrenMap = new Map<string, { id: string; name: string }>();

      (assignedData || []).forEach((d: any) => {
        const id = d.children?.id || d.child_id;
        const name = d.children?.name || "Unknown";
        if (id) childrenMap.set(id, { id, name });
      });

      (pendingInvites || []).forEach((invite: any) => {
        const children = Array.isArray(invite.metadata?.children) ? invite.metadata.children : [];

        children.forEach((child: any) => {
          const name = String(child?.name || "").trim();
          if (!name) return;

          // Skip children that reference another pending invite (linked duplicates)
          if (typeof child?.existingChildId === "string" && child.existingChildId.startsWith("pending-")) return;

          const realChildId = typeof child?.existingChildId === "string"
            ? child.existingChildId
            : null;
          const fallbackId = `pending-${invite.id}-${name.toLowerCase()}`;
          const id = realChildId || fallbackId;

          // Also check by name to avoid duplicates across invites
          const nameKey = name.toLowerCase();
          const alreadyByName = Array.from(childrenMap.values()).some(c => c.name.toLowerCase() === nameKey);

          if (!childrenMap.has(id) && !alreadyByName) {
            childrenMap.set(id, { id, name });
          }
        });
      });

      return Array.from(childrenMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!showChildLinker,
  });

  // Check if user already has the SPECIFIC role they're requesting in the selected team/league
  const hasExistingTeamRole = !isLeagueSelected && selectedTeam && selectedTeamRole && userRoles?.some(r => r.team_id === selectedTeam && r.role === selectedTeamRole);

  // Check if user already has the league role (league roles are stored with club_id)
  const selectedLeagueData = actualLeagueId ? miniLeagues?.find(l => l.id === actualLeagueId) : null;
  const hasExistingLeagueRole = isLeagueSelected && actualLeagueId && selectedLeagueRole && userRoles?.some(r => r.club_id === selectedLeagueData?.club_id && r.role === selectedLeagueRole);

  // Existing roles the user already holds on the selected team — drives the
  // "already a member" UX so we don't ask them to re-join just to add Coach / Team Admin.
  const existingTeamRoles: TeamRole[] = (!isLeagueSelected && selectedTeam && userRoles)
    ? Array.from(new Set(
        userRoles
          .filter(r => r.team_id === selectedTeam)
          .map(r => r.role as TeamRole)
      ))
    : [];
  const isAlreadyTeamMember = existingTeamRoles.length > 0;

  // Pending elevated-access requests so buttons reflect state instead of re-submitting.
  const { data: pendingTeamRequests } = useQuery({
    queryKey: ["pending-role-requests-for-team", user?.id, selectedTeam],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_requests")
        .select("role")
        .eq("user_id", user!.id)
        .eq("team_id", selectedTeam)
        .eq("status", "pending");
      if (error) throw error;
      return (data || []).map(r => r.role as TeamRole);
    },
    enabled: !!user?.id && !!selectedTeam && isAlreadyTeamMember,
    staleTime: 30_000,
  });

  const teamRoleLabel = (r: TeamRole) =>
    r === "team_admin" ? "Team Admin" : r === "coach" ? "Coach" : r === "player" ? "Player" : "Parent";

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
        // Admin notifications are created by the on_role_request_created DB trigger
        // (which includes the requester's name). No client-side insert needed.
      } else {
        // Handle team join request
        // Double-check on submit - only block if they already have this specific role
        if (userRoles?.some(r => r.team_id === selectedTeam && r.role === selectedTeamRole)) {
          throw new Error("You already have this role in this team");
        }
        const team = teams?.find((t) => t.id === selectedTeam);
        const metadata: Record<string, any> = {};
        if (selectedTeamRole === "parent") {
          const trimmedNew = newChildName.trim();
          if (selectedChildForLink && selectedChildForLink !== "__new__") {
            const child = teamChildren?.find(c => c.id === selectedChildForLink);
            metadata.child_id = selectedChildForLink;
            metadata.child_name = child?.name || "";
          } else if (trimmedNew) {
            metadata.child_name = trimmedNew;
          } else {
            throw new Error("Please select your child or add their name before requesting parent access");
          }
        }
        const { error } = await supabase.from("role_requests").insert({
          user_id: user!.id,
          team_id: selectedTeam,
          club_id: team?.club_id,
          role: selectedTeamRole,
          status: "pending",
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        } as any);
        if (error) throw error;
        // Admin notifications are created by the on_role_request_created DB trigger
        // (which includes the requester's name). No client-side insert needed.
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
      setSelectedChildForLink("");
      setNewChildName("");
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

  // Dedicated mutation for "Request additional access" buttons on a team the
  // user is already part of. Reuses the same role_requests workflow.
  const requestAdditionalAccessMutation = useMutation({
    mutationFn: async (role: TeamRole) => {
      if (!user || !selectedTeam) throw new Error("Missing data");
      if (userRoles?.some(r => r.team_id === selectedTeam && r.role === role)) {
        throw new Error(`You already have the ${teamRoleLabel(role)} role on this team`);
      }
      const team = teams?.find((t) => t.id === selectedTeam);
      const { error } = await supabase.from("role_requests").insert({
        user_id: user.id,
        team_id: selectedTeam,
        club_id: team?.club_id,
        role,
        status: "pending",
      } as any);
      if (error) throw error;
    },
    onSuccess: (_data, role) => {
      toast({
        title: "Request sent",
        description: `Your ${teamRoleLabel(role)} access request has been sent to the team admins.`,
      });
      queryClient.invalidateQueries({ queryKey: ["pending-role-requests-for-team", user?.id, selectedTeam] });
      queryClient.invalidateQueries({ queryKey: ["role-requests"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Don't block entire page on events loading - show skeleton/loading state inline instead
  // This prevents the "double flash" issue on login where the page loads, then shows loading, then loads again

  const activeClubName = userClubs?.find((c: any) => c.id === activeClubFilter)?.name || clubs?.find(c => c.id === activeClubFilter)?.name;
  const firstName = profile?.display_name?.split(' ')[0] || 'there';

  // Gate first paint of the widget area on the primary memberships query so
  // every widget mounts together and fades in as a single, cohesive surface
  // instead of popping in piecemeal as each child query resolves.
  // Deep audit: React Query can hydrate an old/empty cached memberships+events
  // result with `isLoading=false`, then immediately refetch. In that window the
  // old empty event list made <NextUpCarousel /> return null, so My Teams painted
  // high on the page and was pushed down when Next Up arrived. Keep the unified
  // Home skeleton in place while an empty Next Up result is actively refetching.
  const waitingForNextUpResolution = events.length === 0 && isFetching;

  // Coordinate first paint of Next Up + My Teams so both fade in together.
  // Both widgets are mounted behind the unified skeleton and only revealed once
  // their own first-card data has settled, preventing either section from
  // visibly loading before the other on cold login.
  const nextUpEventSignature = useMemo(
    () => events.map((event) => event.id).join("|"),
    [events],
  );
  const [readyNextUpSignature, setReadyNextUpSignature] = useState("");
  const handleNextUpReadyChange = useMemo(
    () => (ready: boolean) => setReadyNextUpSignature(ready ? nextUpEventSignature : ""),
    [nextUpEventSignature],
  );
  const myTeamsReadyTarget = `${user?.id ?? "anonymous"}|${activeClubFilter ?? "all"}`;
  const [readyMyTeamsTarget, setReadyMyTeamsTarget] = useState("");
  const handleMyTeamsReadyChange = useMemo(
    () => (ready: boolean) => setReadyMyTeamsTarget(ready ? myTeamsReadyTarget : ""),
    [myTeamsReadyTarget],
  );

  const nextUpSectionReady = events.length === 0
    ? (isFetched || !!membershipAndEvents) && !isLoading && !waitingForNextUpResolution
    : readyNextUpSignature === nextUpEventSignature;
  const myTeamsReady = readyMyTeamsTarget === myTeamsReadyTarget;
  const computedShowContent = initialized && (isFetched || !!membershipAndEvents) && !isLoading && !waitingForNextUpResolution && nextUpSectionReady && myTeamsReady;
  // Latch so we never re-hide the page back to the unified skeleton after the
  // first synchronized reveal — otherwise a later refetch on one section
  // (events array reference changes → NextUp re-checks first hero) would yank
  // both widgets behind the skeleton again and reveal them out of sync.
  const [hasRevealed, setHasRevealed] = useState(false);
  useEffect(() => {
    if (computedShowContent && !hasRevealed) setHasRevealed(true);
  }, [computedShowContent, hasRevealed]);
  // Reset latch on user/club switch so the new context re-synchronizes.
  useEffect(() => {
    setHasRevealed(false);
  }, [user?.id, activeClubFilter]);
  const showContent = computedShowContent || hasRevealed;

  // Empty-state gate: only show the "Find or Join a Club" welcome once we
  // authoritatively know the user has zero clubs AND zero teams. The
  // `userClubs` / `activeTeamIds` queries default to `[]` before their
  // dependent membership fetch resolves, which caused the welcome card to
  // flash for users who DO have clubs. Gate on `userMemberships` (from the
  // primary membership+events query) so we wait for real data.
  const hasResolvedMemberships = !!userMemberships;
  const membershipClubCount = userMemberships?.clubIds?.length ?? 0;
  const membershipTeamCount = userMemberships?.teamIds?.length ?? 0;
  const isNewUserEmptyState =
    initialized &&
    !isLoading &&
    // Never claim "new user" while a refetch is still in flight (resume from
    // phone lock triggers refetchOnWindowFocus; a transient empty read used to
    // flash the "set up your club" card and blank Next Up).
    !isFetching &&
    hasResolvedMemberships &&
    membershipClubCount === 0 &&
    membershipTeamCount === 0 &&
    userClubs.length === 0 &&
    activeTeamIds.length === 0;

  // Home perf: log once first paint occurs (unified skeleton has been
  // replaced by real content OR the authoritative empty state).
  useEffect(() => {
    if (membershipAndEvents && homeQueryReturnTsRef.current === null) {
      homeQueryReturnTsRef.current = Date.now();
      coldMark("home_query_return");
    }
  }, [membershipAndEvents]);
  useEffect(() => {
    if (homePerfLoggedRef.current) return;
    if (!user?.id) return;
    if (!(showContent || isNewUserEmptyState)) return;
    homePerfLoggedRef.current = true;
    if (homeFirstPaintTsRef.current === null) {
      homeFirstPaintTsRef.current = Date.now();
    }
    let source: "warm_nav" | "cold_open" | "notification" =
      nextUpCachedSnapshot ? "warm_nav" : "cold_open";
    try {
      const snap = snapshotStages();
      const notifTap = snap.deltas.notif_tap;
      const homeMount = snap.deltas.home_mount;
      if (
        typeof notifTap === "number" &&
        typeof homeMount === "number" &&
        homeMount >= notifTap &&
        homeMount - notifTap < 10_000
      ) {
        source = "notification";
      }
    } catch {}
    void logHomeOpenLatency({
      userId: user.id,
      source,
      startTs: homeOpenStartRef.current,
      cacheHit: !!nextUpCachedSnapshot,
      mountTs: homeMountTsRef.current,
      queryReturnTs: homeQueryReturnTsRef.current,
      firstPaintTs: homeFirstPaintTsRef.current,
      primaryClubId: activeClubFilter ?? userClubs[0]?.id ?? null,
      context: {
        clubCount: membershipClubCount,
        teamCount: membershipTeamCount,
        upcomingEvents: events.length,
        activeClubFilter: activeClubFilter ?? null,
        isNewUserEmptyState,
      },
    });
  }, [showContent, isNewUserEmptyState, user?.id, membershipClubCount, membershipTeamCount, events.length, activeClubFilter, nextUpCachedSnapshot]);

  const canAccessVault = !!userRoles?.some(r => ["app_admin", "club_admin", "league_admin", "team_admin", "coach", "committee_member"].includes(r.role));

  return (
    <div className="py-6 space-y-5">
      {/* Welcome Header */}
      <div className="px-1 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            Welcome, {firstName}! 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Here's what's coming up{activeClubName ? ` @ ${activeClubName}` : ''}
          </p>
        </div>
        {!isNewUserEmptyState && (
          <div className="lg:hidden">
            <HomeQuickActionsFab
              onInvite={() => setMemberInviteOpen(true)}
              onJoinTeam={() => setTeamDialogOpen(true)}
              hasTeams={!!userRoles?.some(r => r.team_id)}
              canCreateTeam={!!userRoles?.some(r => (r.role === "club_admin" && (!activeClubFilter || r.club_id === activeClubFilter)) || r.role === "app_admin")}
              canCreateEvent={!!userRoles?.some(r => ["app_admin", "club_admin", "team_admin", "coach", "committee_member"].includes(r.role))}
              canAccessVault={canAccessVault}
              isAppAdmin={isAppAdmin}
              activeClubFilter={activeClubFilter}
              activeClubName={activeClubName}
              hasProContext={activeClubFilter ? !!rewardClubs[0]?.hasPro : !!hasProAccess}
            />
          </div>
        )}

      </div>

      {/* Desktop-only action bar — surfaces the quick actions as real buttons */}
      {!isNewUserEmptyState && (
        <DesktopActionBar
          onInvite={() => setMemberInviteOpen(true)}
          onJoinTeam={() => setTeamDialogOpen(true)}
          hasTeams={!!userRoles?.some(r => r.team_id)}
          canCreateTeam={!!userRoles?.some(r => (r.role === "club_admin" && (!activeClubFilter || r.club_id === activeClubFilter)) || r.role === "app_admin")}
          canCreateEvent={!!userRoles?.some(r => ["app_admin", "club_admin", "team_admin", "coach", "committee_member"].includes(r.role))}
          isAppAdmin={isAppAdmin}
          activeClubFilter={activeClubFilter}
        />
      )}

      {/* New-user empty state — no clubs, no team memberships yet */}
      {isNewUserEmptyState && (
        <HomeWelcomeGetStarted
          firstName={firstName}
          email={user?.email}
          onFindOrJoin={() => setTeamDialogOpen(true)}
        />
      )}

      {/* Setup progress moved to Club page only — do not surface on Home once
          a club exists (per product decision). */}


      <div className="relative [overflow-anchor:none]">
        {!showContent && <HomeInitialSkeleton />}
        <div
          className={showContent ? "space-y-5 soft-reveal" : "absolute inset-x-0 top-0 space-y-5 opacity-0 pointer-events-none"}
          aria-hidden={!showContent}
        >

          {/* Next Up Carousel - unified event section */}
          <NextUpCarousel events={events || []} isLoading={isLoading || waitingForNextUpResolution} onReadyChange={handleNextUpReadyChange} />

          {/* My Teams & Leagues - keep directly below Next Up so later async widgets cannot push it down. */}
          <Suspense fallback={<HomeMyTeamsSkeleton />}>
            <MyTeamsPremiumCarousel onReadyChange={handleMyTeamsReadyChange} />
          </Suspense>

          {/* Club News - compact latest-post card; renders nothing when the club has no posts */}
          <Suspense fallback={null}>
            <ClubNewsSection />
          </Suspense>

          {/* Club Info & Links - collapsible tile grid directly below the teams carousel */}
          <Suspense fallback={null}>
            <ClubLinksSection />
          </Suspense>

          {/* Club Files - first-class entry point to the File Vault for permitted roles.
              Synchronous (role-based only) so it never causes a post-reveal layout shift. */}
          {canAccessVault && (
            <Card
              className="border overflow-hidden cursor-pointer bg-card"
              role="button"
              tabIndex={0}
              aria-label="Open club files"
              onClick={() => navigate("/vault")}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate("/vault"); } }}
            >
              <CardContent className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary shrink-0">
                    <FolderOpen className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-foreground">Club Files</p>
                    <p className="text-[12px] text-muted-foreground truncate">Forms, policies & documents</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>

      {showContent && (
        <div className="space-y-5">

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
          <Suspense fallback={null}>
            <GameTimerWidget
              onOpenPitchBoard={(teamId, teamName) => openPitchBoard(teamId, teamName, !hasEditAccess)}
              readOnly={!hasEditAccess}
            />
          </Suspense>
        );

      })()}

      {/* Court-sport resume card archived — soccer resume handled by GameTimerWidget above. */}

      {/* Mini League Live Matches Widget */}
      <MiniLeagueGameWidgets activeClubFilter={activeClubFilter} />

      {/* Account Recovery Banner */}
      {user && (
        <Suspense fallback={null}>
          <AccountRecoveryBanner
            userId={user.id}
            onRecovered={() => queryClient.invalidateQueries()}
          />
        </Suspense>
      )}

      {/* Native App Download Banner - for mobile browser users */}
      <Suspense fallback={null}>
        <NativeAppDownloadBanner />
      </Suspense>


      {memberInviteOpen && (
        <Suspense fallback={null}>
          <HomeInviteFlow open={memberInviteOpen} onOpenChange={setMemberInviteOpen} />
        </Suspense>
      )}

      {/* Upcoming Classes Widget - for parents with enrolled children */}
      <LazyMount minHeight={60}>
        <UpcomingClassesWidget />
      </LazyMount>

      {/* Contact Club - quick DM to club admin (Pro only) */}
      <LazyMount minHeight={48}>
        <ContactClubButton clubFilter={activeClubFilter} compact />
      </LazyMount>



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
                  setSelectedChildForLink("");
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
                  .sort((a, b) => a.name.localeCompare(b.name))
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
                  .sort((a, b) => a.name.localeCompare(b.name))
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
            {isAlreadyTeamMember && !isLeagueSelected ? (
              <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold text-foreground">You're already on this team</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {existingTeamRoles.map((r) => (
                      <Badge key={r} variant="secondary" className="text-xs">{teamRoleLabel(r)}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    No need to rejoin. Request elevated access below and a team admin will review it.
                  </p>
                </div>

                {(["coach", "team_admin"] as TeamRole[])
                  .filter((r) => !existingTeamRoles.includes(r))
                  .map((r) => {
                    const isPending = pendingTeamRequests?.includes(r);
                    const isSubmitting = requestAdditionalAccessMutation.isPending && requestAdditionalAccessMutation.variables === r;
                    return (
                      <div key={r} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">Request {teamRoleLabel(r)} Access</p>
                          <p className="text-xs text-muted-foreground">
                            {r === "coach"
                              ? "Manage training, line-ups and player performance."
                              : "Manage roster, events and team settings."}
                          </p>
                        </div>
                        {isPending ? (
                          <Badge variant="outline" className="shrink-0">Pending</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            onClick={() => requestAdditionalAccessMutation.mutate(r)}
                            disabled={isSubmitting}
                          >
                            {isSubmitting ? "Sending…" : "Request"}
                          </Button>
                        )}
                      </div>
                    );
                  })}

                {(["coach", "team_admin"] as TeamRole[]).every((r) => existingTeamRoles.includes(r)) && (
                  <p className="text-xs text-muted-foreground">
                    You already have the highest-level access available on this team.
                  </p>
                )}
              </div>
            ) : (
              <>
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
                {/* Required child linking when parent role selected */}
                {showChildLinker && (
                  <>
                    <MobileCardSelect
                      value={selectedChildForLink || (teamChildren && teamChildren.length > 0 ? "" : "__new__")}
                      onValueChange={(v) => setSelectedChildForLink(v)}
                      options={[
                        ...((teamChildren || []).map((child) => ({
                          value: child.id,
                          label: child.name,
                        }))),
                        { value: "__new__", label: "➕ Add new child" },
                      ]}
                      label="Link to Your Child"
                      placeholder="Select your child..."
                      searchable
                      searchPlaceholder="Search children..."
                      emptyMessage="No existing children — add one below."
                    />
                    {(selectedChildForLink === "__new__" || (!selectedChildForLink && (!teamChildren || teamChildren.length === 0))) && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Child's name</label>
                        <input
                          type="text"
                          value={newChildName}
                          onChange={(e) => setNewChildName(e.target.value)}
                          placeholder="Enter your child's full name"
                          className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          <ResponsiveDialogFooter>
            {isAlreadyTeamMember && !isLeagueSelected ? (
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setTeamDialogOpen(false)}
              >
                Done
              </Button>
            ) : (
              <>
                {(hasExistingTeamRole || hasExistingLeagueRole) && (
                  <p className="text-sm text-destructive mb-2">
                    You already have this role in this {isLeagueSelected ? "league" : "team"}
                  </p>
                )}
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => teamRequestMutation.mutate()}
                  disabled={
                    !selectedTeam ||
                    teamRequestMutation.isPending ||
                    hasExistingTeamRole ||
                    hasExistingLeagueRole ||
                    (showChildLinker && (
                      (selectedChildForLink === "__new__" || !selectedChildForLink)
                        ? !newChildName.trim()
                        : false
                    ))
                  }
                >
                  {teamRequestMutation.isPending ? "Submitting..." : "Submit Request"}
                </Button>
              </>
            )}
          </ResponsiveDialogFooter>

        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <section aria-label="Points and rewards">
      <Card className={`border overflow-hidden cursor-pointer ${isRewardsProLocked ? 'bg-muted/30 border-dashed' : 'bg-primary/[0.06]'}`} role="button" tabIndex={0} aria-label={isRewardsProLocked ? "Upgrade to Pro to unlock club rewards" : "View points and rewards"} onClick={() => isRewardsProLocked ? handleUpgradeClick() : navigate("/profile?section=points-history")} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isRewardsProLocked ? handleUpgradeClick() : navigate("/profile?section=points-history"); } }}>
        <CardContent className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-lg shrink-0 ${isRewardsProLocked ? 'bg-muted' : 'bg-primary/15'}`}>
              {isRewardsProLocked ? <Lock className="h-4 w-4 text-muted-foreground" /> : <Flame className="h-4 w-4 text-primary" />}
            </div>
            <div className="min-w-0 flex-1">
              {latestPendingRedemption && !isRewardsProLocked ? (
                <p className="text-sm font-semibold leading-tight text-primary truncate">
                  🎁 Ready to claim: {latestPendingRedemption.club_rewards?.name}
                </p>
              ) : minRewardThreshold !== null && myPoints >= minRewardThreshold && !isRewardsProLocked ? (
                <p className="text-sm font-semibold leading-tight text-primary">
                  🎉 Rewards Available
                </p>
              ) : (
              <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold leading-tight">
                    {isRewardsProLocked ? 'Member Rewards' : ((userClubs[0] as any)?.points_display_name || 'Reward Points')}
                  </p>
                  {isRewardsProLocked && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">Pro Only</Badge>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {isRewardsProLocked
                  ? 'Earn points for RSVPs, volunteering & participation'
                  : myPointsLoading
                    ? (<span className="inline-block h-3 w-16 align-middle rounded bg-muted animate-pulse" aria-label="Loading points" />)
                    : `${myPoints} Point${myPoints === 1 ? '' : 's'}${showProBadge ? ' · Pro' : ''}`}
              </p>
            </div>
            {latestPendingRedemption && !isRewardsProLocked ? (
              <Button
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-white gap-1.5 h-8 text-xs font-medium shrink-0"
                onClick={(e) => { e.stopPropagation(); setClaimDialogOpen(true); }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Claim
              </Button>
            ) : isRewardsProLocked ? (
              <Button
                size="sm"
                className="gap-1 h-8 text-xs font-medium shrink-0 px-2"
                onClick={(e) => { e.stopPropagation(); handleUpgradeClick(); }}
              >
                <Crown className="h-3.5 w-3.5" />
                Upgrade
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 h-8 text-xs font-medium text-primary shrink-0 px-2"
                onClick={(e) => { e.stopPropagation(); handleBrowseRewards(); }}
              >
                View Rewards
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      </section>

      {/* Reward Claim QR Dialog */}
      {latestPendingRedemption && user && rewardQROpen && (
        <Suspense fallback={null}>
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
        </Suspense>
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
                ? `You have ${myPoints} points${userChildren.length > 0 ? " (+ children's points)" : ""}`
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
                  const currentPoints = myPoints;
                  const canAfford = currentPoints >= reward.points_required ||
                    userChildren.some((c: any) => childPointsFor(c) >= reward.points_required);
                  
                  return (
                    <button
                      key={reward.id}
                      onClick={() => {
                        if (canAfford) {
                          setSelectedReward(reward);
                          setRewardsDialogOpen(false);
                          setTimeout(() => setConfirmRedeemDialogOpen(true), 300);
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
              redeemAttemptKeyRef.current = null;

            }
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redeem Reward?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm redemption of <strong>{selectedReward?.name}</strong> for{" "}
              <strong>{selectedReward?.points_required} points</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {userChildren.filter((child: any) => childPointsFor(child) >= (selectedReward?.points_required || 0)).length > 0 && (
            <div className="space-y-2 py-2">
              <Label>Redeem for</Label>
              <Select value={selectedRedeemFor} onValueChange={setSelectedRedeemFor}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="myself">
                    Myself ({myPoints} pts)
                  </SelectItem>
                  {userChildren
                    .filter((child: any) => childPointsFor(child) >= (selectedReward?.points_required || 0))
                    .map((child: any) => (
                    <SelectItem key={child.id} value={child.id}>
                      {child.name} ({childPointsFor(child)} pts)
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
                  if (!redeemAttemptKeyRef.current) {
                    redeemAttemptKeyRef.current =
                      typeof crypto !== "undefined" && "randomUUID" in crypto
                        ? crypto.randomUUID()
                        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                  }
                  redeemMutation.mutate({
                    reward: selectedReward,
                    forChildId,
                    idempotencyKey: redeemAttemptKeyRef.current,
                  });
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


      {/* Club Sponsor Section — mounted eagerly (not LazyMount'd) so its
          Supabase query fires in parallel with above-the-fold content and
          the tile appears at the same time as Next Up / Rewards / Teams
          instead of after a scroll. Reserved min-height prevents shift. */}
      {(() => {
        const sponsorHint = readHomeSponsorHint(user?.id, activeClubFilter);
        const sponsorMinHeight = sponsorHint === "none" ? 0 : 120;
        const inClassMode = !!(activeClubFilter && clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled);
        return (
          <div style={{ minHeight: sponsorMinHeight }}>
            {activeClubFilter ? (
              !inClassMode && <ClubSponsorSection clubId={activeClubFilter} />
            ) : (
              <MultiClubSponsorCarousel />
            )}
          </div>
        );
      })()}

      {/* App Ads — same reasoning: mount eagerly so the tier query runs in
          parallel and the ad renders alongside the other home sections. */}
      {!(activeClubFilter && clubs?.find(c => c.id === activeClubFilter)?.class_mode_enabled) && (
        <div style={{ minHeight: 112 }}>
          <SponsorOrAdCarousel location="home" activeClubFilter={activeClubFilter} />
        </div>
      )}

      {/* Pitch Board Loading Overlay */}
      {pitchBoardLoading && createPortal(
         <div className="fixed inset-0 z-[9999] flex items-center justify-center" role="status" aria-label="Loading Pitch Board" style={{ backgroundColor: '#2d5a27' }}>
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
            <div className="fixed inset-0 z-[9999] flex items-center justify-center" role="status" aria-label="Loading Pitch Board" style={{ backgroundColor: '#2d5a27' }}>
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
            onClose={() => { clearPitchBoardOpenFlag(); setPitchBoardTeam(null); }}
            readOnly={pitchBoardTeam.readOnly}
            initialLinkedEventId={pitchBoardTeam.linkedEventId}
          />
        </Suspense>
      )}


      {quickRsvpEvent && (
        <Suspense fallback={null}>
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
        </Suspense>
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
      )}
    </div>
  );
}
