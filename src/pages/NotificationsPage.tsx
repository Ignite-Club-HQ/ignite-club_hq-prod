import { useEffect, useCallback, useState, useRef } from "react";
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

interface Notification {
  id: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
  related_id: string | null;
}

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
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
        .select("*")
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
          const newNotification = payload.new as Notification;
          // Direct cache update - prepend new notification
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
          const updated = payload.new as Notification;
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
      // Optimistic update - clear all
      queryClient.setQueryData<Notification[]>(["notifications", user?.id], []);
    },
    onSuccess: () => {
      clearUnreadCount();
      setDisplayCount(NOTIFICATIONS_PER_PAGE);
    },
  });

  type AppRole = Database["public"]["Enums"]["app_role"];

  const approveRequest = useMutation({
    mutationFn: async (requestId: string) => {
      // Get the request details first with team/club info
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

      if (request.status !== "pending") {
        throw new Error("Request already processed");
      }

      // Check if role already exists
      let query = supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", request.user_id)
        .eq("role", request.role);
      
      if (request.club_id) {
        query = query.eq("club_id", request.club_id);
      } else {
        query = query.is("club_id", null);
      }
      
      if (request.team_id) {
        query = query.eq("team_id", request.team_id);
      } else {
        query = query.is("team_id", null);
      }

      const { data: existingRole } = await query.maybeSingle();

      // Only insert if role doesn't exist
      if (!existingRole) {
        const { error: roleError } = await supabase.from("user_roles").insert({
          user_id: request.user_id,
          role: request.role as AppRole,
          club_id: request.club_id,
          team_id: request.team_id,
        });

        if (roleError) throw roleError;
      }

      // Update the request status
      const { error: updateError } = await supabase
        .from("role_requests")
        .update({ status: "approved", processed_by: user!.id })
        .eq("id", requestId);

      if (updateError) throw updateError;

      // Get context info for notifications
      const teamData = request.teams as { id: string; name: string; club_id: string; clubs: { id: string; name: string; logo_url: string | null } | null } | null;
      const clubData = request.clubs as { id: string; name: string; logo_url: string | null } | null;
      
      const teamName = teamData?.name;
      const clubName = teamData?.clubs?.name || clubData?.name || "the club";
      const clubLogoUrl = teamData?.clubs?.logo_url || clubData?.logo_url;
      const entityName = teamName || clubName;
      const relatedId = request.team_id || request.club_id;
      const roleName = request.role.replace("_", " ");

      // Create in-app notification for the requester
      await supabase.from("notifications").insert({
        user_id: request.user_id,
        type: "join_request_approved",
        message: `Your request to join ${entityName} as ${roleName} has been approved!`,
        related_id: relatedId,
      });

      // Get requester's profile for email
      const { data: requesterProfile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", request.user_id)
        .single();

      // Get requester's email
      const { data: emailData } = await supabase.rpc("get_user_emails_by_ids", { user_ids: [request.user_id] });
      const userEmail = emailData?.[0]?.email;
      
      // Send email notification if we can get the email (via edge function)
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Request approved");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to approve request");
    },
  });

  const denyRequest = useMutation({
    mutationFn: async (requestId: string) => {
      // Get the request details first with team/club info
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

      const { error } = await supabase
        .from("role_requests")
        .update({ status: "denied", processed_by: user!.id })
        .eq("id", requestId);

      if (error) throw error;

      // Get context info for notifications
      const teamData = request.teams as { id: string; name: string; club_id: string; clubs: { id: string; name: string; logo_url: string | null } | null } | null;
      const clubData = request.clubs as { id: string; name: string; logo_url: string | null } | null;
      
      const teamName = teamData?.name;
      const clubName = teamData?.clubs?.name || clubData?.name || "the club";
      const clubLogoUrl = teamData?.clubs?.logo_url || clubData?.logo_url;
      const entityName = teamName || clubName;
      const relatedId = request.team_id || request.club_id;
      const roleName = request.role.replace("_", " ");

      // Create in-app notification for the requester
      await supabase.from("notifications").insert({
        user_id: request.user_id,
        type: "join_request_denied",
        message: `Your request to join ${entityName} as ${roleName} was not approved`,
        related_id: relatedId,
      });

      // Get requester's profile for email
      const { data: requesterProfile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", request.user_id)
        .single();

      // Get requester's email
      const { data: emailData } = await supabase.rpc("get_user_emails_by_ids", { user_ids: [request.user_id] });
      const userEmail = emailData?.[0]?.email;
      
      // Send email notification if we can get the email
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Request denied");
    },
    onError: () => {
      toast.error("Failed to deny request");
    },
  });

  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read first
    if (!notification.read) {
      markAsRead.mutate(notification.id);
    }

    // Navigate based on notification type
    const relatedId = notification.related_id;
    if (!relatedId) return;

    switch (notification.type) {
      case "team_message":
      case "message_reply":
      case "message_reaction":
      case "message_mention":
        // For replies/reactions/mentions, related_id is the message id - try team first
        const { data: teamMessage } = await supabase
          .from("team_messages")
          .select("team_id")
          .eq("id", relatedId)
          .single();
        if (teamMessage?.team_id) {
          navigate(`/messages/${teamMessage.team_id}?message=${relatedId}`);
          break;
        }
        // Try club message
        const { data: clubMsgForReaction } = await supabase
          .from("club_messages")
          .select("club_id")
          .eq("id", relatedId)
          .single();
        if (clubMsgForReaction?.club_id) {
          navigate(`/messages/club/${clubMsgForReaction.club_id}?message=${relatedId}`);
          break;
        }
        // Try group message
        const { data: groupMsgForReaction } = await supabase
          .from("group_messages")
          .select("group_id")
          .eq("id", relatedId)
          .single();
        if (groupMsgForReaction?.group_id) {
          navigate(`/groups/${groupMsgForReaction.group_id}?message=${relatedId}`);
          break;
        }
        // Try broadcast
        const { data: broadcastMsg } = await supabase
          .from("broadcast_messages")
          .select("id")
          .eq("id", relatedId)
          .single();
        if (broadcastMsg) {
          navigate(`/messages/broadcast?message=${relatedId}`);
        }
        break;
      case "club_message":
        const { data: clubMessage } = await supabase
          .from("club_messages")
          .select("club_id")
          .eq("id", relatedId)
          .single();
        if (clubMessage?.club_id) {
          navigate(`/messages/club/${clubMessage.club_id}?message=${relatedId}`);
        }
        break;
      case "group_message":
        const { data: groupMessage } = await supabase
          .from("group_messages")
          .select("group_id")
          .eq("id", relatedId)
          .single();
        if (groupMessage?.group_id) {
          navigate(`/groups/${groupMessage.group_id}?message=${relatedId}`);
        }
        break;
      case "broadcast":
        navigate(`/messages/broadcast?message=${relatedId}`);
        break;
      case "direct_message":
        // related_id is the conversation_id
        navigate(`/dm/${relatedId}`);
        break;
      case "event_invite":
      case "event_cancelled":
      case "event_reminder":
      case "duty_assigned":
        navigate(`/events/${relatedId}`);
        break;
      case "photo_comment":
      case "photo_uploaded":
      case "photo_reaction":
        navigate(`/media?photo=${relatedId}`);
        break;
      case "comment_reaction":
      case "comment_reply":
        // related_id is the photo_id for comment_reply, or comment_id for comment_reaction
        if (notification.type === "comment_reply") {
          navigate(`/media?photo=${relatedId}`);
        } else {
          // related_id is the comment id, get the photo_id from the comment
          const { data: commentData } = await supabase
            .from("photo_comments")
            .select("photo_id")
            .eq("id", relatedId)
            .maybeSingle();
          if (commentData?.photo_id) {
            navigate(`/media?photo=${commentData.photo_id}`);
          } else {
            navigate("/media");
          }
        }
        break;
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
        <div className="space-y-3">
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
                    {["event_invite", "event_cancelled", "event_reminder", "duty_assigned"].includes(notification.type) && notification.related_id && (
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
