import { Users } from "lucide-react";
import type { AttendanceSummary } from "@/features/events/attendanceSummaryPolicy";

export function EventAttendanceSummary({ summary }: { summary: AttendanceSummary }) {
  return <div className="flex items-center gap-3">
    <Users className="h-5 w-5 text-primary" />
    {summary.state === "loading" && <span>Loading...</span>}
    {summary.state === "unavailable" && <span className="text-destructive">Attendance unavailable</span>}
    {summary.state === "players" && <span>{summary.count} {summary.count === 1 ? "player" : "players"} attending</span>}
    {summary.state === "social" && <span>
      {summary.total} attending
      {(summary.adults > 0 || summary.children > 0) && <span className="text-muted-foreground">
        {" "}· {summary.adults} adult{summary.adults === 1 ? "" : "s"}, {summary.children} {summary.children === 1 ? "child" : "children"}
      </span>}
    </span>}
  </div>;
}
