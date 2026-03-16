import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Loader2, Check, X, Clock } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface ClassAttendanceManagerProps {
  clubId: string;
}

type AttendanceStatus = "present" | "absent" | "late";

export function ClassAttendanceManager({ clubId }: ClassAttendanceManagerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTermId, setSelectedTermId] = useState<string>("");
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [sessionDate, setSessionDate] = useState<string>(
    format(new Date(), "yyyy-MM-dd")
  );

  const { data: terms = [] } = useQuery({
    queryKey: ["terms", clubId, "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terms")
        .select("*")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("start_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const termId = selectedTermId || terms[0]?.id;

  const { data: classes = [] } = useQuery({
    queryKey: ["club-classes", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, class_day, class_time, team_type")
        .eq("club_id", clubId)
        .not("class_day", "is", null)
        .order("class_day")
        .order("class_time");
      if (error) throw error;
      return data;
    },
  });

  const classId = selectedClassId || classes[0]?.id;

  // Fetch enrolled members for this class/term
  const { data: enrolledMembers = [] } = useQuery({
    queryKey: ["class-enrolled", termId, classId],
    queryFn: async () => {
      if (!termId || !classId) return [];
      const { data, error } = await supabase
        .from("class_enrolments")
        .select("*, children (id, name)")
        .eq("term_id", termId)
        .eq("team_id", classId)
        .eq("status", "enrolled")
        .order("created_at");
      if (error) throw error;

      // Fetch adult profiles
      const adultIds = data
        ?.filter((e: any) => e.user_id && !e.child_id)
        .map((e: any) => e.user_id) || [];
      let profileMap: Record<string, string> = {};
      if (adultIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", adultIds);
        profiles?.forEach((p) => {
          if (p.display_name) profileMap[p.id] = p.display_name;
        });
      }

      return data.map((e: any) => ({
        ...e,
        _name: e.child_id
          ? e.children?.name || "Unknown"
          : profileMap[e.user_id] || "Unknown",
      }));
    },
    enabled: !!termId && !!classId,
  });

  // Fetch existing attendance for this session
  const { data: attendance = [], isLoading: attendanceLoading } = useQuery({
    queryKey: ["class-attendance", termId, classId, sessionDate],
    queryFn: async () => {
      if (!termId || !classId || !sessionDate) return [];
      const { data, error } = await supabase
        .from("class_attendance")
        .select("*")
        .eq("term_id", termId)
        .eq("team_id", classId)
        .eq("session_date", sessionDate);
      if (error) throw error;
      return data;
    },
    enabled: !!termId && !!classId && !!sessionDate,
  });

  const getAttendanceStatus = (
    childId: string | null,
    userId: string | null
  ): AttendanceStatus | null => {
    const record = attendance.find(
      (a: any) =>
        (childId && a.child_id === childId) ||
        (userId && !childId && a.user_id === userId)
    );
    return (record as any)?.status || null;
  };

  const markAttendanceMutation = useMutation({
    mutationFn: async ({
      childId,
      userId,
      status,
    }: {
      childId: string | null;
      userId: string | null;
      status: AttendanceStatus;
    }) => {
      if (!termId || !classId || !sessionDate) throw new Error("Missing data");

      const record: any = {
        term_id: termId,
        team_id: classId,
        session_date: sessionDate,
        status,
        marked_by: user?.id,
      };
      if (childId) record.child_id = childId;
      if (userId) record.user_id = userId;

      const { error } = await supabase.from("class_attendance").upsert(record, {
        onConflict: childId
          ? "term_id,team_id,session_date,child_id"
          : "term_id,team_id,session_date,user_id",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["class-attendance", termId, classId, sessionDate],
      });
    },
    onError: () => {
      toast({ title: "Failed to update attendance", variant: "destructive" });
    },
  });

  const statusIcon = (status: AttendanceStatus | null) => {
    switch (status) {
      case "present":
        return <Check className="h-4 w-4 text-emerald-500" />;
      case "absent":
        return <X className="h-4 w-4 text-destructive" />;
      case "late":
        return <Clock className="h-4 w-4 text-amber-500" />;
      default:
        return null;
    }
  };

  if (terms.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        Create an active term to track attendance.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-lg">Attendance</h3>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {terms.length > 1 ? (
          <Select value={termId || ""} onValueChange={setSelectedTermId}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Term" />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {terms.map((term) => (
                <SelectItem key={term.id} value={term.id}>
                  {term.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground self-center">
            {terms[0]?.name}
          </p>
        )}

        <Select value={classId || ""} onValueChange={setSelectedClassId}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Select class" />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            {classes.map((cls) => (
              <SelectItem key={cls.id} value={cls.id}>
                {cls.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <input
          type="date"
          value={sessionDate}
          onChange={(e) => setSessionDate(e.target.value)}
          className="h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
      </div>

      {attendanceLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : enrolledMembers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4 italic">
          No enrolled members for this class
        </p>
      ) : (
        <Card>
          <CardContent className="py-2 divide-y">
            {enrolledMembers.map((member: any) => {
              const currentStatus = getAttendanceStatus(
                member.child_id,
                member.user_id
              );
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between py-2 gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {statusIcon(currentStatus)}
                    <span className="text-sm truncate">{member._name}</span>
                    {member.child_id && (
                      <span className="text-[10px] text-muted-foreground">
                        (Child)
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {(["present", "late", "absent"] as AttendanceStatus[]).map(
                      (s) => (
                        <Button
                          key={s}
                          variant={currentStatus === s ? "default" : "outline"}
                          size="sm"
                          className={`h-7 text-xs px-2 ${
                            currentStatus === s
                              ? s === "present"
                                ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                                : s === "late"
                                ? "bg-amber-500 hover:bg-amber-600 text-white"
                                : "bg-destructive hover:bg-destructive/90"
                              : ""
                          }`}
                          onClick={() =>
                            markAttendanceMutation.mutate({
                              childId: member.child_id,
                              userId: member.child_id ? null : member.user_id,
                              status: s,
                            })
                          }
                          disabled={markAttendanceMutation.isPending}
                        >
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </Button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {enrolledMembers.length > 0 && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Check className="h-3 w-3 text-emerald-500" />
            {attendance.filter((a: any) => a.status === "present").length} Present
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-amber-500" />
            {attendance.filter((a: any) => a.status === "late").length} Late
          </span>
          <span className="flex items-center gap-1">
            <X className="h-3 w-3 text-destructive" />
            {attendance.filter((a: any) => a.status === "absent").length} Absent
          </span>
        </div>
      )}
    </div>
  );
}
