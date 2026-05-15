import { useState, useMemo, useEffect, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAllChatDrafts } from "@/hooks/useChatDraft";
import { usePersistedFilter } from "@/lib/persistedFilter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, ChevronRight, Users, Trash2, Search, BellOff, ImageIcon, Crown, Lock, RefreshCw, Flame, Plus, Filter, Check, Building2, Clock } from "lucide-react";
import { ConversationAvatar } from "@/components/chat/ConversationAvatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { formatTimeShort } from "@/lib/formatTimeShort";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { getCachedMessagesPageData, cacheMessagesPageData } from "@/lib/messagesPageCache";
import { useClubTheme } from "@/hooks/useClubTheme";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";
import { fetchUnreadMessageCounts } from "@/lib/unreadMessageCounts";
import { isIgniteSupportUser } from "@/lib/systemUser";
import { ensureFreshSession } from "@/lib/ensureFreshSession";
import { getProfileFromCache, cacheProfiles, fetchProfilesWithCache } from "@/lib/profileCache";
import { formatMessagePreview as stripMentionFormatting, getMessagePreviewText as getMessagePreview, extractEventIds, extractVaultFolderIds, extractVaultFileIds } from "@/lib/messagePreview";
import CreateGroupDialog from "@/components/chat/CreateGroupDialog";
import EditGroupDialog from "@/components/chat/EditGroupDialog";
import { StartDMDialog } from "@/components/chat/StartDMDialog";
import { NewMessageSheet } from "@/components/chat/NewMessageSheet";
import { NewGroupTypeSheet } from "@/components/chat/NewGroupTypeSheet";
import { ContactClubButton } from "@/components/ContactClubButton";
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

// Component for message preview with optional image thumbnail
const MessagePreview = ({ 
  text, 
  imageUrl, 
  author, 
  hasUnread, 
  fallback,
  isAnnouncement,
  eventTitles,
  vaultFolderNames,
  vaultFileNames,
}: { 
  text?: string; 
  imageUrl?: string | null; 
  author?: string;
  hasUnread?: boolean;
  fallback: string;
  isAnnouncement?: boolean;
  eventTitles?: Record<string, string>;
  vaultFolderNames?: Record<string, string>;
  vaultFileNames?: Record<string, string>;
}) => {
  const hasText = text && text.trim();
  const isImageOnly = !hasText && imageUrl;
  const hasTextAndImage = hasText && imageUrl;
  
  // Strip mention formatting (and resolve event/vault names) from text for preview
  const displayText = hasText
    ? stripMentionFormatting(text!, { eventTitles, vaultFolderNames, vaultFileNames })
    : null;
  
  if (!hasText && !imageUrl && !author) {
    return <span className="text-muted-foreground">No messages yet</span>;
  }
  
  return (
    <span className="line-clamp-2">
      {(isImageOnly || hasTextAndImage) && (
        <ImageIcon className="h-3.5 w-3.5 inline-block align-text-bottom mr-0.5 text-muted-foreground" />
      )}
      {author && <span className="font-semibold text-foreground">{isAnnouncement ? abbreviateClubName(author) : getFirstName(author)}: </span>}
      {displayText ?? (isImageOnly ? "Image" : "No messages yet")}
    </span>
  );
};

interface Team {
  id: string;
  name: string;
  logo_url: string | null;
  clubs: { id: string; name: string; logo_url: string | null; sport: string | null };
}

interface Club {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
}

interface UnifiedConversation {
  type: 'club' | 'team' | 'group' | 'league' | 'dm' | 'broadcast' | 'support';
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
}

export default function MessagesPage() {
  const { user, initialized, refreshUnreadCount } = useAuth();
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
  const [localClubFilter, setLocalClubFilter] = usePersistedFilter("messages.localClubFilter", "all");
  const [showClubFilterDrawer, setShowClubFilterDrawer] = useState(false);
  const { activeClubFilter, activeClubTeamIds } = useClubTheme();

  // Effective club filter: use theme filter if active, otherwise use local filter
  const effectiveClubFilter = activeClubFilter || (localClubFilter !== "all" ? localClubFilter : null);
  const hasLocalFilter = !activeClubFilter && localClubFilter !== "all";

  // Load cached data for instant display
  const cachedData = useMemo(() => {
    if (!user?.id) return null;
    return getCachedMessagesPageData(user.id);
  }, [user?.id]);

  // Fetch unread message notifications grouped by thread
  const { data: unreadCounts } = useQuery({
    queryKey: ["unread-message-counts", user?.id],
    queryFn: () => fetchUnreadMessageCounts(user!.id),
    enabled: !!user && initialized,
    refetchInterval: INBOX_REFETCH_INTERVAL_MS,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Delete group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from("chat_groups")
        .delete()
        .eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Group deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
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
  const { data: isAppAdmin } = useQuery({
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
        .is("deleted_at", null);

      return data as Club[];
    },
    enabled: !!user && initialized,
    retry: 3,
    staleTime: 5 * 60 * 1000,
    placeholderData: cachedData?.adminClubs ?? ((prev) => prev),
  });

  // Fetch member clubs with their latest messages in a single query
  const { data: memberClubsWithMessages, isLoading: memberClubsLoading, isFetched: memberClubsFetched } = useQuery({
    queryKey: ["member-clubs-with-messages", user?.id],
    retry: 3,
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
        .is("deleted_at", null);

      const clubs = data as Club[];
      
      // Fetch latest messages for all clubs in parallel, then batch a single
      // profiles lookup for all authors. M1 perf: removes the per-club N+1
      // profile query that previously serialized after each last-message fetch.
      const latestMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null }> = {};

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
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", authorIds);
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
    // Keep latest-message previews fresh: previously staleTime=5m + refetchOnMount=true
    // meant returning to /messages within 5 min showed cached previews and only the
    // 30s/120s poll (or realtime) caught up. Treat list as always stale on mount so
    // re-entering the inbox always pulls the freshest "last message" row.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: INBOX_REFETCH_INTERVAL_MS,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev ?? (cachedData?.memberClubs ? { clubs: cachedData.memberClubs as any, latestMessages: cachedData.latestClubMessages ?? {} } : undefined),
  });
  
  // Extract clubs and latest messages from combined query
  const memberClubs = memberClubsWithMessages?.clubs ?? [];
  const latestClubMessages = memberClubsWithMessages?.latestMessages ?? {};

  // Get latest broadcast message
  const { data: latestBroadcast, isFetched: latestBroadcastFetched } = useQuery({
    queryKey: ["latest-broadcast"],
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
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", data.author_id)
          .maybeSingle();
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
  const { data: teamsWithMessages, isLoading: teamsLoading, isFetched: teamsFetched } = useQuery({
    queryKey: ["my-teams-with-messages", user?.id],
    retry: 3,
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
          clubs (id, name, logo_url, sport)
        `)
        .in("id", teamIds);

      if (error) throw error;
      const teams = data as Team[];
      
      // M1 perf: batch profile lookups for all team last-message authors.
      const latestMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null; is_announcement?: boolean }> = {};

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
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", authorIds);
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
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: INBOX_REFETCH_INTERVAL_MS,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev ?? (cachedData?.teams ? { teams: cachedData.teams as any, latestMessages: cachedData.latestTeamMessages ?? {} } : undefined),
  });
  
  // Extract teams and latest messages from combined query
  const teams = teamsWithMessages?.teams ?? [];
  const latestTeamMessages = teamsWithMessages?.latestMessages ?? {};

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
  const { data: isCommitteeMember } = useQuery({
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
  const { data: userAllRoles } = useQuery({
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
  const { data: userLeagueIds } = useQuery({
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
  const { data: chatGroupsWithMessages, isLoading: chatGroupsLoading, isFetched: chatGroupsFetched } = useQuery({
    queryKey: ["my-chat-groups-with-messages", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_groups")
        .select("*, teams(name), clubs(name), mini_leagues:mini_league_id(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      
      const groups = data || [];
      
      // M1 perf: batch profile lookups for all group last-message authors.
      const latestMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null }> = {};

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
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", authorIds);
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
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: INBOX_REFETCH_INTERVAL_MS,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev ?? (cachedData?.chatGroups ? { groups: cachedData.chatGroups as any, latestMessages: cachedData.latestGroupMessages ?? {} } : undefined),
  });
  
  // Extract groups and latest messages from combined query
  const chatGroups = chatGroupsWithMessages?.groups ?? [];
  const latestGroupMessages = chatGroupsWithMessages?.latestMessages ?? {};

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
  const { data: dmConversations, isLoading: dmLoading, isFetching: dmFetching, isFetched: dmFetched } = useQuery({
    queryKey: ["dm-conversations", user?.id],
    queryFn: async () => {
      // Ensure the access token is valid before any reads. After the phone
      // wakes from lock, the JWT may have expired — issuing reads with a
      // stale token causes RLS to evaluate auth.uid() as NULL, which silently
      // returns empty profile rows and ends up rendering "Unknown User".
      try {
        await ensureFreshSession();
      } catch {
        // If session refresh fails, fall through — the query below will
        // throw and React Query will keep showing previous data.
      }

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

      const [profilesMap, messagesResult] = await Promise.all([
        // Use the global profile cache layer — returns cached/stale entries
        // immediately and falls back to whatever is cached if the network
        // fetch fails. This prevents the inbox from rendering "Unknown User"
        // when the profiles SELECT is throttled, blocked by a transient RLS
        // hiccup, or returns an empty row.
        fetchProfilesWithCache(otherUserIds, { allowStale: true, timeout: 15000 }),
        Promise.all(
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
        ),
      ]);

      const messageMap = new Map(messagesResult.map(m => [m.conversationId, m.message]));

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
    enabled: !!user && initialized && !!hasAnyProAccess,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: INBOX_REFETCH_INTERVAL_MS,
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

    const channel = supabase
      .channel(`messages-inbox-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, (payload: any) => {
        const ids = teamIdsRef.current;
        if (ids.size && !ids.has(payload.new?.team_id)) return;
        schedule('team', () => queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages", user.id] }));
        bumpUnread();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'club_messages' }, (payload: any) => {
        const ids = clubIdsRef.current;
        if (ids.size && !ids.has(payload.new?.club_id)) return;
        schedule('club', () => queryClient.invalidateQueries({ queryKey: ["member-clubs-with-messages", user.id] }));
        bumpUnread();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, (payload: any) => {
        const ids = groupIdsRef.current;
        if (ids.size && !ids.has(payload.new?.group_id)) return;
        schedule('group', () => queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages", user.id] }));
        bumpUnread();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, () => {
        schedule('dm', () => queryClient.invalidateQueries({ queryKey: ["dm-conversations", user.id] }));
        bumpUnread();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast_messages' }, () => {
        queryClient.invalidateQueries({ queryKey: ["latest-broadcast"] });
        bumpUnread();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
        const { data } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", ids);
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

    const channel = supabase
      .channel(`messages-inbox-light-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, (payload: any) => {
        const row = payload.new;
        if (!row?.team_id) return;
        const ids = teamIdsRef.current;
        if (ids.size && !ids.has(row.team_id)) return;
        const isAnnouncement = !!(row.is_club_announcement && row.club_announcement_name);
        const author = isAnnouncement
          ? row.club_announcement_name
          : resolveAuthor(row.author_id, { kind: 'team', targetId: row.team_id });
        queryClient.setQueryData(["my-teams-with-messages", user.id], (old: any) => {
          if (!old) return old;
          const prev = old.latestMessages?.[row.team_id];
          return {
            ...old,
            latestMessages: {
              ...(old.latestMessages || {}),
              [row.team_id]: {
                text: row.text ?? '',
                author: author || (prev?.author ?? ""),
                created_at: row.created_at,
                image_url: row.image_url ?? null,
                is_announcement: isAnnouncement,
              },
            },
          };
        });
        bumpUnread('team', row.team_id, row.author_id);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'club_messages' }, (payload: any) => {
        const row = payload.new;
        if (!row?.club_id) return;
        const ids = clubIdsRef.current;
        if (ids.size && !ids.has(row.club_id)) return;
        const author = resolveAuthor(row.author_id, { kind: 'club', targetId: row.club_id });
        queryClient.setQueryData(["member-clubs-with-messages", user.id], (old: any) => {
          if (!old) return old;
          const prev = old.latestMessages?.[row.club_id];
          return {
            ...old,
            latestMessages: {
              ...(old.latestMessages || {}),
              [row.club_id]: {
                text: row.text ?? '',
                author: author || (prev?.author ?? ""),
                created_at: row.created_at,
                image_url: row.image_url ?? null,
              },
            },
          };
        });
        bumpUnread('club', row.club_id, row.author_id);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, (payload: any) => {
        const row = payload.new;
        if (!row?.group_id) return;
        const ids = groupIdsRef.current;
        if (ids.size && !ids.has(row.group_id)) return;
        const author = resolveAuthor(row.author_id, { kind: 'group', targetId: row.group_id });
        queryClient.setQueryData(["my-chat-groups-with-messages", user.id], (old: any) => {
          if (!old) return old;
          const prev = old.latestMessages?.[row.group_id];
          return {
            ...old,
            latestMessages: {
              ...(old.latestMessages || {}),
              [row.group_id]: {
                text: row.text ?? '',
                author: author || (prev?.author ?? ""),
                created_at: row.created_at,
                image_url: row.image_url ?? null,
              },
            },
          };
        });
        bumpUnread('group', row.group_id, row.author_id);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload: any) => {
        const row = payload.new;
        if (!row?.conversation_id) return;
        // For DMs, the "author name" surface is the other_user.display_name on
        // the conversation row — already populated. Only queue a lookup if
        // the other_user is missing (rare, e.g. brand-new convo arriving).
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
        // If the other participant's name is unknown, queue a lookup.
        const convs = queryClient.getQueryData<any[]>(["dm-conversations", user.id]);
        const conv = convs?.find(c => c.id === row.conversation_id);
        const otherId = conv?.other_user?.id
          ?? (conv?.participant_1 === user.id ? conv?.participant_2 : conv?.participant_1);
        if (otherId && otherId !== user.id && !conv?.other_user?.display_name) {
          resolveAuthor(otherId, { kind: 'dm', targetId: row.conversation_id });
        }
        bumpUnread('dm', row.conversation_id, row.author_id);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast_messages' }, (payload: any) => {
        const row = payload.new;
        queryClient.setQueryData(["latest-broadcast"], (old: any) => ({
          text: row.text ?? '',
          created_at: row.created_at,
          image_url: row.image_url ?? null,
          profiles: old?.profiles ?? null,
        }));
        bumpUnread('broadcast', null);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [user?.id, queryClient]);

  // Check if we have cached data to show immediately
  const hasCachedData = cachedData && (
    cachedData.teams?.length > 0 || 
    cachedData.memberClubs?.length > 0 || 
    cachedData.chatGroups?.length > 0
  );

  const hasAnyDisplayData = !!(teams?.length || memberClubs?.length || chatGroups?.length);
  const isLoadingFreshData = !hasAnyDisplayData && !hasCachedData && !!(teamsLoading || memberClubsLoading || chatGroupsLoading || isLoadingProAccess || isLoadingClubProStatus);
  // Wait for fresh latest-message data before sorting/rendering, so the most recent
  // thread is at the top on first paint (cached `lastActivity` may be stale).
  const proAccessKnown = !isLoadingProAccess && !isFetchingProAccess && hasAnyProAccess !== undefined;
  const freshSortDataReady = teamsFetched && memberClubsFetched && chatGroupsFetched && latestBroadcastFetched && proAccessKnown && (!hasAnyProAccess || dmFetched);
  // Always wait for fresh sort data before rendering the list, even when cached
  // data exists. Otherwise the cached order paints first and threads visibly
  // shuffle when fresh `lastActivity` timestamps arrive a moment later.
  const showSkeletonLoading = isLoadingFreshData || !freshSortDataReady;

  // Determine which data to display (prefer fresh, fallback to cached)
  const displayTeams = teams || cachedData?.teams || [];
  const displayMemberClubs = memberClubs || cachedData?.memberClubs || [];
  const displayAdminClubs = adminClubs || cachedData?.adminClubs || [];
  const allChatGroups = chatGroups?.length > 0 ? chatGroups : (cachedData?.chatGroups as any) || [];
  
  // Filter chat groups by user's roles
  const displayChatGroups = useMemo(() => {
    if (isAppAdmin || isCommitteeMember) return allChatGroups;

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
  }, [allChatGroups, userAllRoles, userLeagueIds, isAppAdmin, isCommitteeMember]);

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
        // Personal/custom groups have no club or team scope — always show them
        // regardless of the club filter so they don't disappear unexpectedly.
        const isPersonalGroup = !group.club_id && !group.team_id && !group.mini_league_id;
        if (isPersonalGroup) return true;
        return (
          group.club_id === effectiveClubFilter ||
          (group.team_id && (activeClubFilter ? activeClubTeamIds.includes(group.team_id) : displayTeams.some((t: any) => t.id === group.team_id && t.clubs?.id === effectiveClubFilter)))
        );
      });
    }
    // Apply hidden filter for custom (personal) groups — they reappear when
    // a new message arrives after the time the user hid them.
    groups = groups.filter((group: any) => {
      const isPersonalGroup = !group.club_id && !group.team_id && !group.mini_league_id;
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
  }, [regularChatGroups, query, effectiveClubFilter, activeClubFilter, activeClubTeamIds, displayTeams, hiddenGroupMap, displayLatestGroupMessages]);

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

  // Filtered DM conversations
  // Hide empty DMs (no messages exchanged) from the list — these are stub
  // conversation rows that get created when someone opens a DM thread without
  // sending anything. They'd otherwise float to the top via `updated_at`.
  const filteredDMs = useMemo(() => {
    if (!dmConversations) return [];
    return dmConversations.filter((conv: any) => {
      const hiddenAt = hiddenDMMap?.get(conv.id);
      if (hiddenAt) {
        const lastMsgAt = conv.last_message?.created_at;
        const stillHidden = !lastMsgAt || new Date(lastMsgAt).getTime() <= new Date(hiddenAt).getTime();
        if (stillHidden && !query) return false;
      }
      if (query) {
        return conv.other_user?.display_name?.toLowerCase().includes(query);
      }
      // Surface if there's a real message OR an unsent draft for this thread.
      const hasDraft = !!allDrafts[conv.id]?.text?.trim();
      return !!conv.last_message || hasDraft;
    });
  }, [dmConversations, hiddenDMMap, query, allDrafts]);

  // Check if Ignite Support should show
  const showIgniteSupport = systemMessage && (!query || "ignite support".includes(query));

  // Build unified conversation list
  const unifiedConversations = useMemo(() => {
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
        link: `/groups/${group.id}`,
        lastActivity: lastMsg?.created_at || '',
        lastMessage: lastMsg,
        unreadCount: unreadCounts?.groups[group.id] || 0,
        isMuted: mutedChats?.groups.has(group.id) || false,
      });
    });

    // Chat groups
    filteredChatGroups.forEach((group: any) => {
      const lastMsg = displayLatestGroupMessages?.[group.id];
      const isPersonalGroup = !group.club_id && !group.team_id && !group.mini_league_id;
      items.push({
        type: 'group',
        id: group.id,
        key: `group-${group.id}`,
        name: group.name,
        link: `/groups/${group.id}`,
        lastActivity: lastMsg?.created_at || '',
        lastMessage: lastMsg,
        unreadCount: unreadCounts?.groups[group.id] || 0,
        isMuted: mutedChats?.groups.has(group.id) || false,
        canHide: isPersonalGroup,
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
    showBroadcast, displayLatestBroadcast, unreadCounts,
    filteredClubs, displayLatestClubMessages, isLoadingClubProStatus, isFetchingClubProStatus, clubProStatus, mutedChats,
    filteredTeams, displayLatestTeamMessages,
    filteredLeagueChats, filteredChatGroups, displayLatestGroupMessages,
    filteredDMs, user?.id, showIgniteSupport, systemMessage, allDrafts,
  ]);

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

  // Split into unread and recent
  const unreadItems = useMemo(() => {
    return unifiedConversations
      .filter(c => c.unreadCount > 0)
      .sort((a, b) => {
        if (!a.lastActivity && !b.lastActivity) return 0;
        if (!a.lastActivity) return 1;
        if (!b.lastActivity) return -1;
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      });
  }, [unifiedConversations]);

  const recentItems = useMemo(() => {
    return unifiedConversations
      .filter(c => c.unreadCount === 0)
      .sort((a, b) => {
        if (!a.lastActivity && !b.lastActivity) return 0;
        if (!a.lastActivity) return 1;
        if (!b.lastActivity) return -1;
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      });
  }, [unifiedConversations]);

  const hasNoResults = query && unifiedConversations.length === 0;
  const hasNoMessages = !displayTeams?.length && !displayMemberClubs?.length && displayChatGroups.length === 0;

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

  // Type label map
  const typeLabels: Record<string, string> = {
    club: 'Club',
    team: 'Team',
    group: 'Group',
    league: 'League',
    dm: 'DM',
  };

  // Render a unified conversation card
  const renderConversationCard = (item: UnifiedConversation) => {
    const hasUnread = item.unreadCount > 0;
    const typeLabel = typeLabels[item.type];

    // Broadcast card
    if (item.type === 'broadcast') {
      return (
        <Link key={item.key} to={item.link}>
          <Card className="hover:border-primary/50 transition-colors bg-primary/5">
            <CardContent className="py-[18px] px-3 flex items-center gap-3">
              <div className="shrink-0">
                <ConversationAvatar type="broadcast" name="Announcements" className="h-9 w-9" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <h3 className={`truncate text-[15px] leading-tight ${hasUnread ? 'font-bold' : 'font-semibold'}`}>Announcements</h3>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {item.lastMessage?.created_at && (
                      <span className="text-xs text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                    )}
                    {hasUnread && (
                      <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                        {item.unreadCount > 9 ? "9+" : item.unreadCount}
                      </span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </div>
                <p className={`text-[13px] leading-relaxed mt-1 line-clamp-2 ${hasUnread ? 'text-foreground/90' : 'text-muted-foreground'}`}>
                  {item.draftText ? (
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold text-destructive">Draft:</span>
                      <span className="truncate">{item.draftText}</span>
                    </span>
                  ) : (
                    <MessagePreview
                      text={item.lastMessage?.text}
                      imageUrl={item.lastMessage?.image_url}
                      author={item.lastMessage?.author}
                      hasUnread={hasUnread}
                      fallback="Official announcements and updates"
                      eventTitles={eventTitleMap}
                      vaultFolderNames={vaultFolderNameMap}
                      vaultFileNames={vaultFileNameMap}
                    />
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      );
    }

    // Support card (Ignite Support system message)
    if (item.type === 'support') {
      return (
        <Link key={item.key} to={item.link}>
          <Card className="hover:border-primary/50 transition-colors">
            <CardContent className="py-[18px] px-3 flex items-center gap-3">
              <ConversationAvatar type="support" name="Ignite Support" className="h-9 w-9" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <h3 className="truncate text-[15px] leading-tight font-semibold">Ignite Support</h3>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {item.lastMessage?.created_at && (
                      <span className="text-xs text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </div>
                <p className="text-[13px] leading-relaxed mt-1 line-clamp-2 text-foreground/70">
                  {item.lastMessage?.text || "Welcome message"}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      );
    }

    // Locked club card
    if (item.type === 'club' && item.isLocked) {
      return (
        <Link key={item.key} to={item.link}>
          <Card className="opacity-70 hover:border-primary/50 transition-colors">
            <CardContent className="py-3 px-2.5 flex items-center gap-2">
              <div className="relative">
                <Avatar className="h-10 w-10 grayscale">
                  <AvatarImage src={item.avatarUrl || undefined} />
                  <AvatarFallback className="bg-secondary text-secondary-foreground text-sm">
                    {item.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-muted flex items-center justify-center border-2 border-background">
                  <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-semibold text-muted-foreground text-sm">{item.name}</h3>
                  <Badge variant="secondary" className="gap-1 text-[10px] shrink-0 px-1.5 py-0">
                    <Crown className="h-2.5 w-2.5" />
                    Pro
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  Club Pro required for club-wide chat
                </p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        </Link>
      );
    }

    // DM card
    if (item.type === 'dm') {
      const conv = item.dmData;
      const isOwn = conv?.last_message?.author_id === user?.id;
      const isSupport = isIgniteSupportUser(conv?.other_user?.id);
      
      const dmCard = (
        <Link key={item.key} to={item.link}>
          <Card className="hover:border-primary/50 transition-colors">
            <CardContent className="py-[18px] px-3 flex items-center gap-3">
              <div className="shrink-0">
                {isSupport ? (
                  <ConversationAvatar type="support" name="Ignite Support" className="h-9 w-9" />
                ) : (
                  <ConversationAvatar type="dm" name={item.name} avatarUrl={conv?.other_user?.avatar_url} className="h-9 w-9" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h3 className={`truncate text-[15px] leading-tight ${hasUnread ? 'font-bold' : 'font-semibold'}`}>
                      {item.name}
                    </h3>
                    {typeLabel && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal text-muted-foreground/70 shrink-0 border-muted/60">
                        {typeLabel}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {item.lastMessage?.created_at && (
                      <span className="text-xs text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                    )}
                    {hasUnread && (
                      <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                        {item.unreadCount > 9 ? "9+" : item.unreadCount}
                      </span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </div>
                <p className={`text-[13px] leading-relaxed mt-1 line-clamp-2 ${hasUnread ? 'text-foreground/90' : 'text-muted-foreground'}`}>
                  {item.draftText ? (
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold text-destructive">Draft:</span>
                      <span className="truncate">{item.draftText}</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      {isOwn && <span className="text-muted-foreground">You:</span>}
                      {conv?.last_message?.image_url && <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <span className="truncate">
                        {conv?.last_message?.text ? stripMentionFormatting(conv.last_message.text, eventTitleMap) :
                         conv?.last_message?.image_url ? "Image" : "Start a conversation"}
                      </span>
                    </span>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      );

      if (!item.canHide) return dmCard;
      return (
        <ContextMenu key={item.key}>
          <ContextMenuTrigger asChild>{dmCard}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => hideDMMutation.mutate(item.id)}>
              <EyeOff className="h-4 w-4 mr-2" />
              Hide conversation
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      );
    }

    // Group/League card
    if (item.type === 'group' || item.type === 'league') {
      const groupCard = (
        <Card
          key={item.key}
          className="hover:border-primary/50 transition-colors cursor-pointer"
          onClick={() => navigate(item.link)}
          tabIndex={0}
          role="link"
        >
          <CardContent className="py-[18px] px-3 flex items-center gap-3">
            <div className="shrink-0">
              <ConversationAvatar type={item.type} name={item.name} className="h-9 w-9" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h3 className={`truncate text-[15px] leading-tight ${hasUnread ? 'font-bold' : 'font-semibold'}`}>{item.name}</h3>
                  {item.isMuted && <BellOff className="h-3 w-3 text-muted-foreground shrink-0" />}
                  {typeLabel && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal text-muted-foreground/70 shrink-0 border-muted/60">
                      {typeLabel}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {item.lastMessage?.created_at && (
                    <span className="text-xs text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                  )}
                  {hasUnread && (
                    <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                      {item.unreadCount > 9 ? "9+" : item.unreadCount}
                    </span>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
              <p className={`text-[13px] leading-relaxed mt-1 line-clamp-2 ${hasUnread ? 'text-foreground/90' : 'text-muted-foreground'}`}>
                {item.draftText ? (
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold text-destructive">Draft:</span>
                    <span className="truncate">{item.draftText}</span>
                  </span>
                ) : (
                  <MessagePreview
                    text={item.lastMessage?.text}
                    imageUrl={item.lastMessage?.image_url}
                    author={item.lastMessage?.author}
                    hasUnread={hasUnread}
                    fallback="No messages yet"
                    eventTitles={eventTitleMap}
                    vaultFolderNames={vaultFolderNameMap}
                    vaultFileNames={vaultFileNameMap}
                  />
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      );

      if (!item.canHide) return groupCard;
      return (
        <ContextMenu key={item.key}>
          <ContextMenuTrigger asChild>{groupCard}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => hideGroupMutation.mutate(item.id)}>
              <EyeOff className="h-4 w-4 mr-2" />
              Hide group
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      );
    }

    // Club/Team card (default)
    return (
      <Link key={item.key} to={item.link}>
        <Card className="hover:border-primary/50 transition-colors">
          <CardContent className="py-[18px] px-3 flex items-center gap-3">
            <div className="shrink-0">
              <ConversationAvatar type={item.type} name={item.name} avatarUrl={item.avatarUrl} className="h-9 w-9" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h3 className={`truncate text-[15px] leading-tight ${hasUnread ? 'font-bold' : 'font-semibold'}`}>{item.name}</h3>
                  {item.isMuted && <BellOff className="h-3 w-3 text-muted-foreground shrink-0" />}
                  {typeLabel && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal text-muted-foreground/70 shrink-0 border-muted/60">
                      {typeLabel}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {item.lastMessage?.created_at && (
                    <span className="text-xs text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                  )}
                  {hasUnread && (
                    <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                      {item.unreadCount > 9 ? "9+" : item.unreadCount}
                    </span>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
              <p className={`text-[13px] leading-relaxed mt-1 line-clamp-2 ${hasUnread ? 'text-foreground/90' : 'text-muted-foreground'}`}>
                {item.draftText ? (
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold text-destructive">Draft:</span>
                    <span className="truncate">{item.draftText}</span>
                  </span>
                ) : (
                  <MessagePreview
                    text={item.lastMessage?.text}
                    imageUrl={item.lastMessage?.image_url}
                    author={item.lastMessage?.author}
                    hasUnread={hasUnread}
                    fallback={item.type === 'club' ? "Club-wide announcements" : "No messages yet"}
                    isAnnouncement={(item.lastMessage as any)?.is_announcement}
                    eventTitles={eventTitleMap}
                    vaultFolderNames={vaultFolderNameMap}
                    vaultFileNames={vaultFileNameMap}
                  />
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  };

  return (
    <div className="py-6 space-y-6">
      {/* Pro upgrade banner for non-Pro admin users */}
      {hasAdminRoleButNoPro && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <Crown className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Unlock Pro Messaging Features</p>
                <p className="text-sm text-muted-foreground">Create custom message groups and access team chat with a Pro subscription. Club chat requires a Club Pro subscription.</p>
              </div>
            </div>
            <Button 
              size="sm" 
              onClick={() => {
                if (adminClubs?.length && adminClubs[0]?.id) {
                  navigate(`/clubs/${adminClubs[0].id}/upgrade`);
                } else if (adminTeamIds?.length && adminTeamIds[0]) {
                  navigate(`/teams/${adminTeamIds[0]}/upgrade`);
                } else {
                  navigate("/profile");
                }
              }}
              className="shrink-0"
            >
              Upgrade to Pro
            </Button>
          </CardContent>
        </Card>
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
          {!activeClubFilter && displayMemberClubs.length > 1 && (
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
              className="h-10 w-10 relative"
            >
              <Filter className="h-5 w-5" />
              {hasLocalFilter && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary-foreground" />
              )}
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
          <Button
            size="icon"
            variant="default"
            className="h-10 w-10 rounded-full shadow-sm shadow-primary/20 active:scale-95 transition-transform"
            aria-label="New message"
            onClick={() => setShowNewMessageSheet(true)}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* New message + group-type bottom sheets */}
      <NewMessageSheet
        open={showNewMessageSheet}
        onOpenChange={setShowNewMessageSheet}
        canCreateGroups={!!canCreateGroups}
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

      {/* DM and Group dialogs */}
      <StartDMDialog open={showDMDialog} onOpenChange={setShowDMDialog} mode="dm" />
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

        {/* Unread Section — render with cached items while fresh data loads to avoid flicker */}
        {!showSkeletonLoading && unreadItems.length > 0 && (
          <>
            <div className="flex items-center gap-2 pb-1.5">
              <span className="text-[13px] font-bold uppercase tracking-wide text-foreground">Unread</span>
              <span className="h-5 min-w-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold flex items-center justify-center">
                {unreadItems.length}
              </span>
            </div>
            {unreadItems.map(renderConversationCard)}
          </>
        )}

        {/* Recent Section */}
        {!showSkeletonLoading && recentItems.length > 0 && (
          <>
            <div className={`flex items-center gap-2 pb-1.5 ${unreadItems.length > 0 ? 'pt-5 border-t border-border/50 mt-3' : ''}`}>
              <span className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Recent</span>
            </div>
            {recentItems.map(renderConversationCard)}
          </>
        )}

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
              <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No messages available</p>
              <p className="text-sm text-muted-foreground mt-1">
                Join a team or club to access chats
              </p>
            </CardContent>
          </Card>
        )}

        {/* Contact Club - Pro feature */}
        {!showSkeletonLoading && (
          <ContactClubButton clubFilter={activeClubFilter} />
        )}

        {/* Sponsor/Ad Carousel */}
        <SponsorOrAdCarousel location="messages" activeClubFilter={activeClubFilter} />
      </div>
    </div>
  );
}
