import { useEffect, useCallback, useState, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { 
  Bell,
  Check, 
  CheckCheck, 
  CheckCircle,
  XCircle,
  RefreshCw,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SwipeableNotificationCard } from "@/components/SwipeableNotificationCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow, parseISO } from "date-fns";
import { playNotificationSound, showBrowserNotification } from "@/lib/notifications";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { useNotificationIcon } from "@/components/NotificationIcon";
import { setPendingChatJump, type ChatJumpKind } from "@/lib/pendingChatJump";

/**
 * Belt-and-braces: when navigating from a notification tap to a chat that
 * should scroll to a specific message, also persist the target in
 * sessionStorage. GroupChatPage / TeamChatPage / etc. read this as a fallback
 * when `?message=` is missing (e.g. React Router strips the search param
 * during an auth-gated redirect, or the user is already on the target chat
 * and useSearchParams hasn't re-fired yet).
 */
function jumpAndNavigate(
  navigate: (to: string) => void,
  kind: ChatJumpKind,
  targetId: string | null,
  messageId: string,
  to: string,
) {
  try { setPendingChatJump(kind, targetId, messageId); } catch { /* ignore */ }
  navigate(to);
}

interface Notification {
  id: string;
  user_id: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
  related_id: string | null;
}

type ChatTarget = {
  kind: ChatJumpKind;
  targetId: string | null;
  messageId: string;
  path: string;
};

type MessageReactionTargetRow = {
  team_message_id?: string | null;
  club_message_id?: string | null;
  group_message_id?: string | null;
  direct_message_id?: string | null;
  broadcast_message_id?: string | null;
  club_admin_message_id?: string | null;
};

const chatTargetPath = (kind: ChatJumpKind, targetId: string | null, messageId: string) => {
  switch (kind) {
    case "team": return targetId ? `/messages/${targetId}?message=${messageId}` : "/messages";
    case "club": return targetId ? `/messages/club/${targetId}?message=${messageId}` : "/messages";
    case "group": return targetId ? `/groups/${targetId}?message=${messageId}` : "/messages";
    case "dm": return targetId ? `/messages/dm/${targetId}?message=${messageId}` : "/messages";
    case "club_admin": return targetId ? `/messages/club-admin/${targetId}?message=${messageId}` : "/messages";
    case "broadcast": return `/messages/broadcast?message=${messageId}`;
  }
};

const resolveChatTargetForMessageId = async (messageId: string): Promise<ChatTarget | null> => {
  const { data: tMsg } = await supabase.from("team_messages").select("team_id").eq("id", messageId).maybeSingle();
  if (tMsg?.team_id) return { kind: "team", targetId: tMsg.team_id, messageId, path: chatTargetPath("team", tMsg.team_id, messageId) };

  const { data: cMsg } = await supabase.from("club_messages").select("club_id").eq("id", messageId).maybeSingle();
  if (cMsg?.club_id) return { kind: "club", targetId: cMsg.club_id, messageId, path: chatTargetPath("club", cMsg.club_id, messageId) };

  const { data: gMsg } = await supabase.from("group_messages").select("group_id").eq("id", messageId).maybeSingle();
  if (gMsg?.group_id) return { kind: "group", targetId: gMsg.group_id, messageId, path: chatTargetPath("group", gMsg.group_id, messageId) };

  const { data: dMsg } = await supabase.from("direct_messages").select("conversation_id").eq("id", messageId).maybeSingle();
  if (dMsg?.conversation_id) return { kind: "dm", targetId: dMsg.conversation_id, messageId, path: chatTargetPath("dm", dMsg.conversation_id, messageId) };

  const { data: bMsg } = await supabase.from("broadcast_messages").select("id").eq("id", messageId).maybeSingle();
  if (bMsg) return { kind: "broadcast", targetId: null, messageId, path: chatTargetPath("broadcast", null, messageId) };

  const { data: caMsg } = await supabase.from("club_admin_messages").select("conversation_id").eq("id", messageId).maybeSingle();
  if (caMsg?.conversation_id) return { kind: "club_admin", targetId: caMsg.conversation_id, messageId, path: chatTargetPath("club_admin", caMsg.conversation_id, messageId) };

  return null;
};

const resolveLegacyReactionTarget = async (notification: Notification): Promise<ChatTarget | null> => {
  if (!notification.related_id) return null;
  const at = new Date(notification.created_at).getTime();
  if (!Number.isFinite(at)) return null;
  const from = new Date(at - 5000).toISOString();
  const to = new Date(at + 5000).toISOString();

  const { data: reactions } = await supabase
    .from("message_reactions")
    .select("team_message_id, club_message_id, group_message_id, direct_message_id, broadcast_message_id, club_admin_message_id, created_at")
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: false })
    .limit(30);

  const rows: MessageReactionTargetRow[] = Array.isArray(reactions) ? reactions : [];
  const pick = (key: keyof MessageReactionTargetRow) => rows.map((r) => r[key]).filter((id): id is string => Boolean(id));
  const relatedId = notification.related_id;
  const authorId = notification.user_id;

  const teamIds = pick("team_message_id");
  if (teamIds.length) {
    const { data } = await supabase.from("team_messages").select("id, team_id").in("id", teamIds).eq("team_id", relatedId).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id && msg.team_id) return { kind: "team", targetId: msg.team_id, messageId: msg.id, path: chatTargetPath("team", msg.team_id, msg.id) };
  }

  const clubIds = pick("club_message_id");
  if (clubIds.length) {
    const { data } = await supabase.from("club_messages").select("id, club_id").in("id", clubIds).eq("club_id", relatedId).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id && msg.club_id) return { kind: "club", targetId: msg.club_id, messageId: msg.id, path: chatTargetPath("club", msg.club_id, msg.id) };
  }

  const groupIds = pick("group_message_id");
  if (groupIds.length) {
    const { data } = await supabase.from("group_messages").select("id, group_id").in("id", groupIds).eq("group_id", relatedId).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id && msg.group_id) return { kind: "group", targetId: msg.group_id, messageId: msg.id, path: chatTargetPath("group", msg.group_id, msg.id) };
  }

  const dmIds = pick("direct_message_id");
  if (dmIds.length) {
    const { data } = await supabase.from("direct_messages").select("id, conversation_id").in("id", dmIds).eq("conversation_id", relatedId).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id && msg.conversation_id) return { kind: "dm", targetId: msg.conversation_id, messageId: msg.id, path: chatTargetPath("dm", msg.conversation_id, msg.id) };
  }

  const broadcastIds = pick("broadcast_message_id");
  if (broadcastIds.length) {
    const { data } = await supabase.from("broadcast_messages").select("id").in("id", broadcastIds).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id) return { kind: "broadcast", targetId: null, messageId: msg.id, path: chatTargetPath("broadcast", null, msg.id) };
  }

  const clubAdminIds = pick("club_admin_message_id");
  if (clubAdminIds.length) {
    const { data } = await supabase.from("club_admin_messages").select("id, conversation_id").in("id", clubAdminIds).eq("conversation_id", relatedId).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id && msg.conversation_id) return { kind: "club_admin", targetId: msg.conversation_id, messageId: msg.id, path: chatTargetPath("club_admin", msg.conversation_id, msg.id) };
  }

  return null;
};

const navigateToChatTarget = (navigate: (to: string) => void, target: ChatTarget) => {
  jumpAndNavigate(navigate, target.kind, target.targetId, target.messageId, target.path);
};

// Helper component for rendering notification icons with read state
function NotificationIconWrapper({ type, isRead }: { type: string; isRead: boolean }) {
  const { Icon, colorClass } = useNotificationIcon(type);
  return (
    <div className={`p-2 rounded-lg ${isRead ? "bg-muted" : "bg-primary/10"}`}>
      <Icon className={`h-4 w-4 ${isRead ? "text-muted-foreground" : colorClass}`} />
    </div>
  );
}

const NOTIFICATIONS_PER_PAGE = 30;

export default function NotificationsPage() {
  const { user, refreshUnreadCount, clearUnreadCount } = useAuth();
  usePageTitle("Notifications");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // Sync unread badge on mount
  useEffect(() => {
    refreshUnreadCount();
  }, [refreshUnreadCount]);

  // Pull-to-refresh state
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [displayCount, setDisplayCount] = useState(NOTIFICATIONS_PER_PAGE);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const PULL_THRESHOLD = 80;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setDisplayCount(NOTIFICATIONS_PER_PAGE);
    await queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
    setTimeout(() => {
      setIsRefreshing(false);
      setPullDistance(0);
    }, 500);
  }, [queryClient, user?.id]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (containerRef.current?.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling || isRefreshing) return;
    
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    
    if (diff > 0 && containerRef.current?.scrollTop === 0) {
      e.preventDefault();
      setPullDistance(Math.min(diff * 0.5, PULL_THRESHOLD * 1.5));
    }
  }, [isPulling, isRefreshing]);

  const handleTouchEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      handleRefresh();
    } else {
      setPullDistance(0);
    }
    setIsPulling(false);
  }, [pullDistance, isRefreshing, handleRefresh]);

  const { data: notifications, isLoading } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, user_id, type, message, related_id, is_read, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(500); // Cap at 500 for performance

      if (error) throw error;
      return (data || []).map(n => ({ ...n, read: n.is_read })) as Notification[];
    },
    enabled: !!user,
    staleTime: 30000, // Consider data fresh for 30 seconds
  });

  // Paginated display
  const displayedNotifications = notifications?.slice(0, displayCount) || [];
  const hasMore = (notifications?.length || 0) > displayCount;

  const loadMore = useCallback(() => {
    setDisplayCount(prev => prev + NOTIFICATIONS_PER_PAGE);
  }, []);

  // Real-time subscription for new notifications - direct cache updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const raw = payload.new as any;
          const newNotification: Notification = { ...raw, read: raw.is_read };
          queryClient.setQueryData<Notification[]>(
            ["notifications", user.id],
            (old) => old ? [newNotification, ...old] : [newNotification]
          );
          
          refreshUnreadCount();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const raw = payload.new as any;
          const updated: Notification = { ...raw, read: raw.is_read };
          queryClient.setQueryData<Notification[]>(
            ["notifications", user.id],
            (old) => old?.map(n => n.id === updated.id ? updated : n) || []
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const deleted = payload.old as { id: string };
          queryClient.setQueryData<Notification[]>(
            ["notifications", user.id],
            (old) => old?.filter(n => n.id !== deleted.id) || []
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient, refreshUnreadCount]);

  const markAsRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      // Optimistic update
      queryClient.setQueryData<Notification[]>(
        ["notifications", user?.id],
        (old) => old?.map(n => n.id === id ? { ...n, read: true } : n) || []
      );
    },
    onSuccess: () => {
      refreshUnreadCount();
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user!.id)
        .eq("is_read", false);
      if (error) throw error;
    },
    onMutate: async () => {
      // Optimistic update - mark all as read
      queryClient.setQueryData<Notification[]>(
        ["notifications", user?.id],
        (old) => old?.map(n => ({ ...n, read: true })) || []
      );
    },
    onSuccess: () => {
      clearUnreadCount();
      queryClient.invalidateQueries({ queryKey: ["recent-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["club-unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["club-messages-unread"] });
      queryClient.invalidateQueries({ queryKey: ["unread-message-counts"] });
      setTimeout(() => refreshUnreadCount(), 300);
    },
  });

  const deleteNotification = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      // Optimistic update - remove from list
      queryClient.setQueryData<Notification[]>(
        ["notifications", user?.id],
        (old) => old?.filter(n => n.id !== id) || []
      );
    },
    onSuccess: () => {
      refreshUnreadCount();
    },
  });

  const clearAllNotifications = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onMutate: async () => {
      // Cancel any in-flight queries to prevent stale data overwriting
      await queryClient.cancelQueries({ queryKey: ["notifications", user?.id] });
      await queryClient.cancelQueries({ queryKey: ["recent-notifications"] });
      await queryClient.cancelQueries({ queryKey: ["unread-count"] });
      // Optimistic update - clear all
      queryClient.setQueryData<Notification[]>(["notifications", user?.id], []);
    },
    onSuccess: () => {
      clearUnreadCount();
      setDisplayCount(NOTIFICATIONS_PER_PAGE);
      // Invalidate all notification-related queries for consistency
      queryClient.invalidateQueries({ queryKey: ["recent-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["club-unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["club-messages-unread"] });
      queryClient.invalidateQueries({ queryKey: ["unread-message-counts"] });
      // Force refresh to get accurate count from server
      setTimeout(() => refreshUnreadCount(), 300);
    },
  });

  type AppRole = Database["public"]["Enums"]["app_role"];

  // Translate raw RPC / network errors into a friendly, actionable toast message.
  const friendlyRequestError = (error: unknown, action: "approve" | "deny"): string => {
    const e = error as { message?: string; details?: string; hint?: string; code?: string } | null;
    const raw = [e?.message, e?.details, e?.hint, e?.code, String(error ?? "")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const verb = action === "approve" ? "approve" : "deny";

    if (raw.includes("not authorized") || raw.includes("permission denied")) {
      return `You don't have permission to ${verb} this request. Only team admins, coaches, and club admins can manage join requests.`;
    }
    if (
      raw.includes("already processed") ||
      raw.includes("already approved") ||
      raw.includes("already denied") ||
      raw.includes("already handled") ||
      raw.includes("not pending")
    ) {
      const past = action === "approve" ? "approved" : "denied";
      return `This request has already been ${past} — likely by another admin. Pull to refresh to see the latest list.`;
    }
    if (raw.includes("request not found") || raw.includes("not found")) {
      return "This request no longer exists — it may have been withdrawn or already actioned.";
    }
    if (raw.includes("network") || raw.includes("failed to fetch") || raw.includes("timeout")) {
      return `We couldn't reach the server. Check your connection and try ${verb}ing again.`;
    }
    return `Couldn't ${verb} this request right now. Please try again in a moment — if it keeps failing, contact support.`;
  };

  const approveRequest = useMutation({
    mutationFn: async (requestId: string) => {
      // Get the request details for email sending
      const { data: request, error: fetchError } = await supabase
        .from("role_requests")
        .select(`
          *,
          teams:team_id(id, name, club_id, clubs:club_id(id, name, logo_url)),
          clubs:club_id(id, name, logo_url)
        `)
        .eq("id", requestId)
        .maybeSingle();

      if (fetchError || !request) {
        throw new Error("Request not found");
      }

      // Use the secure RPC to approve (handles role insert, notifications, child linking)
      const { error } = await supabase.rpc("approve_role_request", { p_request_id: requestId });
      if (error) throw error;

      // ── Side-effects below: best-effort only. Failures here MUST NOT surface as
      // a "Failed to approve" toast because the approval itself already succeeded.
      try {
        const teamData = request.teams as { id: string; name: string; club_id: string; clubs: { id: string; name: string; logo_url: string | null } | null } | null;
        const clubData = request.clubs as { id: string; name: string; logo_url: string | null } | null;
        const teamName = teamData?.name;
        const clubName = teamData?.clubs?.name || clubData?.name || "the club";
        const clubLogoUrl = teamData?.clubs?.logo_url || clubData?.logo_url;
        const entityName = teamName || clubName;
        const roleName = request.role.replace("_", " ");

        const { data: requesterProfile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", request.user_id)
          .maybeSingle();

        const { data: emailData } = await supabase.rpc("get_user_emails_by_ids", { user_ids: [request.user_id] });
        const userEmail = emailData?.[0]?.email;

        if (userEmail) {
          const teamLink = request.team_id
            ? `/teams/${request.team_id}`
            : `/clubs/${request.club_id}`;

          await supabase.functions.invoke("send-email", {
            body: {
              to: userEmail,
              subject: `Welcome to ${entityName}! 🎉`,
              template: "join-request-response",
              templateData: {
                recipientName: requesterProfile?.display_name || "Member",
                teamName: teamName,
                clubName: clubName,
                roleName: roleName,
                approved: true,
                teamLink: teamLink,
                clubLogoUrl: clubLogoUrl,
              },
            },
          });
        }
      } catch (sideEffectError) {
        // Approval succeeded; only the welcome email pipeline failed.
        console.warn("[approveRequest] Welcome email side-effect failed:", sideEffectError);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Request approved");
    },
    onError: (error: Error) => {
      toast.error(friendlyRequestError(error, "approve"));
    },
  });

  const denyRequest = useMutation({
    mutationFn: async (requestId: string) => {
      // Get request details for email
      const { data: request, error: fetchError } = await supabase
        .from("role_requests")
        .select(`
          *,
          teams:team_id(id, name, club_id, clubs:club_id(id, name, logo_url)),
          clubs:club_id(id, name, logo_url)
        `)
        .eq("id", requestId)
        .maybeSingle();

      if (fetchError || !request) {
        throw new Error("Request not found");
      }

      // Use the secure RPC to deny
      const { error } = await supabase.rpc("deny_role_request", { p_request_id: requestId });
      if (error) throw error;

      // Best-effort email — never let a failure here masquerade as "Failed to deny".
      try {
        const teamData = request.teams as { id: string; name: string; club_id: string; clubs: { id: string; name: string; logo_url: string | null } | null } | null;
        const clubData = request.clubs as { id: string; name: string; logo_url: string | null } | null;
        const teamName = teamData?.name;
        const clubName = teamData?.clubs?.name || clubData?.name || "the club";
        const clubLogoUrl = teamData?.clubs?.logo_url || clubData?.logo_url;
        const entityName = teamName || clubName;
        const roleName = request.role.replace("_", " ");

        const { data: requesterProfile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", request.user_id)
          .maybeSingle();

        const { data: emailData } = await supabase.rpc("get_user_emails_by_ids", { user_ids: [request.user_id] });
        const userEmail = emailData?.[0]?.email;

        if (userEmail) {
          await supabase.functions.invoke("send-email", {
            body: {
              to: userEmail,
              subject: `Update on your request to join ${entityName}`,
              template: "join-request-response",
              templateData: {
                recipientName: requesterProfile?.display_name || "Member",
                teamName: teamName,
                clubName: clubName,
                roleName: roleName,
                approved: false,
                clubLogoUrl: clubLogoUrl,
              },
            },
          });
        }
      } catch (sideEffectError) {
        console.warn("[denyRequest] Notification email side-effect failed:", sideEffectError);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Request denied");
    },
    onError: (error: Error) => {
      toast.error(friendlyRequestError(error, "deny"));
    },
  });

  const openDirectMessageNotification = async (relatedId: string, createdAt?: string | null) => {
    const { data: directMsg } = await supabase
      .from("direct_messages")
      .select("id, conversation_id")
      .eq("id", relatedId)
      .maybeSingle();
    if (directMsg?.conversation_id) {
      jumpAndNavigate(navigate, "dm", directMsg.conversation_id, directMsg.id, `/messages/dm/${directMsg.conversation_id}?message=${directMsg.id}`);
      return true;
    }

    const { data: conversation } = await supabase
      .from("direct_conversations")
      .select("id")
      .eq("id", relatedId)
      .maybeSingle();
    if (!conversation) return false;

    const clickedAt = createdAt ? new Date(createdAt) : null;
    const upperBound = clickedAt && !Number.isNaN(clickedAt.getTime())
      ? new Date(clickedAt.getTime() + 30_000).toISOString()
      : null;
    let messageQuery = supabase
      .from("direct_messages")
      .select("id, conversation_id")
      .eq("conversation_id", relatedId)
      .is("deleted_at", null);
    if (user?.id) messageQuery = messageQuery.neq("author_id", user.id);
    if (upperBound) messageQuery = messageQuery.lte("created_at", upperBound);
    const { data: nearestMsg } = await messageQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (nearestMsg?.id) {
      jumpAndNavigate(navigate, "dm", relatedId, nearestMsg.id, `/messages/dm/${relatedId}?message=${nearestMsg.id}`);
    } else {
      navigate(`/messages/dm/${relatedId}`);
    }
    return true;
  };

  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read first
    if (!notification.read) {
      markAsRead.mutate(notification.id);
    }

    // Navigate based on notification type
    const relatedId = notification.related_id;
    if (!relatedId) return;

    switch (notification.type) {
      case "message_reaction": {
        // Current notifications store the reacted message id. Some older rows
        // stored only the chat/container id, so recover the exact message from
        // the reaction row created at the same instant.
        const messageTarget = await resolveChatTargetForMessageId(relatedId);
        if (messageTarget) { navigateToChatTarget(navigate, messageTarget); break; }
        const legacyReactionTarget = await resolveLegacyReactionTarget(notification);
        if (legacyReactionTarget) { navigateToChatTarget(navigate, legacyReactionTarget); break; }
        // Backward-compat: old notifications stored container id as related_id.
        const { data: teamCheck } = await supabase.from("teams").select("id").eq("id", relatedId).maybeSingle();
        if (teamCheck) { navigate(`/messages/${relatedId}`); break; }
        const { data: clubCheck } = await supabase.from("clubs").select("id").eq("id", relatedId).maybeSingle();
        if (clubCheck) { navigate(`/messages/club/${relatedId}`); break; }
        const { data: groupCheck } = await supabase.from("chat_groups").select("id").eq("id", relatedId).maybeSingle();
        if (groupCheck) { navigate(`/groups/${relatedId}`); break; }
        const { data: convCheck } = await supabase.from("direct_conversations").select("id").eq("id", relatedId).maybeSingle();
        if (convCheck) { navigate(`/messages/dm/${relatedId}`); break; }
        navigate("/messages");
        break;
      }
      case "team_message":
      case "message_reply":
      case "message_mention":
      case "message_forwarded":
        // For replies/mentions/forwards, related_id is the message id - try team first
        const { data: teamMessage } = await supabase
          .from("team_messages")
          .select("team_id")
          .eq("id", relatedId)
          .maybeSingle();
        if (teamMessage?.team_id) {
          jumpAndNavigate(navigate, "team", teamMessage.team_id, relatedId, `/messages/${teamMessage.team_id}?message=${relatedId}`);
          break;
        }
        // Try club message
        const { data: clubMsgForReaction } = await supabase
          .from("club_messages")
          .select("club_id")
          .eq("id", relatedId)
          .maybeSingle();
        if (clubMsgForReaction?.club_id) {
          jumpAndNavigate(navigate, "club", clubMsgForReaction.club_id, relatedId, `/messages/club/${clubMsgForReaction.club_id}?message=${relatedId}`);
          break;
        }
        // Try group message
        const { data: groupMsgForReaction } = await supabase
          .from("group_messages")
          .select("group_id")
          .eq("id", relatedId)
          .maybeSingle();
        if (groupMsgForReaction?.group_id) {
          jumpAndNavigate(navigate, "group", groupMsgForReaction.group_id, relatedId, `/groups/${groupMsgForReaction.group_id}?message=${relatedId}`);
          break;
        }
        // Try direct message
        const { data: dmMsgForReaction } = await supabase
          .from("direct_messages")
          .select("conversation_id")
          .eq("id", relatedId)
          .maybeSingle();
        if (dmMsgForReaction?.conversation_id) {
          jumpAndNavigate(navigate, "dm", dmMsgForReaction.conversation_id, relatedId, `/messages/dm/${dmMsgForReaction.conversation_id}?message=${relatedId}`);
          break;
        }
        // Try broadcast
        const { data: broadcastMsg } = await supabase
          .from("broadcast_messages")
          .select("id")
          .eq("id", relatedId)
          .maybeSingle();
        if (broadcastMsg) {
          jumpAndNavigate(navigate, "broadcast", null, relatedId, `/messages/broadcast?message=${relatedId}`);
        }
        break;
      case "club_message":
        const { data: clubMessage } = await supabase
          .from("club_messages")
          .select("club_id")
          .eq("id", relatedId)
          .single();
        if (clubMessage?.club_id) {
          jumpAndNavigate(navigate, "club", clubMessage.club_id, relatedId, `/messages/club/${clubMessage.club_id}?message=${relatedId}`);
        }
        break;
      case "group_message":
        const { data: groupMessage } = await supabase
          .from("group_messages")
          .select("group_id")
          .eq("id", relatedId)
          .single();
        if (groupMessage?.group_id) {
          jumpAndNavigate(navigate, "group", groupMessage.group_id, relatedId, `/groups/${groupMessage.group_id}?message=${relatedId}`);
        }
        break;
      case "club_admin_message": {
        // related_id is the club_admin_messages.id; look up its conversation
        const { data: caMsg } = await (supabase as any)
          .from("club_admin_messages")
          .select("conversation_id")
          .eq("id", relatedId)
          .maybeSingle();
        if (caMsg?.conversation_id) {
          jumpAndNavigate(navigate, "club_admin", caMsg.conversation_id, relatedId, `/messages/club-admin/${caMsg.conversation_id}?message=${relatedId}`);
        } else {
          // Fallback: related_id might already be a conversation id
          const { data: convCheck } = await (supabase as any)
            .from("club_admin_conversations")
            .select("id")
            .eq("id", relatedId)
            .maybeSingle();
          if (convCheck) navigate(`/messages/club-admin/${relatedId}`);
          else navigate("/messages");
        }
        break;
      }
      case "broadcast":
        jumpAndNavigate(navigate, "broadcast", null, relatedId, `/messages/broadcast?message=${relatedId}`);
        break;
      case "direct_message":
        if (!(await openDirectMessageNotification(relatedId, notification.created_at))) navigate("/messages");
        break;
      case "event_invite":
      case "event_cancelled":
      case "event_updated":
      case "event_reminder":
      case "event_view_reminder":
      case "duty_assigned":
      case "rsvp":
      case "rsvp_update":
      case "rsvp_updated":
        navigate(`/events/${relatedId}`);
        break;
      case "photo_comment":
      case "photo_reaction": {
        const { data: photoCheck } = await supabase
          .from("photos")
          .select("id, deleted_at")
          .eq("id", relatedId)
          .maybeSingle();
        if (!photoCheck || photoCheck.deleted_at) {
          toast.info("This photo is no longer available.");
          break;
        }
        const suffix = notification.type === "photo_comment" ? "&comments=1" : "";
        navigate(`/media?photo=${relatedId}${suffix}`);
        break;
      }
      case "photo_uploaded": {
        // Land on the gallery filtered to the team/club, not fullscreen.
        const { data: photoCheck } = await supabase
          .from("photos")
          .select("id, team_id, club_id, deleted_at")
          .eq("id", relatedId)
          .maybeSingle();
        if (!photoCheck || photoCheck.deleted_at) {
          navigate("/media");
          break;
        }
        if (photoCheck.team_id) {
          navigate(`/media?team=${photoCheck.team_id}`);
        } else if (photoCheck.club_id) {
          navigate(`/media?club=${photoCheck.club_id}`);
        } else {
          navigate("/media");
        }
        break;
      }
      case "photo_prompt_reminder": {
        // related_id is the event_id — open Media gallery filtered to that team/event
        // with the upload sheet auto-opened.
        const { data: ev } = await supabase
          .from("events")
          .select("id, team_id")
          .eq("id", relatedId)
          .maybeSingle();
        if (ev?.team_id) {
          navigate(`/media?team=${ev.team_id}&event=${ev.id}&upload=1`);
        } else {
          navigate(`/media?upload=1`);
        }
        break;
      }
      case "comment_reaction":
      case "comment_reply": {
        let targetPhotoId: string | null = null;
        if (notification.type === "comment_reply") {
          targetPhotoId = relatedId;
        } else {
          const { data: commentData } = await supabase
            .from("photo_comments")
            .select("photo_id")
            .eq("id", relatedId)
            .maybeSingle();
          targetPhotoId = commentData?.photo_id ?? null;
        }
        if (!targetPhotoId) {
          toast.info("This photo is no longer available.");
          break;
        }
        const { data: photoCheck2 } = await supabase
          .from("photos")
          .select("id, deleted_at")
          .eq("id", targetPhotoId)
          .maybeSingle();
        if (!photoCheck2 || photoCheck2.deleted_at) {
          toast.info("This photo is no longer available.");
          break;
        }
        // comment replies / reactions also belong on the comment screen
        navigate(`/media?photo=${targetPhotoId}&comments=1`);
        break;
      }
      case "team_invite": {
        // related_id is the pending_invite id — look up status and team
        const { data: inviteData } = await supabase
          .from("pending_invites")
          .select("invite_token, team_id, club_id, status, metadata")
          .eq("id", relatedId)
          .maybeSingle();
        if (inviteData) {
          const inviteMeta = inviteData.metadata as any;
          if (inviteData.status === 'accepted' || inviteData.status === 'auto_accepted') {
            // Already accepted — navigate to the right page
            if (inviteMeta?.mini_league_id) {
              navigate(`/mini-leagues/${inviteMeta.mini_league_id}`);
            } else if (inviteData.team_id) {
              navigate(`/teams/${inviteData.team_id}`);
            } else if (inviteData.club_id) {
              navigate(`/clubs/${inviteData.club_id}`);
            }
          } else if (inviteData.invite_token) {
            if (inviteData.team_id) {
              navigate(`/join/${inviteData.invite_token}`);
            } else {
              navigate(`/join/p/${inviteData.invite_token}`);
            }
          }
        }
        break;
      }
      case "role_assigned":
      case "invite_accepted":
      case "team_join": {
        // related_id is the team_id — navigate to team page
        if (relatedId) {
          navigate(`/teams/${relatedId}`);
        }
        break;
      }
      case "member_joined": {
        // related_id could be mini_league_id, team_id, or club_id — check which one
        if (relatedId) {
          const { data: miniLeagueCheck } = await supabase
            .from("mini_leagues")
            .select("id")
            .eq("id", relatedId)
            .maybeSingle();
          if (miniLeagueCheck) {
            navigate(`/mini-leagues/${relatedId}`);
          } else {
            const { data: clubCheckMJ } = await supabase
              .from("clubs")
              .select("id")
              .eq("id", relatedId)
              .maybeSingle();
            if (clubCheckMJ) {
              navigate(`/clubs/${relatedId}`);
            } else {
              navigate(`/teams/${relatedId}`);
            }
          }
        }
        break;
      }
      case "club_join": {
        // related_id is the club_id — navigate to club page
        if (relatedId) {
          navigate(`/clubs/${relatedId}`);
        }
        break;
      }
      case "join_request":
        // Just mark as read - admin can approve/deny from notification buttons
        // Don't navigate away since they can take action right here
        break;
      case "join_request_approved":
      case "join_request_denied":
      case "join_request_processed":
        // Navigate to the club or team - relatedId is club_id or team_id
        if (relatedId) {
          // Try to determine if it's a club or team
          const { data: clubCheck } = await supabase
            .from("clubs")
            .select("id")
            .eq("id", relatedId)
            .single();
          if (clubCheck) {
            navigate(`/clubs/${relatedId}`);
          } else {
            navigate(`/teams/${relatedId}`);
          }
        }
        break;
      case "pending_sub":
        // Navigate to home and open the pitch board
        localStorage.setItem('pitch-board-open-source', 'pending_sub');
        navigate("/");
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('open-pitch-board', { detail: { notificationType: 'pending_sub' } }));
        }, 300);
        break;
      case "half_time":
      case "game_finished":
        // related_id is game.id — try to find the linked event from the active game
        if (relatedId) {
          const { data: activeGame } = await supabase
            .from("active_games")
            .select("pitch_state")
            .eq("id", relatedId)
            .maybeSingle();
          const linkedEventId = (activeGame?.pitch_state as any)?.linkedEventId;
          if (linkedEventId) {
            navigate(`/events/${linkedEventId}`);
          } else {
            // Fallback: navigate to home page instead of non-existent /pitch-board
            navigate("/");
          }
        } else {
          navigate("/");
        }
        break;
      case "formation_change":
        // Open the pitch board (same flow as pending_sub).
        // The HomePage listener uses the persisted timer state to know which board to open.
        localStorage.setItem('pitch-board-open-source', 'formation_change');
        navigate("/");
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('open-pitch-board', { detail: { notificationType: 'formation_change' } }));
        }, 300);
        break;
      case "points_awarded":
      case "early_rsvp_points":
      case "reward_redeemed":
      case "player_of_match":
        navigate("/profile?section=points-history");
        break;
      case "fee_payment_request":
        if (relatedId) {
          navigate(`/pay-fees/${relatedId}`);
        }
        break;
      default:
        break;
    }
  };

  const unreadCount = notifications?.filter((n) => !n.read).length || 0;

  return (
    <div 
      ref={containerRef}
      className="pt-2 pb-6 space-y-4 min-h-full"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div 
        className="flex justify-center items-center overflow-hidden transition-all duration-200"
        style={{ 
          height: pullDistance > 0 ? pullDistance : 0,
          opacity: pullDistance / PULL_THRESHOLD 
        }}
      >
        <RefreshCw 
          className={`h-6 w-6 text-primary transition-transform ${isRefreshing ? 'animate-spin' : ''}`}
          style={{ 
            transform: `rotate(${pullDistance * 2}deg)`,
          }}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">Notifications</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {unreadCount > 0 && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
            >
              <CheckCheck className="h-4 w-4 mr-1" />
              Mark all read
            </Button>
          )}
          {notifications && notifications.length > 0 && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => clearAllNotifications.mutate()}
              disabled={clearAllNotifications.isPending}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear all
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : notifications?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No notifications yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" role="list" aria-label={`${displayedNotifications.length} notification${displayedNotifications.length === 1 ? '' : 's'}`}>
          {displayedNotifications.map((notification) => (
            <SwipeableNotificationCard
              key={notification.id}
              className={notification.read ? "opacity-60" : "border-primary/30"}
              onClick={() => handleNotificationClick(notification)}
              onDelete={() => deleteNotification.mutate(notification.id)}
            >
              <div className="flex items-start gap-3">
                <NotificationIconWrapper type={notification.type} isRead={notification.read} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${notification.read ? "text-muted-foreground" : ""}`}>
                    {notification.message}
                    {/* Show "View event" link for event-related notifications */}
                    {["event_invite", "event_cancelled", "event_updated", "event_reminder", "event_view_reminder", "duty_assigned"].includes(notification.type) && notification.related_id && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 ml-1 text-primary font-medium"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!notification.read) {
                            markAsRead.mutate(notification.id);
                          }
                          navigate(`/events/${notification.related_id}`);
                        }}
                      >
                        View event →
                      </Button>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(parseISO(notification.created_at), { addSuffix: true })}
                  </p>
                  {notification.type === "join_request" && notification.related_id && (
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          approveRequest.mutate(notification.related_id!);
                        }}
                        disabled={approveRequest.isPending || denyRequest.isPending}
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          denyRequest.mutate(notification.related_id!);
                        }}
                        disabled={approveRequest.isPending || denyRequest.isPending}
                      >
                        <XCircle className="h-3 w-3 mr-1" />
                        Deny
                      </Button>
                    </div>
                  )}
                </div>
                {!notification.read && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      markAsRead.mutate(notification.id);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      markAsRead.mutate(notification.id);
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </SwipeableNotificationCard>
          ))}
          
          {hasMore && (
            <Button
              variant="outline"
              className="w-full"
              onClick={loadMore}
            >
              Load more ({(notifications?.length || 0) - displayCount} remaining)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
