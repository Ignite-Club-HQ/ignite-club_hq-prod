import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Bell, BellOff, BellRing, Loader2, Check, ChevronDown, ChevronUp, Mail, Smartphone, MessageSquareOff, Share2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { getShareUrl } from "@/lib/shareUtils";
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
import { EventViewMemberRow } from "@/components/EventViewMemberRow";

interface EventViewsAdminSectionProps {
  eventId: string;
  teamId: string | null;
  clubId: string;
  miniLeagueId: string | null;
  eventTitle?: string;
}

interface MemberWithViewStatus {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  hasViewed: boolean;
  viewedAt?: string;
  hasResponded: boolean;
  unrespondedChildCount?: number;
}

export function EventViewsAdminSection({ 
  eventId, 
  teamId, 
  clubId, 
  miniLeagueId,
  eventTitle,
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

  // Fetch RSVPs separately to track who has responded (including child RSVPs)
  const { data: eventRsvps } = useQuery({
    queryKey: ["event-rsvps-for-views", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rsvps")
        .select("user_id, child_id, status, created_at")
        .eq("event_id", eventId);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch children assigned to this team (to check child-level RSVP completeness)
  const { data: teamChildren } = useQuery({
    queryKey: ["event-team-children", teamId],
    queryFn: async () => {
      if (!teamId) return [];
      const { data, error } = await supabase
        .from("child_team_assignments")
        .select("child_id, children:child_id(id, name, parent_id)")
        .eq("team_id", teamId);
      if (error) throw error;
      return (data || []).map((d: any) => d.children).filter(Boolean);
    },
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
  });

  const teamChildIds = useMemo(
    () => (teamChildren || []).map((child: any) => child.id),
    [teamChildren]
  );

  // Fetch guardian links for children on this team so secondary guardians are treated like parents
  const { data: teamChildGuardians } = useQuery({
    queryKey: ["event-team-child-guardians", teamId, teamChildIds.join(",")],
    queryFn: async () => {
      if (!teamId || teamChildIds.length === 0) return [];
      const { data, error } = await supabase
        .from("child_guardians")
        .select("child_id, guardian_id")
        .in("child_id", teamChildIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!teamId && teamChildIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch all team/club members who should see this event
  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["event-members-for-views", eventId, teamId, clubId, miniLeagueId],
    queryFn: async () => {
      // For mini-league events, scope to league admins + parents of assigned children
      let userIds: string[] = [];

      if (miniLeagueId) {
        const [adminsRes, assignmentsRes, playersRes] = await Promise.all([
          supabase.from("mini_league_admins").select("user_id").eq("mini_league_id", miniLeagueId),
          supabase.from("child_mini_league_assignments").select("child_id").eq("mini_league_id", miniLeagueId),
          supabase.from("mini_league_players").select("parent_user_id").eq("mini_league_id", miniLeagueId),
        ]);
        const adminIds = (adminsRes.data || []).map((r: any) => r.user_id).filter(Boolean);
        const playerParentIds = (playersRes.data || []).map((r: any) => r.parent_user_id).filter(Boolean);

        const childIds = (assignmentsRes.data || []).map((r: any) => r.child_id).filter(Boolean);
        let childParentIds: string[] = [];
        if (childIds.length) {
          const [childrenRes, guardiansRes] = await Promise.all([
            supabase.from("children").select("parent_id").in("id", childIds),
            supabase.from("child_guardians").select("guardian_id").in("child_id", childIds),
          ]);
          childParentIds = [
            ...(childrenRes.data || []).map((c: any) => c.parent_id),
            ...(guardiansRes.data || []).map((g: any) => g.guardian_id),
          ].filter(Boolean);
        }

        userIds = [...adminIds, ...playerParentIds, ...childParentIds];
      } else if (teamId) {
        // Get all users with a role on this team
        const { data: roles, error } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("team_id", teamId);
        if (error) throw error;
        userIds = (roles || []).map(r => r.user_id).filter(Boolean);
      } else if (clubId) {
        // Get all users with a role in this club (direct club roles)
        const { data: clubRoles, error: clubError } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", clubId);
        if (clubError) throw clubError;
        const clubUserIds = (clubRoles || []).map(r => r.user_id).filter(Boolean);

        // Also get members from all teams in this club (covers team-only role rows)
        const { data: clubTeams } = await supabase
          .from("teams")
          .select("id")
          .eq("club_id", clubId);
        
        let teamUserIds: string[] = [];
        if (clubTeams?.length) {
          const teamIds = clubTeams.map(t => t.id);
          const { data: teamRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .in("team_id", teamIds);
          teamUserIds = (teamRoles || []).map(r => r.user_id).filter(Boolean);
        }

        userIds = [...clubUserIds, ...teamUserIds];
      }

      const uniqueUserIds = [...new Set(userIds)];
      if (uniqueUserIds.length === 0) return [];

      // Fetch profiles
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", uniqueUserIds);

      if (error) throw error;
      return profiles || [];
    },
  });

  // Combine members with view and RSVP status
  const viewedUserIds = new Set(eventViews?.map(v => v.user_id) || []);
  const viewedAtMap = new Map(eventViews?.map(v => [v.user_id, v.viewed_at]) || []);
  const rsvpUserIds = new Set(eventRsvps?.map(r => r.user_id) || []);

  // Build a set of child IDs that have RSVPs
  const rsvpdChildIds = new Set(
    eventRsvps?.filter(r => r.child_id).map(r => r.child_id) || []
  );

  // For each member, check if they have fully responded:
  // - If they have children/guardian-linked children on this team, all of those children must have RSVPs
  // - Otherwise they must have an RSVP for themselves
  const membersWithStatus: MemberWithViewStatus[] = (members || []).map(m => {
    const selfResponded = rsvpUserIds.has(m.id);
    const primaryChildren = (teamChildren || []).filter((c: any) => c.parent_id === m.id);
    const guardianChildIds = new Set(
      (teamChildGuardians || [])
        .filter((link: any) => link.guardian_id === m.id)
        .map((link: any) => link.child_id)
    );
    const guardianChildren = (teamChildren || []).filter((c: any) => guardianChildIds.has(c.id));
    const memberChildren = [...new Map([...primaryChildren, ...guardianChildren].map((child: any) => [child.id, child])).values()];
    const allChildrenResponded = memberChildren.length === 0 || memberChildren.every((c: any) => rsvpdChildIds.has(c.id));
    const unrespondedChildCount = memberChildren.filter((c: any) => !rsvpdChildIds.has(c.id)).length;

    const isParentOnTeam = memberChildren.length > 0;
    const fullyResponded = isParentOnTeam
      ? allChildrenResponded
      : selfResponded;

    return {
      id: m.id,
      display_name: m.display_name,
      avatar_url: m.avatar_url,
      hasViewed: viewedUserIds.has(m.id) || rsvpUserIds.has(m.id),
      viewedAt: viewedAtMap.get(m.id),
      hasResponded: fullyResponded,
      unrespondedChildCount,
    };
  });

  const viewedMembers = membersWithStatus.filter(m => m.hasViewed);
  const notViewedMembers = membersWithStatus.filter(m => !m.hasViewed);
  const notRespondedMembers = membersWithStatus.filter(m => !m.hasResponded);

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
      // Build per-user context for personalized messages
      const userContexts: Record<string, { selfResponded: boolean; unrespondedChildCount: number }> = {};
      for (const uid of userIds) {
        const member = membersWithStatus.find(m => m.id === uid);
        if (member) {
          userContexts[uid] = {
            selfResponded: rsvpUserIds.has(uid),
            unrespondedChildCount: member.unrespondedChildCount || 0,
          };
        }
      }

      const { data, error } = await supabase.functions.invoke("send-event-view-reminder", {
        body: { eventId, userIds, userContexts, channels },
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
    const ids = targetUserIds || notRespondedMembers.map(m => m.id);
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
  const handleShareEventLink = async () => {
    const shareUrl = getShareUrl("event", eventId);
    const shareText = eventTitle ? `Reminder: Please RSVP for "${eventTitle}"` : "Please RSVP for this event";
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: shareText,
          text: shareText,
          url: shareUrl,
          dialogTitle: "Share Event Reminder",
        });
      } else if (navigator.share) {
        await navigator.share({ title: shareText, text: shareText, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        toast({ title: "Reminder link copied to clipboard!" });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        toast({ title: "Reminder link copied to clipboard!" });
      }
    }
  };

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
  const notRespondedCount = notRespondedMembers.length;

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

  const renderMemberRow = (member: MemberWithViewStatus, variant: "viewed" | "not-viewed") => {
    const pushDisabled = notifPrefs && member.id in notifPrefs ? !notifPrefs[member.id] : false;
    const noPushSetup = pushReachable ? (pushReachable[member.id] === false) : false;

    return (
      <EventViewMemberRow
        key={member.id}
        member={member}
        variant={variant}
        pushDisabled={pushDisabled}
        noPushSetup={noPushSetup}
        isBusy={sendingForUser === member.id || nudgingUser === member.id}
        onSendReminder={handleSendReminders}
        onNudge={handleSendNudgeToUser}
        onShareLink={handleShareEventLink}
        hasResponded={member.hasResponded}
      />
    );
  };

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
              {/* Haven't Responded Section - with Send Reminder */}
              {notRespondedMembers.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h4 className="text-sm font-medium flex items-center gap-2 text-warning">
                      <MessageSquareOff className="h-4 w-4" />
                      Haven't Responded ({notRespondedCount})
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
                        <DropdownMenuItem onClick={handleShareEventLink}>
                          <Share2 className="h-4 w-4 mr-2" />
                          Share via Link
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="grid gap-2">
                    {notRespondedMembers.map((member) => renderMemberRow(member, "not-viewed"))}
                  </div>
                </div>
              )}

              {notRespondedMembers.length > 0 && (notViewedMembers.length > 0 || viewedMembers.length > 0) && (
                <Separator />
              )}

              {/* Haven't Viewed Section */}
              {notViewedMembers.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <EyeOff className="h-4 w-4" />
                    Haven't Viewed ({notViewedCount})
                  </h4>
                  <div className="grid gap-2">
                    {notViewedMembers.map((member) => renderMemberRow(member, "not-viewed"))}
                  </div>
                </div>
              )}

              {(notViewedMembers.length > 0 || notRespondedMembers.length > 0) && viewedMembers.length > 0 && (
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
                    {viewedMembers.map((member) => renderMemberRow(member, "viewed"))}
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
