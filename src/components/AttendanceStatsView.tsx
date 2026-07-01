import { useQuery } from "@tanstack/react-query";
import { BarChart3, Check, Clock, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MobileSelect } from "@/components/ui/mobile-select";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useState } from "react";

interface AttendanceStatsViewProps {
  clubId: string;
}

export function AttendanceStatsView({ clubId }: AttendanceStatsViewProps) {
  const [selectedTermId, setSelectedTermId] = useState<string>("");
  const [selectedClassId, setSelectedClassId] = useState<string>("");

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
        .select("id, name, class_day, class_time")
        .eq("club_id", clubId)
        .not("class_day", "is", null)
        .order("class_day")
        .order("class_time");
      if (error) throw error;
      return data;
    },
  });

  const classId = selectedClassId || classes[0]?.id;

  // Fetch enrolled members
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

      const adultIds = data
        ?.filter((e: any) => e.user_id && !e.child_id)
        .map((e: any) => e.user_id) || [];
      let profileMap: Record<string, string> = {};
      if (adultIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(adultIds);
        profiles?.forEach((p) => {
          if (p.display_name) profileMap[p.id] = p.display_name;
        });
      }

      return data.map((e: any) => ({
        ...e,
        _name: e.child_id ? e.children?.name || "Unknown" : profileMap[e.user_id] || "Unknown",
      }));
    },
    enabled: !!termId && !!classId,
  });

  // Fetch all attendance records for this term+class
  const { data: allAttendance = [] } = useQuery({
    queryKey: ["attendance-stats", termId, classId],
    queryFn: async () => {
      if (!termId || !classId) return [];
      const { data, error } = await supabase
        .from("class_attendance")
        .select("child_id, user_id, status, session_date")
        .eq("term_id", termId)
        .eq("team_id", classId);
      if (error) throw error;
      return data;
    },
    enabled: !!termId && !!classId,
  });

  // Compute stats per member
  const memberStats = enrolledMembers.map((member: any) => {
    const records = allAttendance.filter((a: any) =>
      (member.child_id && a.child_id === member.child_id) ||
      (!member.child_id && member.user_id && a.user_id === member.user_id)
    );
    const present = records.filter((r: any) => r.status === "present").length;
    const late = records.filter((r: any) => r.status === "late").length;
    const absent = records.filter((r: any) => r.status === "absent").length;
    const total = records.length;
    const attendanceRate = total > 0 ? Math.round(((present + late) / total) * 100) : null;

    return {
      name: member._name,
      childId: member.child_id,
      present,
      late,
      absent,
      total,
      attendanceRate,
    };
  });

  const uniqueDates = [...new Set(allAttendance.map((a: any) => a.session_date))];

  if (terms.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No active terms.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3">
        {terms.length > 1 && (
          <MobileSelect
            value={termId || ""}
            onValueChange={setSelectedTermId}
            options={terms.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Term"
            title="Select Term"
          />
        )}
        <MobileSelect
          value={classId || ""}
          onValueChange={setSelectedClassId}
          options={classes.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Select class"
          title="Select Class"
        />
      </div>

      {enrolledMembers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4 italic">No enrolled members</p>
      ) : (
        <>
          {/* Summary */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{uniqueDates.length} sessions recorded</span>
            <span>•</span>
            <span>{enrolledMembers.length} members</span>
          </div>

          <Card>
            <CardContent className="py-2 divide-y">
              {memberStats
                .sort((a, b) => (a.attendanceRate ?? -1) - (b.attendanceRate ?? -1))
                .map((member, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{member.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Check className="h-2.5 w-2.5 text-emerald-500" />{member.present}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5 text-amber-500" />{member.late}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <X className="h-2.5 w-2.5 text-destructive" />{member.absent}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {member.attendanceRate !== null ? (
                        <Badge
                          variant="outline"
                          className={`text-xs font-semibold ${
                            member.attendanceRate >= 80
                              ? "border-emerald-300 text-emerald-600"
                              : member.attendanceRate >= 50
                              ? "border-amber-300 text-amber-600"
                              : "border-red-300 text-red-600"
                          }`}
                        >
                          {member.attendanceRate}%
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          —
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
