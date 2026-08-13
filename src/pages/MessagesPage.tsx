import { useStickyList } from "@/hooks/useStickyList";
import { useStableInboxReadModel } from "@/hooks/useStableInboxReadModel";
import React, { Fragment, useState, useMemo, useEffect, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAllChatDrafts } from "@/hooks/useChatDraft";
import { usePersistedFilter } from "@/lib/persistedFilter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, ChevronRight, Users, Trash2, Search, BellOff, ImageIcon, Lock, RefreshCw, Flame, Filter, Check, Building2, Clock, Sparkles } from "lucide-react";
import { GlobalChatRecapSheet, type RecapScopeRef } from "@/components/chat/GlobalChatRecapSheet";
import { useUserHasAnyAICatchUpClub } from "@/hooks/useUserHasAnyAICatchUpClub";
import { CreateActionButton } from "@/components/CreateActionButton";
import { ConversationAvatar } from "@/components/chat/ConversationAvatar";
import { QueryErrorBanner } from "@/components/QueryErrorBanner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { formatTimeShort } from "@/lib/formatTimeShort";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { WifiOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getCachedMessagesPageData, cacheMessagesPageData } from "@/lib/messagesPageCache";
import { filterDeletedTeams } from "@/lib/deletedTeamTombstones";
import { useClubTheme } from "@/hooks/useClubTheme";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";
import { fetchUnreadMessageCounts } from "@/lib/unreadMessageCounts";
import { useUnreadMessageCounts } from "@/hooks/useUnreadMessageCounts";
import { useGroupChatUnreadCache } from "@/hooks/useGroupChatUnreadCache";
import { isIgniteSupportUser } from "@/lib/systemUser";
import { queueChatInvalidation } from "@/lib/chatInvalidationQueue";

import { useMessagesPageBootstrap, isMessagesBootstrapEnabled } from "@/hooks/useMessagesPageBootstrap";
import { useAuthorizedScopes } from "@/hooks/useAuthorizedScopes";
import { registerChannel } from "@/lib/realtimeChannelRegistry";
import {
  createInboxRealtimeCoordinator,
  createInboxPreviewWatermarks,
  type InboxRealtimeEvent,
} from "@/features/messaging/inbox/inboxRealtimeReconciliation";
import { mark as coldMark, snapshotStages } from "@/lib/coldStartMarks";
import { notificationKeys } from "@/features/notifications/queryKeys";
import { logInboxOpenLatency, resetInboxOpenLog } from "@/lib/inboxOpenLatency";

import { cacheProfiles, getProfileFromCache, selectCachedProfilesByIds } from "@/lib/profileCache";
import { formatMessagePreview as stripMentionFormatting, getMessagePreviewText as getMessagePreview } from "@/lib/messagePreview";
import CreateGroupDialog from "@/components/chat/CreateGroupDialog";
import EditGroupDialog from "@/components/chat/EditGroupDialog";
import { StartDMDialog } from "@/components/chat/StartDMDialog";
import { NewMessageSheet } from "@/components/chat/NewMessageSheet";
import { NewGroupTypeSheet } from "@/components/chat/NewGroupTypeSheet";
import { ContactClubButton } from "@/components/ContactClubButton";
import { clubAdminInboxQueryKey, fetchClubAdminConversations } from "@/components/chat/ClubAdminInboxList";
import DiscoverGroupsList from "@/components/chat/DiscoverGroupsList";
import { MessagePreview } from "@/components/chat/MessagePreview";
import { ConversationRow } from "@/components/chat/ConversationRow";
import {
  filterInboxConversations,
  normalizeInboxTypeFilter,
  partitionInboxByReadState,
  resolveOperationalConversationDisclosure,
  type InboxConversation as UnifiedConversation,
} from "@/features/messaging/inbox/inboxReadModel";
import {
  fetchInboxAdminTeamIds,
  fetchInboxAdminClubs,
  fetchInboxAppAdminStatus,
  fetchInboxBroadcastPrefetchPage,
  fetchInboxClubScopeFilter,
  fetchInboxClubProStatus,
  fetchInboxClubPrefetchPage,
  fetchInboxCommitteeMemberStatus,
  fetchInboxCompetitionClubMap,
  fetchInboxEventTitleMap,
  fetchInboxHiddenDirectMessages,
  fetchInboxHiddenGroups,
  fetchInboxGroupPrefetchPage,
  fetchInboxHasAnyProAccess,
  fetchInboxMutedChats,
  fetchInboxMemberClubsWithMessages,
  fetchInboxMemberTeamsWithMessages,
  fetchInboxChatGroupsWithMessages,
  fetchInboxLatestBroadcast,
  fetchInboxLatestDirectMessages,
  fetchInboxSystemMessage,
  fetchInboxTeamPrefetchPage,
  fetchInboxDirectConversationMembership,
  fetchInboxUserLeagueIds,
  fetchInboxUserRoles,
  fetchInboxVaultFileNameMap,
  fetchInboxVaultFolderNameMap,
} from "@/features/messaging/inbox/inboxRepositories";
import {
  areInboxSortSourcesSettled,
  resolveInboxRevealPolicy,
} from "@/features/messaging/inbox/inboxRevealPolicy";
import { resolveInboxDisplayList } from "@/features/messaging/inbox/inboxDisplaySources";
import { filterInboxGroupsByVisibility } from "@/features/messaging/inbox/inboxGroupVisibility";
import {
  collectDirectMessagePeerIds,
  collectPersonalGroupIds,
  filterInboxChatGroups,
  filterInboxClubs,
  filterInboxDirectMessages,
  filterInboxLeagueChats,
  filterInboxTeams,
  normalizeInboxSearchQuery,
  partitionInboxGroups,
} from "@/features/messaging/inbox/inboxFilterPolicy";
import {
  assembleDirectMessageInboxConversations,
  buildDirectMessageCachePayload,
  buildPreviousDirectMessagePeerMap,
  hydrateCachedDirectMessages,
  loadDirectMessagePeerProfiles,
  resolveEffectiveDirectMessages,
} from "@/features/messaging/inbox/inboxDirectMessageSources";
import { buildUnifiedInboxConversations } from "@/features/messaging/inbox/inboxUnifiedComposition";
import { collectInboxPreviewReferences } from "@/features/messaging/inbox/inboxPreviewReferences";
import {
  resolveInboxEmptyState,
  resolveInboxGroupCreationCapability,
  resolveInboxUpgradePresentation,
} from "@/features/messaging/inbox/inboxPresentationPolicy";

// Session-scoped first-reveal latch (per user id). Survives inbox unmount so
// warm re-entries paint cached rows immediately instead of re-running the
// initial ordering gate. Reset implicitly on reload / user switch.
let sessionRevealedInboxUserId: string | null = null;
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EyeOff } from "lucide-react";

const MESSAGES_PER_PAGE = 15;
const isNativeRuntime = () => !!(window as any).Capacitor?.isNativePlatform?.();
// Web polls aggressively (30s); native uses a longer interval to reduce
// background work on low-end Android WebViews while still keeping the inbox
// reasonably fresh between realtime events / resume refetches.
const INBOX_REFETCH_INTERVAL_MS = isNativeRuntime() ? 120000 : 30000;
// Jitter polling intervals so the ~5 inbox queries don't fire as a single
// burst every 30s (which caused render-storm + network burst). Each query
// gets an independent ±15% offset, spreading network + re-render work across
// a few seconds instead of landing simultaneously.
const jitteredInboxInterval = () => {
  const base = INBOX_REFETCH_INTERVAL_MS;
  const jitter = base * 0.15;
  return base + (Math.random() * 2 - 1) * jitter;
};
// Cap background prefetch fanout. Without a cap, /messages prefetches every
// thread the user belongs to, which on Android WebView can stall the main
// thread for seconds after navigating away.
const PREFETCH_THREAD_CAP = isNativeRuntime() ? 5 : 15;


// Skeleton component for message items while loading
function MessageSkeleton() {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-3 w-8 shrink-0" />
      </CardContent>
    </Card>
  );
}

// Per-conversation-type accent colors. Stronger than the previous neutral
// type chip but intentionally restrained: a thin left-edge stripe + a tinted
// type pill, no avatar tinting, no card backgrounds.
const TYPE_ACCENT_HSL: Record<string, string | undefined> = {
  team: '142 71% 42%',   // green
  club: '210 85% 52%',   // blue
  group: '25 92% 52%',   // orange
  admin_group: '210 85% 52%',
  league: '270 60% 55%', // purple
  dm: undefined,         // neutral
  broadcast: undefined,
  support: undefined,
};

function typeAccentStyle(type: string): React.CSSProperties | undefined {
  const h = TYPE_ACCENT_HSL[type];
  if (!h) return undefined;
  return { borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: `hsl(${h})` };
}

function typeBadgeStyle(type: string): React.CSSProperties | undefined {
  const h = TYPE_ACCENT_HSL[type];
  if (!h) return undefined;
  return { color: `hsl(${h})`, borderColor: `hsl(${h} / 0.4)`, backgroundColor: `hsl(${h} / 0.08)` };
}

// Detect automated/system reminder messages so the inbox can de-emphasize
// them vs real human conversation. Currently keyed off the gallery-prompt
// token (📸 Reminder: add team photos) — extend here as more system
// reminder types are added.
function isSystemReminderText(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\[galleryprompt:[0-9a-f-]{36}\]/i.test(text);
}


// Helper to get first name only from a display name
const getFirstName = (fullName: string | undefined): string => {
  if (!fullName) return "";
  return fullName.split(" ")[0];
};

// Abbreviate club names: "Bridgewater Soccer Club" -> "Bridgewater SC"
const abbreviateClubName = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) return name;
  const firstWord = words[0];
  const initials = words.slice(1).map(w => w.charAt(0).toUpperCase()).join("");
  return `${firstWord} ${initials}`;
};

// NOTE: Placeholder name generation was removed - it caused confusion by showing
// fake names like "Casey Walker" when profiles weren't loaded yet.
// Now we show empty string until the real profile is fetched.

// MessagePreview lives in its own module so the memoized ConversationRow can
// share the exact same render path. See: components/chat/MessagePreview.tsx

interface Club {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
}

export default function MessagesPage() {
  const { user, initialized, refreshUnreadCount } = useAuth();
  const { isOnline } = useOnlineStatus();
  usePageTitle("Messages");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [showDMDialog, setShowDMDialog] = useState(false);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [showCustomGroupDialog, setShowCustomGroupDialog] = useState(false);
  const [groupDialogType, setGroupDialogType] = useState<"role" | "team">("role");
  const [showNewMessageSheet, setShowNewMessageSheet] = useState(false);
  const [showGroupTypeSheet, setShowGroupTypeSheet] = useState(false);
  const [showGlobalRecap, setShowGlobalRecap] = useState(false);
  const [localClubFilter, setLocalClubFilter] = usePersistedFilter("messages.localClubFilter", "all");
  const [typeFilterRaw, setTypeFilter] = usePersistedFilter("messages.typeFilter", "all");
  // Normalize legacy persisted values ('club' / 'league' used to be top-level
  // chips — they now live inside 'groups').
  const typeFilter = normalizeInboxTypeFilter(typeFilterRaw);
  const [showAllOps, setShowAllOps] = useState(false);
  const [showClubFilterDrawer, setShowClubFilterDrawer] = useState(false);
  const { activeClubFilter, activeClubTeamIds } = useClubTheme();

  // Effective club filter: use theme filter if active, otherwise use local filter
  const effectiveClubFilter = activeClubFilter || (localClubFilter !== "all" ? localClubFilter : null);
  const hasLocalFilter = !activeClubFilter && localClubFilter !== "all";

  // Gate Chat Recap to the active club context so a free active club can't
  // borrow Pro access from another club the user belongs to.
  const { hasAICatchUpClub, resolved: aiCatchUpResolved } = useUserHasAnyAICatchUpClub(effectiveClubFilter ?? null);
  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    let changed = false;
    if (params.get("new") === "picker") {
      setShowNewMessageSheet(true);
      params.delete("new");
      changed = true;
    }
    if (params.get("recap") === "1") {
      if (hasAICatchUpClub) {
        setShowGlobalRecap(true);
      } else {
        toast({ title: "Pro feature", description: "Chat Recap is a Pro feature. Upgrade your club to unlock AI summaries." });
      }
      params.delete("recap");
      changed = true;
    }
    if (changed) {
      navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" }, { replace: true });
    }
  }, [location.search, location.pathname, navigate, hasAICatchUpClub]);

  const { data: clubAdminConversations = [] } = useQuery({
    queryKey: clubAdminInboxQueryKey(user?.id, effectiveClubFilter),
    enabled: !!user && initialized,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnMount: "always",
    queryFn: () => fetchClubAdminConversations(user!.id, effectiveClubFilter),
  });

  // Load cached data for instant display
  const cachedData = useMemo(() => {
    if (!user?.id) return null;
    return getCachedMessagesPageData(user.id);
  }, [user?.id]);

  // Phase 1 perf: behind localStorage flag `msg_bootstrap_v1`. When enabled,
  // one RPC seeds the cache for 5 role/permission queries (is-app-admin,
  // is-committee-member, admin-team-ids, user-all-roles, has-any-pro-access)
  // so their existing useQuery blocks become instant cache hits. Rollback:
  // `localStorage.removeItem("msg_bootstrap_v1")`.
  const bootstrapQ = useMessagesPageBootstrap(user?.id, initialized);

  // Inbox perf: mark mount + track bootstrap RPC return + first paint. See
  // src/lib/inboxOpenLatency.ts. Best-effort; one sample per open.
  // We capture per-open timestamps locally because `coldMark` is
  // first-write-wins per JS session — relying on it made every subsequent
  // inbox open report the FIRST open's `bootstrap_ms` / `first_paint_ms`.
  const inboxOpenStartRef = useRef<number>(Date.now());
  const inboxMountTsRef = useRef<number>(Date.now());
  const inboxBootstrapReturnTsRef = useRef<number | null>(null);
  const inboxFirstPaintTsRef = useRef<number | null>(null);
  useEffect(() => {
    const now = Date.now();
    inboxMountTsRef.current = now;
    inboxBootstrapReturnTsRef.current = null;
    inboxFirstPaintTsRef.current = null;
    // For a true cold open, anchor tap_to_paint_ms to the earliest signal we
    // have (notif_tap if it fired, otherwise boot/performance.timeOrigin) so
    // the top-level metric captures the pre-mount prefix (native webview
    // init, auth resolve, chunk fetch, route settle) — not just mount → paint.
    let startTs = now;
    try {
      const snap = snapshotStages();
      if (snap.anchor !== null) {
        const notifTapDelta = snap.deltas.notif_tap;
        if (typeof notifTapDelta === "number") {
          startTs = snap.anchor + notifTapDelta;
        } else if (typeof performance !== "undefined" && performance.timeOrigin) {
          // Prefer timeOrigin (native process start) over the `boot` mark so
          // cold_open captures webview/JS bundle parse time too.
          startTs = Math.min(now, Math.round(performance.timeOrigin));
        } else {
          startTs = snap.anchor;
        }
      }
    } catch {}
    inboxOpenStartRef.current = startTs;
    coldMark("inbox_mount");
    return () => { resetInboxOpenLog(); };
  }, []);
  useEffect(() => {
    if (bootstrapQ.data && inboxBootstrapReturnTsRef.current === null) {
      inboxBootstrapReturnTsRef.current = Date.now();
      coldMark("inbox_bootstrap_return");
    }
  }, [bootstrapQ.data]);



  // Fetch unread message notifications grouped by thread.
  // Uses the shared useUnreadMessageCounts hook so the RPC is deduped across
  // MessagesPage, BottomNav and MyTeamsPremiumCarousel (previously each
  // fetched independently — the #1 slow query in pg_stat_statements).
  const { data: unreadCounts } = useUnreadMessageCounts(user?.id, {
    enabled: initialized,
    placeholderData: (prev) => prev,
  });

  // Per-group-chat row badges read from the denormalised `chat_group_unread`
  // cache (realtime-backed). Falls back to `unreadCounts.groups[id]` if the
  // hook hasn't populated yet — so behaviour is identical to the old RPC path
  // in the worst case, and instant in the common case.
  const { data: groupUnreadCache } = useGroupChatUnreadCache(
    initialized ? user?.id : null,
  );

  // Delete group mutation (soft-delete so an app admin can restore later)
  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from("chat_groups")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id ?? null,
        } as any)
        .eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Chat removed. An app admin can restore it if needed." });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
    },
    onError: (error) => {
      toast({
        title: "Error deleting group",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Check if user is app admin
  const { data: isAppAdmin, isFetching: isAppAdminFetching } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: () => fetchInboxAppAdminStatus(user!.id),
    enabled: !!user && initialized,
    retry: 3,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Get clubs where user is admin
  const { data: adminClubs } = useQuery({
    queryKey: ["admin-clubs", user?.id],
    queryFn: () => fetchInboxAdminClubs(user!.id),
    enabled: !!user && initialized,
    retry: 3,
    staleTime: 5 * 60 * 1000,
    initialData: cachedData?.adminClubs as Club[] | undefined,
    placeholderData: (prev) => prev,
  });

  // Preview watermarks: the most recent Realtime-accepted inbox preview per
  // scope. Inbox query responses are merged against these so a response that
  // STARTED before a Realtime event can never regress to older/empty preview
  // data (the "preview appears then disappears" defect). Cleared on user
  // change / sign-out below.
  const previewWatermarksRef = useRef(createInboxPreviewWatermarks());
  const previewWatermarks = previewWatermarksRef.current;

  // Fetch member clubs with their latest messages in a single query

  const { data: memberClubsWithMessages, isLoading: memberClubsLoading, isFetched: memberClubsFetched, isFetching: memberClubsFetching, isError: memberClubsError } = useQuery({
    queryKey: ["member-clubs-with-messages", user?.id],
    retry: 3,
    refetchOnReconnect: "always",
    queryFn: () => fetchInboxMemberClubsWithMessages(user!.id),
    enabled: !!user && initialized,
    // Warm revisits render instantly from cache; realtime + 30s poll keep
    // previews fresh. Forcing refetch on every mount/focus caused 10-25s
    // freezes when returning to /messages because the N+1 cascade refired.
    staleTime: 30_000,
    initialDataUpdatedAt: 0,
    refetchInterval: jitteredInboxInterval,
    gcTime: 10 * 60 * 1000,
    initialData: cachedData?.memberClubs
      ? { clubs: cachedData.memberClubs as any, latestMessages: cachedData.latestClubMessages ?? {} }
      : undefined,
    placeholderData: (prev) => prev,
  });
  
  // Extract clubs and latest messages from combined query
  const memberClubs = memberClubsWithMessages?.clubs ?? [];
  const latestClubMessages = previewWatermarks.reconcile(
    "club",
    memberClubsWithMessages?.latestMessages,
  );

  // Get latest broadcast message
  const { data: latestBroadcast, isFetched: latestBroadcastFetched, isFetching: latestBroadcastFetching, isError: latestBroadcastError } = useQuery({
    queryKey: ["latest-broadcast"],
    refetchOnReconnect: "always",
    queryFn: () => fetchInboxLatestBroadcast(),
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: true,
    placeholderData: (prev) => prev,
  });


  // Fetch teams with their latest messages in a single query for efficiency
  const { data: teamsWithMessages, isLoading: teamsLoading, isFetched: teamsFetched, isFetching: teamsFetching, isError: teamsError } = useQuery({
    queryKey: ["my-teams-with-messages", user?.id],
    retry: 3,
    refetchOnReconnect: "always",
    queryFn: () => fetchInboxMemberTeamsWithMessages(user!.id),
    enabled: !!user && initialized,
    staleTime: 30_000,
    initialDataUpdatedAt: 0,
    refetchInterval: jitteredInboxInterval,
    gcTime: 10 * 60 * 1000,
    initialData: cachedData?.teams
      ? { teams: filterDeletedTeams(cachedData.teams as any) as any, latestMessages: cachedData.latestTeamMessages ?? {} }
      : undefined,
    placeholderData: (prev) => prev,
  });
  
  // Extract teams and latest messages from combined query
  // Locally tombstoned (soft-deleted) teams are dropped at render time too —
  // any cache layer or realtime patch that still holds one can never surface a
  // duplicate/empty thread for a recreated team of the same name.
  const teams = useMemo(
    () => filterDeletedTeams(teamsWithMessages?.teams as any) as typeof teamsWithMessages.teams,
    [teamsWithMessages?.teams],
  );
  const latestTeamMessages = previewWatermarks.reconcile(
    "team",
    teamsWithMessages?.latestMessages,
  );

  // Get admin teams where user can create groups
  const { data: adminTeamIds } = useQuery({
    queryKey: ["admin-team-ids", user?.id],
    queryFn: () => fetchInboxAdminTeamIds(user!.id),
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Check if user is a committee member (club-level role)
  const { data: isCommitteeMember, isFetching: isCommitteeMemberFetching } = useQuery({
    queryKey: ["is-committee-member", user?.id],
    queryFn: () => fetchInboxCommitteeMemberStatus(user!.id),
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Fetch all user roles for chat group filtering
  const { data: userAllRoles, isFetching: userAllRolesFetching } = useQuery({
    queryKey: ["user-all-roles", user?.id],
    queryFn: () => fetchInboxUserRoles(user!.id),
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch mini league IDs the user's children are assigned to (for league group visibility)
  const { data: userLeagueIds, isFetching: userLeagueIdsFetching } = useQuery({
    queryKey: ["user-child-league-ids", user?.id],
    queryFn: () => fetchInboxUserLeagueIds(user!.id),
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
  });

  // Check if user has any Pro access
  // Pro Access Logic: Club Pro → all teams inherit; Free club → check team subscription
  const { data: hasAnyProAccess, isLoading: isLoadingProAccess, isFetching: isFetchingProAccess } = useQuery({
    queryKey: ["has-any-pro-access", user?.id],
    queryFn: () => fetchInboxHasAnyProAccess(user!.id),
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Get Pro status for each club - derived from memberClubs data
  const memberClubIds = useMemo(() => {
    const clubs = memberClubsWithMessages?.clubs ?? [];
    return clubs.map((c: any) => c.id).filter(Boolean) as string[];
  }, [memberClubsWithMessages]);

  const { data: clubProStatus, isLoading: isLoadingClubProStatus, isFetching: isFetchingClubProStatus } = useQuery({
    queryKey: ["club-pro-status", memberClubIds],
    // Errors remain distinct from an all-false entitlement result so React
    // Query can retain the previous good value through placeholderData.
    queryFn: () => fetchInboxClubProStatus(memberClubIds),
    enabled: memberClubIds.length > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
    retry: 2,
  });

  // Fetch chat groups with their latest messages in a single query
  const { data: chatGroupsWithMessages, isLoading: chatGroupsLoading, isFetched: chatGroupsFetched, isFetching: chatGroupsFetching, isError: chatGroupsError } = useQuery({
    queryKey: ["my-chat-groups-with-messages", user?.id],
    refetchOnReconnect: "always",
    queryFn: () => fetchInboxChatGroupsWithMessages(user!.id, {
      // Kill-switch retained for deployments where the optional scope RPC is
      // unavailable; the repository then relies on the existing RLS query.
      accessibleIdsRpcEnabled:
        typeof window === "undefined" || window.localStorage.getItem("msg_accessible_ids_rpc") !== "0",
    }),
    enabled: !!user && initialized,
    staleTime: 30_000,
    initialDataUpdatedAt: 0,
    refetchInterval: jitteredInboxInterval,
    gcTime: 10 * 60 * 1000,
    initialData: cachedData?.chatGroups
      ? { groups: cachedData.chatGroups as any, latestMessages: cachedData.latestGroupMessages ?? {} }
      : undefined,
    placeholderData: (prev) => prev,
  });
  
  // Extract groups and latest messages from combined query
  const chatGroups = chatGroupsWithMessages?.groups ?? [];
  // Monotonic reconciliation: an older/empty authoritative response that
  // started before a Realtime event must not erase the newer preview.
  const latestGroupMessages = previewWatermarks.reconcile(
    "group",
    chatGroupsWithMessages?.latestMessages,
  );

  // For competition-scoped chat groups, fetch which clubs have entered teams.
  // Used to hide competition chats when the user filters to a club that is
  // not actually participating in that competition.
  const competitionIdsForGroups = useMemo(() => {
    const ids = new Set<string>();
    for (const g of chatGroups as any[]) {
      if (g?.competition_id) ids.add(g.competition_id);
    }
    return Array.from(ids);
  }, [chatGroups]);

  const { data: competitionClubMap } = useQuery({
    queryKey: ["competition-entry-clubs", competitionIdsForGroups],
    enabled: competitionIdsForGroups.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchInboxCompetitionClubMap(competitionIdsForGroups),
  });


  // Fetch all muted chats for the user
  const { data: mutedChats } = useQuery({
    queryKey: ["muted-chats", user?.id],
    queryFn: () => fetchInboxMutedChats(user!.id),
    enabled: !!user && initialized,
    staleTime: 60000,
    placeholderData: (prev) => prev,
  });

  // Fetch DM conversations
  const { data: dmConversations, isLoading: dmLoading, isFetching: dmFetching, isFetched: dmFetched, isError: dmError } = useQuery({
    queryKey: ["dm-conversations", user?.id],
    refetchOnReconnect: "always",
    queryFn: async () => {
      // Note: session freshness is handled globally by the auth listener /
      // supabaseAuthRetry layer. Awaiting ensureFreshSession() here added
      // 1-3s on cold loads and serialized the DM cascade behind it.



      const { conversations: convos, otherUserIds } =
        await fetchInboxDirectConversationMembership(user!.id);
      if (convos.length === 0) return [];

      const conversationIds = convos.map((c) => c.id);

      const [profilesMap, messageMap] = await Promise.all([
        // Always fetch DM other-user profiles directly from the DB (bypassing
        // the 24h profileCache) so display_name / avatar changes made by the
        // other participant are reflected in the inbox on the next load.
        // Falls back to whatever the global profile cache has if the network
        // fetch fails or returns empty (handled by the layered fallbacks below).
        loadDirectMessagePeerProfiles(otherUserIds),
        fetchInboxLatestDirectMessages(conversationIds),
      ]);

      // Build a fallback map of previously-known other_user data so that a
      // transient empty profile fetch (RLS / network blip after lock screen)
      // never downgrades a real name back to "Unknown User".
      const previousResult = queryClient.getQueryData<any[]>(["dm-conversations", user?.id]);
      const previousOtherUserMap = buildPreviousDirectMessagePeerMap({
        live: previousResult,
        cached: cachedData?.dmConversations,
      });

      const result = assembleDirectMessageInboxConversations({
        conversations: convos,
        currentUserId: user!.id,
        fetchedProfiles: profilesMap,
        previousProfiles: previousOtherUserMap,
        latestMessages: messageMap,
        getGlobalProfile: getProfileFromCache,
      });

      // Cache
      const cachePayload = buildDirectMessageCachePayload({
        conversations: result,
        currentUserId: user!.id,
      });
      cacheMessagesPageData(user!.id, cachePayload);

      return result;
    },
    // Fetch DMs in parallel with everything else; Pro gating happens at
    // render time. Previously this waited on hasAnyProAccess (3 serial
    // queries) before even starting, adding 2-5s to cold loads. RLS still
    // enforces who can read each conversation.
    enabled: !!user && initialized,
    staleTime: 30_000,
    initialDataUpdatedAt: 0,
    refetchInterval: jitteredInboxInterval,
    placeholderData: () => {
      const hydrated = hydrateCachedDirectMessages({
        conversations: cachedData?.dmConversations,
        latestMessages: cachedData?.latestDMMessages,
        currentUserId: user?.id,
      });
      return hydrated.length > 0 ? hydrated : undefined;
    },
  });

  // Fetch hidden DM conversations (with hidden_at so they can resurface on new messages)
  const { data: hiddenDMMap } = useQuery({
    queryKey: ["hidden-dm-conversations", user?.id],
    queryFn: () => fetchInboxHiddenDirectMessages(user!.id),
    enabled: !!user,
  });

  // Fetch hidden custom group chats (with hidden_at)
  const { data: hiddenGroupMap } = useQuery({
    queryKey: ["hidden-chat-groups", user?.id],
    queryFn: () => fetchInboxHiddenGroups(user!.id),
    enabled: !!user,
  });

  // Mutation: hide a DM conversation
  const hideDMMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from("hidden_dm_conversations")
        .upsert(
          { user_id: user!.id, conversation_id: conversationId, hidden_at: new Date().toISOString() },
          { onConflict: "user_id,conversation_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hidden-dm-conversations", user?.id] });
      toast({ title: "Conversation hidden", description: "It will reappear when you receive a new message." });
    },
    onError: (e: any) => toast({ title: "Could not hide", description: e?.message || "Try again", variant: "destructive" }),
  });

  // Mutation: hide a custom group chat
  const hideGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from("hidden_chat_groups" as any)
        .upsert(
          { user_id: user!.id, group_id: groupId, hidden_at: new Date().toISOString() },
          { onConflict: "user_id,group_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hidden-chat-groups", user?.id] });
      toast({ title: "Group hidden", description: "It will reappear when someone sends a new message." });
    },
    onError: (e: any) => toast({ title: "Could not hide", description: e?.message || "Try again", variant: "destructive" }),
  });

  // Fetch system messages (welcome message from Ignite Support)
  const { data: systemMessage } = useQuery({
    queryKey: ["system-messages", user?.id],
    queryFn: () => fetchInboxSystemMessage(user!.id),
    enabled: !!user,
  });

  // Cache fresh data when it arrives
  useEffect(() => {
    if (!user?.id) return;
    
    const hasData = teams || memberClubs || adminClubs || chatGroups?.length || latestBroadcast;
    if (!hasData) return;
    
    cacheMessagesPageData(user.id, {
      teams: teams as any,
      memberClubs: memberClubs as any,
      adminClubs: adminClubs as any,
      chatGroups: chatGroups as any,
      latestBroadcast: latestBroadcast as any,
      latestTeamMessages,
      latestClubMessages,
      latestGroupMessages,
    });
  }, [user?.id, teams, memberClubs, adminClubs, chatGroups, latestBroadcast, latestTeamMessages, latestClubMessages, latestGroupMessages]);

  // Prefetch messages for top N threads in the background (non-blocking).
  // Capped via PREFETCH_THREAD_CAP to avoid the Android WebView freeze caused
  // by fanning out a prefetch per team/club/group on /messages — which stalled
  // the main thread for seconds after navigating away from a chat.
  useEffect(() => {
    if (!user) return;
    // Android WebView cold-open audit: the prefetch storm (16+ extra `messages`
    // SELECTs scheduled ~100ms after first paint) competes with the main-thread
    // work needed to render the inbox itself, adding ~0.5-1s before the user
    // can interact. On native we skip it entirely — the per-thread fetch fires
    // when the user actually opens that chat, which is fast enough. Web keeps
    // the speculative prefetch since desktop has spare capacity.
    if (isNativeRuntime()) return;


    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const cappedTeams = (teams ?? []).slice(0, PREFETCH_THREAD_CAP);
    const cappedClubs = (memberClubs ?? []).slice(0, PREFETCH_THREAD_CAP);
    const cappedGroups = (chatGroups ?? []).slice(0, PREFETCH_THREAD_CAP);

    const prefetchAll = () => {
      if (cancelled) return;
      queryClient.prefetchQuery({
        queryKey: ["broadcast-messages"],
        queryFn: () => fetchInboxBroadcastPrefetchPage(MESSAGES_PER_PAGE),
        staleTime: 1000 * 60,
      });

      cappedTeams.forEach((team) => {
        if (cancelled) return;
        queryClient.prefetchQuery({
          queryKey: ["team-messages", team.id],
          queryFn: () => fetchInboxTeamPrefetchPage(team.id, MESSAGES_PER_PAGE),
          staleTime: 1000 * 60,
        });
      });

      cappedClubs.forEach((club) => {
        if (cancelled) return;
        queryClient.prefetchQuery({
          queryKey: ["club-messages", club.id],
          queryFn: () => fetchInboxClubPrefetchPage(club.id, MESSAGES_PER_PAGE),
          staleTime: 1000 * 60,
        });
      });

      cappedGroups.forEach((group) => {
        if (cancelled) return;
        queryClient.prefetchQuery({
          queryKey: ["group-messages", group.id],
          queryFn: () => fetchInboxGroupPrefetchPage(group.id, MESSAGES_PER_PAGE),
          staleTime: 1000 * 60,
        });
      });
    };

    if ('requestIdleCallback' in window) {
      idleHandle = (window as any).requestIdleCallback(prefetchAll, { timeout: 2000 });
    } else {
      timeoutHandle = setTimeout(prefetchAll, 100);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null && 'cancelIdleCallback' in window) {
        try { (window as any).cancelIdleCallback(idleHandle); } catch { /* ignore */ }
      }
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    };
  }, [user, teams, memberClubs, chatGroups, queryClient]);

  // Realtime: keep inbox previews + ordering fresh as new messages arrive.
  // Without this, latest-message text and the most-recent-at-top sort only
  // refresh on the 30s refetchInterval, so new threads don't bubble to the top.
  //
  // IMPORTANT: subscribe ONCE per user (not per teams/clubs/groups identity)
  // to avoid the channel being torn down + rebuilt every 30s when the
  // refetchInterval produces a new array reference. During the resubscribe
  // window incoming INSERTs were being dropped, which is why new messages
  // (including the user's own send) didn't bubble the row to the top until
  // the next 30s poll. We read the latest membership ids via refs.
  const teamIdsRef = useRef<Set<string>>(new Set());
  const clubIdsRef = useRef<Set<string>>(new Set());
  const groupIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { teamIdsRef.current = new Set((teams ?? []).map((t: any) => t.id)); }, [teams]);
  useEffect(() => { clubIdsRef.current = new Set((memberClubs ?? []).map((c: any) => c.id)); }, [memberClubs]);
  useEffect(() => { groupIdsRef.current = new Set((chatGroups ?? []).map((g: any) => g.id)); }, [chatGroups]);

  // Fail-closed authorization set for Realtime callbacks (pass b of Realtime
  // membership audit). We keep the page-driven teams/clubs/groups refs above
  // for perf (they drive UI patching) but layer the authoritative membership
  // snapshot on top: payloads are dropped while status !== 'ready' AND when
  // the scope id is not in the authorized set. Empty set + ready => user has
  // no access to that scope => drop (previous `ids.size && !ids.has(x)` guard
  // failed open on empty).
  const authScopes = useAuthorizedScopes();
  const authStatusRef = useRef(authScopes.status);
  const authTeamIdsRef = useRef<ReadonlySet<string>>(authScopes.teamIds);
  const authClubIdsRef = useRef<ReadonlySet<string>>(authScopes.clubIds);
  const authGroupIdsRef = useRef<ReadonlySet<string>>(authScopes.groupIds);
  const authDmIdsRef = useRef<ReadonlySet<string>>(authScopes.dmConversationIds);
  useEffect(() => {
    authStatusRef.current = authScopes.status;
    authTeamIdsRef.current = authScopes.teamIds;
    authClubIdsRef.current = authScopes.clubIds;
    authGroupIdsRef.current = authScopes.groupIds;
    authDmIdsRef.current = authScopes.dmConversationIds;
  }, [authScopes]);

  // Payloads that arrive before the membership snapshot resolves used to be
  // dropped outright, which meant the first seconds after opening /messages
  // could silently lose the newest message until the next poll. Both channels
  // now hand every event to a coordinator that buffers (bounded) until
  // `status === 'ready'` and then replays exactly once. Authorization stays
  // fail-closed: the replay runs the same `isAuthorized` check.
  //
  // `attemptFlush()` is idempotent and called from BOTH sides of the race —
  // here when authorization becomes ready, and inside the channel effects when
  // the applier is installed — so whichever happens last performs the flush.
  const webInboxCoordinatorRef = useRef(
    createInboxRealtimeCoordinator({ isReady: () => authStatusRef.current === "ready" }),
  );
  const nativeInboxCoordinatorRef = useRef(
    createInboxRealtimeCoordinator({ isReady: () => authStatusRef.current === "ready" }),
  );
  const webInboxCoordinator = webInboxCoordinatorRef.current;
  const nativeInboxCoordinator = nativeInboxCoordinatorRef.current;

  useEffect(() => {
    if (authScopes.status === "ready") {
      webInboxCoordinator.attemptFlush();
      nativeInboxCoordinator.attemptFlush();
      return;
    }
    if (authScopes.status === "failed") {
      // Authorization could not be established — discard buffered events
      // rather than risk applying them later against unknown scopes.
      webInboxCoordinator.clear();
      nativeInboxCoordinator.clear();
      previewWatermarks.clear();
    }
  }, [authScopes.status, webInboxCoordinator, nativeInboxCoordinator, previewWatermarks]);

  // Sign-out / user switch: no buffered event or preview watermark from the
  // previous user may survive into the next session.
  useEffect(() => {
    return () => {
      webInboxCoordinator.clear();
      nativeInboxCoordinator.clear();
      previewWatermarks.clear();
    };
  }, [user?.id, webInboxCoordinator, nativeInboxCoordinator, previewWatermarks]);




  useEffect(() => {
    if (!user?.id) return;

    // HARD-STOP PERF GUARD (native): the inbox realtime fanout was the single
    // largest source of long-task storms / 26s freezes on Android WebView.
    // Every INSERT to team/club/group/dm/broadcast tables would invalidate
    // 1-2 large queries AND the unread-counts query, which on accounts with
    // many threads chained dozens of long tasks together and froze the UI.
    //
    // On native we now rely on:
    //   - 30s refetchInterval on each query
    //   - foreground resume + reconnect refetches (reactQueryNativeAdapter)
    //   - pull-to-refresh
    //   - opening a thread (the thread itself stays fully realtime)
    // Web still gets the live channel.
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
    // Native uses a separate, lightweight realtime block (below) that patches
    // react-query caches in place via setQueryData — no invalidations, no
    // refetch storm, no localStorage rewrites on the hot path. The freeze on
    // /messages came from invalidateQueries chaining 4-6 parallel refetches
    // that each parsed/merged/restringified the 100-500KB messages-page cache
    // blob. Patching the in-memory query data directly lets previews stay
    // live without any of that work.
    if (isNative) return;

    const rafState = { team: 0, club: 0, group: 0, dm: 0, unread: 0 } as Record<string, number>;
    const schedule = (key: keyof typeof rafState, fn: () => void) => {
      if (rafState[key]) return;
      rafState[key] = requestAnimationFrame(() => { rafState[key] = 0; fn(); });
    };
    const bumpUnread = () => schedule('unread', () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.messageUnreadFor(user.id) });
    });

    // Web: patch the latestMessages cache IN PLACE so the preview text updates
    // instantly (same trick the native channel uses below). Without this, the
    // unread badge appears immediately (cheap COUNT RPC) but the preview text
    // sits stale for seconds waiting on the heavier join RPC. The invalidate
    // still runs afterward to backfill author display name + reconcile.
    const previewAuthor = (authorId?: string) => {
      if (!authorId) return "";
      if (authorId === user.id) return "You";
      const cached = getProfileFromCache(authorId);
      return cached?.display_name || "";
    };
    const patchLatest = (
      key: any[],
      scope: 'team' | 'club' | 'group',
      targetId: string,
      row: any,
      extra: Record<string, any> = {},
    ) => {
      const cached = queryClient.getQueryData<any>(key);
      const prev = cached?.latestMessages?.[targetId];
      const preview = {
        text: row.text ?? '',
        author: extra.author || previewAuthor(row.author_id) || (prev?.author ?? ""),
        created_at: row.created_at,
        image_url: row.image_url ?? null,
        ...extra,
      };

      // This handler is reached only after the final fail-closed scope check.
      // Record the exact object written to React Query so a stale response from
      // the invalidation below cannot erase the accepted Realtime preview.
      previewWatermarks.note(`${scope}:${targetId}`, preview);
      queryClient.setQueryData(key, (old: any) => {
        const base = old ?? { latestMessages: {} };
        return {
          ...base,
          latestMessages: {
            ...(base.latestMessages || {}),
            [targetId]: preview,
          },
        };
      });
    };

    // Fail-closed filters — drop payload unless membership snapshot is `ready`
    // AND the scope id is in the authorized set. Empty set + ready => user
    // has no access to that kind => drop.
    const isAuthorized = (kind: 'team' | 'club' | 'group' | 'dm', id: string | null | undefined): boolean => {
      if (!id) return false;
      if (authStatusRef.current !== 'ready') return false;
      const set =
        kind === 'team' ? authTeamIdsRef.current :
        kind === 'club' ? authClubIdsRef.current :
        kind === 'group' ? authGroupIdsRef.current :
        authDmIdsRef.current;
      return set.has(id);
    };

    const handlers: Record<string, (payload: any) => void> = {
      team_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('team', row?.team_id)) return;
        const isAnnouncement = !!(row.is_club_announcement && row.club_announcement_name);
        patchLatest(["my-teams-with-messages", user.id], 'team', row.team_id, row, {
          author: isAnnouncement ? row.club_announcement_name : previewAuthor(row.author_id),
          is_announcement: isAnnouncement,
        });
        schedule('team', () => queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages", user.id] }));
        bumpUnread();
      },
      club_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('club', row?.club_id)) return;
        patchLatest(["member-clubs-with-messages", user.id], 'club', row.club_id, row);
        schedule('club', () => queryClient.invalidateQueries({ queryKey: ["member-clubs-with-messages", user.id] }));
        bumpUnread();
      },
      group_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('group', row?.group_id)) return;
        patchLatest(["my-chat-groups-with-messages", user.id], 'group', row.group_id, row);
        schedule('group', () => queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages", user.id] }));
        bumpUnread();
      },
      direct_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('dm', row?.conversation_id)) return;
        queryClient.setQueryData(["dm-conversations", user.id], (old: any[] | undefined) => {
          if (!Array.isArray(old)) return old;
          const idx = old.findIndex((c: any) => c.id === row.conversation_id);
          if (idx === -1) return old;
          const conv = old[idx];
          const updated = {
            ...conv,
            updated_at: row.created_at,
            last_message: {
              text: row.text ?? '',
              image_url: row.image_url ?? null,
              created_at: row.created_at,
              author_id: row.author_id,
            },
          };
          const next = old.slice();
          next.splice(idx, 1);
          next.unshift(updated);
          return next;
        });
        schedule('dm', () => queryClient.invalidateQueries({ queryKey: ["dm-conversations", user.id] }));
        bumpUnread();
      },
      broadcast_messages: (payload: any) => {
        // Broadcasts have no scope id — RLS on `broadcast_messages` already
        // decides who receives them. Still gate on `ready` so we don't act
        // on a stale channel after sign-out.
        if (authStatusRef.current !== 'ready') return;
        const row = payload.new;
        queryClient.setQueryData(["latest-broadcast"], (old: any) => ({
          text: row.text ?? '',
          created_at: row.created_at,
          image_url: row.image_url ?? null,
          profiles: old?.profiles ?? null,
        }));
        queryClient.invalidateQueries({ queryKey: ["latest-broadcast"] });
        bumpUnread();
      },
    };

    // Edits (UPDATE) never fired here before, so an edited message kept its
    // ORIGINAL text in every inbox preview until the next cold refetch.
    // Reconcile by refetching the affected list (edits are rare, so this can't
    // contribute to invalidation storms) — no unread bump, edits aren't new mail.
    const editHandlers: Record<string, (payload: any) => void> = {
      team_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('team', row?.team_id)) return;
        schedule('team', () => queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages", user.id] }));
      },
      club_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('club', row?.club_id)) return;
        schedule('club', () => queryClient.invalidateQueries({ queryKey: ["member-clubs-with-messages", user.id] }));
      },
      group_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('group', row?.group_id)) return;
        schedule('group', () => queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages", user.id] }));
      },
      direct_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('dm', row?.conversation_id)) return;
        schedule('dm', () => queryClient.invalidateQueries({ queryKey: ["dm-conversations", user.id] }));
      },
      broadcast_messages: () => {
        if (authStatusRef.current !== 'ready') return;
        queryClient.invalidateQueries({ queryKey: ["latest-broadcast"] });
      },
    };

    // Buffer-then-replay via the shared inbox coordinator: while the
    // membership snapshot is still loading we hold payloads (bounded) instead
    // of discarding them, and replay them through these same authorized
    // handlers once scopes resolve.
    const applyEvent = (event: InboxRealtimeEvent) => {
      if (event.kind === 'edit') editHandlers[event.table]?.(event.payload);
      else handlers[event.table]?.(event.payload);
    };
    webInboxCoordinator.setApplier(applyEvent);
    const dispatch = (table: string, payload: any, kind: 'insert' | 'edit' = 'insert') => {
      webInboxCoordinator.dispatch({ table, payload, kind });
    };


    const channel = supabase
      .channel(`messages-inbox-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, (p: any) => dispatch('team_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'club_messages' }, (p: any) => dispatch('club_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, (p: any) => dispatch('group_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (p: any) => dispatch('direct_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast_messages' }, (p: any) => dispatch('broadcast_messages', p))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'team_messages' }, (p: any) => dispatch('team_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'club_messages' }, (p: any) => dispatch('club_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_messages' }, (p: any) => dispatch('group_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages' }, (p: any) => dispatch('direct_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'broadcast_messages' }, (p: any) => dispatch('broadcast_messages', p, 'edit'))
      .subscribe();


    // Register with the realtime channel registry so it's torn down on
    // membership revocation / sign-out via `revokeAllForUser`.
    const unregister = registerChannel({
      key: `messages-inbox-${user.id}`,
      channel,
      userId: user.id,
      scope: { kind: 'user', id: user.id },
    });

    return () => {
      unregister();
      webInboxCoordinator.setApplier(null);
      webInboxCoordinator.clear();
      Object.keys(rafState).forEach((k) => { if (rafState[k]) cancelAnimationFrame(rafState[k]); });
    };
  }, [user?.id, queryClient]);

  // Native-only: lightweight realtime that PATCHES react-query caches in
  // place instead of invalidating them. This keeps inbox previews live
  // (latest text, image hint, bubble-to-top sort) without triggering the
  // refetch storm + cache rewrites that froze Android WebView for 11-26s.
  // No unread-count bump here — counts refresh on 30s poll, foreground
  // resume, reconnect, and on opening the thread.
  useEffect(() => {
    if (!user?.id) return;
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
    if (!isNative) return;

    // Resolve an author display name without ever invalidating react-query.
    // 1) "You" if it's the current user.
    // 2) profileCache hit (sync, in-memory).
    // 3) Queue the id; a coalesced batch lookup runs every 500ms and
    //    re-patches the affected preview rows when names arrive.
    type PendingTarget = { kind: 'team' | 'club' | 'group' | 'dm'; targetId: string };
    const pendingByAuthor = new Map<string, PendingTarget[]>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const patchAuthor = (kind: PendingTarget['kind'], targetId: string, authorName: string) => {
      const apply = (key: any[], idKey: string) => {
        queryClient.setQueryData(key, (old: any) => {
          if (!old?.latestMessages?.[targetId]) return old;
          if (old.latestMessages[targetId].author === authorName) return old;
          return {
            ...old,
            latestMessages: {
              ...old.latestMessages,
              [targetId]: { ...old.latestMessages[targetId], author: authorName },
            },
          };
        });
      };
      if (kind === 'team') apply(["my-teams-with-messages", user.id], 'team_id');
      else if (kind === 'club') apply(["member-clubs-with-messages", user.id], 'club_id');
      else if (kind === 'group') apply(["my-chat-groups-with-messages", user.id], 'group_id');
      else if (kind === 'dm') {
        queryClient.setQueryData(["dm-conversations", user.id], (old: any[] | undefined) => {
          if (!Array.isArray(old)) return old;
          const idx = old.findIndex((c: any) => c.id === targetId);
          if (idx === -1) return old;
          const conv = old[idx];
          if (conv?.other_user?.display_name === authorName) return old;
          const next = old.slice();
          next[idx] = { ...conv, other_user: { ...(conv.other_user || { id: '' }), display_name: authorName } };
          return next;
        });
      }
    };

    const flushPending = async () => {
      flushTimer = null;
      if (pendingByAuthor.size === 0) return;
      const ids = Array.from(pendingByAuthor.keys());
      const batch = new Map(pendingByAuthor);
      pendingByAuthor.clear();
      try {
        const { data } = await selectCachedProfilesByIds(ids);
        if (data && data.length) cacheProfiles(data);
        const byId = new Map((data ?? []).map(p => [p.id, p.display_name || ""]));
        batch.forEach((targets, authorId) => {
          const name = byId.get(authorId);
          if (!name) return;
          targets.forEach(t => patchAuthor(t.kind, t.targetId, name));
        });
      } catch { /* silent — next 30s poll will fill it in */ }
    };

    const queueAuthor = (authorId: string, target: PendingTarget) => {
      const list = pendingByAuthor.get(authorId) ?? [];
      list.push(target);
      pendingByAuthor.set(authorId, list);
      if (!flushTimer) flushTimer = setTimeout(flushPending, 500);
    };

    const resolveAuthor = (authorId: string | undefined, target: PendingTarget): string => {
      if (!authorId) return "";
      if (authorId === user.id) return "You";
      const cached = getProfileFromCache(authorId);
      if (cached?.display_name) return cached.display_name;
      queueAuthor(authorId, target);
      return ""; // placeholder — patched in <500ms once batch resolves
    };

    // Lightweight unread bump: in-place setQueryData on the unread-counts
    // cache, no invalidation (which would re-run the expensive RPC fanout
    // and re-freeze Android WebView). Skips own messages and the currently
    // open thread so badges don't flash.
    const bumpUnread = (
      kind: 'team' | 'club' | 'group' | 'dm' | 'broadcast',
      targetId: string | null,
      authorId?: string,
    ) => {
      if (authorId && authorId === user.id) return;
      const path = window.location.pathname;
      if (kind === 'team' && targetId && path === `/messages/${targetId}`) return;
      if (kind === 'club' && targetId && path === `/messages/club/${targetId}`) return;
      if (kind === 'group' && targetId && path === `/groups/${targetId}`) return;
      if (kind === 'dm' && targetId && path === `/messages/dm/${targetId}`) return;
      if (kind === 'broadcast' && path === '/messages/broadcast') return;
      queryClient.setQueryData(["unread-message-counts", user.id], (old: any) => {
        if (!old) return old;
        if (kind === 'broadcast') return { ...old, broadcast: (old.broadcast ?? 0) + 1 };
        if (!targetId) return old;
        const bucket =
          kind === 'team' ? 'teams' :
          kind === 'club' ? 'clubs' :
          kind === 'group' ? 'groups' : 'dms';
        const map = { ...(old[bucket] || {}) };
        map[targetId] = (map[targetId] ?? 0) + 1;
        return { ...old, [bucket]: map };
      });
    };

    // Fail-closed authorization filter (native-light channel).
    const isAuthorized = (kind: 'team' | 'club' | 'group' | 'dm', id: string | null | undefined): boolean => {
      if (!id) return false;
      if (authStatusRef.current !== 'ready') return false;
      const set =
        kind === 'team' ? authTeamIdsRef.current :
        kind === 'club' ? authClubIdsRef.current :
        kind === 'group' ? authGroupIdsRef.current :
        authDmIdsRef.current;
      return set.has(id);
    };

    const handlers: Record<string, (payload: any) => void> = {
      team_messages: (payload: any) => {

        const row = payload.new;
        if (!isAuthorized('team', row?.team_id)) return;
        const isAnnouncement = !!(row.is_club_announcement && row.club_announcement_name);
        const author = isAnnouncement
          ? row.club_announcement_name
          : resolveAuthor(row.author_id, { kind: 'team', targetId: row.team_id });
        const teamPreview = {
          text: row.text ?? '',
          author: author || '',
          created_at: row.created_at,
          image_url: row.image_url ?? null,
          is_announcement: isAnnouncement,
        };
        // Watermark first: a query that started before this event must not
        // regress the preview when it resolves afterwards.
        previewWatermarks.note(`team:${row.team_id}`, teamPreview);
        queryClient.setQueryData(["my-teams-with-messages", user.id], (old: any) => {
          if (!old) return old;
          const prev = old.latestMessages?.[row.team_id];
          return {
            ...old,
            latestMessages: {
              ...(old.latestMessages || {}),
              [row.team_id]: {
                ...teamPreview,
                author: author || (prev?.author ?? ""),
              },
            },
          };
        });
        bumpUnread('team', row.team_id, row.author_id);
      },
      club_messages: (payload: any) => {

        const row = payload.new;
        if (!isAuthorized('club', row?.club_id)) return;
        const author = resolveAuthor(row.author_id, { kind: 'club', targetId: row.club_id });
        const clubPreview = {
          text: row.text ?? '',
          author: author || '',
          created_at: row.created_at,
          image_url: row.image_url ?? null,
        };
        previewWatermarks.note(`club:${row.club_id}`, clubPreview);
        queryClient.setQueryData(["member-clubs-with-messages", user.id], (old: any) => {
          if (!old) return old;
          const prev = old.latestMessages?.[row.club_id];
          return {
            ...old,
            latestMessages: {
              ...(old.latestMessages || {}),
              [row.club_id]: {
                ...clubPreview,
                author: author || (prev?.author ?? ""),
              },
            },
          };
        });
        bumpUnread('club', row.club_id, row.author_id);
      },
      group_messages: (payload: any) => {

        const row = payload.new;
        if (!isAuthorized('group', row?.group_id)) return;
        const author = resolveAuthor(row.author_id, { kind: 'group', targetId: row.group_id });
        const groupPreview = {
          text: row.text ?? '',
          author: author || '',
          created_at: row.created_at,
          image_url: row.image_url ?? null,
        };
        previewWatermarks.note(`group:${row.group_id}`, groupPreview);
        queryClient.setQueryData(["my-chat-groups-with-messages", user.id], (old: any) => {
          if (!old) return old;
          const prev = old.latestMessages?.[row.group_id];
          return {
            ...old,
            latestMessages: {
              ...(old.latestMessages || {}),
              [row.group_id]: {
                ...groupPreview,
                author: author || (prev?.author ?? ""),
              },
            },
          };
        });
        bumpUnread('group', row.group_id, row.author_id);
      },
      direct_messages: (payload: any) => {

        const row = payload.new;
        if (!isAuthorized('dm', row?.conversation_id)) return;
        queryClient.setQueryData(["dm-conversations", user.id], (old: any[] | undefined) => {
          if (!Array.isArray(old)) return old;
          const idx = old.findIndex((c: any) => c.id === row.conversation_id);
          if (idx === -1) return old;
          const conv = old[idx];
          const updated = {
            ...conv,
            updated_at: row.created_at,
            last_message: {
              text: row.text ?? '',
              image_url: row.image_url ?? null,
              created_at: row.created_at,
              author_id: row.author_id,
            },
          };
          const next = old.slice();
          next.splice(idx, 1);
          next.unshift(updated);
          return next;
        });
        const convs = queryClient.getQueryData<any[]>(["dm-conversations", user.id]);
        const conv = convs?.find(c => c.id === row.conversation_id);
        const otherId = conv?.other_user?.id
          ?? (conv?.participant_1 === user.id ? conv?.participant_2 : conv?.participant_1);
        if (otherId && otherId !== user.id && !conv?.other_user?.display_name) {
          resolveAuthor(otherId, { kind: 'dm', targetId: row.conversation_id });
        }
        bumpUnread('dm', row.conversation_id, row.author_id);
      },
      broadcast_messages: (payload: any) => {

        if (authStatusRef.current !== 'ready') return;
        const row = payload.new;
        queryClient.setQueryData(["latest-broadcast"], (old: any) => ({
          text: row.text ?? '',
          created_at: row.created_at,
          image_url: row.image_url ?? null,
          profiles: old?.profiles ?? null,
        }));
        bumpUnread('broadcast', null);
      },
    };

    // Native edit handling: patch the preview text in place when the edited
    // row IS the currently previewed latest message (matched on created_at).
    // Previously UPDATE events were never subscribed, so an edited message
    // kept showing its original text in the inbox.
    const patchEditedPreview = (
      key: any[],
      scope: 'team' | 'club' | 'group',
      targetId: string,
      row: any,
    ) => {
      queryClient.setQueryData(key, (old: any) => {
        const prev = old?.latestMessages?.[targetId];
        if (!prev || prev.created_at !== row.created_at) return old;
        const next = { ...prev, text: row.text ?? '', image_url: row.image_url ?? null };
        // Keep the watermark in step so a later stale response can't restore
        // the pre-edit text.
        previewWatermarks.note(`${scope}:${targetId}`, next);
        return {
          ...old,
          latestMessages: {
            ...old.latestMessages,
            [targetId]: next,
          },
        };
      });
    };

    const editHandlers: Record<string, (payload: any) => void> = {
      team_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('team', row?.team_id)) return;
        patchEditedPreview(["my-teams-with-messages", user.id], 'team', row.team_id, row);
      },
      club_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('club', row?.club_id)) return;
        patchEditedPreview(["member-clubs-with-messages", user.id], 'club', row.club_id, row);
      },
      group_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('group', row?.group_id)) return;
        patchEditedPreview(["my-chat-groups-with-messages", user.id], 'group', row.group_id, row);
      },
      direct_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('dm', row?.conversation_id)) return;
        queryClient.setQueryData(["dm-conversations", user.id], (old: any[] | undefined) => {
          if (!Array.isArray(old)) return old;
          const idx = old.findIndex((c: any) => c.id === row.conversation_id);
          if (idx === -1) return old;
          const conv = old[idx];
          if (conv?.last_message?.created_at !== row.created_at) return old;
          const next = old.slice();
          next[idx] = {
            ...conv,
            last_message: { ...conv.last_message, text: row.text ?? '', image_url: row.image_url ?? null },
          };
          return next;
        });
      },
      broadcast_messages: (payload: any) => {
        if (authStatusRef.current !== 'ready') return;
        const row = payload.new;
        queryClient.setQueryData(["latest-broadcast"], (old: any) => {
          if (!old || old.created_at !== row.created_at) return old;
          return { ...old, text: row.text ?? '', image_url: row.image_url ?? null };
        });
      },
    };


    // Buffering + exactly-once application is owned by the shared inbox
    // coordinator: events arriving before the membership snapshot resolves are
    // held (bounded) and replayed once scopes are `ready`. Fail-closed is
    // preserved — the replay runs the same `isAuthorized` check below.
    const applyEvent = (event: InboxRealtimeEvent) => {
      if (event.kind === 'edit') editHandlers[event.table]?.(event.payload);
      else handlers[event.table]?.(event.payload);
    };
    nativeInboxCoordinator.setApplier(applyEvent);
    const dispatch = (table: string, payload: any, kind: 'insert' | 'edit' = 'insert') => {
      nativeInboxCoordinator.dispatch({ table, payload, kind });
    };


    const channel = supabase
      .channel(`messages-inbox-light-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, (p: any) => dispatch('team_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'club_messages' }, (p: any) => dispatch('club_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, (p: any) => dispatch('group_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (p: any) => dispatch('direct_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast_messages' }, (p: any) => dispatch('broadcast_messages', p))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'team_messages' }, (p: any) => dispatch('team_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'club_messages' }, (p: any) => dispatch('club_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_messages' }, (p: any) => dispatch('group_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages' }, (p: any) => dispatch('direct_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'broadcast_messages' }, (p: any) => dispatch('broadcast_messages', p, 'edit'))
      .subscribe();

    const unregister = registerChannel({
      key: `messages-inbox-light-${user.id}`,
      channel,
      userId: user.id,
      scope: { kind: 'user', id: user.id },
    });

    return () => {
      unregister();
      if (flushTimer) clearTimeout(flushTimer);
      // Channel teardown: the applier closes over this effect's handlers, so
      // it must not outlive them. Buffered events are dropped with it.
      nativeInboxCoordinator.setApplier(null);
      nativeInboxCoordinator.clear();
    };

  }, [user?.id, queryClient]);

  // Force-refresh inbox previews on mount and whenever the page becomes
  // visible again. The realtime channels above can miss inserts while the
  // tab/app was backgrounded (especially on Android WebView), leaving the
  // unread badge correctly bumped by the notifications channel but the
  // preview text stuck on an older message. A cheap RPC refetch on visibility
  // brings the latest-message text in sync with the unread badge.
  useEffect(() => {
    if (!user?.id) return;
    const refreshPreviews = () => {
      // Dripped in bounded batches rather than 6 concurrent N+1 cascades —
      // firing them all at once saturated the Android WebView connection pool
      // and froze the inbox. See src/lib/chatInvalidationQueue.ts.
      queueChatInvalidation(queryClient, [
        ["my-teams-with-messages", user.id],
        ["member-clubs-with-messages", user.id],
        ["my-chat-groups-with-messages", user.id],
        ["dm-conversations", user.id],
        ["latest-broadcast"],
        ["unread-message-counts", user.id],
      ]);
    };

    // Run once on mount so the cached preview is reconciled with the server.
    refreshPreviews();
    // NATIVE: `reactQueryNativeAdapter` is the single owner of foreground
    // recovery (it refetches active queries on appStateChange). Running this
    // six-query invalidation batch as well produced overlapping refresh
    // storms that saturated the Android WebView main thread — the inbox
    // rendered but taps on conversation rows did nothing until force-quit.
    // Web/PWA keeps the visibility refresh since it has no native adapter.
    if (isNativeRuntime()) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshPreviews();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [user?.id, queryClient]);




  // Check if we have cached data to show immediately
  const hasCachedData = cachedData && (
    cachedData.teams?.length > 0 || 
    cachedData.memberClubs?.length > 0 || 
    cachedData.chatGroups?.length > 0
  );

  const hasAnyDisplayData = !!(teams?.length || memberClubs?.length || chatGroups?.length);
  // Wait for fresh latest-message data before sorting/rendering, so the most
  // recent thread is at the top on first paint (cached `lastActivity` may be
  // stale). We keep this gate even when cached data exists — otherwise the
  // cached order paints first and threads visibly shuffle once fresh
  // `lastActivity` timestamps arrive.
  // NOTE: Pro access is intentionally excluded — it's 4 serial DB trips and
  // would block first paint 200–800ms without affecting sort order. DM thread
  // visibility is the only thing it gates, and DMs settle into the already-
  // rendered list in-place (no re-sort jump) because they sort by their own
  // lastActivity alongside the rest.
  // Treat errored queries as "settled" — otherwise a network drop during the
  // initial load leaves `isFetched` false forever, and the inbox is stuck on
  // the skeleton even after coverage returns. The errored query will retry
  // on reconnect (refetchOnReconnect: "always") and rehydrate in place.
  // Offline: never wait on remote queries — they can't resolve without a
  // network, and the user-scoped cache is the authoritative thing to show.
  //
  // NATIVE STALE-ORDER FIX: `initialData` (from the user-scoped inbox cache)
  // makes React Query report `isFetched === true` before the network round
  // trip returns, so the old gate released on cached `lastActivity` values and
  // the rows visibly re-sorted a moment later. Requiring `!isFetching` as well
  // means the first reveal always happens on server-authoritative ordering.
  // Errored queries still settle (isFetching flips false), and offline/paused
  // queries also report `isFetching === false`, so neither can wedge the gate.
  const sortSources = [
    { isFetched: teamsFetched, isFetching: teamsFetching, isError: teamsError },
    { isFetched: memberClubsFetched, isFetching: memberClubsFetching, isError: memberClubsError },
    { isFetched: chatGroupsFetched, isFetching: chatGroupsFetching, isError: chatGroupsError },
    { isFetched: latestBroadcastFetched, isFetching: latestBroadcastFetching, isError: latestBroadcastError },
    { isFetched: dmFetched, isFetching: dmFetching, isError: dmError },
  ];
  const sortSourcesSettled = areInboxSortSourcesSettled(sortSources);

  // Hard ceiling: never hold the skeleton longer than this, even if one query
  // is pathologically slow. Order may correct in place after this point, but
  // the inbox is guaranteed to paint.
  const [sortGateExpired, setSortGateExpired] = useState(false);
  useEffect(() => {
    if (sortSourcesSettled) return;
    const t = window.setTimeout(() => setSortGateExpired(true), 3500);
    return () => window.clearTimeout(t);
  }, [sortSourcesSettled]);

  // FIRST-REVEAL LATCH.
  // `sortSourcesSettled` depends on `isFetching`, which flips true again for
  // every ordinary background/Realtime refetch. Using it directly as the
  // permanent render decision made the whole inbox collapse back to the
  // full-page skeleton after resume or when a new message arrived. The
  // ordering gate must therefore apply *only until* the first settled reveal;
  // afterwards refetching is non-blocking and rows are patched in place.
  const hasRevealedStableInboxRef = useRef(sessionRevealedInboxUserId === user?.id && !!user?.id);
  const [hasRevealedStableInbox, setHasRevealedStableInbox] = useState(hasRevealedStableInboxRef.current);

  // Reset only on a genuine identity change (a new mount starts false anyway).
  const revealLatchIdentityRef = useRef<string | undefined>(user?.id);
  if (revealLatchIdentityRef.current !== user?.id) {
    revealLatchIdentityRef.current = user?.id;
    hasRevealedStableInboxRef.current = sessionRevealedInboxUserId === user?.id && !!user?.id;
  }

  // WARM-MOUNT CACHE FIX. The ordering gate must only ever apply to the very
  // first inbox reveal of the session. Previously the latch lived in a mount
  // ref, so every warm re-entry to /messages started false again — and because
  // the inbox queries use `refetchOnMount`, `isFetching` was true on that mount,
  // which held the full-page skeleton and ignored the cached rows we already
  // had. The latch is now session-scoped per user, so warm re-entry paints from
  // cache immediately and patches in place.
  //
  // STALE-ORDER FIX: the cached-data bypass must NOT also be applied to the
  // session's *first* reveal. Cached rows carry stale `lastActivity` /
  // `created_at` values, so releasing the gate merely because a cache exists
  // painted an intermediate ordering that visibly re-sorted the moment the
  // authoritative previews arrived (the Android reload/resume jolt). Online
  // cold starts therefore wait for authoritative ordering, bounded by
  // `sortGateExpired` (and `isLoadingFreshData` still consults the cache, so
  // a cached inbox never waits on the *loading* half of the gate). Offline is
  // excluded entirely by the leading `isOnline`, so the cached inbox is still
  // revealed instantly with no network.
  const {
    isLoadingFreshData,
    initialRevealBlocked,
    showSkeletonLoading,
  } = resolveInboxRevealPolicy({
    isOnline,
    hasAnyDisplayData,
    hasCachedData: !!hasCachedData,
    hasLoadingSource: !!(teamsLoading || memberClubsLoading || chatGroupsLoading || isLoadingClubProStatus),
    sortSources,
    sortGateExpired,
    hasRevealedStableInbox: hasRevealedStableInboxRef.current,
  });


  useEffect(() => {
    if (hasRevealedStableInboxRef.current) return;
    if (initialRevealBlocked) return;
    hasRevealedStableInboxRef.current = true;
    if (user?.id) sessionRevealedInboxUserId = user.id;
    setHasRevealedStableInbox(true);
  }, [initialRevealBlocked, user?.id]);

  useEffect(() => {
    if (hasRevealedStableInbox && !hasRevealedStableInboxRef.current) {
      setHasRevealedStableInbox(false);
    }
  }, [hasRevealedStableInbox, user?.id]);

  // Resume/reconnect stability: an inbox source query can transiently resolve
  // to undefined/[] while it is refetching or errored (auth refresh, RLS
  // settling, dropped socket). Retain the last non-empty result until the query
  // settles successfully — a settled empty result is still authoritative, so
  // removed/purged conversations do not linger.
  // A successful empty `user_roles` response can be a transient false-negative
  // while the native auth token is rotating on resume. The independently
  // resolved bootstrap membership list corroborates whether that empty result
  // is authoritative before we release a retained team snapshot.
  const teamsEmptyCorroborated =
    teams.length > 0 ||
    !bootstrapQ.data ||
    bootstrapQ.data.member_team_ids.length === 0;
  const stickyTeams = useStickyList<any>(teams, {
    isFetching: teamsFetching,
    isFetched: teamsFetched && teamsEmptyCorroborated,
    isError: teamsError,
    resetKey: user?.id ?? null,
  });
  const stickyMemberClubs = useStickyList<any>(memberClubs, {
    isFetching: memberClubsFetching,
    isFetched: memberClubsFetched,
    isError: memberClubsError,
    resetKey: user?.id ?? null,
  });
  const stickyChatGroups = useStickyList<any>(chatGroups, {
    isFetching: chatGroupsFetching,
    isFetched: chatGroupsFetched,
    isError: chatGroupsError,
    resetKey: user?.id ?? null,
  });

  // Determine which data to display (prefer fresh, fallback to cached).
  // Cached rows are also used while a source query has not yet completed its
  // first fetch for this mount (`!isFetched`) — that's what makes a warm inbox
  // open paint instantly instead of showing an empty list. A *settled* empty
  // online result stays authoritative.
  const displayTeams = resolveInboxDisplayList({
    sticky: stickyTeams,
    cached: cachedData?.teams,
    isOnline,
    isFetched: teamsFetched,
  });
  const displayMemberClubs = resolveInboxDisplayList({
    sticky: stickyMemberClubs,
    cached: cachedData?.memberClubs,
    isOnline,
    isFetched: memberClubsFetched,
  });
  const displayAdminClubs = adminClubs || cachedData?.adminClubs || [];
  // Important: an empty fresh chat-group result is authoritative *while
  // online*. Falling back to cached groups when `chatGroups.length === 0`
  // kept soft-deleted/purged club chats visible forever after the server
  // correctly returned no rows. Offline, an empty/failed result carries no
  // authority, so cached rows stay visible.
  const allChatGroups = resolveInboxDisplayList({
    sticky: stickyChatGroups,
    cached: cachedData?.chatGroups,
    isOnline,
    isFetched: chatGroupsFetched,
  });


  
  // Filter chat groups by user's roles
  const displayChatGroups = useMemo(() => filterInboxGroupsByVisibility({
    groups: allChatGroups,
    roles: userAllRoles,
    leagueIds: userLeagueIds,
    isAppAdmin: !!isAppAdmin,
    isCommitteeMember: !!isCommitteeMember,
    isOnline,
  }), [allChatGroups, userAllRoles, userLeagueIds, isAppAdmin, isCommitteeMember, isOnline]);

  const displayLatestBroadcast = latestBroadcast || cachedData?.latestBroadcast;
  const displayLatestTeamMessages = latestTeamMessages || {};
  const displayLatestClubMessages = latestClubMessages || {};
  const displayLatestGroupMessages = latestGroupMessages || {};

  const displayClubsWithAnnouncements = displayMemberClubs;

  const { hasAdminRole: hasAdminRoleForGroups, canCreateGroups } = resolveInboxGroupCreationCapability({
    adminTeamCount: adminTeamIds?.length || 0,
    adminClubCount: adminClubs?.length || 0,
    isAppAdmin: !!isAppAdmin,
    isCommitteeMember: !!isCommitteeMember,
    hasAnyProAccess,
  });

  // Filter all items based on search query and active club filter
  const query = normalizeInboxSearchQuery(searchQuery);

  // Separate league chats from regular chat groups
  const { leagueChats, regularChatGroups } = useMemo(
    () => partitionInboxGroups(displayChatGroups),
    [displayChatGroups],
  );

  // Personal/custom groups (membership-based, no club/team/league/competition scope).
  const personalGroupIds = useMemo(
    () => collectPersonalGroupIds(regularChatGroups),
    [regularChatGroups]
  );

  // Other-user ids across all DM conversations (used to test club membership).
  const dmOtherUserIds = useMemo(
    () => collectDirectMessagePeerIds(dmConversations || [], user?.id),
    [dmConversations, user?.id]
  );

  // When a club filter is active, look up which DM peers and which
  // personal-group members hold any user_role under the selected club.
  // RLS already allows visibility to club co-members.
  const { data: clubScopeFilterData } = useQuery({
    queryKey: [
      "messages-club-scope-filter",
      user?.id,
      effectiveClubFilter,
      personalGroupIds.join(","),
      dmOtherUserIds.join(","),
    ],
    enabled: !!user && !!effectiveClubFilter && (personalGroupIds.length > 0 || dmOtherUserIds.length > 0),
    staleTime: 60_000,
    queryFn: () => fetchInboxClubScopeFilter({
      userId: user!.id,
      clubId: effectiveClubFilter!,
      personalGroupIds,
      dmOtherUserIds,
    }),
  });

  const clubScopedUsersInClub = clubScopeFilterData?.usersInClub;
  const clubScopedGroupMembers = clubScopeFilterData?.groupMembersMap;



  const filteredLeagueChats = useMemo(() => filterInboxLeagueChats({
    groups: leagueChats,
    query,
    clubId: effectiveClubFilter,
  }), [leagueChats, query, effectiveClubFilter]);

  const filteredChatGroups = useMemo(() => filterInboxChatGroups({
    groups: regularChatGroups,
    query,
    effectiveClubId: effectiveClubFilter,
    activeClubId: activeClubFilter,
    activeClubTeamIds,
    displayedTeams: displayTeams,
    hiddenGroupMap,
    latestGroupMessages: displayLatestGroupMessages,
    competitionClubMap,
    groupMembersMap: clubScopedGroupMembers,
    usersInClub: clubScopedUsersInClub,
    currentUserId: user?.id,
  }), [regularChatGroups, query, effectiveClubFilter, activeClubFilter, activeClubTeamIds, displayTeams, hiddenGroupMap, displayLatestGroupMessages, competitionClubMap, clubScopedGroupMembers, clubScopedUsersInClub, user?.id]);

  const filteredTeams = useMemo(() => filterInboxTeams({
    teams: displayTeams,
    query,
    effectiveClubId: effectiveClubFilter,
    activeClubId: activeClubFilter,
    activeClubTeamIds,
  }), [displayTeams, query, effectiveClubFilter, activeClubFilter, activeClubTeamIds]);

  const filteredClubs = useMemo(() => filterInboxClubs({
    clubs: displayClubsWithAnnouncements,
    query,
    clubId: effectiveClubFilter,
  }), [displayClubsWithAnnouncements, query, effectiveClubFilter]);

  const showBroadcast = !query || "announcements".includes(query);

  // Live drafts (unsent text in any chat composer)
  const allDrafts = useAllChatDrafts();

  // Offline fallback: when the DM query errors (no network), React Query drops
  // the placeholder and `dmConversations` is undefined. Rebuild the list from
  // the user-scoped cache so saved conversations stay selectable offline.
  const offlineCachedDMs = useMemo(() => {
    return hydrateCachedDirectMessages({
      conversations: cachedData?.dmConversations,
      latestMessages: cachedData?.latestDMMessages,
      currentUserId: user?.id,
    });
  }, [cachedData, user?.id]);

  // Resume stability: keep the last non-empty DM list while the query is
  // refetching/errored so rows do not blink out of the inbox.
  const stickyDMConversations = useStickyList<any>(dmConversations as any[] | undefined, {
    isFetching: dmFetching,
    isFetched: dmFetched,
    isError: dmError,
    resetKey: user?.id ?? null,
  });

  const effectiveDMConversations = useMemo(() => {
    return resolveEffectiveDirectMessages({
      sticky: stickyDMConversations as any[] | undefined,
      offlineCached: offlineCachedDMs,
      isOnline,
    });
  }, [stickyDMConversations, isOnline, offlineCachedDMs]);

  // Filtered DM conversations
  // Hide empty DMs (no messages exchanged) from the list — these are stub
  // conversation rows that get created when someone opens a DM thread without
  // sending anything. They'd otherwise float to the top via `updated_at`.
  const filteredDMs = useMemo(() => filterInboxDirectMessages({
    conversations: effectiveDMConversations,
    query,
    drafts: allDrafts,
    hiddenMap: hiddenDMMap,
    effectiveClubId: effectiveClubFilter,
    usersInClub: clubScopedUsersInClub,
    isSupportUser: isIgniteSupportUser,
  }), [effectiveDMConversations, hiddenDMMap, query, allDrafts, effectiveClubFilter, clubScopedUsersInClub]);


  // Check if Ignite Support should show
  const showIgniteSupport = systemMessage && (!query || "ignite support".includes(query));

  // Build unified conversation list
  const freshUnifiedConversations = useMemo(() => buildUnifiedInboxConversations({
    showBroadcast,
    latestBroadcast: displayLatestBroadcast,
    clubs: filteredClubs,
    teams: filteredTeams,
    leagueChats: filteredLeagueChats,
    chatGroups: filteredChatGroups,
    directMessages: filteredDMs,
    adminConversations: clubAdminConversations,
    latestClubMessages: displayLatestClubMessages,
    latestTeamMessages: displayLatestTeamMessages,
    latestGroupMessages: displayLatestGroupMessages,
    unreadCounts,
    realtimeGroupUnread: groupUnreadCache,
    muted: mutedChats,
    clubProStatuses: clubProStatus,
    isClubProLoading: isLoadingClubProStatus,
    isClubProFetching: isFetchingClubProStatus,
    isAppAdmin: !!isAppAdmin,
    query,
    currentUserId: user?.id,
    showSupport: !!showIgniteSupport,
    systemMessage,
    drafts: allDrafts,
    isSupportUser: isIgniteSupportUser,
  }), [
    showBroadcast, displayLatestBroadcast, unreadCounts, groupUnreadCache,
    filteredClubs, displayLatestClubMessages, isLoadingClubProStatus, isFetchingClubProStatus, clubProStatus, mutedChats,
    filteredTeams, displayLatestTeamMessages,
    filteredLeagueChats, filteredChatGroups, displayLatestGroupMessages,
    filteredDMs, clubAdminConversations, query, user?.id, showIgniteSupport, systemMessage, allDrafts, isAppAdmin,
  ]);

  // Keep the final authorised read model coherent across native resume and
  // background refetches. Individual sticky source arrays are insufficient:
  // a derived role/filter input can settle one render before another source
  // and temporarily remove an otherwise retained row. Only publish the fresh
  // model once the complete ordering/source set is settled; a settled empty
  // model remains authoritative, so real deletions and permission removals
  // are never retained indefinitely.
  const unifiedConversations = useStableInboxReadModel(freshUnifiedConversations, {
    authoritative: !isOnline || (
      sortSourcesSettled &&
      !isAppAdminFetching &&
      !isCommitteeMemberFetching &&
      !userAllRolesFetching &&
      !userLeagueIdsFetching
    ),
    resetKey: user?.id
      ? `${user.id}:${effectiveClubFilter ?? "all"}:${query}`
      : null,
  });

  // Perf: log inbox open latency once when the first meaningful list is ready.
  const perfLoggedRef = useRef(false);
  useEffect(() => {
    if (perfLoggedRef.current) return;
    if (!user?.id) return;
    // "First paint" = we actually have rows to render, OR every source query
    // has resolved (empty inbox is a valid state).
    const listReady = unifiedConversations.length > 0
      || (teamsFetched && memberClubsFetched && chatGroupsFetched && dmFetched && latestBroadcastFetched);
    if (!listReady) return;
    perfLoggedRef.current = true;
    // Attribute notification-tap opens: if a notif_tap mark fired within 10s
    // of this inbox mount, treat this as source="notification" so we can
    // separate push-tap latency from warm/cold navigation.
    let inboxSource: "warm_nav" | "cold_open" | "notification" =
      cachedData ? "warm_nav" : "cold_open";
    try {
      const snap = snapshotStages();
      const notifTap = snap.deltas.notif_tap;
      const inboxMount = snap.deltas.inbox_mount;
      if (
        typeof notifTap === "number" &&
        typeof inboxMount === "number" &&
        inboxMount >= notifTap &&
        inboxMount - notifTap < 10_000
      ) {
        inboxSource = "notification";
      }
    } catch {}
    if (inboxFirstPaintTsRef.current === null) {
      inboxFirstPaintTsRef.current = Date.now();
    }
    void logInboxOpenLatency({
      userId: user.id,
      source: inboxSource,
      startTs: inboxOpenStartRef.current,
      cacheHit: !!cachedData,
      bootstrapEnabled: isMessagesBootstrapEnabled(),
      mountTs: inboxMountTsRef.current,
      bootstrapReturnTs: inboxBootstrapReturnTsRef.current,
      firstPaintTs: inboxFirstPaintTsRef.current,
      primaryClubId: (memberClubs?.[0] as any)?.id ?? null,
      sectionCounts: {
        teams: filteredTeams.length,
        clubs: filteredClubs.length,
        groups: filteredChatGroups.length + filteredLeagueChats.length,
        dms: filteredDMs.length,
        total: unifiedConversations.length,
      },
    });
  }, [unifiedConversations, user?.id, cachedData, teamsFetched, memberClubsFetched, chatGroupsFetched, dmFetched, latestBroadcastFetched, filteredTeams.length, filteredClubs.length, filteredChatGroups.length, filteredLeagueChats.length, filteredDMs.length]);




  // Resolve event titles referenced in any conversation preview so they
  // display the actual event name instead of a generic "Event" placeholder.
  const {
    eventIds: referencedEventIds,
    vaultFolderIds: referencedVaultFolderIds,
    vaultFileIds: referencedVaultFileIds,
  } = useMemo(
    () => collectInboxPreviewReferences(unifiedConversations),
    [unifiedConversations],
  );

  const { data: eventTitleMap = {} } = useQuery({
    queryKey: ["messages-page-event-titles", referencedEventIds.join(",")],
    queryFn: () => fetchInboxEventTitleMap(referencedEventIds),
    enabled: referencedEventIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vaultFolderNameMap = {} } = useQuery({
    queryKey: ["messages-page-vault-folder-names", referencedVaultFolderIds.join(",")],
    queryFn: () => fetchInboxVaultFolderNameMap(referencedVaultFolderIds),
    enabled: referencedVaultFolderIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vaultFileNameMap = {} } = useQuery({
    queryKey: ["messages-page-vault-file-names", referencedVaultFileIds.join(",")],
    queryFn: () => fetchInboxVaultFileNameMap(referencedVaultFileIds),
    enabled: referencedVaultFileIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Apply type filter chip (teams/groups/dms/club/league/all).
  // Ignite Support remains visible regardless of chip. Broadcasts are shown
  // only in the unfiltered inbox, matching the existing chip behavior.
  const typeFilteredConversations = useMemo(
    () => filterInboxConversations(unifiedConversations, typeFilter),
    [unifiedConversations, typeFilter],
  );

  // Split into unread and recent
  const { unread: unreadItems, recent: recentItems } = useMemo(
    () => partitionInboxByReadState(typeFilteredConversations),
    [typeFilteredConversations],
  );

  // Mark first non-empty render for perf diagnostics (one-shot).
  // Progressive disclosure for operational groups: when a user has many
  // stale group/league chats, collapse the long tail behind a "Show more
  // groups" toggle. Only kicks in for power users — regular parents with
  // only a few groups see no change.
  const { visibleRecent, hiddenOps } = useMemo(
    () => resolveOperationalConversationDisclosure(recentItems, {
      now: Date.now(),
      showAll: showAllOps,
      typeFilter,
      hasSearchQuery: !!query,
    }),
    [recentItems, showAllOps, typeFilter, query],
  );


  const { hasNoResults, hasNoMessages } = resolveInboxEmptyState({
    query,
    unifiedConversationCount: unifiedConversations.length,
    teamCount: displayTeams.length,
    memberClubCount: displayMemberClubs.length,
    visibleGroupCount: displayChatGroups.length,
    directMessageCount: filteredDMs.length,
  });

  // If a specific club is in scope (active club theme or local filter), use that
  // club's Pro status — otherwise fall back to the global "any Pro" check. This
  // prevents the upgrade banner from showing for admins of a Pro club just
  // because they also belong to a Free club elsewhere.
  // Treat Pro access as unknown until both queries have actually returned data.
  // The clubProStatus query is `enabled` only after memberClubIds resolves, so
  // its loading flags can briefly be false-without-data on first render after
  // login (especially noticeable on iOS WebView resume) — without this guard
  // the upgrade banner flashes for admins of a Pro club. Mirrors the lock
  // logic at line ~1394.
  const { scopedClubIsPro, hasAdminRoleButNoPro, upgradeClubId } = resolveInboxUpgradePresentation({
    effectiveClubId: effectiveClubFilter,
    clubProStatuses: clubProStatus,
    hasAnyProAccess,
    isProAccessLoading: isLoadingProAccess,
    isProAccessFetching: isFetchingProAccess,
    isClubProLoading: isLoadingClubProStatus,
    isClubProFetching: isFetchingClubProStatus,
    adminTeamCount: adminTeamIds?.length || 0,
    adminClubs: displayAdminClubs,
    memberClubs: displayMemberClubs,
    isAppAdmin: !!isAppAdmin,
  });

  // Type label map
  const typeLabels: Record<string, string> = {
    club: 'Club',
    team: 'Team',
    group: 'Group',
    admin_group: 'Admin',
    league: 'League',
    dm: 'DM',
  };

  // Stable hide-callbacks so memoized rows don't invalidate on parent re-renders.
  const hideDMRef = useRef(hideDMMutation);
  hideDMRef.current = hideDMMutation;
  const hideGroupRef = useRef(hideGroupMutation);
  hideGroupRef.current = hideGroupMutation;
  const onHideDM = useMemo(() => (id: string) => hideDMRef.current.mutate(id), []);
  const onHideGroup = useMemo(() => (id: string) => hideGroupRef.current.mutate(id), []);

  // Render a unified conversation card — thin wrapper around the memoized
  // ConversationRow component. Keeping the function preserves all existing
  // call sites; the actual render path is memoized per-item so unrelated
  // inbox refreshes (polling, realtime ticks) no longer re-render every row.
  const renderConversationCard = (item: UnifiedConversation) => {
    const typeLabel = typeLabels[item.type];
    return (
      <ConversationRow
        key={item.key}
        item={item}
        currentUserId={user?.id}
        typeLabel={typeLabel}
        accentStyle={typeAccentStyle(item.type)}
        badgeStyle={typeBadgeStyle(item.type)}
        eventTitleMap={eventTitleMap}
        vaultFolderNameMap={vaultFolderNameMap}
        vaultFileNameMap={vaultFileNameMap}
        onHideDM={onHideDM}
        onHideGroup={onHideGroup}
      />
    );
  };

  return (
    <div className="py-4 space-y-4">

      {!isOnline && (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>You're offline — showing saved conversations.</span>
        </div>
      )}

      {/* Header with search and create group */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Messages</h1>
          {isLoadingFreshData && hasCachedData && (
            <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {(!activeClubFilter && displayMemberClubs.length > 1) && (
            <Button
              variant={hasLocalFilter ? "default" : "outline"}
              size="icon"
              onClick={() => {
                if (hasLocalFilter) {
                  setLocalClubFilter("all");
                } else {
                  setShowClubFilterDrawer(true);
                }
              }}
              className="relative"
              aria-label="Filter"
            >
              <Filter className="h-4 w-4" />
              {hasLocalFilter && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
              )}
            </Button>
          )}

          {aiCatchUpResolved && hasAICatchUpClub && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowGlobalRecap(true)}
              className="h-10 w-10 relative"
              aria-label="Recap all chats"
              title="Recap all unread chats"
            >
              <Sparkles className="h-5 w-5" />
            </Button>
          )}


          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate("/scheduled-messages")}
            className="h-10 w-10"
            aria-label="Scheduled messages"
            title="Scheduled messages"
          >
            <Clock className="h-5 w-5" />
          </Button>
          <CreateActionButton
            ariaLabel="New message"
            onClick={() => setShowNewMessageSheet(true)}
          />
        </div>
      </div>

      <QueryErrorBanner
        hasError={!!(teamsError || memberClubsError || chatGroupsError)}
        onRetry={async () => {
          await queryClient.refetchQueries({ type: "all", stale: false, predicate: (q) => q.state.status === "error" });
        }}
        message="Couldn't load chats. Tap to retry."
      />

      <GlobalChatRecapSheet
        open={showGlobalRecap}
        onOpenChange={setShowGlobalRecap}
        scopes={(unifiedConversations
          .filter((c) =>
            c.unreadCount > 0 &&
            !c.isLocked &&
            (c.type === "team" || c.type === "club" || c.type === "group" || c.type === "league" || c.type === "dm")
          )
          .map((c): RecapScopeRef => ({
            scope_type: (c.type === "team"
              ? "team"
              : c.type === "club"
              ? "club"
              : c.type === "dm"
              ? "direct"
              : "group") as RecapScopeRef["scope_type"],
            scope_id: c.id,
            name: c.name,
            link: c.link,
            unreadCount: c.unreadCount,
            typeLabel: c.type,
          })))}
      />






      {/* New message + group-type bottom sheets */}
      <NewMessageSheet
        open={showNewMessageSheet}
        onOpenChange={setShowNewMessageSheet}
        canCreateGroups={!!canCreateGroups}
        hasAdminRoleForGroups={hasAdminRoleForGroups}
        hasPro={effectiveClubFilter ? scopedClubIsPro === true : !!hasAnyProAccess}
        isAppAdmin={!!isAppAdmin}
        upgradeClubId={upgradeClubId}
        onPickDM={() => setShowDMDialog(true)}
        onPickGroup={() => setShowGroupTypeSheet(true)}
      />
      {canCreateGroups && (
        <NewGroupTypeSheet
          open={showGroupTypeSheet}
          onOpenChange={setShowGroupTypeSheet}
          onPickRole={() => {
            setGroupDialogType("role");
            setShowGroupDialog(true);
          }}
          onPickTeam={() => {
            setGroupDialogType("team");
            setShowGroupDialog(true);
          }}
          onPickCustom={() => setShowCustomGroupDialog(true)}
        />
      )}

      {/* DM and Group dialogs — DM creation is Pro-gated */}
      {(!!hasAnyProAccess || !!isAppAdmin) && (
        <StartDMDialog open={showDMDialog} onOpenChange={setShowDMDialog} mode="dm" />
      )}
      {canCreateGroups && (
        <StartDMDialog
          open={showCustomGroupDialog}
          onOpenChange={setShowCustomGroupDialog}
          mode="custom-group"
        />
      )}
      {canCreateGroups && (
        <CreateGroupDialog
          open={showGroupDialog}
          onOpenChange={setShowGroupDialog}
          groupType={groupDialogType}
        />
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search messages..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Pro upgrade banner for non-Pro admin users — compact, benefit-led */}
      {hasAdminRoleButNoPro && (
        <Card className="border-primary/10 bg-primary/[0.03] overflow-hidden">
          <CardContent className="py-1.5 px-3">
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className="text-[9px] px-1.5 py-0 h-4 font-bold uppercase tracking-wider bg-primary/10 text-primary border-0 leading-none shrink-0"
              >
                PRO
              </Badge>
              <p className="font-bold text-sm leading-tight whitespace-nowrap">
                Unlock Unlimited Club Messaging
              </p>
              <button
                type="button"
                onClick={() => {
                  if (upgradeClubId) {
                    navigate(`/clubs/${upgradeClubId}/upgrade`);
                  } else if (adminTeamIds?.length && adminTeamIds[0]) {
                    navigate(`/teams/${adminTeamIds[0]}/upgrade`);
                  } else {
                    navigate("/clubs");
                  }
                }}
                className="ml-auto shrink-0 text-xs font-semibold text-primary hover:underline"
              >
                Upgrade →
              </button>
            </div>
            <p className="mt-1 text-[11px] text-foreground/60 leading-snug">
              📢 Club Chats · 📷 Photos · 📁 Files · 📊 Polls
            </p>
          </CardContent>
        </Card>
      )}

      {/* Lightweight type filter chips. Only chips for types the user actually
          has appear, keeping the inbox uncluttered for simple users. Gated on
          ALL inbox queries having resolved so chips pop in together instead of
          Teams → Groups → DMs appearing one-by-one as each query finishes. */}
      {(!isOnline || ((teamsFetched || teamsError) && (memberClubsFetched || memberClubsError) && (chatGroupsFetched || chatGroupsError) && (dmFetched || dmError))) && (() => {
        const counts = { teams: 0, groupish: 0, dms: 0 };
        const unread = { teams: 0, groupish: 0, dms: 0 };
        unifiedConversations.forEach((c) => {
          const u = c.unreadCount || 0;
          if (c.type === 'team' || c.type === 'league') { counts.teams++; unread.teams += u; }
          else if (c.type === 'group' || c.type === 'club' || c.type === 'admin_group') { counts.groupish++; unread.groupish += u; }
          else if (c.type === 'dm') { counts.dms++; unread.dms += u; }
        });
        const totalUnread = unread.teams + unread.groupish + unread.dms;
        const chips: { id: typeof typeFilter; label: string; visible: boolean; type?: string; unread: number }[] = [
          { id: 'all', label: 'All', visible: true, unread: totalUnread },
          { id: 'teams', label: 'Teams', visible: counts.teams > 0, type: 'team', unread: unread.teams },
          { id: 'groups', label: 'Groups', visible: counts.groupish > 0, type: 'group', unread: unread.groupish },
          { id: 'dms', label: 'DMs', visible: counts.dms > 0, type: 'dm', unread: unread.dms },
        ];
        const shown = chips.filter(c => c.visible);
        // Show chips for power users (>6 threads) OR whenever there are
        // unread messages anywhere — so users can instantly see where the
        // unread badge they saw on the tab is hiding.
        if (totalUnread === 0 && unifiedConversations.length <= 6) return null;
        if (shown.length <= 2) return null;

        // Contextual nudge: current filter is empty of unread but another
        // bucket has some — point the user there.
        const currentUnread = chips.find(c => c.id === typeFilter)?.unread ?? 0;
        const elsewhere = chips
          .filter(c => c.id !== 'all' && c.id !== typeFilter && c.unread > 0)
          .sort((a, b) => b.unread - a.unread);
        const showBanner = typeFilter !== 'all' && currentUnread === 0 && elsewhere.length > 0;
        const banner = showBanner ? elsewhere[0] : null;

        return (
          <>
            <div className="-mx-4 px-4 mt-1 mb-1 overflow-x-auto scrollbar-none">
              <div className="flex items-center gap-2 py-1">
                {shown.map((chip) => {
                  const active = typeFilter === chip.id;
                  const accent = chip.type ? TYPE_ACCENT_HSL[chip.type] : undefined;
                  const activeStyle: React.CSSProperties | undefined = active && accent
                    ? { backgroundColor: `hsl(${accent} / 0.14)`, color: `hsl(${accent})`, borderColor: `hsl(${accent} / 0.45)` }
                    : undefined;
                  const showCount = chip.unread > 0;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setTypeFilter(chip.id)}
                      style={activeStyle}
                      aria-pressed={active}
                      aria-label={showCount ? `${chip.label}, ${chip.unread} unread` : chip.label}
                      className={`shrink-0 inline-flex items-center gap-2 px-4 h-10 min-h-[40px] rounded-full text-sm border transition-colors touch-manipulation ${
                        active
                          ? `font-semibold ${accent ? '' : 'bg-primary text-primary-foreground border-primary'}`
                          : `${showCount ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'} bg-background border-border hover:text-foreground`
                      }`}
                    >
                      <span>{chip.label}</span>
                      {showCount && (
                        chip.unread === 1 ? (
                          <span className="h-2 w-2 rounded-full bg-destructive" />
                        ) : (
                          <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center leading-none">
                            {chip.unread > 99 ? '99+' : chip.unread}
                          </span>
                        )
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {banner && (
              <button
                type="button"
                onClick={() => setTypeFilter(banner.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/5 text-left touch-manipulation"
              >
                <span className="text-[13px] text-foreground">
                  You have <span className="font-semibold">{banner.unread}</span> unread message{banner.unread === 1 ? '' : 's'} in <span className="font-semibold">{banner.label}</span>
                </span>
                <span className="shrink-0 text-[12px] font-semibold text-destructive">
                  View {banner.label} →
                </span>
              </button>
            )}
          </>
        );
      })()}

      {/* Active club filter indicator */}
      {hasLocalFilter && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1">
            <Building2 className="h-3 w-3" />
            {displayMemberClubs.find((c: any) => c.id === localClubFilter)?.name || "Club"}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => setLocalClubFilter("all")} className="h-7 px-2 text-xs text-muted-foreground">
            Clear
          </Button>
        </div>
      )}

      {/* Club filter drawer */}
      <Drawer open={showClubFilterDrawer} onOpenChange={setShowClubFilterDrawer}>
        <DrawerContent>
          <DrawerHeader className="text-left border-b">
            <DrawerTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Filter by Club
            </DrawerTitle>
          </DrawerHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-4 space-y-2">
              <button
                type="button"
                onClick={() => { setLocalClubFilter("all"); setShowClubFilterDrawer(false); }}
                className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left hover:bg-accent/50 ${
                  localClubFilter === "all" ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <span className="text-base font-medium">All Clubs</span>
                {localClubFilter === "all" && <Check className="h-5 w-5 text-primary" />}
              </button>
              {displayMemberClubs.map((club: any) => (
                <button
                  key={club.id}
                  type="button"
                  onClick={() => { setLocalClubFilter(club.id); setShowClubFilterDrawer(false); }}
                  className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left hover:bg-accent/50 ${
                    localClubFilter === club.id ? "border-primary bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <span className="text-base font-medium">{club.name}</span>
                  {localClubFilter === club.id && <Check className="h-5 w-5 text-primary" />}
                </button>
              ))}
            </div>
          </ScrollArea>
        </DrawerContent>
      </Drawer>

      {/* Unified Messages List */}
      <div className="space-y-2">
        {/* Skeleton loading when no cache available */}
        {showSkeletonLoading && (
          <>
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
          </>
        )}

        {/*
          Inbox rendering.

          For short inboxes (≤ VIRTUALIZE_THRESHOLD rows) or the bucketed
          Groups-filter view, we render the original flat / sectioned markup.
          For long inboxes we flatten Unread + Recent into a typed row list
          and hand it to Virtuoso in `useWindowScroll` mode so off-screen
          conversation cards never mount. The Groups sectioned layout stays
          on the legacy path because it's a power-user view with internal
          sub-headers — virtualizing it adds complexity for marginal gain.
        */}
        {(() => {
          if (showSkeletonLoading) return null;

          // Virtualization disabled — Virtuoso `useWindowScroll` miscomputed
          // the viewport inside the app's scrollable main container, which
          // clipped the inbox to ~12 rows and hid the sections beneath
          // (Discover groups, Contact Club, sponsor carousel). Render the
          // full legacy list until we move to a scroll-parent virtualizer.
          const VIRTUALIZE_THRESHOLD = Number.POSITIVE_INFINITY;
          const useGroupSections =
            typeFilter === 'groups' && visibleRecent.length >= 5;
          const totalRows = unreadItems.length + visibleRecent.length;
          const shouldVirtualize = !useGroupSections && totalRows > VIRTUALIZE_THRESHOLD;

          type FlatRow =
            | { kind: 'unread-header'; key: string; count: number }
            | { kind: 'recent-header'; key: string; withDivider: boolean }
            | { kind: 'card'; key: string; item: UnifiedConversation }
            | { kind: 'show-more-ops'; key: string; count: number };

          if (shouldVirtualize) {
            const rows: FlatRow[] = [];
            if (unreadItems.length > 0) {
              rows.push({ kind: 'unread-header', key: '__unread_header', count: unreadItems.length });
              unreadItems.forEach((item) => rows.push({ kind: 'card', key: `u:${item.key}`, item }));
            }
            if (visibleRecent.length > 0) {
              rows.push({
                kind: 'recent-header',
                key: '__recent_header',
                withDivider: unreadItems.length > 0,
              });
              visibleRecent.forEach((item) => rows.push({ kind: 'card', key: `r:${item.key}`, item }));
            }
            if (hiddenOps.length > 0) {
              rows.push({ kind: 'show-more-ops', key: '__more_ops', count: hiddenOps.length });
            }

            return (
              <Virtuoso
                useWindowScroll
                data={rows}
                computeItemKey={(_i, row) => row.key}
                increaseViewportBy={{ top: 600, bottom: 800 }}
                itemContent={(_i, row) => {
                  if (row.kind === 'unread-header') {
                    return (
                      <div className="flex items-center gap-2 pb-1.5 mb-2">
                        <span className="text-[13px] font-bold uppercase tracking-wide text-foreground">Unread</span>
                      </div>
                    );
                  }
                  if (row.kind === 'recent-header') {
                    return (
                      <div
                        className={`flex items-center gap-2 pb-1.5 mb-2 ${
                          row.withDivider ? 'pt-5 border-t border-border/50 mt-3' : ''
                        }`}
                      >
                        <span className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
                          Recent
                        </span>
                      </div>
                    );
                  }
                  if (row.kind === 'show-more-ops') {
                    return (
                      <button
                        type="button"
                        onClick={() => setShowAllOps(true)}
                        className="w-full mt-1 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md border border-dashed border-border hover:border-foreground/40"
                      >
                        Show {row.count} more inactive group{row.count === 1 ? '' : 's'}
                      </button>
                    );
                  }
                  // card
                  return <div className="mb-2">{renderConversationCard(row.item)}</div>;
                }}
              />
            );
          }

          // Legacy non-virtualized rendering (short inbox or Groups-sectioned view).
          return (
            <>
              {unreadItems.length > 0 && (
                <>
                  <div className="flex items-center gap-2 pb-1.5">
                    <span className="text-[13px] font-bold uppercase tracking-wide text-foreground">Unread</span>
                  </div>
                  {unreadItems.map(renderConversationCard)}
                </>
              )}

              {recentItems.length > 0 && (
                <>
                  <div className={`flex items-center gap-2 pb-1.5 ${unreadItems.length > 0 ? 'pt-5 border-t border-border/50 mt-3' : ''}`}>
                    <span className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Recent</span>
                  </div>
                  {(() => {
                    const BUILTIN_ORDER = ['Announcements', 'Club Management', 'Operations', 'Volunteers', 'Admin Groups', 'Custom Groups'] as const;
                    const classifyGroup = (c: UnifiedConversation): string => {
                      if (c.type === 'admin_group') return 'Admin Groups';
                      if (c.type === 'club' || c.type === 'broadcast') return 'Announcements';
                      const explicit = (c.category || '').trim();
                      if (explicit) return explicit;
                      const name = (c.name || '').toLowerCase();
                      if (/committee|admin|coach|leadership|staff|board|manager|coordinator/.test(name)) return 'Club Management';
                      if (/finance|treasur|ground|fixture|operation|registr|equipment|kit|event|schedul/.test(name)) return 'Operations';
                      if (/volunteer|bbq|canteen|fundrais|helper|roster/.test(name)) return 'Volunteers';
                      return 'Custom Groups';
                    };

                    if (!useGroupSections) {
                      return <>{visibleRecent.map(renderConversationCard)}</>;
                    }
                    const buckets: Record<string, UnifiedConversation[]> = {};
                    visibleRecent.forEach((c) => {
                      const section = (c.type === 'group' || c.type === 'club' || c.type === 'broadcast' || c.type === 'admin_group')
                        ? classifyGroup(c)
                        : 'Custom Groups';
                      (buckets[section] ||= []).push(c);
                    });
                    const customSections = Object.keys(buckets)
                      .filter((s) => !(BUILTIN_ORDER as readonly string[]).includes(s))
                      .sort((a, b) => a.localeCompare(b));
                    const orderedSections = [...BUILTIN_ORDER.filter((s) => buckets[s]?.length), ...customSections];
                    return (
                      <>
                        {orderedSections.map((section, idx) => (
                          <Fragment key={section}>
                            <div className={idx === 0 ? '' : 'pt-3'}>
                              <div className="flex items-center gap-2 pb-1.5">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                                  {section}
                                </span>
                              </div>
                              {buckets[section].map(renderConversationCard)}
                            </div>
                          </Fragment>
                        ))}
                      </>
                    );
                  })()}

                  {hiddenOps.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllOps(true)}
                      className="w-full mt-1 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md border border-dashed border-border hover:border-foreground/40"
                    >
                      Show {hiddenOps.length} more inactive group{hiddenOps.length === 1 ? '' : 's'}
                    </button>
                  )}
                </>
              )}
            </>
          );
        })()}


        {/* Empty state when no results */}
        {!showSkeletonLoading && hasNoResults && (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center">
              <Search className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No messages match "{searchQuery}"</p>
            </CardContent>
          </Card>
        )}

        {/* Empty state when no messages at all */}
        {!showSkeletonLoading && !searchQuery && hasNoMessages && (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center">
              {isOnline ? (
                <>
                  <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No messages available</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Join a team or club to access chats
                  </p>
                </>
              ) : (
                <>
                  <WifiOff className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    You're offline and no saved conversations are available yet
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Reconnect to load your messages
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}


        {/* Admin Group threads are now merged into the unified sorted list above. */}


        {/* Contact Club - Pro feature */}
        {!showSkeletonLoading && (
          <ContactClubButton clubFilter={activeClubFilter} />
        )}

        {/* Discover open-to-club Operations / Volunteers groups */}
        {!showSkeletonLoading && (typeFilter === 'all' || typeFilter === 'groups') && (
          <DiscoverGroupsList activeClubFilter={effectiveClubFilter} />
        )}

        {/* Sponsor/Ad Carousel */}
        <SponsorOrAdCarousel location="messages" activeClubFilter={activeClubFilter} />
      </div>
    </div>
  );
}
