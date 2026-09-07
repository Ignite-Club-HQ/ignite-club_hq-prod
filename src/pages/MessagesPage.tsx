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
import { logInboxOpenLatency, resetInboxOpenLog } from "@/lib/inboxOpenLatency";

import { cacheProfiles, fetchProfilesWithCache, getProfileFromCache, selectCachedProfileById, selectCachedProfilesByIds } from "@/lib/profileCache";
import { formatMessagePreview as stripMentionFormatting, getMessagePreviewText as getMessagePreview, extractEventIds, extractVaultFolderIds, extractVaultFileIds } from "@/lib/messagePreview";
import CreateGroupDialog from "@/components/chat/CreateGroupDialog";
import EditGroupDialog from "@/components/chat/EditGroupDialog";
import { StartDMDialog } from "@/components/chat/StartDMDialog";
import { NewMessageSheet } from "@/components/chat/NewMessageSheet";
import { ContactClubButton } from "@/components/ContactClubButton";
import { clubAdminInboxQueryKey, fetchClubAdminConversations } from "@/components/chat/ClubAdminInboxList";
import DiscoverGroupsList from "@/components/chat/DiscoverGroupsList";
import { MessagePreview } from "@/components/chat/MessagePreview";
import { ConversationRow } from "@/components/chat/ConversationRow";

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

interface Team {
  id: string;
  name: string;
  logo_url: string | null;
  deleted_at?: string | null;
  clubs: { id: string; name: string; logo_url: string | null; sport: string | null; deleted_at?: string | null; purged_at?: string | null };
}

interface Club {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
}

interface UnifiedConversation {
  type: 'club' | 'team' | 'group' | 'league' | 'dm' | 'broadcast' | 'support' | 'admin_group';
  id: string;
  key: string;
  name: string;
  avatarUrl?: string | null;
  link: string;
  lastActivity: string;
  lastMessage?: { text: string; author: string; created_at: string; image_url?: string | null; is_announcement?: boolean };
  unreadCount: number;
  isMuted: boolean;
  isLocked?: boolean;
  canManage?: boolean;
  canHide?: boolean;
  dmData?: any;
  draftText?: string;
  category?: string | null;
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
  const [showGlobalRecap, setShowGlobalRecap] = useState(false);
  const [localClubFilter, setLocalClubFilter] = usePersistedFilter("messages.localClubFilter", "all");
  const [typeFilterRaw, setTypeFilter] = usePersistedFilter("messages.typeFilter", "all");
  // Normalize legacy persisted values ('club' / 'league' used to be top-level
  // chips — they now live inside 'groups').
  const typeFilter = (
    typeFilterRaw === 'club' || typeFilterRaw === 'league' ? 'groups' : typeFilterRaw
  ) as 'all' | 'teams' | 'groups' | 'dms';
  const [showAllOps, setShowAllOps] = useState(false);
  const [showClubFilterDrawer, setShowClubFilterDrawer] = useState(false);
  const { activeClubFilter, activeClubTeamIds } = useClubTheme();

  // Effective club filter: use theme filter if active, otherwise use local filter
  const effectiveClubFilter = activeClubFilter || (localClubFilter !== "all" ? localClubFilter : null);
  const hasLocalFilter = !activeClubFilter && localClubFilter !== "all";

  // Gate Chat Recap to the active club context so a free active club can't
  // borrow Pro access from another club the user belongs to.
  const { hasAICatchUpClub, recapVisible, resolved: aiCatchUpResolved } = useUserHasAnyAICatchUpClub(effectiveClubFilter ?? null);
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    enabled: !!user && initialized,
    retry: 3,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Get clubs where user is admin
  const { data: adminClubs } = useQuery({
    queryKey: ["admin-clubs", user?.id],
    queryFn: async () => {
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .eq("role", "club_admin");

      if (rolesError) throw rolesError;
      if (!roles || roles.length === 0) return [];

      const clubIds = roles.map((r) => r.club_id).filter(Boolean);
      const { data } = await supabase
        .from("clubs")
        .select("id, name, logo_url, sport")
        .in("id", clubIds)
        .is("deleted_at", null)
        .neq("kind", "shell");

      return data as Club[];
    },
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
    queryFn: async () => {
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);

      if (rolesError) throw rolesError;
      if (!roles || roles.length === 0) return { clubs: [] as Club[], latestMessages: {} };

      const clubIds = [...new Set(roles.map((r) => r.club_id).filter(Boolean))];
      const { data } = await supabase
        .from("clubs")
        .select("id, name, logo_url, sport")
        .in("id", clubIds)
        .is("deleted_at", null)
        .neq("kind", "shell");

      const clubs = data as Club[];
      
      // Fetch latest messages for all clubs in parallel, then batch a single
      // profiles lookup for all authors. M1 perf: removes the per-club N+1
      // profile query that previously serialized after each last-message fetch.
      const latestMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null }> = {};

      // Fast path: single RPC returning latest message + author display name per club.
      try {
        const { data: rpcRows, error: rpcErr } = await (supabase as any).rpc(
          "get_inbox_latest_club_messages",
          { _club_ids: clubIds }
        );
        if (rpcErr) throw rpcErr;
        for (const row of (rpcRows ?? []) as any[]) {
          latestMessages[row.club_id] = {
            text: row.text,
            author: row.author_display_name ?? "",
            created_at: row.created_at,
            image_url: row.image_url,
          };
        }
        return { clubs, latestMessages };
      } catch {
        // Fall through to legacy per-club fetch.
      }

      const msgRows = await Promise.all(
        clubs.map(async (club) => {
          const { data: msgData } = await supabase
            .from("club_messages")
            .select("text, created_at, image_url, author_id")
            .eq("club_id", club.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return { clubId: club.id, msg: msgData };
        })
      );

      const authorIds = Array.from(new Set(
        msgRows.map(r => r.msg?.author_id).filter((id): id is string => !!id)
      ));
      const authorNameById: Record<string, string> = {};
      if (authorIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(authorIds);
        for (const p of profiles ?? []) {
          if (p.display_name) authorNameById[p.id] = p.display_name;
        }
      }

      for (const { clubId, msg } of msgRows) {
        if (!msg) continue;
        latestMessages[clubId] = {
          text: msg.text,
          author: msg.author_id ? (authorNameById[msg.author_id] ?? "") : "",
          created_at: msg.created_at,
          image_url: msg.image_url,
        };
      }
      
      return { clubs, latestMessages };
    },
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
    queryFn: async () => {
      const { data } = await supabase
        .from("broadcast_messages")
        .select("text, created_at, image_url, author_id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (!data) return null;
      
      let authorName = "";
      if (data.author_id) {
        const { data: profile } = await selectCachedProfileById(data.author_id);
        if (profile?.display_name) {
          authorName = profile.display_name;
        }
      }
      
      return {
        text: data.text,
        created_at: data.created_at,
        image_url: data.image_url,
        author_id: data.author_id,
        profiles: { display_name: authorName }
      };
    },
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
    queryFn: async () => {
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .not("team_id", "is", null);

      if (rolesError) throw rolesError;

      const teamIds = roles.map((r) => r.team_id).filter(Boolean);
      if (teamIds.length === 0) return { teams: [] as Team[], latestMessages: {} };

      const { data, error } = await supabase
        .from("teams")
        .select(`
          id,
          name,
          logo_url,
          deleted_at,
          clubs!club_id (id, name, logo_url, sport, deleted_at, purged_at)
        `)
        .in("id", teamIds)
        .is("deleted_at", null);

      if (error) throw error;
      const teams = ((data || []) as Team[]).filter((team: any) => {
        if (team.deleted_at) return false;
        if (team.clubs?.deleted_at || team.clubs?.purged_at) return false;
        return true;
      });
      const activeTeamIds = teams.map((team) => team.id);
      if (activeTeamIds.length === 0) return { teams: [] as Team[], latestMessages: {} };
      
      // M1 perf: batch profile lookups for all team last-message authors.
      const latestMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null; is_announcement?: boolean }> = {};

      // Fast path: single RPC returning latest message + author display name per team.
      try {
        const { data: rpcRows, error: rpcErr } = await (supabase as any).rpc(
          "get_inbox_latest_team_messages",
          { _team_ids: activeTeamIds }
        );
        if (rpcErr) throw rpcErr;
        for (const row of (rpcRows ?? []) as any[]) {
          const isAnnouncement = !!(row.is_club_announcement && row.club_announcement_name);
          latestMessages[row.team_id] = {
            text: row.text,
            author: isAnnouncement
              ? row.club_announcement_name
              : (row.author_display_name ?? ""),
            created_at: row.created_at,
            image_url: row.image_url,
            is_announcement: isAnnouncement,
          };
        }
        return { teams, latestMessages };
      } catch {
        // Fall through to legacy per-team fetch path below.
      }

      const msgRows = await Promise.all(
        teams.map(async (team) => {
          const { data: msgData } = await supabase
            .from("team_messages")
            .select("text, created_at, image_url, author_id, is_club_announcement, club_announcement_name")
            .eq("team_id", team.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return { teamId: team.id, msg: msgData };
        })
      );

      const authorIds = Array.from(new Set(
        msgRows
          .map(r => r.msg)
          .filter((m): m is NonNullable<typeof m> => !!m && !(m.is_club_announcement && m.club_announcement_name) && !!m.author_id)
          .map(m => m.author_id as string)
      ));
      const authorNameById: Record<string, string> = {};
      if (authorIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(authorIds);
        for (const p of profiles ?? []) {
          if (p.display_name) authorNameById[p.id] = p.display_name;
        }
      }

      for (const { teamId, msg } of msgRows) {
        if (!msg) continue;
        const isAnnouncement = !!(msg.is_club_announcement && msg.club_announcement_name);
        const authorName = isAnnouncement
          ? msg.club_announcement_name!
          : (msg.author_id ? (authorNameById[msg.author_id] ?? "") : "");
        latestMessages[teamId] = {
          text: msg.text,
          author: authorName,
          created_at: msg.created_at,
          image_url: msg.image_url,
          is_announcement: isAnnouncement,
        };
      }

      return { teams, latestMessages };
    },
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
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach", "committee_member"]);
      return data?.map((r) => r.team_id).filter(Boolean) || [];
    },
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Check if user is a committee member (club-level role)
  const { data: isCommitteeMember, isFetching: isCommitteeMemberFetching } = useQuery({
    queryKey: ["is-committee-member", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "committee_member")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Fetch all user roles for chat group filtering
  const { data: userAllRoles, isFetching: userAllRolesFetching } = useQuery({
    queryKey: ["user-all-roles", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);
      return data || [];
    },
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch mini league IDs the user's children are assigned to (for league group visibility)
  const { data: userLeagueIds, isFetching: userLeagueIdsFetching } = useQuery({
    queryKey: ["user-child-league-ids", user?.id],
    queryFn: async () => {
      // Get user's children
      const { data: children } = await supabase
        .from("children")
        .select("id")
        .eq("parent_id", user!.id);
      
      if (!children?.length) {
        // Also check child_guardians for non-primary parents
        const { data: guardianLinks } = await supabase
          .from("child_guardians")
          .select("child_id")
          .eq("guardian_id", user!.id);
        
        const guardianChildIds = guardianLinks?.map(g => g.child_id) || [];
        if (!guardianChildIds.length) return new Set<string>();
        
        const { data: assignments } = await supabase
          .from("child_mini_league_assignments")
          .select("mini_league_id")
          .in("child_id", guardianChildIds);
        
        return new Set(assignments?.map(a => a.mini_league_id) || []);
      }
      
      const childIds = children.map(c => c.id);
      
      // Also include guardian children
      const { data: guardianLinks } = await supabase
        .from("child_guardians")
        .select("child_id")
        .eq("guardian_id", user!.id);
      
      guardianLinks?.forEach(g => {
        if (!childIds.includes(g.child_id)) childIds.push(g.child_id);
      });
      
      const { data: assignments } = await supabase
        .from("child_mini_league_assignments")
        .select("mini_league_id")
        .in("child_id", childIds);
      
      return new Set(assignments?.map(a => a.mini_league_id) || []);
    },
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
  });

  // Check if user has any Pro access
  // Pro Access Logic: Club Pro → all teams inherit; Free club → check team subscription
  const { data: hasAnyProAccess, isLoading: isLoadingProAccess, isFetching: isFetchingProAccess } = useQuery({
    queryKey: ["has-any-pro-access", user?.id],
    queryFn: async () => {
      const { data: userTeamRoles } = await supabase
        .from("user_roles")
        .select("team_id, club_id")
        .eq("user_id", user!.id);
      
      if (!userTeamRoles?.length) return false;
      
      const teamIds = userTeamRoles.map(r => r.team_id).filter(Boolean) as string[];
      const clubIds = [...new Set(userTeamRoles.map(r => r.club_id).filter(Boolean))] as string[];
      
      // Get parent clubs of teams
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        
        teams?.forEach(t => {
          if (t.club_id && !clubIds.includes(t.club_id)) {
            clubIds.push(t.club_id);
          }
        });
      }
      
      // First check club subscriptions (if any club has Pro, user has Pro)
      if (clubIds.length > 0) {
        const { data: proClubs } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
          .in("club_id", clubIds);
        
        const hasProClub = proClubs?.some(sub => 
          (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) && 
          (!sub.expires_at || new Date(sub.expires_at) > new Date())
        );
        
        if (hasProClub) return true;
      }
      
      // Check team-level subscriptions (for teams in free clubs)
      if (teamIds.length > 0) {
        const { data: proTeams } = await supabase
          .from("team_subscriptions")
          .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
          .in("team_id", teamIds);
        
        const hasProTeam = proTeams?.some(sub => 
          (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) && 
          (!sub.expires_at || new Date(sub.expires_at) > new Date())
        );
        
        if (hasProTeam) return true;
      }
      
      return false;
    },
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
    queryFn: async () => {
      if (memberClubIds.length === 0) return {};

      const { data: subs, error } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", memberClubIds);

      // If the query errors transiently (e.g. after returning from phone lock),
      // throw so React Query keeps the previous (good) data via placeholderData
      // instead of caching an all-false map that would lock Pro chats.
      if (error) throw error;

      const statusMap: Record<string, boolean> = {};
      memberClubIds.forEach(id => {
        const sub = subs?.find(s => s.club_id === id);
        statusMap[id] = sub ? 
          (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) && 
          (!sub.expires_at || new Date(sub.expires_at) > new Date()) : false;
      });
      
      return statusMap;
    },
    enabled: memberClubIds.length > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
    retry: 2,
  });

  // Fetch chat groups with their latest messages in a single query
  const { data: chatGroupsWithMessages, isLoading: chatGroupsLoading, isFetched: chatGroupsFetched, isFetching: chatGroupsFetching, isError: chatGroupsError } = useQuery({
    queryKey: ["my-chat-groups-with-messages", user?.id],
    refetchOnReconnect: "always",
    queryFn: async () => {
      // Perf: pre-filter via SECURITY DEFINER RPC that returns just the
      // accessible group ids (scope-table lookup), then do a PK select on
      // chat_groups. Avoids per-row RLS policy evaluation on inbox cold load.
      // Kill-switch: localStorage.msg_accessible_ids_rpc = "0" to bypass.
      let accessibleIds: string[] | null = null;
      try {
        if (typeof window === "undefined" || window.localStorage.getItem("msg_accessible_ids_rpc") !== "0") {
          const { data: ids, error: idsErr } = await (supabase as any).rpc(
            "get_my_accessible_chat_group_ids",
            { _user_id: user!.id }
          );
          if (!idsErr && Array.isArray(ids)) accessibleIds = ids as string[];
        }
      } catch {
        accessibleIds = null;
      }

      if (accessibleIds && accessibleIds.length === 0) {
        return { groups: [], latestMessages: {} };
      }

      let query = supabase
        .from("chat_groups")
        .select("*, teams(name, deleted_at), clubs!club_id(name, logo_url, deleted_at, purged_at), mini_leagues:mini_league_id(name)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (accessibleIds) query = query.in("id", accessibleIds);
      const { data, error } = await query;

      
      const groups = ((data || []) as any[]).filter((group: any) => {
        if (group.deleted_at) return false;
        if (group.clubs?.deleted_at || group.clubs?.purged_at) return false;
        if (group.teams?.deleted_at) return false;
        return true;
      });
      
      // M1 perf: batch profile lookups for all group last-message authors.
      const latestMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null }> = {};

      // Fast path: single RPC returning latest message + author display name per group.
      const groupIds = groups.map((g: any) => g.id);
      if (groupIds.length > 0) {
        try {
          const { data: rpcRows, error: rpcErr } = await (supabase as any).rpc(
            "get_inbox_latest_group_messages",
            { _group_ids: groupIds }
          );
          if (rpcErr) throw rpcErr;
          for (const row of (rpcRows ?? []) as any[]) {
            latestMessages[row.group_id] = {
              text: row.text,
              author: row.author_display_name ?? "",
              created_at: row.created_at,
              image_url: row.image_url,
            };
          }
          return { groups, latestMessages };
        } catch {
          // Fall through to legacy per-group fetch.
        }
      }

      const msgRows = await Promise.all(
        groups.map(async (group) => {
          const { data: msgData } = await supabase
            .from("group_messages")
            .select("text, created_at, image_url, author_id")
            .eq("group_id", group.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return { groupId: group.id, msg: msgData };
        })
      );

      const authorIds = Array.from(new Set(
        msgRows.map(r => r.msg?.author_id).filter((id): id is string => !!id)
      ));
      const authorNameById: Record<string, string> = {};
      if (authorIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(authorIds);
        for (const p of profiles ?? []) {
          if (p.display_name) authorNameById[p.id] = p.display_name;
        }
      }

      for (const { groupId, msg } of msgRows) {
        if (!msg) continue;
        latestMessages[groupId] = {
          text: msg.text,
          author: msg.author_id ? (authorNameById[msg.author_id] ?? "") : "",
          created_at: msg.created_at,
          image_url: msg.image_url,
        };
      }

      return { groups, latestMessages };
    },
    enabled: !!user && initialized,
    // Matches the sibling inbox queries. The 25s REST GET timeout in
    // `supabaseAuthRetry.ts` otherwise surfaces transient RLS-heavy timeouts
    // as hard errors after a single attempt.
    retry: 3,
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
    queryFn: async () => {
      // Only ACTIVE participation maps a club into a competition:
      // - the entry must still be accepted (not invited/declined/withdrawn)
      // - the entering team must not be soft-deleted
      // Otherwise stale entries keep a competition's chat groups visible in a
      // club's inbox forever after its teams leave or are deleted.
      const { data, error } = await supabase
        .from("competition_entries")
        .select("competition_id, status, teams!inner(club_id, deleted_at)")
        .in("competition_id", competitionIdsForGroups)
        .eq("status", "accepted")
        .is("teams.deleted_at", null);
      if (error) throw error;
      const map: Record<string, Set<string>> = {};
      for (const row of (data ?? []) as any[]) {
        if (row?.status !== "accepted") continue;
        if (row?.teams?.deleted_at) continue;
        const clubId = row?.teams?.club_id;
        if (!clubId) continue;
        (map[row.competition_id] ||= new Set()).add(clubId);
      }
      return map;
    },
  });


  // Fetch all muted chats for the user
  const { data: mutedChats } = useQuery({
    queryKey: ["muted-chats", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_mute_preferences")
        .select("chat_id, chat_type, muted_until")
        .eq("user_id", user!.id);
      
      const now = new Date();
      const muted = {
        teams: new Set<string>(),
        clubs: new Set<string>(),
        groups: new Set<string>(),
      };
      
      data?.forEach((pref) => {
        const isActive = pref.muted_until === null || new Date(pref.muted_until) > now;
        if (!isActive) return;
        
        if (pref.chat_type === "team") muted.teams.add(pref.chat_id);
        else if (pref.chat_type === "club") muted.clubs.add(pref.chat_id);
        else if (pref.chat_type === "group") muted.groups.add(pref.chat_id);
      });
      
      return muted;
    },
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



      const { data: convos, error } = await supabase
        .from("direct_conversations")
        .select("*")
        .or(`participant_1.eq.${user!.id},participant_2.eq.${user!.id}`)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      if (!convos?.length) return [];

      const otherUserIds = convos.map(c => 
        c.participant_1 === user!.id ? c.participant_2 : c.participant_1
      );

      // Fast path: single RPC for latest message across all conversations.
      // Falls back to legacy per-conversation queries on error.
      const conversationIds = convos.map((c) => c.id);
      const fetchLatestMessages = async (): Promise<Map<string, { text: string; image_url: string | null; created_at: string; author_id: string } | null>> => {
        try {
          const { data, error } = await supabase.rpc("get_inbox_latest_dm_messages", { _conversation_ids: conversationIds });
          if (error) throw error;
          const map = new Map<string, { text: string; image_url: string | null; created_at: string; author_id: string } | null>();
          (data || []).forEach((row: any) => {
            map.set(row.conversation_id, {
              text: row.text,
              image_url: row.image_url,
              created_at: row.created_at,
              author_id: row.author_id,
            });
          });
          return map;
        } catch {
          // Legacy fallback
          const messagesResult = await Promise.all(
            convos.map(async (conv) => {
              const { data } = await supabase
                .from("direct_messages")
                .select("text, image_url, created_at, author_id")
                .eq("conversation_id", conv.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              return { conversationId: conv.id, message: data };
            })
          );
          return new Map(messagesResult.map((m) => [m.conversationId, m.message as any]));
        }
      };

      const [profilesMap, messageMap] = await Promise.all([
        // Always fetch DM other-user profiles directly from the DB (bypassing
        // the 24h profileCache) so display_name / avatar changes made by the
        // other participant are reflected in the inbox on the next load.
        // Falls back to whatever the global profile cache has if the network
        // fetch fails or returns empty (handled by the layered fallbacks below).
        (async () => {
          try {
            const { data } = await selectCachedProfilesByIds(otherUserIds);
            if (data && data.length) {
              // Refresh the global profile cache so every other surface
              // (chat rows, member lists, mention chips) picks up the new name.
              cacheProfiles(data);
            }
            const map = new Map<string, { id: string; display_name: string | null; avatar_url: string | null; cached_at: number }>();
            const now = Date.now();
            (data ?? []).forEach((p) => map.set(p.id, { ...p, cached_at: now }));
            return map;
          } catch {
            // Network/RLS hiccup — fall back to whatever the cache has.
            return await fetchProfilesWithCache(otherUserIds, { allowStale: true, timeout: 15000 });
          }
        })(),
        fetchLatestMessages(),
      ]);

      // Build a fallback map of previously-known other_user data so that a
      // transient empty profile fetch (RLS / network blip after lock screen)
      // never downgrades a real name back to "Unknown User".
      const previousResult = queryClient.getQueryData<any[]>(["dm-conversations", user?.id]);
      const previousOtherUserMap = new Map<string, any>();
      previousResult?.forEach((c: any) => {
        if (c?.other_user?.id && c.other_user.display_name) {
          previousOtherUserMap.set(c.other_user.id, c.other_user);
        }
      });
      // Also seed from the persistent cache as a second layer of defence.
      cachedData?.dmConversations?.forEach((c: any) => {
        if (c?.other_user?.id && c.other_user.display_name && !previousOtherUserMap.has(c.other_user.id)) {
          previousOtherUserMap.set(c.other_user.id, c.other_user);
        }
      });

      const result = convos.map(conv => {
        const otherUserId = conv.participant_1 === user!.id ? conv.participant_2 : conv.participant_1;
        const fetchedProfile = profilesMap.get(otherUserId);
        const fallbackProfile = previousOtherUserMap.get(otherUserId);
        // Final defence: the global in-memory profile cache (populated by
        // every other surface in the app — chat rows, member lists, etc).
        const globalCached = getProfileFromCache(otherUserId);
        // Prefer freshly fetched data, but never overwrite a known good
        // profile with null/empty values.
        const otherUser = (fetchedProfile && fetchedProfile.display_name)
          ? {
              id: otherUserId,
              display_name: fetchedProfile.display_name,
              avatar_url: fetchedProfile.avatar_url ?? fallbackProfile?.avatar_url ?? globalCached?.avatar_url ?? null,
            }
          : (fallbackProfile && fallbackProfile.display_name)
            ? fallbackProfile
            : globalCached
              ? {
                  id: otherUserId,
                  display_name: globalCached.display_name,
                  avatar_url: globalCached.avatar_url ?? null,
                }
              : (fetchedProfile
                  ? { id: otherUserId, display_name: null, avatar_url: fetchedProfile.avatar_url ?? null }
                  : null);
        return {
          ...conv,
          other_user: otherUser,
          last_message: messageMap.get(conv.id) || null,
        };
      });

      // Cache
      const dmConversationsForCache = result.map(conv => ({
        id: conv.id,
        participant_1: conv.participant_1,
        participant_2: conv.participant_2,
        updated_at: conv.updated_at,
        created_at: (conv as any).created_at,
        created_by: (conv as any).created_by ?? null,
        other_user: conv.other_user,
      }));
      const latestDMMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null }> = {};
      result.forEach(conv => {
        if (conv.last_message) {
          latestDMMessages[conv.id] = {
            text: conv.last_message.text,
            author: conv.last_message.author_id === user!.id ? "You" : (conv.other_user?.display_name || ""),
            created_at: conv.last_message.created_at,
            image_url: conv.last_message.image_url,
          };
        }
      });
      cacheMessagesPageData(user!.id, { dmConversations: dmConversationsForCache, latestDMMessages });

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
      if (!cachedData?.dmConversations?.length) return undefined;
      return cachedData.dmConversations.map(conv => ({
        ...conv,
        created_at: (conv as any).created_at || conv.updated_at,
        created_by: (conv as any).created_by || null,
        last_message: cachedData.latestDMMessages?.[conv.id] ? {
          text: cachedData.latestDMMessages[conv.id].text,
          image_url: cachedData.latestDMMessages[conv.id].image_url || null,
          created_at: cachedData.latestDMMessages[conv.id].created_at,
          author_id: cachedData.latestDMMessages[conv.id].author === "You" ? user?.id || "" : conv.other_user?.id || "",
        } : null,
      })) as any;
    },
  });

  // Fetch hidden DM conversations (with hidden_at so they can resurface on new messages)
  const { data: hiddenDMMap } = useQuery({
    queryKey: ["hidden-dm-conversations", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("hidden_dm_conversations")
        .select("conversation_id, hidden_at")
        .eq("user_id", user!.id);
      const map = new Map<string, string>();
      (data || []).forEach((h: any) => map.set(h.conversation_id, h.hidden_at));
      return map;
    },
    enabled: !!user,
  });

  // Fetch hidden custom group chats (with hidden_at)
  const { data: hiddenGroupMap } = useQuery({
    queryKey: ["hidden-chat-groups", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("hidden_chat_groups" as any)
        .select("group_id, hidden_at")
        .eq("user_id", user!.id);
      const map = new Map<string, string>();
      (data || []).forEach((h: any) => map.set(h.group_id, h.hidden_at));
      return map;
    },
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_messages")
        .select("*")
        .eq("user_id", user!.id)
        .eq("message_type", "welcome")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data;
    },
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
        queryFn: async () => {
          const { data: messagesData } = await supabase
            .from("broadcast_messages")
            .select("id, text, created_at, author_id, image_url, reply_to_id")
            .order("created_at", { ascending: false })
            .limit(MESSAGES_PER_PAGE + 1);
          
          if (!messagesData?.length) return { messages: [], hasOlderMessages: false };
          const hasMore = messagesData.length > MESSAGES_PER_PAGE;
          const messagesToDisplay = hasMore ? messagesData.slice(0, MESSAGES_PER_PAGE) : messagesData;
          return { messages: [...messagesToDisplay].reverse(), hasOlderMessages: hasMore };
        },
        staleTime: 1000 * 60,
      });

      cappedTeams.forEach((team) => {
        if (cancelled) return;
        queryClient.prefetchQuery({
          queryKey: ["team-messages", team.id],
          queryFn: async () => {
            const { data: messagesData } = await supabase
              .from("team_messages")
              .select("id, text, created_at, author_id, image_url, reply_to_id, team_id")
              .eq("team_id", team.id)
              .order("created_at", { ascending: false })
              .limit(MESSAGES_PER_PAGE + 1);
            
            if (!messagesData?.length) return { messages: [], hasOlderMessages: false };
            const hasMore = messagesData.length > MESSAGES_PER_PAGE;
            const messagesToDisplay = hasMore ? messagesData.slice(0, MESSAGES_PER_PAGE) : messagesData;
            return { messages: [...messagesToDisplay].reverse(), hasOlderMessages: hasMore };
          },
          staleTime: 1000 * 60,
        });
      });

      cappedClubs.forEach((club) => {
        if (cancelled) return;
        queryClient.prefetchQuery({
          queryKey: ["club-messages", club.id],
          queryFn: async () => {
            const { data: messagesData } = await supabase
              .from("club_messages")
              .select("id, text, created_at, author_id, image_url, reply_to_id, club_id")
              .eq("club_id", club.id)
              .order("created_at", { ascending: false })
              .limit(MESSAGES_PER_PAGE + 1);
            
            if (!messagesData?.length) return { messages: [], hasOlderMessages: false };
            const hasMore = messagesData.length > MESSAGES_PER_PAGE;
            const messagesToDisplay = hasMore ? messagesData.slice(0, MESSAGES_PER_PAGE) : messagesData;
            return { messages: [...messagesToDisplay].reverse(), hasOlderMessages: hasMore };
          },
          staleTime: 1000 * 60,
        });
      });

      cappedGroups.forEach((group) => {
        if (cancelled) return;
        queryClient.prefetchQuery({
          queryKey: ["group-messages", group.id],
          queryFn: async () => {
            const { data: messagesData } = await supabase
              .from("group_messages")
              .select("id, text, created_at, author_id, image_url, reply_to_id, group_id")
              .eq("group_id", group.id)
              .order("created_at", { ascending: false })
              .limit(MESSAGES_PER_PAGE + 1);
            
            if (!messagesData?.length) return { messages: [], hasOlderMessages: false };
            const hasMore = messagesData.length > MESSAGES_PER_PAGE;
            const messagesToDisplay = hasMore ? messagesData.slice(0, MESSAGES_PER_PAGE) : messagesData;
            return { messages: [...messagesToDisplay].reverse(), hasOlderMessages: hasMore };
          },
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
      queryClient.invalidateQueries({ queryKey: ["unread-message-counts", user.id] });
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
  const isLoadingFreshData = !hasAnyDisplayData && !hasCachedData && !!(teamsLoading || memberClubsLoading || chatGroupsLoading || isLoadingClubProStatus);
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
  const sortSourcesSettled =
    (teamsFetched || teamsError) && !teamsFetching &&
    (memberClubsFetched || memberClubsError) && !memberClubsFetching &&
    (chatGroupsFetched || chatGroupsError) && !chatGroupsFetching &&
    (latestBroadcastFetched || latestBroadcastError) && !latestBroadcastFetching &&
    (dmFetched || dmError) && !dmFetching;

  // Hard ceiling: never hold the skeleton longer than this, even if one query
  // is pathologically slow. Order may correct in place after this point, but
  // the inbox is guaranteed to paint.
  const [sortGateExpired, setSortGateExpired] = useState(false);
  useEffect(() => {
    if (sortSourcesSettled) return;
    const t = window.setTimeout(() => setSortGateExpired(true), 3500);
    return () => window.clearTimeout(t);
  }, [sortSourcesSettled]);

  // `freshSortDataReady` describes *initial ordering readiness only*.
  const freshSortDataReady = !isOnline || sortSourcesSettled || sortGateExpired;

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
  const initialRevealBlocked =
    isOnline &&
    (isLoadingFreshData || !freshSortDataReady);


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

  const showSkeletonLoading = isOnline && !hasRevealedStableInboxRef.current && initialRevealBlocked;




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
  const displayTeams = (stickyTeams?.length ? stickyTeams : ((!isOnline || !teamsFetched) ? (cachedData?.teams as any) : null)) || stickyTeams || cachedData?.teams || [];
  const displayMemberClubs = (stickyMemberClubs?.length ? stickyMemberClubs : ((!isOnline || !memberClubsFetched) ? (cachedData?.memberClubs as any) : null)) || stickyMemberClubs || cachedData?.memberClubs || [];
  const displayAdminClubs = adminClubs || cachedData?.adminClubs || [];
  // Important: an empty fresh chat-group result is authoritative *while
  // online*. Falling back to cached groups when `chatGroups.length === 0`
  // kept soft-deleted/purged club chats visible forever after the server
  // correctly returned no rows. Offline, an empty/failed result carries no
  // authority, so cached rows stay visible.
  const allChatGroups = (stickyChatGroups?.length ? stickyChatGroups : ((!isOnline || !chatGroupsFetched) ? (cachedData?.chatGroups as any) : null)) ?? stickyChatGroups ?? (cachedData?.chatGroups as any) ?? [];


  
  // Filter chat groups by user's roles
  const displayChatGroups = useMemo(() => {
    if (isAppAdmin || isCommitteeMember) return allChatGroups;

    // Offline with no roles loaded: the cached groups were already RLS- and
    // role-filtered for THIS user when they were written (cache is
    // user-scoped and cleared on sign-out), so render them rather than
    // dropping every club/team chat.
    const rolesUnavailableOffline = !isOnline && !userAllRoles?.length;
    if (rolesUnavailableOffline) return allChatGroups;

    return allChatGroups.filter((group: any) => {
      // Personal/custom groups (no club, team, or mini-league scope) are
      // membership-based via group_members and RLS already filtered them.
      // Always show them — do NOT gate on user_roles.
      const isPersonalGroup = !group.club_id && !group.team_id && !group.mini_league_id;
      if (isPersonalGroup) return true;

      if (!userAllRoles?.length) return false;


      const allowedRoles: string[] = group.allowed_roles || [];
      if (allowedRoles.length === 0) return true;

      if (group.mini_league_id) {
        const isLeagueAdmin = userAllRoles.some((ur: any) => 
          ["club_admin", "league_admin", "coach", "team_admin"].includes(ur.role) && 
          ur.club_id === group.club_id
        );
        if (isLeagueAdmin) return true;
        if (!userLeagueIds?.has(group.mini_league_id)) return false;
      }
      
      return userAllRoles.some((ur: any) => {
        if (!allowedRoles.includes(ur.role)) return false;
        if (group.club_id && !group.team_id && !group.mini_league_id) {
          return ur.club_id === group.club_id;
        }
        if (group.team_id) {
          return ur.team_id === group.team_id;
        }
        return true;
      });
    });
  }, [allChatGroups, userAllRoles, userLeagueIds, isAppAdmin, isCommitteeMember, isOnline]);

  const displayLatestBroadcast = latestBroadcast || cachedData?.latestBroadcast;
  const displayLatestTeamMessages = latestTeamMessages || {};
  const displayLatestClubMessages = latestClubMessages || {};
  const displayLatestGroupMessages = latestGroupMessages || {};

  const displayClubsWithAnnouncements = displayMemberClubs;

  const canCreateGroups = (adminTeamIds?.length || adminClubs?.length || isAppAdmin || isCommitteeMember) && (hasAnyProAccess || isAppAdmin);

  // Filter all items based on search query and active club filter
  const query = searchQuery.toLowerCase().trim();

  // Separate league chats from regular chat groups
  const { leagueChats, regularChatGroups } = useMemo(() => {
    const leagues: any[] = [];
    const regular: any[] = [];
    
    displayChatGroups.forEach((group: any) => {
      if (group.mini_league_id) {
        leagues.push(group);
      } else {
        regular.push(group);
      }
    });
    
    return { leagueChats: leagues, regularChatGroups: regular };
  }, [displayChatGroups]);

  // Personal/custom groups (membership-based, no club/team/league/competition scope).
  const personalGroupIds = useMemo(
    () => regularChatGroups
      .filter((g: any) => !g.club_id && !g.team_id && !g.mini_league_id && !g.competition_id)
      .map((g: any) => g.id),
    [regularChatGroups]
  );

  // Other-user ids across all DM conversations (used to test club membership).
  const dmOtherUserIds = useMemo(
    () => (dmConversations || [])
      .map((c: any) => c?.other_user?.id)
      .filter((id: any) => !!id && id !== user?.id),
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
    queryFn: async () => {
      // 1. Personal group memberships.
      const groupMembersMap = new Map<string, string[]>();
      if (personalGroupIds.length > 0) {
        const { data: gm } = await supabase
          .from("group_members")
          .select("group_id, user_id")
          .in("group_id", personalGroupIds);
        (gm || []).forEach((row: any) => {
          const arr = groupMembersMap.get(row.group_id) || [];
          arr.push(row.user_id);
          groupMembersMap.set(row.group_id, arr);
        });
      }

      // 2. Union of user ids whose club membership we need to check.
      const userIdSet = new Set<string>(dmOtherUserIds);
      groupMembersMap.forEach((members) => {
        members.forEach((uid) => {
          if (uid && uid !== user?.id) userIdSet.add(uid);
        });
      });

      const usersInClub = new Set<string>();
      if (userIdSet.size > 0) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", effectiveClubFilter)
          .in("user_id", Array.from(userIdSet));
        (roles || []).forEach((r: any) => {
          if (r.user_id) usersInClub.add(r.user_id);
        });
      }

      return { groupMembersMap, usersInClub };
    },
  });

  const clubScopedUsersInClub = clubScopeFilterData?.usersInClub;
  const clubScopedGroupMembers = clubScopeFilterData?.groupMembersMap;



  const filteredLeagueChats = useMemo(() => {
    let groups = leagueChats;
    if (effectiveClubFilter) {
      groups = groups.filter((group: any) => group.club_id === effectiveClubFilter);
    }
    if (!query) return groups;
    return groups.filter((group: any) => {
      const groupName = group.name?.toLowerCase() || "";
      const clubName = group.clubs?.name?.toLowerCase() || "";
      return groupName.includes(query) || clubName.includes(query);
    });
  }, [leagueChats, query, effectiveClubFilter]);

  const filteredChatGroups = useMemo(() => {
    let groups = regularChatGroups;
    if (effectiveClubFilter) {
      groups = groups.filter((group: any) => {
        // Competition-scoped groups: only show when the active club has a
        // team entered in that competition.
        if (group.competition_id) {
          const clubs = competitionClubMap?.[group.competition_id];
          return !!clubs && clubs.has(effectiveClubFilter);
        }
        // Personal/custom groups: when a club filter is active, only show
        // the group if at least one member (other than the current user)
        // holds a role under the selected club. While the membership
        // lookup is still loading, fall back to showing the group so it
        // doesn't briefly disappear on each filter switch.
        const isPersonalGroup = !group.club_id && !group.team_id && !group.mini_league_id;
        if (isPersonalGroup) {
          if (!clubScopedGroupMembers || !clubScopedUsersInClub) return true;
          const members = clubScopedGroupMembers.get(group.id) || [];
          const otherMembers = members.filter((uid) => uid !== user?.id);
          if (otherMembers.length === 0) return true;
          return otherMembers.some((uid) => clubScopedUsersInClub.has(uid));
        }

        return (
          group.club_id === effectiveClubFilter ||
          (group.team_id && (activeClubFilter ? activeClubTeamIds.includes(group.team_id) : displayTeams.some((t: any) => t.id === group.team_id && t.clubs?.id === effectiveClubFilter)))
        );
      });
    }

    // Apply hidden filter for custom (personal) groups — they reappear when
    // a new message arrives after the time the user hid them.
    groups = groups.filter((group: any) => {
      const isPersonalGroup = !group.club_id && !group.team_id && !group.mini_league_id && !group.competition_id;
      if (!isPersonalGroup) return true;
      const hiddenAt = hiddenGroupMap?.get(group.id);
      if (!hiddenAt) return true;
      const lastMsgAt = displayLatestGroupMessages?.[group.id]?.created_at;
      const stillHidden = !lastMsgAt || new Date(lastMsgAt).getTime() <= new Date(hiddenAt).getTime();
      if (stillHidden && !query) return false;
      return true;
    });
    if (!query) return groups;
    return groups.filter((group: any) => {
      const groupName = group.name?.toLowerCase() || "";
      const teamName = group.teams?.name?.toLowerCase() || "";
      const clubName = group.clubs?.name?.toLowerCase() || "";
      return groupName.includes(query) || teamName.includes(query) || clubName.includes(query);
    });
  }, [regularChatGroups, query, effectiveClubFilter, activeClubFilter, activeClubTeamIds, displayTeams, hiddenGroupMap, displayLatestGroupMessages, competitionClubMap, clubScopedGroupMembers, clubScopedUsersInClub, user?.id]);

  const filteredTeams = useMemo(() => {
    let teamsToFilter = displayTeams || [];
    if (effectiveClubFilter) {
      if (activeClubFilter) {
        const hasResolvedActiveClubTeams = activeClubTeamIds.length > 0;
        teamsToFilter = teamsToFilter.filter((team: any) => {
          const matchesResolvedIds = hasResolvedActiveClubTeams && activeClubTeamIds.includes(team.id);
          const matchesClubRelation = team.clubs?.id === activeClubFilter;
          return matchesResolvedIds || matchesClubRelation;
        });
      } else {
        teamsToFilter = teamsToFilter.filter((team: any) => team.clubs?.id === effectiveClubFilter);
      }
    }
    if (!query) return teamsToFilter;
    return teamsToFilter.filter((team: any) =>
      team.name.toLowerCase().includes(query) ||
      team.clubs?.name?.toLowerCase()?.includes(query)
    );
  }, [displayTeams, query, effectiveClubFilter, activeClubFilter, activeClubTeamIds]);

  const filteredClubs = useMemo(() => {
    let clubsToFilter = displayClubsWithAnnouncements || [];
    if (effectiveClubFilter) {
      clubsToFilter = clubsToFilter.filter((club: any) => club.id === effectiveClubFilter);
    }
    if (!query) return clubsToFilter;
    return clubsToFilter.filter((club: any) =>
      club.name.toLowerCase().includes(query)
    );
  }, [displayClubsWithAnnouncements, query, effectiveClubFilter]);

  const showBroadcast = !query || "announcements".includes(query);

  // Live drafts (unsent text in any chat composer)
  const allDrafts = useAllChatDrafts();
  const draftFor = (id?: string | null) => (id ? allDrafts[id] : undefined);

  // Offline fallback: when the DM query errors (no network), React Query drops
  // the placeholder and `dmConversations` is undefined. Rebuild the list from
  // the user-scoped cache so saved conversations stay selectable offline.
  const offlineCachedDMs = useMemo(() => {
    if (!cachedData?.dmConversations?.length) return [];
    return cachedData.dmConversations.map((conv: any) => ({
      ...conv,
      created_at: conv.created_at || conv.updated_at,
      created_by: conv.created_by || null,
      last_message: cachedData.latestDMMessages?.[conv.id]
        ? {
            text: cachedData.latestDMMessages[conv.id].text,
            image_url: cachedData.latestDMMessages[conv.id].image_url || null,
            created_at: cachedData.latestDMMessages[conv.id].created_at,
            author_id:
              cachedData.latestDMMessages[conv.id].author === "You"
                ? user?.id || ""
                : conv.other_user?.id || "",
          }
        : null,
    })) as any[];
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
    if (stickyDMConversations?.length) return stickyDMConversations as any[];
    if (!isOnline && offlineCachedDMs.length) return offlineCachedDMs;
    return (stickyDMConversations as any[]) ?? [];
  }, [stickyDMConversations, isOnline, offlineCachedDMs]);

  // Filtered DM conversations
  // Hide empty DMs (no messages exchanged) from the list — these are stub
  // conversation rows that get created when someone opens a DM thread without
  // sending anything. They'd otherwise float to the top via `updated_at`.
  const filteredDMs = useMemo(() => {
    if (!effectiveDMConversations.length) return [];
    // Fail CLOSED while the club-scope lookup for the *current* club filter is
    // still resolving. Otherwise, immediately after switching clubs, the DM
    // rows of the previous club render for a beat before the scope data lands
    // and filters them out. (`clubScopeFilterData` is keyed by the filter, so
    // undefined here means "not yet known for this club".)
    if (effectiveClubFilter && !clubScopeFilterData && dmOtherUserIds.length > 0 && isOnline) {
      return [];
    }
    return effectiveDMConversations.filter((conv: any) => {

      const hiddenAt = hiddenDMMap?.get(conv.id);
      if (hiddenAt) {
        const lastMsgAt = conv.last_message?.created_at;
        const stillHidden = !lastMsgAt || new Date(lastMsgAt).getTime() <= new Date(hiddenAt).getTime();
        if (stillHidden && !query) return false;
      }
      // DMs are scoped to the active club: only show threads whose other
      // participant holds a role in that club, so the list matches the badge.
      if (effectiveClubFilter && clubScopedUsersInClub) {
        const otherId = conv.other_user?.id;
        if (!otherId || !clubScopedUsersInClub.has(otherId)) return false;
      }
      if (query) {
        return conv.other_user?.display_name?.toLowerCase().includes(query);
      }
      // Surface if there's a real message OR an unsent draft for this thread.
      const hasDraft = !!allDrafts[conv.id]?.text?.trim();
      return !!conv.last_message || hasDraft;
    });
  }, [effectiveDMConversations, hiddenDMMap, query, allDrafts, effectiveClubFilter, clubScopedUsersInClub, clubScopeFilterData, dmOtherUserIds.length, isOnline]);




  // Check if Ignite Support should show
  const showIgniteSupport = systemMessage && (!query || "ignite support".includes(query));

  // Build unified conversation list
  const freshUnifiedConversations = useMemo(() => {
    const items: UnifiedConversation[] = [];

    // Broadcast
    if (showBroadcast) {
      items.push({
        type: 'broadcast',
        id: 'broadcast',
        key: 'broadcast',
        name: 'Announcements',
        link: '/messages/broadcast',
        lastActivity: displayLatestBroadcast?.created_at || '',
        lastMessage: displayLatestBroadcast ? {
          text: displayLatestBroadcast.text,
          author: (displayLatestBroadcast.profiles as any)?.display_name || '',
          created_at: displayLatestBroadcast.created_at,
          image_url: displayLatestBroadcast.image_url,
        } : undefined,
        unreadCount: unreadCounts?.broadcast || 0,
        isMuted: false,
      });
    }

    // Clubs
    filteredClubs.forEach((club: any) => {
      const lastMsg = displayLatestClubMessages?.[club.id];
      // Treat as Pro until we have a definitive answer. This prevents a flash of
      // "Pro only" lock state after returning from phone lock / visibility refetch
      // when clubProStatus is briefly unavailable.
      const proStatusKnown = !isLoadingClubProStatus && !isFetchingClubProStatus && clubProStatus !== undefined;
      const hasProAccess = proStatusKnown ? (clubProStatus?.[club.id] === true) : true;
      items.push({
        type: 'club',
        id: club.id,
        key: `club-${club.id}`,
        name: club.name,
        avatarUrl: club.logo_url,
        link: `/messages/club/${club.id}`,
        lastActivity: lastMsg?.created_at || '',
        lastMessage: lastMsg,
        unreadCount: unreadCounts?.clubs[club.id] || 0,
        isMuted: mutedChats?.clubs.has(club.id) || false,
        isLocked: proStatusKnown && !hasProAccess,
      });
    });

    // Teams
    filteredTeams.forEach((team: any) => {
      const lastMsg = displayLatestTeamMessages?.[team.id];
      items.push({
        type: 'team',
        id: team.id,
        key: `team-${team.id}`,
        name: team.name,
        avatarUrl: team.logo_url || team.clubs?.logo_url,
        link: `/messages/${team.id}`,
        lastActivity: lastMsg?.created_at || '',
        lastMessage: lastMsg,
        unreadCount: unreadCounts?.teams[team.id] || 0,
        isMuted: mutedChats?.teams.has(team.id) || false,
      });
    });

    // League chats
    filteredLeagueChats.forEach((group: any) => {
      const lastMsg = displayLatestGroupMessages?.[group.id];
      items.push({
        type: 'league',
        id: group.id,
        key: `league-${group.id}`,
        name: group.name,
        avatarUrl: group.clubs?.logo_url ?? null,
        link: `/groups/${group.id}`,
        lastActivity: lastMsg?.created_at || '',
        lastMessage: lastMsg,
        unreadCount: groupUnreadCache?.[group.id] ?? unreadCounts?.groups[group.id] ?? 0,
        isMuted: mutedChats?.groups.has(group.id) || false,
      });
    });

    // Chat groups
    filteredChatGroups.forEach((group: any) => {
      const lastMsg = displayLatestGroupMessages?.[group.id];
      const isPersonalGroup = !group.club_id && !group.team_id && !group.mini_league_id;
      const allowedRoles: string[] = group.allowed_roles || [];
      const isClubRoleGroup =
        !!group.club_id &&
        !group.team_id &&
        !group.mini_league_id &&
        allowedRoles.some((r) =>
          ["coach", "team_admin", "committee_member", "club_admin"].includes(r)
        );
      const proStatusKnown =
        !isLoadingClubProStatus && !isFetchingClubProStatus && clubProStatus !== undefined;
      const clubHasPro = group.club_id
        ? proStatusKnown
          ? clubProStatus?.[group.club_id] === true
          : true
        : true;
      const isLocked =
        isClubRoleGroup && proStatusKnown && !clubHasPro && !isAppAdmin;
      items.push({
        type: 'group',
        id: group.id,
        key: `group-${group.id}`,
        name: group.name,
        link: isLocked ? `/clubs/${group.club_id}/upgrade` : `/groups/${group.id}`,
        lastActivity: lastMsg?.created_at || '',
        lastMessage: lastMsg,
        unreadCount: groupUnreadCache?.[group.id] ?? unreadCounts?.groups[group.id] ?? 0,
        isMuted: mutedChats?.groups.has(group.id) || false,
        canHide: isPersonalGroup,
        category: (group as any).category ?? null,
        isLocked,
      });
    });


    // DM conversations
    filteredDMs.forEach((conv: any) => {
      const isSupport = isIgniteSupportUser(conv.other_user?.id);
      items.push({
        type: 'dm',
        id: conv.id,
        key: `dm-${conv.id}`,
        name: isSupport ? "Ignite Support" : (conv.other_user?.display_name || "Unknown User"),
        avatarUrl: conv.other_user?.avatar_url,
        link: `/messages/dm/${conv.id}`,
        lastActivity: conv.last_message?.created_at || conv.updated_at || '',
        lastMessage: conv.last_message ? {
          text: conv.last_message.text,
          author: conv.last_message.author_id === user?.id ? "You" : (conv.other_user?.display_name || ""),
          created_at: conv.last_message.created_at,
          image_url: conv.last_message.image_url,
        } : undefined,
        unreadCount: unreadCounts?.dms[conv.id] || 0,
        isMuted: false,
        canHide: !isSupport,
        dmData: conv,
      });
    });

    // Club admin conversations (filter by search query against member name / club name / last message)
    const filteredAdminConvs = query
      ? clubAdminConversations.filter((conv) => {
          const name = conv.member_name?.toLowerCase() || "";
          const club = conv.club_name?.toLowerCase() || "";
          const text = conv.last_text?.toLowerCase() || "";
          return name.includes(query) || club.includes(query) || text.includes(query);
        })
      : clubAdminConversations;
    filteredAdminConvs.forEach((conv) => {
      items.push({
        type: 'admin_group',
        id: conv.id,
        key: `admin-group-${conv.id}`,
        name: conv.member_name,
        avatarUrl: conv.member_avatar,
        link: `/messages/club-admin/${conv.id}`,
        lastActivity: conv.last_created_at || conv.updated_at || '',
        lastMessage: conv.last_created_at ? {
          text: conv.last_text || '',
          author: conv.last_author_id === user?.id ? 'You' : conv.member_name,
          created_at: conv.last_created_at,
          image_url: conv.last_image,
        } : undefined,
        unreadCount: 0,
        isMuted: false,
        category: 'Admin Groups',
      });
    });


    // Ignite Support system message (if not already shown as a DM)
    if (showIgniteSupport && !filteredDMs.some((conv: any) => isIgniteSupportUser(conv.other_user?.id))) {
      items.push({
        type: 'support',
        id: 'ignite-support',
        key: 'ignite-support',
        name: 'Ignite Support',
        link: '/messages/welcome',
        lastActivity: systemMessage?.created_at || '',
        lastMessage: systemMessage ? {
          text: systemMessage.text.substring(0, 60) + '...',
          author: '',
          created_at: systemMessage.created_at,
        } : undefined,
        unreadCount: 0,
        isMuted: false,
      });
    }

    // Attach drafts and bump lastActivity if draft is more recent than last message
    return items.map((item) => {
      const draftId = item.type === 'broadcast' ? 'broadcast' : item.id;
      const draft = draftFor(draftId);
      if (!draft) return item;
      const draftTime = draft.updatedAt;
      const lastTime = item.lastActivity;
      const isNewer = !lastTime || new Date(draftTime).getTime() > new Date(lastTime).getTime();
      return {
        ...item,
        draftText: draft.text,
        lastActivity: isNewer ? draftTime : lastTime,
      };
    });
  }, [
    showBroadcast, displayLatestBroadcast, unreadCounts, groupUnreadCache,
    filteredClubs, displayLatestClubMessages, isLoadingClubProStatus, isFetchingClubProStatus, clubProStatus, mutedChats,
    filteredTeams, displayLatestTeamMessages,
    filteredLeagueChats, filteredChatGroups, displayLatestGroupMessages,
    filteredDMs, clubAdminConversations, query, user?.id, showIgniteSupport, systemMessage, allDrafts,
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
  const referencedEventIds = useMemo(() => {
    const set = new Set<string>();
    unifiedConversations.forEach((c) => {
      extractEventIds(c.lastMessage?.text).forEach((id) => set.add(id));
    });
    return Array.from(set);
  }, [unifiedConversations]);

  const referencedVaultFolderIds = useMemo(() => {
    const set = new Set<string>();
    unifiedConversations.forEach((c) => {
      extractVaultFolderIds(c.lastMessage?.text).forEach((id) => set.add(id));
    });
    return Array.from(set);
  }, [unifiedConversations]);

  const referencedVaultFileIds = useMemo(() => {
    const set = new Set<string>();
    unifiedConversations.forEach((c) => {
      extractVaultFileIds(c.lastMessage?.text).forEach((id) => set.add(id));
    });
    return Array.from(set);
  }, [unifiedConversations]);

  const { data: eventTitleMap = {} } = useQuery({
    queryKey: ["messages-page-event-titles", referencedEventIds.join(",")],
    queryFn: async () => {
      if (referencedEventIds.length === 0) return {} as Record<string, string>;
      const { data } = await supabase
        .from("events")
        .select("id, title")
        .in("id", referencedEventIds);
      const map: Record<string, string> = {};
      (data || []).forEach((e) => {
        if (e?.id && e?.title) map[e.id.toLowerCase()] = e.title;
      });
      return map;
    },
    enabled: referencedEventIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vaultFolderNameMap = {} } = useQuery({
    queryKey: ["messages-page-vault-folder-names", referencedVaultFolderIds.join(",")],
    queryFn: async () => {
      if (referencedVaultFolderIds.length === 0) return {} as Record<string, string>;
      const { data } = await supabase
        .from("vault_folders")
        .select("id, name")
        .in("id", referencedVaultFolderIds);
      const map: Record<string, string> = {};
      (data || []).forEach((f) => {
        if (f?.id && f?.name) map[f.id.toLowerCase()] = f.name;
      });
      return map;
    },
    enabled: referencedVaultFolderIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vaultFileNameMap = {} } = useQuery({
    queryKey: ["messages-page-vault-file-names", referencedVaultFileIds.join(",")],
    queryFn: async () => {
      if (referencedVaultFileIds.length === 0) return {} as Record<string, string>;
      const { data } = await supabase
        .from("vault_files")
        .select("id, name")
        .in("id", referencedVaultFileIds);
      const map: Record<string, string> = {};
      (data || []).forEach((f) => {
        if (f?.id && f?.name) map[f.id.toLowerCase()] = f.name;
      });
      return map;
    },
    enabled: referencedVaultFileIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Apply type filter chip (teams/groups/dms/club/league/all).
  // Broadcasts and Ignite Support always remain visible regardless of chip
  // (they're not real conversation types users think about filtering away).
  const typeFilteredConversations = useMemo(() => {
    if (typeFilter === 'all') return unifiedConversations;
    return unifiedConversations.filter((c) => {
      if (c.type === 'support') return true;
      switch (typeFilter) {
        // Mini-leagues (e.g. Maxiroos) live under Teams — users mentally treat
        // them as another team they belong to.
        case 'teams': return c.type === 'team' || c.type === 'league';
        // Groups bucket includes club broadcast-style groups alongside regular chat groups.
        case 'groups': return c.type === 'group' || c.type === 'club' || c.type === 'admin_group';
        case 'dms': return c.type === 'dm';
        default: return true;
      }
    });
  }, [unifiedConversations, typeFilter]);

  const sortByActivityDesc = (a: UnifiedConversation, b: UnifiedConversation) => {
    if (!a.lastActivity && !b.lastActivity) return 0;
    if (!a.lastActivity) return 1;
    if (!b.lastActivity) return -1;
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
  };

  // Split into unread and recent
  const unreadItems = useMemo(() => {
    return typeFilteredConversations.filter(c => c.unreadCount > 0).sort(sortByActivityDesc);
  }, [typeFilteredConversations]);

  const recentItems = useMemo(() => {
    return typeFilteredConversations.filter(c => c.unreadCount === 0).sort(sortByActivityDesc);
  }, [typeFilteredConversations]);

  // Mark first non-empty render for perf diagnostics (one-shot).
  // Progressive disclosure for operational groups: when a user has many
  // stale group/league chats, collapse the long tail behind a "Show more
  // groups" toggle. Only kicks in for power users — regular parents with
  // only a few groups see no change.
  const STALE_OPS_DAYS = 30;
  const STALE_OPS_THRESHOLD = 6;
  const OPS_VISIBLE_WHEN_COLLAPSED = 2;
  const { visibleRecent, hiddenOps } = useMemo(() => {
    const cutoff = Date.now() - STALE_OPS_DAYS * 24 * 60 * 60 * 1000;
    const isStaleOp = (c: UnifiedConversation) =>
      (c.type === 'group' || c.type === 'league') &&
      c.unreadCount === 0 &&
      !c.draftText &&
      (!c.lastActivity || new Date(c.lastActivity).getTime() < cutoff);

    const stale = recentItems.filter(isStaleOp);
    if (stale.length <= STALE_OPS_THRESHOLD || showAllOps || typeFilter !== 'all' || !!query) {
      return { visibleRecent: recentItems, hiddenOps: [] as UnifiedConversation[] };
    }
    const keepStaleIds = new Set(stale.slice(0, OPS_VISIBLE_WHEN_COLLAPSED).map(c => c.key));
    const hidden = stale.slice(OPS_VISIBLE_WHEN_COLLAPSED);
    const hiddenIds = new Set(hidden.map(c => c.key));
    const visible = recentItems.filter(c => !hiddenIds.has(c.key) || keepStaleIds.has(c.key));
    return { visibleRecent: visible, hiddenOps: hidden };
  }, [recentItems, showAllOps, typeFilter, query]);


  const hasNoResults = query && unifiedConversations.length === 0;
  const hasNoMessages = !displayTeams?.length && !displayMemberClubs?.length && displayChatGroups.length === 0 && filteredDMs.length === 0;

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
  const proAccessQueryReady = !isLoadingProAccess && !isFetchingProAccess && hasAnyProAccess !== undefined;
  const clubProQueryReady = !isLoadingClubProStatus && !isFetchingClubProStatus && clubProStatus !== undefined;
  const scopedClubIsPro = effectiveClubFilter ? clubProStatus?.[effectiveClubFilter] === true : null;
  const proGateFails = effectiveClubFilter
    ? clubProQueryReady && scopedClubIsPro === false
    : proAccessQueryReady && hasAnyProAccess === false;
  const hasAdminRoleButNoPro = proAccessQueryReady && clubProQueryReady && !!(adminTeamIds?.length || adminClubs?.length) && proGateFails && isAppAdmin === false;
  const scopedAdminClubId = effectiveClubFilter
    ? displayAdminClubs.find((club: any) => club.id === effectiveClubFilter)?.id ?? null
    : null;
  const upgradeClubId = effectiveClubFilter
    ? scopedAdminClubId ?? effectiveClubFilter
    : displayAdminClubs[0]?.id ?? displayMemberClubs[0]?.id ?? null;

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

          {aiCatchUpResolved && recapVisible && (
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
        // Only alarm the user when there is genuinely nothing to show. A
        // failed background refresh over a rendered (cached) inbox is not an
        // error the user needs to act on.
        hasError={
          !!(teamsError || memberClubsError || chatGroupsError) &&
          unifiedConversations.length === 0
        }
        onRetry={async () => {
          // No `stale` filter: errored queries that still hold cached data are
          // stale, so filtering by `stale: false` made retry a silent no-op.
          await queryClient.refetchQueries({ type: "all", predicate: (q) => q.state.status === "error" });
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






      {/* New message bottom sheet (flat: DM + group types) */}
      <NewMessageSheet
        open={showNewMessageSheet}
        onOpenChange={setShowNewMessageSheet}
        canCreateGroups={!!canCreateGroups}
        canCreateCustomGroup={!!(hasAnyProAccess || isAppAdmin)}
        hasPro={effectiveClubFilter ? scopedClubIsPro === true : !!hasAnyProAccess}
        isAppAdmin={!!isAppAdmin}
        upgradeClubId={upgradeClubId}
        onPickDM={() => setShowDMDialog(true)}
        onPickCustom={() => setShowCustomGroupDialog(true)}
        onPickTeam={() => {
          setGroupDialogType("team");
          setShowGroupDialog(true);
        }}
        onPickRole={() => {
          setGroupDialogType("role");
          setShowGroupDialog(true);
        }}
      />


      {/* DM and Group dialogs — DM creation is Pro-gated */}
      {(!!hasAnyProAccess || !!isAppAdmin) && (
        <StartDMDialog open={showDMDialog} onOpenChange={setShowDMDialog} mode="dm" />
      )}
      {(!!hasAnyProAccess || !!isAppAdmin) && (
        <StartDMDialog
          open={showCustomGroupDialog}
          onOpenChange={setShowCustomGroupDialog}
          mode="custom-group"
          allowCategory={!!canCreateGroups}
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
          exactly the same reveal latch as the conversation list, so the chips
          paint in the SAME frame as the rows instead of popping in afterwards
          and pushing the list down (previously gated on all four inbox queries
          having individually resolved, which lands later than first reveal). */}
      {!showSkeletonLoading && (() => {
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
