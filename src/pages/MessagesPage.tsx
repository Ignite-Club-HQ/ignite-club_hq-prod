import { useState, useMemo, useEffect } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, ChevronRight, Users, Trash2, Search, BellOff, ImageIcon, Crown, Lock, RefreshCw, Flame, Plus, Filter, Check, Building2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { getCachedMessagesPageData, cacheMessagesPageData } from "@/lib/messagesPageCache";
import { useClubTheme } from "@/hooks/useClubTheme";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";
import { MESSAGE_NOTIFICATION_TYPES } from "@/lib/notificationTypes";

const MESSAGES_PER_PAGE = 15;
import CreateGroupDialog from "@/components/chat/CreateGroupDialog";
import EditGroupDialog from "@/components/chat/EditGroupDialog";
import ChatGroupCard from "@/components/chat/ChatGroupCard";
import { StartDMDialog } from "@/components/chat/StartDMDialog";
import { DMConversationsList } from "@/components/chat/DMConversationsList";
import { NewMessageMenu } from "@/components/chat/NewMessageMenu";
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


// Skeleton component for message items while loading
function MessageSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-full shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}

// Helper to strip mention formatting: @[Name](id) -> @Name
const stripMentionFormatting = (text: string): string => {
  return text.replace(/@\[([^\]]+)\]\([^)]+\)/g, '$1');
};

// Helper to get message preview text - shows "Image" if message is only an image
const getMessagePreview = (text: string | undefined, imageUrl?: string | null): string => {
  if (text && text.trim()) return stripMentionFormatting(text);
  if (imageUrl) return "Image";
  return "";
};

// Helper to get first name only from a display name
const getFirstName = (fullName: string | undefined): string => {
  if (!fullName) return "";
  return fullName.split(" ")[0];
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
}: { 
  text?: string; 
  imageUrl?: string | null; 
  author?: string;
  hasUnread?: boolean;
  fallback: string;
  isAnnouncement?: boolean;
}) => {
  const hasText = text && text.trim();
  const isImageOnly = !hasText && imageUrl;
  const hasTextAndImage = hasText && imageUrl;
  
  // Strip mention formatting from text for preview
  const displayText = hasText ? stripMentionFormatting(text!) : null;
  
  if (!hasText && !imageUrl && !author) {
    return <span>{fallback}</span>;
  }
  
  return (
    <span className="flex items-center gap-1.5">
      {/* Image-only: show camera icon */}
      {isImageOnly && (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      {/* Text + image: show camera icon */}
      {hasTextAndImage && (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      {author && <span className="font-medium">{isAnnouncement ? author : getFirstName(author)}:</span>}
      <span className="truncate">{displayText ?? (isImageOnly ? "Image" : fallback)}</span>
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

export default function MessagesPage() {
  const { user, initialized, refreshUnreadCount } = useAuth();
  usePageTitle("Messages");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [showDMDialog, setShowDMDialog] = useState(false);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [localClubFilter, setLocalClubFilter] = useState("all");
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
    queryFn: async () => {
      const { data: notifications } = await supabase
        .from("notifications")
        .select("id, type, related_id")
        .eq("user_id", user!.id)
        .eq("is_read", false)
        .in("type", MESSAGE_NOTIFICATION_TYPES);
      
      const counts: {
        broadcast: number;
        teams: Record<string, number>;
        clubs: Record<string, number>;
        groups: Record<string, number>;
      } = {
        broadcast: 0,
        teams: {},
        clubs: {},
        groups: {},
      };
      
      if (!notifications?.length) return counts;
      
      // Separate notifications by type
      const teamMessageIds: string[] = [];
      const clubMessageIds: string[] = [];
      const groupMessageIds: string[] = [];
      
      notifications.forEach(n => {
        if (n.type === 'broadcast') {
          counts.broadcast++;
        } else if (n.type === 'team_message' && n.related_id) {
          teamMessageIds.push(n.related_id);
        } else if (n.type === 'club_message' && n.related_id) {
          clubMessageIds.push(n.related_id);
        } else if (n.type === 'group_message' && n.related_id) {
          groupMessageIds.push(n.related_id);
        }
      });
      
      // Look up team_id for team messages
      if (teamMessageIds.length > 0) {
        const { data: teamMessages } = await supabase
          .from("team_messages")
          .select("id, team_id")
          .in("id", teamMessageIds);
        
        teamMessages?.forEach(msg => {
          if (msg.team_id) {
            counts.teams[msg.team_id] = (counts.teams[msg.team_id] || 0) + 1;
          }
        });
      }
      
      // Look up club_id for club messages
      if (clubMessageIds.length > 0) {
        const { data: clubMessages } = await supabase
          .from("club_messages")
          .select("id, club_id")
          .in("id", clubMessageIds);
        
        clubMessages?.forEach(msg => {
          if (msg.club_id) {
            counts.clubs[msg.club_id] = (counts.clubs[msg.club_id] || 0) + 1;
          }
        });
      }
      
      // Look up group_id for group messages
      if (groupMessageIds.length > 0) {
        const { data: groupMessages } = await supabase
          .from("group_messages")
          .select("id, group_id")
          .in("id", groupMessageIds);
        
        groupMessages?.forEach(msg => {
          if (msg.group_id) {
            counts.groups[msg.group_id] = (counts.groups[msg.group_id] || 0) + 1;
          }
        });
      }
      
      return counts;
    },
    enabled: !!user && initialized,
    refetchInterval: 30000,
    staleTime: 30000,
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
        .in("id", clubIds);

      return data as Club[];
    },
    enabled: !!user && initialized,
    retry: 3,
    staleTime: 5 * 60 * 1000,
    placeholderData: cachedData?.adminClubs ?? ((prev) => prev),
  });

  // Fetch member clubs with their latest messages in a single query
  const { data: memberClubsWithMessages, isLoading: memberClubsLoading } = useQuery({
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
        .in("id", clubIds);

      const clubs = data as Club[];
      
      // Fetch latest messages for all clubs in parallel
      const latestMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null }> = {};
      
      await Promise.all(
        clubs.map(async (club) => {
          const { data: msgData } = await supabase
            .from("club_messages")
            .select("text, created_at, image_url, author_id")
            .eq("club_id", club.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (msgData) {
            // Fetch author profile - start with empty string, will be populated from DB
            let authorName = "";
            if (msgData.author_id) {
              const { data: profile } = await supabase
                .from("profiles")
                .select("display_name")
                .eq("id", msgData.author_id)
                .maybeSingle();
              if (profile?.display_name) {
                authorName = profile.display_name;
              }
            }
            latestMessages[club.id] = {
              text: msgData.text,
              author: authorName,
              created_at: msgData.created_at,
              image_url: msgData.image_url,
            };
          }
        })
      );
      
      return { clubs, latestMessages };
    },
    enabled: !!user && initialized,
    staleTime: 60000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev ?? (cachedData?.memberClubs ? { clubs: cachedData.memberClubs as any, latestMessages: cachedData.latestClubMessages ?? {} } : undefined),
  });
  
  // Extract clubs and latest messages from combined query
  const memberClubs = memberClubsWithMessages?.clubs ?? [];
  const latestClubMessages = memberClubsWithMessages?.latestMessages ?? {};

  // Get latest broadcast message
  const { data: latestBroadcast } = useQuery({
    queryKey: ["latest-broadcast"],
    queryFn: async () => {
      const { data } = await supabase
        .from("broadcast_messages")
        .select("text, created_at, image_url, author_id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (!data) return null;
      
      // Fetch author profile - start with empty string, will be populated from DB
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
    staleTime: 60000,
    placeholderData: (prev) => prev,
  });


  // Fetch teams with their latest messages in a single query for efficiency
  const { data: teamsWithMessages, isLoading: teamsLoading } = useQuery({
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
      
      // Fetch latest messages for all teams in parallel
      const latestMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null; is_announcement?: boolean }> = {};
      
      await Promise.all(
        teams.map(async (team) => {
          const { data: msgData } = await supabase
            .from("team_messages")
            .select("text, created_at, image_url, author_id, is_club_announcement, club_announcement_name")
            .eq("team_id", team.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (msgData) {
            let authorName = "";
            const isAnnouncement = !!(msgData.is_club_announcement && msgData.club_announcement_name);
            // For club announcements, use the club name
            if (isAnnouncement) {
              authorName = msgData.club_announcement_name!;
            } else if (msgData.author_id) {
              const { data: profile } = await supabase
                .from("profiles")
                .select("display_name")
                .eq("id", msgData.author_id)
                .maybeSingle();
              if (profile?.display_name) {
                authorName = profile.display_name;
              }
            }
            latestMessages[team.id] = {
              text: msgData.text,
              author: authorName,
              created_at: msgData.created_at,
              image_url: msgData.image_url,
              is_announcement: isAnnouncement,
            };
          }
        })
      );
      
      return { teams, latestMessages };
    },
    enabled: !!user && initialized,
    staleTime: 30000,
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

  // Check if user has any Pro access
  // Pro Access Logic: Club Pro → all teams inherit; Free club → check team subscription
  const { data: hasAnyProAccess, isLoading: isLoadingProAccess } = useQuery({
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

  // Get Pro status for each club to determine which are locked
  const { data: clubProStatus, isLoading: isLoadingClubProStatus } = useQuery({
    queryKey: ["club-pro-status", user?.id],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);

      if (!roles || roles.length === 0) return {};

      const clubIds = [...new Set(roles.map((r) => r.club_id).filter(Boolean))];
      
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", clubIds);

      const statusMap: Record<string, boolean> = {};
      clubIds.forEach(id => {
        const sub = subs?.find(s => s.club_id === id);
        statusMap[id as string] = sub ? 
          (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) && 
          (!sub.expires_at || new Date(sub.expires_at) > new Date()) : false;
      });
      
      return statusMap;
    },
    enabled: !!user && initialized,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Fetch chat groups with their latest messages in a single query
  const { data: chatGroupsWithMessages, isLoading: chatGroupsLoading } = useQuery({
    queryKey: ["my-chat-groups-with-messages", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_groups")
        .select("*, teams(name), clubs(name), mini_leagues:mini_league_id(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      
      const groups = data || [];
      
      // Fetch latest messages for all groups in parallel
      const latestMessages: Record<string, { text: string; author: string; created_at: string; image_url?: string | null }> = {};
      
      await Promise.all(
        groups.map(async (group) => {
          const { data: msgData } = await supabase
            .from("group_messages")
            .select("text, created_at, image_url, author_id")
            .eq("group_id", group.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (msgData) {
            // Fetch author profile separately
            let authorName = "";
            if (msgData.author_id) {
              const { data: profile } = await supabase
                .from("profiles")
                .select("display_name")
                .eq("id", msgData.author_id)
                .maybeSingle();
              if (profile?.display_name) {
                authorName = profile.display_name;
              }
            }
            latestMessages[group.id] = {
              text: msgData.text,
              author: authorName,
              created_at: msgData.created_at,
              image_url: msgData.image_url,
            };
          }
        })
      );
      
      return { groups, latestMessages };
    },
    enabled: !!user && initialized,
    staleTime: 60000,
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
        // Only treat as muted if indefinite (null) or not yet expired
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

  // Cache fresh data when it arrives
  useEffect(() => {
    if (!user?.id) return;
    
    // Only cache when we have fresh data (not placeholder)
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

  // Prefetch messages for all threads in the background (non-blocking)
  useEffect(() => {
    if (!user) return;
    
    // Use requestIdleCallback to defer prefetching until browser is idle
    const prefetchAll = () => {
      // Prefetch broadcast messages (lightweight - no profiles join)
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
          const reversedMessages = [...messagesToDisplay].reverse();

          return { messages: reversedMessages, hasOlderMessages: hasMore };
        },
        staleTime: 1000 * 60,
      });

      // Prefetch team messages (lightweight)
      teams?.forEach((team) => {
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
            const reversedMessages = [...messagesToDisplay].reverse();

            return { messages: reversedMessages, hasOlderMessages: hasMore };
          },
          staleTime: 1000 * 60,
        });
      });

      // Prefetch club messages (lightweight)
      memberClubs?.forEach((club) => {
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
            const reversedMessages = [...messagesToDisplay].reverse();

            return { messages: reversedMessages, hasOlderMessages: hasMore };
          },
          staleTime: 1000 * 60,
        });
      });

      // Prefetch group messages (lightweight)
      chatGroups?.forEach((group) => {
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
            const reversedMessages = [...messagesToDisplay].reverse();

            return { messages: reversedMessages, hasOlderMessages: hasMore };
          },
          staleTime: 1000 * 60,
        });
      });
    };

    // Defer prefetching to not block initial render
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(prefetchAll, { timeout: 2000 });
    } else {
      setTimeout(prefetchAll, 100);
    }
  }, [user, teams, memberClubs, chatGroups, queryClient]);

  // Check if we have cached data to show immediately
  const hasCachedData = cachedData && (
    cachedData.teams?.length > 0 || 
    cachedData.memberClubs?.length > 0 || 
    cachedData.chatGroups?.length > 0
  );

  // Track if fresh data is still loading (for skeleton states)
  // With placeholderData, isLoading should be false when cached data exists — but guard further:
  const hasAnyDisplayData = !!(teams?.length || memberClubs?.length || chatGroups?.length);
  const isLoadingFreshData = !hasAnyDisplayData && !hasCachedData && !!(teamsLoading || memberClubsLoading || chatGroupsLoading || isLoadingProAccess || isLoadingClubProStatus);

  // Show skeleton loading UI when fresh data is loading and we have nothing to show yet
  const showSkeletonLoading = isLoadingFreshData;

  // Determine which data to display (prefer fresh, fallback to cached)
  const displayTeams = teams || cachedData?.teams || [];
  const displayMemberClubs = memberClubs || cachedData?.memberClubs || [];
  const displayAdminClubs = adminClubs || cachedData?.adminClubs || [];
  const allChatGroups = chatGroups?.length > 0 ? chatGroups : (cachedData?.chatGroups as any) || [];
  
  // Filter chat groups by user's roles - committee members and app admins see all
  const displayChatGroups = useMemo(() => {
    if (isAppAdmin || isCommitteeMember) return allChatGroups;
    if (!userAllRoles?.length) return [];
    
    return allChatGroups.filter((group: any) => {
      const allowedRoles: string[] = group.allowed_roles || [];
      if (allowedRoles.length === 0) return true; // No restrictions
      
      return userAllRoles.some((ur: any) => {
        if (!allowedRoles.includes(ur.role)) return false;
        // Club-level group: user must have matching role in that club
        if (group.club_id && !group.team_id) {
          return ur.club_id === group.club_id;
        }
        // Team-level group: user must have matching role in that team
        if (group.team_id) {
          return ur.team_id === group.team_id;
        }
        return true;
      });
    });
  }, [allChatGroups, userAllRoles, isAppAdmin, isCommitteeMember]);
  const displayLatestBroadcast = latestBroadcast || cachedData?.latestBroadcast;
  const displayLatestTeamMessages = latestTeamMessages || {};
  const displayLatestClubMessages = latestClubMessages || {};
  const displayLatestGroupMessages = latestGroupMessages || {};

  // Show all member clubs (Pro ones are accessible, non-Pro ones are locked)
  const displayClubsWithAnnouncements = displayMemberClubs;

  // Check if user can create groups (requires admin role AND Pro access)
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
    
    // Apply club filter if active
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
    
    // Apply club filter if active
    if (effectiveClubFilter) {
      groups = groups.filter((group: any) => 
        group.club_id === effectiveClubFilter || 
        (group.team_id && (activeClubFilter ? activeClubTeamIds.includes(group.team_id) : displayTeams.some((t: any) => t.id === group.team_id && t.clubs?.id === effectiveClubFilter)))
      );
    }
    
    if (!query) return groups;
    return groups.filter((group: any) => {
      const groupName = group.name?.toLowerCase() || "";
      const teamName = group.teams?.name?.toLowerCase() || "";
      const clubName = group.clubs?.name?.toLowerCase() || "";
      return groupName.includes(query) || teamName.includes(query) || clubName.includes(query);
    });
  }, [regularChatGroups, query, effectiveClubFilter, activeClubFilter, activeClubTeamIds, displayTeams]);

  const filteredTeams = useMemo(() => {
    let teamsToFilter = displayTeams || [];
    
    if (effectiveClubFilter) {
      if (activeClubFilter) {
        // Theme filter: use resolved team IDs with fallback
        const hasResolvedActiveClubTeams = activeClubTeamIds.length > 0;
        teamsToFilter = teamsToFilter.filter((team: any) => {
          const matchesResolvedIds = hasResolvedActiveClubTeams && activeClubTeamIds.includes(team.id);
          const matchesClubRelation = team.clubs?.id === activeClubFilter;
          return matchesResolvedIds || matchesClubRelation;
        });
      } else {
        // Local filter: use club relation on team
        teamsToFilter = teamsToFilter.filter((team: any) => team.clubs?.id === effectiveClubFilter);
      }
    }
    
    if (!query) {
      return [...teamsToFilter].sort((a: any, b: any) =>
        (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" })
      );
    }
    return teamsToFilter
      .filter((team: any) =>
        team.name.toLowerCase().includes(query) ||
        team.clubs?.name?.toLowerCase()?.includes(query)
      )
      .sort((a: any, b: any) =>
        (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" })
      );
  }, [displayTeams, query, effectiveClubFilter, activeClubFilter, activeClubTeamIds]);

  const filteredClubs = useMemo(() => {
    let clubsToFilter = displayClubsWithAnnouncements || [];
    
    // Apply club filter if active - only show the active club
    if (effectiveClubFilter) {
      clubsToFilter = clubsToFilter.filter((club: any) => club.id === effectiveClubFilter);
    }
    
    if (!query) return clubsToFilter;
    return clubsToFilter.filter((club: any) =>
      club.name.toLowerCase().includes(query)
    );
  }, [displayClubsWithAnnouncements, query, effectiveClubFilter]);

  // Always show broadcast in club mode - it's a global announcements channel
  const showBroadcast = !query || "announcements".includes(query);

  const hasNoResults = query && 
    filteredChatGroups.length === 0 && 
    filteredLeagueChats.length === 0 &&
    filteredTeams.length === 0 && 
    filteredClubs.length === 0 && 
    !showBroadcast;

  const hasNoMessages = !displayTeams?.length && !displayMemberClubs?.length && displayChatGroups.length === 0;

  // Check if user has admin role but no Pro access (show upgrade prompt)
  // Only show after ALL relevant queries have loaded to prevent flash of upgrade banner
  const hasAdminRoleButNoPro = !!(adminTeamIds?.length || adminClubs?.length) && hasAnyProAccess === false && isAppAdmin === false;

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
                // Navigate to club upgrade if user is club admin, otherwise team upgrade
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
          {/* Stale indicator when showing cached data and refreshing */}
          {isLoadingFreshData && hasCachedData && (
            <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Club filter button - only show when not in club theme mode and user has multiple clubs */}
          {!activeClubFilter && displayMemberClubs.length > 1 && (
            <Button
              variant={hasLocalFilter ? "default" : "outline"}
              size="icon"
              onClick={() => {
                if (hasLocalFilter) {
                  setLocalClubFilter("all");
                } else {
                  // Cycle: show a simple drawer with club options
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
          <NewMessageMenu 
            onNewDM={() => setShowDMDialog(true)}
            onNewGroup={() => setShowGroupDialog(true)}
            canCreateGroups={!!canCreateGroups}
          />
        </div>
      </div>

      {/* DM and Group dialogs */}
      <StartDMDialog open={showDMDialog} onOpenChange={setShowDMDialog} />
      {canCreateGroups && <CreateGroupDialog open={showGroupDialog} onOpenChange={setShowGroupDialog} />}

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

      {/* All Messages List */}
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


        {/* Club Chats Section */}
        {!showSkeletonLoading && filteredClubs.length > 0 && (
          <div className="flex items-center gap-2 pt-4 pb-1 border-t mt-2">
            <span className="text-sm font-medium text-muted-foreground">Club Chats</span>
          </div>
        )}
        {!showSkeletonLoading && filteredClubs.map((club: any) => {
          const lastMessage = displayLatestClubMessages?.[club.id];
          const unreadCount = unreadCounts?.clubs[club.id] || 0;
          const hasUnread = unreadCount > 0;
          const isMuted = mutedChats?.clubs.has(club.id);
          // Only determine lock status after clubProStatus has loaded to prevent flash
          const hasProAccess = isLoadingClubProStatus ? true : (clubProStatus?.[club.id] === true);
          
          // Locked club chat card (non-Pro) - still clickable for admin access
          if (!isLoadingClubProStatus && !hasProAccess) {
            return (
              <Link key={`club-${club.id}`} to={`/messages/club/${club.id}`}>
                <Card className="opacity-70 hover:border-primary/50 transition-colors">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="relative">
                      <Avatar className="h-12 w-12 grayscale">
                        <AvatarImage src={club.logo_url || undefined} />
                        <AvatarFallback className="bg-secondary text-secondary-foreground">
                          {club.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-muted flex items-center justify-center border-2 border-background">
                        <Lock className="h-3 w-3 text-muted-foreground" />
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold text-muted-foreground">{club.name}</h3>
                        <Badge variant="secondary" className="gap-1 text-xs shrink-0">
                          <Crown className="h-3 w-3" />
                          Club Pro
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Club Pro required for club-wide chat
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Lock className="h-5 w-5 text-muted-foreground" />
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          }
          
          return (
            <Link key={`club-${club.id}`} to={`/messages/club/${club.id}`}>
              <Card className={`hover:border-primary/50 transition-colors ${hasUnread ? 'border-primary/30' : ''}`}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="relative">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={club.logo_url || undefined} />
                      <AvatarFallback className="bg-secondary text-secondary-foreground">
                        {club.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {hasUnread && (
                      <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-destructive border-2 border-background" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className={`truncate ${hasUnread ? 'font-bold' : 'font-semibold'}`}>{club.name}</h3>
                      {isMuted && (
                        <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <p className={`text-sm ${hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      <MessagePreview 
                        text={lastMessage?.text} 
                        imageUrl={lastMessage?.image_url}
                        author={lastMessage?.author}
                        hasUnread={hasUnread}
                        fallback="Club-wide announcements"
                      />
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {lastMessage?.created_at && (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(lastMessage.created_at), { addSuffix: true })}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      {hasUnread && (
                        <span className="h-5 min-w-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-medium flex items-center justify-center">
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {/* Team Chats Section */}
        {!showSkeletonLoading && filteredTeams.length > 0 && (
          <div className="flex items-center gap-2 pt-4 pb-1 border-t mt-2">
            <span className="text-sm font-medium text-muted-foreground">Team Chats</span>
          </div>
        )}
        {!showSkeletonLoading &&
          filteredTeams.map((team: any) => {
            const lastMessage = displayLatestTeamMessages?.[team.id];
            const unreadCount = unreadCounts?.teams[team.id] || 0;
            const hasUnread = unreadCount > 0;
            const isMuted = mutedChats?.teams.has(team.id);
            return (
              <Link key={`team-${team.id}`} to={`/messages/${team.id}`}>
                <Card className={`hover:border-primary/50 transition-colors ${hasUnread ? 'border-primary/30' : ''}`}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="relative">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={team.logo_url || team.clubs?.logo_url || undefined} />
                        <AvatarFallback className="bg-secondary text-secondary-foreground">
                          {team.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {hasUnread && (
                        <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-destructive border-2 border-background" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className={`truncate ${hasUnread ? 'font-bold' : 'font-semibold'}`}>{team.name}</h3>
                        {isMuted && (
                          <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <p className={`text-sm ${hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                        <MessagePreview 
                          text={lastMessage?.text} 
                          imageUrl={lastMessage?.image_url}
                          author={lastMessage?.author}
                          hasUnread={hasUnread}
                          fallback={team.clubs?.name || "Team chat"}
                          isAnnouncement={(lastMessage as any)?.is_announcement}
                        />
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {lastMessage?.created_at && (
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(lastMessage.created_at), { addSuffix: true })}
                        </span>
                      )}
                      <div className="flex items-center gap-2">
                        {hasUnread && (
                          <span className="h-5 min-w-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-medium flex items-center justify-center">
                            {unreadCount > 9 ? "9+" : unreadCount}
                          </span>
                        )}
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })
        }

        {/* League Chats Section */}
        {!showSkeletonLoading && filteredLeagueChats.length > 0 && (
          <div className="flex items-center gap-2 pt-4 pb-1 border-t mt-2">
            <span className="text-sm font-medium text-muted-foreground">League Chats</span>
          </div>
        )}
        {!showSkeletonLoading && filteredLeagueChats.map((group: any) => {
          const canManage =
            isAppAdmin ||
            group.created_by === user?.id ||
            (group.club_id && adminClubs?.some((c) => c.id === group.club_id));

          const lastMessage = displayLatestGroupMessages?.[group.id];
          const unreadCount = unreadCounts?.groups[group.id] || 0;
          const isMuted = mutedChats?.groups.has(group.id) || false;

          return (
            <ChatGroupCard
              key={`league-${group.id}`}
              group={group}
              lastMessage={lastMessage}
              unreadCount={unreadCount}
              isMuted={isMuted}
              canManage={!!canManage}
              onDelete={(groupId) => deleteGroupMutation.mutate(groupId)}
              MessagePreviewComponent={MessagePreview}
            />
          );
        })}

        {/* Chat Groups Section */}
        {!showSkeletonLoading && filteredChatGroups.length > 0 && (
          <div className="flex items-center gap-2 pt-4 pb-1 border-t mt-2">
            <span className="text-sm font-medium text-muted-foreground">Group Chats</span>
          </div>
        )}
        {!showSkeletonLoading && filteredChatGroups.map((group: any) => {
          const canManage =
            isAppAdmin ||
            group.created_by === user?.id ||
            (group.club_id && adminClubs?.some((c) => c.id === group.club_id)) ||
            (group.team_id && adminTeamIds?.includes(group.team_id));

          const lastMessage = displayLatestGroupMessages?.[group.id];
          const unreadCount = unreadCounts?.groups[group.id] || 0;
          const isMuted = mutedChats?.groups.has(group.id) || false;

          return (
            <ChatGroupCard
              key={`group-${group.id}`}
              group={group}
              lastMessage={lastMessage}
              unreadCount={unreadCount}
              isMuted={isMuted}
              canManage={!!canManage}
              onDelete={(groupId) => deleteGroupMutation.mutate(groupId)}
              MessagePreviewComponent={MessagePreview}
            />
          );
        })}

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

        {/* Direct Messages Section - Pro feature */}
        {!showSkeletonLoading && hasAnyProAccess && (
          <DMConversationsList searchQuery={searchQuery} hasProAccess={hasAnyProAccess} />
        )}

        {/* Contact Club - Pro feature */}
        {!showSkeletonLoading && (
          <ContactClubButton clubFilter={activeClubFilter} />
        )}

        {/* Announcements Section */}
        {!showSkeletonLoading && showBroadcast && (
          <>
            <div className="flex items-center gap-2 pt-4 pb-1 border-t mt-2">
              <span className="text-sm font-medium text-muted-foreground">Support</span>
            </div>
            {(() => {
              const hasUnread = (unreadCounts?.broadcast || 0) > 0;
              return (
                <Link to="/messages/broadcast">
                  <Card className={`hover:border-primary/50 transition-colors bg-primary/5 ${hasUnread ? 'border-primary/30' : ''}`}>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="relative">
                        <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'hsl(142, 71%, 45%)' }}>
                          <Flame className="h-5 w-5 text-white" />
                        </div>
                        {hasUnread && (
                          <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-destructive border-2 border-background" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className={`truncate ${hasUnread ? 'font-bold' : 'font-semibold'}`}>Announcements</h3>
                        <p className={`text-sm ${hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                          <MessagePreview 
                            text={displayLatestBroadcast?.text} 
                            imageUrl={displayLatestBroadcast?.image_url}
                            author={(displayLatestBroadcast?.profiles as any)?.display_name}
                            hasUnread={hasUnread}
                            fallback="Official announcements and updates"
                          />
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {displayLatestBroadcast?.created_at && (
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(displayLatestBroadcast.created_at), { addSuffix: true })}
                          </span>
                        )}
                        <div className="flex items-center gap-2">
                          {hasUnread && (
                            <span className="h-5 min-w-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-medium flex items-center justify-center">
                              {unreadCounts?.broadcast > 9 ? "9+" : unreadCounts?.broadcast}
                            </span>
                          )}
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })()}
          </>
        )}

        {/* Sponsor/Ad Carousel */}
        <SponsorOrAdCarousel location="messages" activeClubFilter={activeClubFilter} />
      </div>
    </div>
  );
}
