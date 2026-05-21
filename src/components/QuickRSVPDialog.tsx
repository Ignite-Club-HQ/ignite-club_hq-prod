import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Baby, Calendar, Clock, MapPin, Users, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isToday, isTomorrow } from "date-fns";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { resolveRsvpAudience, shouldPromptParent, shouldPromptPlayer } from "@/lib/rsvpAudience";


type RsvpStatus = "going" | "maybe" | "not_going";

const rsvpOptions: { value: RsvpStatus; label: string; icon: string }[] = [
  { value: "going", label: "Going", icon: "✅" },
  { value: "maybe", label: "Maybe", icon: "🤔" },
  { value: "not_going", label: "Can't Go", icon: "❌" },
];

interface QuickRSVPDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  eventType: string;
  teamId: string | null;
  suburb: string | null;
  opponent: string | null;
  clubId: string;
  clubName: string;
  eventAmount?: number | null;
}

function formatEventDate(dateStr: string) {
  const date = parseISO(dateStr);
  if (isToday(date)) return `Today at ${format(date, "h:mm a")}`;
  if (isTomorrow(date)) return `Tomorrow at ${format(date, "h:mm a")}`;
  return format(date, "EEE, MMM d 'at' h:mm a");
}

export function QuickRSVPDialog({
  open,
  onOpenChange,
  eventId,
  eventTitle,
  eventDate,
  eventType,
  teamId,
  suburb,
  opponent,
  clubId,
  clubName,
  eventAmount,
}: QuickRSVPDialogProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(new Set());
  const [showPaymentPrompt, setShowPaymentPrompt] = useState(false);

  // Resolve effective RSVP audience (event override → team default → players_only)
  const { data: audienceInfo } = useQuery({
    queryKey: ["quick-rsvp-audience", eventId, teamId],
    queryFn: async () => {
      const [{ data: ev }, teamRes] = await Promise.all([
        supabase.from("events").select("rsvp_audience").eq("id", eventId).maybeSingle(),
        teamId
          ? supabase.from("teams").select("default_rsvp_audience").eq("id", teamId).maybeSingle()
          : Promise.resolve({ data: null } as any),
      ]);
      return {
        eventAudience: (ev as any)?.rsvp_audience ?? null,
        teamDefault: (teamRes as any)?.data?.default_rsvp_audience ?? null,
      };
    },
    enabled: open,
  });
  const audience = resolveRsvpAudience(audienceInfo?.eventAudience, audienceInfo?.teamDefault);
  const promptParent = shouldPromptParent(audience);
  const promptPlayer = shouldPromptPlayer(audience);


  // Fetch children assigned to this team (including guardian-linked)
  const { data: childrenOnTeam, isLoading: loadingChildren } = useQuery({
    queryKey: ["quick-rsvp-children", teamId, user?.id],
    queryFn: async () => {
      if (!teamId) return [];
      
      // Fetch direct children and guardian-linked children in parallel
      const [ownChildren, guardianLinks] = await Promise.all([
        supabase
          .from("children")
          .select("id, name, child_team_assignments!inner (team_id)")
          .eq("parent_id", user!.id)
          .eq("child_team_assignments.team_id", teamId),
        supabase
          .from("child_guardians")
          .select("child_id, children!inner (id, name)")
          .eq("guardian_id", user!.id),
      ]);

      const directChildren = ownChildren.data || [];
      const guardianChildren = (guardianLinks.data || []).map((g: any) => g.children).filter(Boolean);

      // Filter guardian children to those on this team
      let filteredGuardianChildren: any[] = [];
      if (guardianChildren.length > 0) {
        const guardianChildIds = guardianChildren.map((c: any) => c.id);
        const { data: assignments } = await supabase
          .from("child_team_assignments")
          .select("child_id")
          .eq("team_id", teamId)
          .in("child_id", guardianChildIds);
        const assignedIds = new Set((assignments || []).map((a: any) => a.child_id));
        filteredGuardianChildren = guardianChildren.filter((c: any) => assignedIds.has(c.id));
      }

      // Deduplicate
      const seen = new Set<string>();
      return [...directChildren, ...filteredGuardianChildren].filter((c: any) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    },
    enabled: open && !!user && !!teamId,
  });

  // Fetch existing RSVPs for this event (self + all children by child_id)
  const { data: existingRsvps, isLoading: loadingRsvps } = useQuery({
    queryKey: ["quick-rsvp", eventId, user?.id, childrenOnTeam?.map(c => c.id).join(",")],
    queryFn: async () => {
      // Fetch own RSVP
      const { data: myRsvps, error } = await supabase
        .from("rsvps")
        .select("id, status, child_id")
        .eq("event_id", eventId)
        .eq("user_id", user!.id);
      if (error) throw error;

      // Fetch child RSVPs by child_id (regardless of which parent created them)
      const childIds = (childrenOnTeam || []).map((c: any) => c.id);
      let childRsvpData: any[] = [];
      if (childIds.length > 0) {
        const { data, error: childErr } = await supabase
          .from("rsvps")
          .select("id, status, child_id, user_id")
          .eq("event_id", eventId)
          .in("child_id", childIds);
        if (!childErr && data) childRsvpData = data;
      }

      // Merge: own non-child RSVPs + child RSVPs (deduplicated by child_id)
      const ownNonChild = (myRsvps || []).filter(r => !r.child_id);
      const seenChildIds = new Set<string>();
      const deduped = childRsvpData.filter(r => {
        if (seenChildIds.has(r.child_id)) return false;
        seenChildIds.add(r.child_id);
        return true;
      });

      return [...ownNonChild, ...deduped];
    },
    enabled: open && !!user,
  });

  // Initialize selected children based on existing RSVPs
  useEffect(() => {
    if (existingRsvps) {
      const childRsvpIds = existingRsvps
        .filter(r => r.child_id && r.status === "going")
        .map(r => r.child_id!);
      setSelectedChildIds(new Set(childRsvpIds));
    }
  }, [existingRsvps]);

  const myRsvp = existingRsvps?.find(r => !r.child_id);

  // RSVP mutation for self
  const rsvpMutation = useMutation({
    mutationFn: async (status: RsvpStatus) => {
      let rsvpId: string | null = null;
      
      if (myRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", myRsvp.id);
        if (error) throw error;
        rsvpId = myRsvp.id;
      } else {
        const { data: newRsvp, error } = await supabase.from("rsvps").insert({
          event_id: eventId,
          user_id: user!.id,
          status,
        }).select("id").single();
        if (error) throw error;
        rsvpId = newRsvp?.id || null;
      }

      // Fire-and-forget: don't block UI for points calculation
      if (status === "going" && rsvpId) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          eventDate,
          rsvpId,
          clubId,
          clubName,
        }).catch(console.error);
      }
    },
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["quick-rsvp", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", eventId] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-events"] });
      queryClient.invalidateQueries({ queryKey: ["user-rsvps-home"] });
      queryClient.invalidateQueries({ queryKey: ["hero-rsvp", eventId] });
      queryClient.invalidateQueries({ queryKey: ["child-rsvps-card", eventId] });
      queryClient.invalidateQueries({ queryKey: ["card-child-rsvps", eventId] });
      queryClient.invalidateQueries({ queryKey: ["rsvp-summary", eventId] });

      // If going to a paid event, prompt payment
      if (status === "going" && eventAmount && eventAmount > 0 && eventType === "social") {
        setShowPaymentPrompt(true);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // RSVP mutation for child
  const childRsvpMutation = useMutation({
    mutationFn: async ({ childId, status }: { childId: string; status: RsvpStatus }) => {
      const existingChildRsvp = existingRsvps?.find(r => r.child_id === childId);
      let rsvpId: string | null = null;
      
      if (existingChildRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", existingChildRsvp.id);
        if (error) throw error;
        rsvpId = existingChildRsvp.id;
      } else {
        const { data: newRsvp, error } = await supabase.from("rsvps").insert({
          event_id: eventId,
          user_id: user!.id,
          child_id: childId,
          status,
        }).select("id").single();
        if (error) throw error;
        rsvpId = newRsvp?.id || null;
      }

      // Fire-and-forget: award early RSVP points for child
      if (status === "going" && rsvpId) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          childId,
          eventDate,
          rsvpId,
          clubId,
          clubName,
        }).catch(console.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-rsvp", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", eventId] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-events"] });
      queryClient.invalidateQueries({ queryKey: ["user-rsvps-home"] });
      queryClient.invalidateQueries({ queryKey: ["hero-rsvp", eventId] });
      queryClient.invalidateQueries({ queryKey: ["child-rsvps-card", eventId] });
      queryClient.invalidateQueries({ queryKey: ["card-child-rsvps", eventId] });
      queryClient.invalidateQueries({ queryKey: ["rsvp-summary", eventId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleChildToggle = (childId: string) => {
    const existingChildRsvp = existingRsvps?.find(r => r.child_id === childId);
    const isCurrentlyGoing = existingChildRsvp?.status === "going";
    
    childRsvpMutation.mutate({
      childId,
      status: isCurrentlyGoing ? "not_going" : "going",
    });

    // Optimistically update local state
    setSelectedChildIds(prev => {
      const next = new Set(prev);
      if (isCurrentlyGoing) {
        next.delete(childId);
      } else {
        next.add(childId);
      }
      return next;
    });
  };

  const handleSelfRsvp = (status: RsvpStatus) => {
    rsvpMutation.mutate(status);
  };

  const isLoading = loadingRsvps || loadingChildren;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Quick RSVP</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Respond to this event
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 pt-2 pb-6">
          {/* Event Info */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="capitalize">
                {eventType}
              </Badge>
              <span className="font-semibold">{eventTitle}</span>
            </div>
            {opponent && eventType === "game" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span>vs {opponent}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {formatEventDate(eventDate)}
            </div>
            {suburb && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {suburb}
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Self RSVP */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Your Response</h4>
                <div className="flex gap-2">
                  {rsvpOptions.map((option) => (
                    <Button
                      key={option.value}
                      variant={myRsvp?.status === option.value ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => myRsvp?.status !== option.value && handleSelfRsvp(option.value)}
                      disabled={rsvpMutation.isPending || myRsvp?.status === option.value}
                    >
                      {rsvpMutation.isPending && myRsvp?.status !== option.value ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <span className="mr-1">{option.icon}</span>
                      )}
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Children RSVP */}
              {childrenOnTeam && childrenOnTeam.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <Baby className="h-4 w-4" />
                      Children's Response
                    </h4>
                    <div className="space-y-3">
                      {childrenOnTeam.map((child) => {
                        const childRsvp = existingRsvps?.find(r => r.child_id === child.id);
                        
                        return (
                          <div key={child.id} className="space-y-2">
                            <span className="text-sm font-medium">{child.name}</span>
                            <div className="flex gap-2">
                              {rsvpOptions.map((option) => (
                                <Button
                                  key={option.value}
                                  variant={childRsvp?.status === option.value ? "default" : "outline"}
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => childRsvpMutation.mutate({ childId: child.id, status: option.value })}
                                  disabled={childRsvpMutation.isPending}
                                >
                                  {childRsvpMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                  ) : (
                                    <span className="mr-1">{option.icon}</span>
                                  )}
                                  {option.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* Payment prompt after RSVP going */}
          {showPaymentPrompt && (
            <>
              <Separator />
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-warning/20">
                    <DollarSign className="h-5 w-5 text-warning" />
                  </div>
                  <div>
                    <p className="font-medium">Payment Required</p>
                    <p className="text-sm text-muted-foreground">
                      ${Number(eventAmount).toFixed(2)} per person
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/events/${eventId}`);
                  }}
                >
                  <DollarSign className="h-4 w-4 mr-2" />
                  Go to Event to Pay
                </Button>
              </div>
            </>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
