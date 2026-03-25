import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Bell, BellOff, BellRing, Loader2, Check, ChevronDown, ChevronUp, Mail, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface EventViewsAdminSectionProps {
  eventId: string;
  teamId: string | null;
  clubId: string;
  miniLeagueId: string | null;
}

interface MemberWithViewStatus {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  hasViewed: boolean;
  viewedAt?: string;
}

export function EventViewsAdminSection({ 
  eventId, 
  teamId, 
  clubId, 
  miniLeagueId 
}: EventViewsAdminSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSendingNudge, setIsSendingNudge] = useState(false);
  const [sendingForUser, setSendingForUser] = useState<string | null>(null);
  const [nudgingUser, setNudgingUser] = useState<string | null>(null);

  // Fetch all event views for this event
  const { data: eventViews } = useQuery({
    queryKey: ["event-views", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_views")
        .select("user_id, viewed_at")
        .eq("event_id", eventId);
      
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch members who should see this event
  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["event-members-for-views", eventId, teamId, clubId, miniLeagueId],
    queryFn: async () => {
      let userIds: string[] = [];

      if (miniLeagueId) {
        // For mini-league events, get parents and league admins
        const { data: players } = await supabase
          .from("mini_league_players")
          .select("parent_user_id")
          .eq("mini_league_id", miniLeagueId)
          .not("parent_user_id", "is", null);
        
        const parentIds = [...new Set(players?.map(p => p.parent_user_id).filter(Boolean) as string[])];
        
        const { data: adminRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", clubId)
          .in("role", ["club_admin", "league_admin", "coach"]);
        
        const adminIds = adminRoles?.map(r => r.user_id) || [];
        userIds = [...new Set([...parentIds, ...adminIds])];
      } else if (teamId) {
        // For team events, get team members
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("team_id", teamId);
        
        userIds = roles?.map(r => r.user_id) || [];
      } else {
        // For club-wide events, get club members
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", clubId);
        
        userIds = roles?.map(r => r.user_id) || [];
      }

      if (userIds.length === 0) return [];

      // Fetch profiles
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);

      if (error) throw error;
      return profiles || [];
    },
  });

  // Combine members with view status
  const viewedUserIds = new Set(eventViews?.map(v => v.user_id) || []);
  const viewedAtMap = new Map(eventViews?.map(v => [v.user_id, v.viewed_at]) || []);

  const membersWithStatus: MemberWithViewStatus[] = (members || []).map(m => ({
    id: m.id,
    display_name: m.display_name,
    avatar_url: m.avatar_url,
    hasViewed: viewedUserIds.has(m.id),
    viewedAt: viewedAtMap.get(m.id),
  }));

  const viewedMembers = membersWithStatus.filter(m => m.hasViewed);
  const notViewedMembers = membersWithStatus.filter(m => !m.hasViewed);

  const memberIds = useMemo(() => membersWithStatus.map(m => m.id), [membersWithStatus]);

  // Fetch notification preferences (events_enabled) for all members via RPC to bypass RLS
  const { data: notifPrefs } = useQuery({
    queryKey: ["event-members-notif-prefs", eventId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data, error } = await supabase
        .rpc("get_members_events_enabled", { member_ids: memberIds });
      
      if (error) console.error("[EventViews] notif prefs RPC error:", error);
      
      const map: Record<string, boolean> = {};
      for (const row of data || []) {
        map[row.user_id] = row.events_enabled;
      }
      return map;
    },
    enabled: isOpen && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  // Fetch push reachability (has push_subscriptions or fcm_tokens)
  const { data: pushReachable } = useQuery({
    queryKey: ["event-members-push-reachable", eventId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data, error } = await supabase
        .rpc("get_members_push_reachable", { member_ids: memberIds });
      
      if (error) console.error("[EventViews] push reachable RPC error:", error);
      
      const map: Record<string, boolean> = {};
      for (const row of data || []) {
        map[row.user_id] = row.has_push;
      }
      return map;
    },
    enabled: isOpen && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  // Send reminder mutation
  const sendReminderMutation = useMutation({
    mutationFn: async ({ userIds, channels }: { userIds: string[]; channels: "push" | "email" | "both" }) => {
      const { data, error } = await supabase.functions.invoke("send-event-view-reminder", {
        body: { eventId, userIds, channels },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const parts: string[] = [];
      if (data.emailsSent > 0) parts.push(`${data.emailsSent} email${data.emailsSent === 1 ? "" : "s"}`);
      if (data.pushSent > 0) parts.push(`${data.pushSent} push notification${data.pushSent === 1 ? "" : "s"}`);
      toast({
        title: "Reminders sent!",
        description: parts.length > 0 ? `Sent ${parts.join(" and ")}.` : "No reminders could be delivered.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to send reminders",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSendReminders = async (channels: "push" | "email" | "both", targetUserIds?: string[]) => {
    const ids = targetUserIds || notViewedMembers.map(m => m.id);
    if (ids.length === 0) return;
    
    const isSingle = targetUserIds && targetUserIds.length === 1;
    if (isSingle) setSendingForUser(targetUserIds[0]);
    else setIsSending(true);
    
    try {
      await sendReminderMutation.mutateAsync({ userIds: ids, channels });
    } finally {
      if (isSingle) setSendingForUser(null);
      else setIsSending(false);
    }
  };

  const handleSendNudgeToUser = async (userId: string, displayName: string) => {
    setNudgingUser(userId);
    try {
      const { error } = await supabase.from("notifications").insert({
        user_id: userId,
        type: "admin_nudge" as const,
        message: "Your admin recommends enabling push notifications so you never miss important updates. Go to Settings to enable them.",
        related_id: eventId,
      });
      if (error) throw error;
      toast({
        title: "Nudge sent!",
        description: `Sent notification nudge to ${displayName}.`,
      });
    } catch (error: any) {
      toast({
        title: "Failed to send nudge",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setNudgingUser(null);
    }
  };

  // Compute unreachable members (no push setup)
  const unreachableMembers = useMemo(() => {
    if (!pushReachable) return [];
    return (members || []).filter(m => pushReachable[m.id] === false);
  }, [members, pushReachable]);

  if (membersLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading view status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalMembers = membersWithStatus.length;
  const viewedCount = viewedMembers.length;
  const notViewedCount = notViewedMembers.length;

  const handleSendNudge = async () => {
    if (unreachableMembers.length === 0) return;
    setIsSendingNudge(true);
    try {
      // Send in-app notification to unreachable members
      const notifications = unreachableMembers.map(m => ({
        user_id: m.id,
        type: "admin_nudge" as const,
        message: "Your admin recommends enabling push notifications so you never miss important updates. Go to Settings to enable them.",
        related_id: eventId,
      }));
      
      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) throw error;

      toast({
        title: "Nudge sent!",
        description: `Sent notification to ${unreachableMembers.length} member${unreachableMembers.length === 1 ? '' : 's'} encouraging them to enable notifications.`,
      });
    } catch (error: any) {
      toast({
        title: "Failed to send nudge",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSendingNudge(false);
    }
  };

  const MemberRow = useCallback(({ member, variant }: { member: MemberWithViewStatus; variant: "viewed" | "not-viewed" }) => {
    const pushDisabled = notifPrefs && member.id in notifPrefs ? !notifPrefs[member.id] : false;
    const noPushSetup = pushReachable ? (pushReachable[member.id] === false) : false;
    const [showMenu, setShowMenu] = useState(false);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchStart = useRef<{ x: number; y: number } | null>(null);

    const LONG_PRESS_MS = 600;
    const MOVE_THRESHOLD = 10;

    const handleTouchStart = (e: React.TouchEvent) => {
      const touch = e.touches[0];
      touchStart.current = { x: touch.clientX, y: touch.clientY };
      longPressTimer.current = setTimeout(() => {
        setShowMenu(true);
      }, LONG_PRESS_MS);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (!touchStart.current || !longPressTimer.current) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStart.current.x);
      const dy = Math.abs(touch.clientY - touchStart.current.y);
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };

    const handleTouchEnd = () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };

    return (
      <div
        key={member.id}
        className={`flex items-center gap-2 p-2 rounded-lg select-none ${
          variant === "viewed" ? "bg-primary/5" : "bg-muted/50"
        }`}
        onTouchStart={variant === "not-viewed" ? handleTouchStart : undefined}
        onTouchMove={variant === "not-viewed" ? handleTouchMove : undefined}
        onTouchEnd={variant === "not-viewed" ? handleTouchEnd : undefined}
        onContextMenu={(e) => { if (variant === "not-viewed") e.preventDefault(); }}
      >
        <Avatar className="h-7 w-7">
          <AvatarImage src={member.avatar_url || undefined} />
          <AvatarFallback className="text-xs">
            {member.display_name?.charAt(0)?.toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm truncate flex-1">{member.display_name || "Unknown"}</span>
        <div className="flex items-center gap-1 shrink-0">
          {(pushDisabled || noPushSetup) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="p-0.5 rounded text-destructive/70">
                  <BellOff className="h-3.5 w-3.5" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>{noPushSetup ? "No push notifications set up" : "Event push notifications disabled"}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {variant === "viewed" && member.viewedAt && (
            <span className="text-xs text-muted-foreground">
              {new Date(member.viewedAt).toLocaleDateString()}
            </span>
          )}
          {variant === "not-viewed" && showMenu && (
            <DropdownMenu modal={false} open={showMenu} onOpenChange={setShowMenu}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 touch-none"
                  disabled={sendingForUser === member.id || nudgingUser === member.id}
                >
                  {(sendingForUser === member.id || nudgingUser === member.id) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MoreVertical className="h-3.5 w-3.5" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleSendReminders("push", [member.id])}>
                  <Smartphone className="h-4 w-4 mr-2" />
                  Send Push
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSendReminders("email", [member.id])}>
                  <Mail className="h-4 w-4 mr-2" />
                  Send Email
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSendReminders("both", [member.id])}>
                  <Bell className="h-4 w-4 mr-2" />
                  Send Both
                </DropdownMenuItem>
                {noPushSetup && (
                  <DropdownMenuItem onClick={() => handleSendNudgeToUser(member.id, member.display_name || "Member")}>
                    <BellRing className="h-4 w-4 mr-2" />
                    Nudge to Enable Push
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    );
  }, [notifPrefs, pushReachable, sendingForUser, nudgingUser, handleSendReminders, handleSendNudgeToUser]);

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Event Views
              </CardTitle>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary" className="gap-1">
                    <Eye className="h-3 w-3" />
                    {viewedCount}
                  </Badge>
                  {notViewedCount > 0 && (
                    <Badge variant="outline" className="gap-1 text-warning border-warning">
                      <EyeOff className="h-3 w-3" />
                      {notViewedCount}
                    </Badge>
                  )}
                </div>
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            <TooltipProvider delayDuration={300}>
              {/* Not Viewed Section */}
              {notViewedMembers.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h4 className="text-sm font-medium flex items-center gap-2 text-warning">
                      <EyeOff className="h-4 w-4" />
                      Haven't Viewed ({notViewedCount})
                    </h4>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          disabled={isSending}
                          className="gap-1.5 touch-none"
                        >
                          {isSending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Bell className="h-4 w-4" />
                          )}
                          Send Reminder
                          <ChevronDown className="h-3 w-3 ml-0.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleSendReminders("push")}>
                          <Smartphone className="h-4 w-4 mr-2" />
                          Push Notification
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleSendReminders("email")}>
                          <Mail className="h-4 w-4 mr-2" />
                          Email
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleSendReminders("both")}>
                          <Bell className="h-4 w-4 mr-2" />
                          Both (Push + Email)
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="grid gap-2">
                    {notViewedMembers.map((member) => <MemberRow key={member.id} member={member} variant="not-viewed" />)}
                  </div>
                </div>
              )}

              {notViewedMembers.length > 0 && viewedMembers.length > 0 && (
                <Separator />
              )}

              {/* Viewed Section */}
              {viewedMembers.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium flex items-center gap-2 text-primary">
                    <Check className="h-4 w-4" />
                    Viewed ({viewedCount})
                  </h4>
                  <div className="grid gap-2">
                    {viewedMembers.map((member) => <MemberRow key={member.id} member={member} variant="viewed" />)}
                  </div>
                </div>
              )}
            </TooltipProvider>

            {/* Nudge unreachable members */}
            {unreachableMembers.length > 0 && (
              <div className="pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <BellOff className="h-4 w-4" />
                    <span>{unreachableMembers.length} member{unreachableMembers.length === 1 ? '' : 's'} can't receive push notifications</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSendNudge}
                    disabled={isSendingNudge}
                    className="gap-1.5"
                  >
                    {isSendingNudge ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <BellRing className="h-3.5 w-3.5" />
                    )}
                    Nudge
                  </Button>
                </div>
              </div>
            )}

            {totalMembers === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No members to track
              </p>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
