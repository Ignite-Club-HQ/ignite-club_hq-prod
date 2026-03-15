import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, UserPlus, Users, Clock, CalendarDays, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export default function ClassEnrolmentPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedTermId, setSelectedTermId] = useState<string>("");
  const [enrollingClassId, setEnrollingClassId] = useState<string | null>(null);

  // Fetch club info
  const { data: club } = useQuery({
    queryKey: ["club", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("name, logo_url, class_mode_enabled")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Fetch active terms
  const { data: terms = [], isLoading: termsLoading } = useQuery({
    queryKey: ["terms", clubId, "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terms")
        .select("*")
        .eq("club_id", clubId!)
        .eq("is_active", true)
        .order("start_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Auto-select first term
  const activeTerm = terms.find((t) => t.id === selectedTermId) || terms[0];
  const termId = activeTerm?.id;

  // Fetch classes (teams with class fields) for this club
  const { data: classes = [], isLoading: classesLoading } = useQuery({
    queryKey: ["club-classes", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, class_day, class_time, class_duration_minutes, class_capacity, level_age, logo_url")
        .eq("club_id", clubId!)
        .not("class_day", "is", null)
        .order("class_day")
        .order("class_time");
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Fetch user's children
  const { data: children = [] } = useQuery({
    queryKey: ["my-children", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("children")
        .select("*")
        .eq("parent_id", user!.id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch existing enrolments for the selected term
  const childIds = children.map((c) => c.id);
  const { data: enrolments = [] } = useQuery({
    queryKey: ["class-enrolments", termId, user?.id, childIds],
    queryFn: async () => {
      if (!termId || childIds.length === 0) return [];
      const { data, error } = await supabase
        .from("class_enrolments")
        .select("*")
        .eq("term_id", termId)
        .in("child_id", childIds);
      if (error) throw error;
      return data;
    },
    enabled: !!termId && childIds.length > 0,
  });

  // Fetch enrolment counts per class for capacity check
  const { data: enrolmentCounts = {} } = useQuery({
    queryKey: ["class-enrolment-counts", termId],
    queryFn: async () => {
      if (!termId) return {};
      const classIds = classes.map((c) => c.id);
      if (classIds.length === 0) return {};

      const { data, error } = await supabase
        .from("class_enrolments")
        .select("team_id, status")
        .eq("term_id", termId)
        .in("team_id", classIds)
        .eq("status", "enrolled");
      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach((e) => {
        counts[e.team_id] = (counts[e.team_id] || 0) + 1;
      });
      return counts;
    },
    enabled: !!termId && classes.length > 0,
  });

  // Enrol mutation
  const enrolMutation = useMutation({
    mutationFn: async ({ childId, teamId }: { childId: string; teamId: string }) => {
      if (!termId) throw new Error("No term selected");

      // Check capacity
      const cls = classes.find((c) => c.id === teamId);
      const currentCount = enrolmentCounts[teamId] || 0;
      const isFull = cls?.class_capacity && currentCount >= cls.class_capacity;
      const status = isFull ? "waitlisted" : "enrolled";

      // Get waitlist position if waitlisted
      let waitlistPosition: number | null = null;
      if (status === "waitlisted") {
        const { count } = await supabase
          .from("class_enrolments")
          .select("*", { count: "exact", head: true })
          .eq("term_id", termId)
          .eq("team_id", teamId)
          .eq("status", "waitlisted");
        waitlistPosition = (count || 0) + 1;
      }

      const { error } = await supabase.from("class_enrolments").insert({
        child_id: childId,
        team_id: teamId,
        term_id: termId,
        status,
        waitlist_position: waitlistPosition,
      });
      if (error) throw error;
      return { status };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["class-enrolments"] });
      queryClient.invalidateQueries({ queryKey: ["class-enrolment-counts"] });
      setEnrollingClassId(null);
      toast({
        title: result.status === "enrolled" ? "Enrolled!" : "Added to waitlist",
        description: result.status === "enrolled"
          ? "Your child has been enrolled in the class."
          : "The class is full. Your child has been added to the waitlist.",
      });
    },
    onError: (error: any) => {
      setEnrollingClassId(null);
      const isDuplicate = error?.code === "23505" || error?.message?.includes("duplicate");
      toast({
        title: isDuplicate ? "Already enrolled" : "Enrolment failed",
        description: isDuplicate
          ? "This child is already enrolled in this class for the selected term."
          : "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Withdraw mutation
  const withdrawMutation = useMutation({
    mutationFn: async (enrolmentId: string) => {
      const { error } = await supabase
        .from("class_enrolments")
        .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
        .eq("id", enrolmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class-enrolments"] });
      queryClient.invalidateQueries({ queryKey: ["class-enrolment-counts"] });
      toast({ title: "Withdrawn from class" });
    },
  });

  const getEnrolment = (childId: string, teamId: string) =>
    enrolments.find((e) => e.child_id === childId && e.team_id === teamId && e.status !== "withdrawn");

  const [selectedChildId, setSelectedChildId] = useState<string>("");

  const isLoading = termsLoading || classesLoading;

  if (isLoading) {
    return (
      <div className="py-6 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Class Enrolment</h1>
          {club && <p className="text-sm text-muted-foreground">{club.name}</p>}
        </div>
      </div>

      {children.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You need to{" "}
            <Button variant="link" className="h-auto p-0" onClick={() => navigate("/children")}>
              add a child profile
            </Button>{" "}
            before enrolling in classes.
          </AlertDescription>
        </Alert>
      )}

      {terms.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>No active terms available for enrolment.</AlertDescription>
        </Alert>
      )}

      {/* Term Selector */}
      {terms.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Term</label>
          <Select
            value={selectedTermId || terms[0]?.id || ""}
            onValueChange={setSelectedTermId}
          >
            <SelectTrigger className="h-11">
              <SelectValue placeholder="Select a term" />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {terms.map((term) => (
                <SelectItem key={term.id} value={term.id}>
                  {term.name} ({format(new Date(term.start_date), "d MMM")} – {format(new Date(term.end_date), "d MMM yyyy")})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Child Selector */}
      {children.length > 1 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Child</label>
          <Select value={selectedChildId || children[0]?.id || ""} onValueChange={setSelectedChildId}>
            <SelectTrigger className="h-11">
              <SelectValue placeholder="Select a child" />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {children.map((child) => (
                <SelectItem key={child.id} value={child.id}>
                  {child.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Classes List */}
      {classes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CalendarDays className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No classes have been set up yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Available Classes</h3>
          {classes.map((cls) => {
            const activeChild = selectedChildId || children[0]?.id;
            const existing = activeChild ? getEnrolment(activeChild, cls.id) : null;
            const count = enrolmentCounts[cls.id] || 0;
            const isFull = cls.class_capacity ? count >= cls.class_capacity : false;
            const isEnrolling = enrollingClassId === cls.id;

            return (
              <Card key={cls.id}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{cls.name}</p>
                      {cls.level_age && (
                        <p className="text-xs text-muted-foreground">{cls.level_age}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        {cls.class_day && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {cls.class_day}
                          </span>
                        )}
                        {cls.class_time && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {cls.class_time.slice(0, 5)}
                          </span>
                        )}
                        {cls.class_duration_minutes && (
                          <span>{cls.class_duration_minutes} mins</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {count}{cls.class_capacity ? `/${cls.class_capacity}` : ""} enrolled
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {existing ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <Badge variant={existing.status === "enrolled" ? "default" : "secondary"}>
                            {existing.status === "enrolled" ? "Enrolled" : `Waitlisted #${existing.waitlist_position}`}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive h-7 text-xs"
                            onClick={() => withdrawMutation.mutate(existing.id)}
                            disabled={withdrawMutation.isPending}
                          >
                            Withdraw
                          </Button>
                        </div>
                      ) : activeChild && termId ? (
                        <Button
                          size="sm"
                          variant={isFull ? "outline" : "default"}
                          onClick={() => {
                            setEnrollingClassId(cls.id);
                            enrolMutation.mutate({ childId: activeChild, teamId: cls.id });
                          }}
                          disabled={isEnrolling || enrolMutation.isPending || !activeChild}
                        >
                          {isEnrolling ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <UserPlus className="h-4 w-4 mr-1" />
                              {isFull ? "Join Waitlist" : "Enrol"}
                            </>
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
