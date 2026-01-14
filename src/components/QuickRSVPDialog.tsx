import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Baby, Calendar, Clock, MapPin, Users } from "lucide-react";
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
}: QuickRSVPDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(new Set());

  // Fetch existing RSVPs for this event
  const { data: existingRsvps, isLoading: loadingRsvps } = useQuery({
    queryKey: ["quick-rsvp", eventId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rsvps")
        .select("id, status, child_id")
        .eq("event_id", eventId)
        .eq("user_id", user!.id);
      if (error) throw error;
      return data;
    },
    enabled: open && !!user,
  });

  // Fetch children assigned to this team
  const { data: childrenOnTeam, isLoading: loadingChildren } = useQuery({
    queryKey: ["quick-rsvp-children", teamId, user?.id],
    queryFn: async () => {
      if (!teamId) return [];
      const { data, error } = await supabase
        .from("children")
        .select(`
          id,
          name,
          child_team_assignments!inner (team_id)
        `)
        .eq("parent_id", user!.id)
        .eq("child_team_assignments.team_id", teamId);

      if (error) throw error;
      return data || [];
    },
    enabled: open && !!user && !!teamId,
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
      if (myRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", myRsvp.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rsvps").insert({
          event_id: eventId,
          user_id: user!.id,
          status,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-rsvp", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", eventId] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-events"] });
      queryClient.invalidateQueries({ queryKey: ["user-rsvps-home"] });
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
      
      if (existingChildRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", existingChildRsvp.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rsvps").insert({
          event_id: eventId,
          user_id: user!.id,
          child_id: childId,
          status,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-rsvp", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", eventId] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-events"] });
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
                      onClick={() => handleSelfRsvp(option.value)}
                      disabled={rsvpMutation.isPending}
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
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
