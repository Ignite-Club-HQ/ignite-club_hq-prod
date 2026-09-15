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
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow, parseISO } from "date-fns";
import { playNotificationSound, showBrowserNotification } from "@/lib/notifications";
import { toast } from "sonner";
import { useNotificationIcon } from "@/components/NotificationIcon";
import { setPendingChatJump, withChatJumpNonce, type ChatJumpKind } from "@/lib/pendingChatJump";
import { useClubTheme } from "@/hooks/useClubTheme";
import {
  resolveChatTargetResult,
  NOTIFICATION_FALLBACK_PATH,
  type ChatTarget,
} from "@/lib/notificationChatRouting";
import { requestClubSwitchForChatTarget, requestClubSwitchForNotificationUrl } from "@/lib/notificationClubSwitch";
import { notificationKeys } from "@/features/notifications/queryKeys";
import {
  beginNotificationListUpdate,
  invalidateNotificationSurfaces,
  notificationListFamilyKey,
  restoreQuerySnapshots,
  snapshotAndUpdateQueries,
  type QuerySnapshot,
} from "@/features/notifications/cachePolicy";
import {
  resolveDirectNotificationTarget,
  resolveLegacyReactionContainerPath,
  resolveLegacyReactionTarget,
  resolveScopedMessageNotificationTarget,
} from "@/features/notifications/notificationNavigationRepository";
import {
  clearNotifications,
  deleteNotification as deleteNotificationRecord,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationListItem,
} from "@/features/notifications/notificationRepository";
import {
  resolveCommentNotificationTarget,
  resolvePhotoInteractionTarget,
  resolvePhotoPromptTarget,
  resolveUploadedPhotoTarget,
} from "@/features/notifications/mediaNotificationRepository";
import {
  friendlyRoleRequestError,
  processRoleRequest,
} from "@/features/notifications/roleRequestService";
import {
  resolveInviteNotificationPath,
  resolveJoinedMemberPath,
  resolveProcessedJoinRequestPath,
} from "@/features/notifications/membershipNotificationRepository";
import { resolveGameNotificationPath } from "@/features/notifications/gameNotificationRepository";
import { useNotificationRealtime } from "@/features/notifications/useNotificationRealtime";


/**
 * A notification tap whose message lookup FAILED (offline / dropped socket) must
 * not redirect anywhere — the message probably still exists. Keep the user on
 * the list and invite a retry.
 */
function warnUnreachableNotification() {
  toast.error("Couldn't open this message", {
    description: "Your connection looks unstable. Tap it again once you're back online.",
  });
}



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
  console.log("[InAppNotifTap] jumpAndNavigate", { kind, targetId, messageId, to });
  try { setPendingChatJump(kind, targetId, messageId); } catch { /* ignore */ }
  // A bell tap is a user-driven action, so it MAY move the global active-club
  // filter to the club that owns this thread (same rationale as a push tap).
  // Resolve first (bounded) so the destination doesn't render under the wrong
  // club, then navigate. Membership is verified before the filter actually
  // changes, inside useNotificationClubSwitch.
  void requestClubSwitchForChatTarget(kind, targetId)
    .catch(() => { /* never block navigation */ })
    .finally(() => navigate(withChatJumpNonce(to)));
}


type Notification = NotificationListItem;

const navigateToChatTarget = (navigate: (to: string) => void, target: ChatTarget) => {
  jumpAndNavigate(navigate, target.kind, target.targetId, target.messageId, target.path);
};

// Helper component for rendering notification icons with read state
function NotificationIconWrapper({ type, isRead, message }: { type: string; isRead: boolean; message?: string | null }) {
  const { Icon, reactionEmoji, colorClass } = useNotificationIcon(type, message);
  return (
    <div className={`p-2 rounded-lg ${isRead ? "bg-muted" : "bg-primary/10"}`}>
      {reactionEmoji ? (
        <span
          className="inline-flex items-center justify-center h-4 w-4 text-base leading-none"
          role="img"
          aria-label={type.replace(/_/g, " ")}
        >
          {reactionEmoji}
        </span>
      ) : (
        <Icon className={`h-4 w-4 ${isRead ? "text-muted-foreground" : colorClass}`} />
      )}
    </div>
  );
}

const NOTIFICATIONS_PER_PAGE = 30;

export default function NotificationsPage() {
  const { user, refreshUnreadCount, clearUnreadCount } = useAuth();
  const { activeClubFilter } = useClubTheme();
  usePageTitle("Notifications");
  const navigate = useNavigate();
  const routerNavigate = navigate;

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
    if (user?.id) {
      await queryClient.invalidateQueries({
        queryKey: [notificationKeys.lists[0], user.id],
      });
    }
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
    queryKey: notificationKeys.list(user?.id, activeClubFilter),
    queryFn: () => listNotifications(user!.id, activeClubFilter),
    enabled: !!user,
    staleTime: 30000, // Consider data fresh for 30 seconds
  });

  // Paginated display
  const displayedNotifications = notifications?.slice(0, displayCount) || [];
  const hasMore = (notifications?.length || 0) > displayCount;

  const loadMore = useCallback(() => {
    setDisplayCount(prev => prev + NOTIFICATIONS_PER_PAGE);
  }, []);

  useNotificationRealtime(user?.id, queryClient, refreshUnreadCount);

  const markAsRead = useMutation({
    mutationFn: markNotificationRead,
    onMutate: async (id) => {
      const snapshots = await beginNotificationListUpdate<Notification[]>(
        queryClient,
        user?.id,
        (old) => old?.map(n => n.id === id ? { ...n, read: true } : n) || [],
      );
      return { snapshots };
    },
    onSuccess: () => {
      refreshUnreadCount();
    },
    onError: (_error, _id, context) => {
      restoreQuerySnapshots(
        queryClient,
        context?.snapshots ?? ([] as QuerySnapshot<Notification[]>[]),
      );
      refreshUnreadCount();
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: () => markAllNotificationsRead(user!.id, activeClubFilter),
    onMutate: async () => {
      const snapshots = await beginNotificationListUpdate<Notification[]>(
        queryClient,
        user?.id,
        (old) => old?.map(n => ({ ...n, read: true })) || [],
      );
      return { snapshots };
    },
    onSuccess: () => {
      if (!activeClubFilter) clearUnreadCount();
      invalidateNotificationSurfaces(queryClient, { includeMessageUnread: true });
      setTimeout(() => refreshUnreadCount(), 300);
    },
    onError: (_error, _variables, context) => {
      restoreQuerySnapshots(
        queryClient,
        context?.snapshots ?? ([] as QuerySnapshot<Notification[]>[]),
      );
      refreshUnreadCount();
    },
  });


  const deleteNotification = useMutation({
    mutationFn: deleteNotificationRecord,
    onMutate: async (id) => {
      const snapshots = await beginNotificationListUpdate<Notification[]>(
        queryClient,
        user?.id,
        (old) => old?.filter(n => n.id !== id) || [],
      );
      return { snapshots };
    },
    onSuccess: () => {
      refreshUnreadCount();
    },
    onError: (_error, _id, context) => {
      restoreQuerySnapshots(
        queryClient,
        context?.snapshots ?? ([] as QuerySnapshot<Notification[]>[]),
      );
      refreshUnreadCount();
    },
  });

  const clearAllNotifications = useMutation({
    mutationFn: () => clearNotifications(user!.id, activeClubFilter),
    onMutate: async () => {
      // Cancel any in-flight queries to prevent stale data overwriting
      const queryKey = notificationListFamilyKey(user?.id);
      await queryClient.cancelQueries({ queryKey });
      await queryClient.cancelQueries({ queryKey: notificationKeys.recent });
      await queryClient.cancelQueries({ queryKey: notificationKeys.globalUnread });
      const snapshots = snapshotAndUpdateQueries<Notification[]>(
        queryClient,
        queryKey,
        () => [],
      );
      return { snapshots };
    },
    onSuccess: () => {
      if (!activeClubFilter) clearUnreadCount();
      setDisplayCount(NOTIFICATIONS_PER_PAGE);
      // Invalidate all notification-related queries for consistency
      invalidateNotificationSurfaces(queryClient, { includeMessageUnread: true });
      // Force refresh to get accurate count from server
      setTimeout(() => refreshUnreadCount(), 300);
    },
    onError: (_error, _variables, context) => {
      restoreQuerySnapshots(
        queryClient,
        context?.snapshots ?? ([] as QuerySnapshot<Notification[]>[]),
      );
      refreshUnreadCount();
    },
  });


  const approveRequest = useMutation({
    mutationFn: (requestId: string) => processRoleRequest(requestId, "approve"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.lists });
      toast.success("Request approved");
    },
    onError: (error: Error) => {
      toast.error(friendlyRoleRequestError(error, "approve"));
    },
  });

  const denyRequest = useMutation({
    mutationFn: (requestId: string) => processRoleRequest(requestId, "deny"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.lists });
      toast.success("Request denied");
    },
    onError: (error: Error) => {
      toast.error(friendlyRoleRequestError(error, "deny"));
    },
  });

  const openDirectMessageNotification = async (relatedId: string, createdAt?: string | null) => {
    const target = await resolveDirectNotificationTarget(relatedId, user?.id, createdAt);
    if (!target) return false;
    if (target.messageId) jumpAndNavigate(navigate, "dm", target.conversationId, target.messageId, target.path);
    else navigate(target.path);
    return true;
  };

  const handleNotificationClick = async (notification: Notification) => {
    // Every non-chat branch below navigates straight into club-owned content
    // (`/events/:id`, `/media?photo=…`, `/teams/:id`, `/clubs/:id`, …). Route
    // those through a club-scope-aware navigate: a bell tap is user-driven, so
    // it MAY move the active club filter to the club that owns the tapped item.
    // Without this the app stayed filtered to the previous club and
    // `useClubScopeGuard` bounced the user straight back home.
    const navigate = (to: string) => {
      void requestClubSwitchForNotificationUrl(null, to)
        .catch(() => { /* never block navigation */ })
        .finally(() => routerNavigate(to));
    };

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
        const reactionResult = await resolveChatTargetResult(relatedId);
        if (reactionResult.status === "found") { navigateToChatTarget(navigate, reactionResult.target); break; }
        if (reactionResult.status === "unreachable") { warnUnreachableNotification(); break; }
        const legacyReactionTarget = await resolveLegacyReactionTarget(notification);
        if (legacyReactionTarget) { navigateToChatTarget(navigate, legacyReactionTarget); break; }
        // Backward-compat: old notifications stored container id as related_id.
        navigate(await resolveLegacyReactionContainerPath(relatedId) ?? "/messages");
        break;
      }
      case "team_message":
      case "message_reply":
      case "message_mention":
      case "message_forwarded": {
        // related_id is a message id. resolveChatTargetResult probes all six
        // message tables under RLS and distinguishes three outcomes:
        //  - found       → jump to the chat
        //  - not_found   → deleted / no access; safe /messages fallback
        //  - unreachable → a probe FAILED (offline, dropped socket). Stay put
        //                  and tell the user to retry rather than silently
        //                  dumping them on /messages as if the message were gone.
        const result = await resolveChatTargetResult(relatedId);
        if (result.status === "found") {
          navigateToChatTarget(navigate, result.target);
        } else if (result.status === "unreachable") {
          warnUnreachableNotification();
        } else {
          navigate(NOTIFICATION_FALLBACK_PATH);
        }
        break;
      }


      case "club_message": {
        const target = await resolveScopedMessageNotificationTarget("club", relatedId);
        if (target?.messageId) jumpAndNavigate(navigate, target.kind, target.targetId, target.messageId, target.path);
        break;
      }
      case "group_message": {
        const target = await resolveScopedMessageNotificationTarget("group", relatedId);
        if (target?.messageId) jumpAndNavigate(navigate, target.kind, target.targetId, target.messageId, target.path);
        break;
      }
      case "club_admin_message": {
        const target = await resolveScopedMessageNotificationTarget("club_admin", relatedId);
        if (!target) navigate("/messages");
        else if (target.messageId) jumpAndNavigate(navigate, target.kind, target.targetId, target.messageId, target.path);
        else navigate(target.path);
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
      case "duty_completed":

      case "rsvp":
      case "rsvp_update":
      case "rsvp_updated":
        navigate(`/events/${relatedId}`);
        break;
      case "photo_comment":
      case "photo_reaction": {
        const target = await resolvePhotoInteractionTarget(relatedId, notification.type === "photo_comment");
        if (target.status === "unavailable") {
          toast.info("This photo is no longer available.");
          break;
        }
        navigate(target.path);
        break;
      }
      case "photo_uploaded": {
        // Land on the gallery filtered to the team/club, not fullscreen.
        navigate(await resolveUploadedPhotoTarget(relatedId));
        break;
      }
      case "photo_prompt_reminder": {
        // related_id is the event_id — open Media gallery filtered to that team/event
        // with the upload sheet auto-opened.
        navigate(await resolvePhotoPromptTarget(relatedId));
        break;
      }
      case "comment_reaction":
      case "comment_reply": {
        const target = await resolveCommentNotificationTarget(relatedId, notification.type === "comment_reply");
        if (target.status === "unavailable") {
          toast.info("This photo is no longer available.");
          break;
        }
        navigate(target.path);
        break;
      }
      case "team_invite": {
        const path = await resolveInviteNotificationPath(relatedId);
        if (path) navigate(path);
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
        navigate(await resolveJoinedMemberPath(relatedId));
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
        navigate(await resolveProcessedJoinRequestPath(relatedId));
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
        navigate(await resolveGameNotificationPath(relatedId));
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
      case "leaderboard_update":
      case "streak_progress":
      case "streak_bonus":
      case "reward_proximity":
      case "reward_unlocked":
        navigate("/leaderboard");
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
                <NotificationIconWrapper type={notification.type} isRead={notification.read} message={notification.message} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${notification.read ? "text-muted-foreground" : ""}`}>
                    {notification.message}
                    {/* Show "View event" link for event-related notifications */}
                    {["event_invite", "event_cancelled", "event_updated", "event_reminder", "event_view_reminder", "duty_assigned", "duty_completed"].includes(notification.type) && notification.related_id && (
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
