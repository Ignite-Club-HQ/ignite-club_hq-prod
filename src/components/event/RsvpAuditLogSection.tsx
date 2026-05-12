import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollText, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type AuditRow = {
  id: string;
  rsvp_id: string | null;
  action: "insert" | "update" | "delete";
  old_status: string | null;
  new_status: string | null;
  actor_user_id: string | null;
  subject_kind:
    | "self"
    | "parent_for_user"
    | "parent_for_child"
    | "parent_for_league_player"
    | "admin_override";
  subject_label: string | null;
  source: string | null;
  created_at: string;
};

const KIND_LABELS: Record<AuditRow["subject_kind"], string> = {
  self: "Player (self)",
  parent_for_user: "Parent → player",
  parent_for_child: "Parent → child",
  parent_for_league_player: "Parent → league player",
  admin_override: "Admin override",
};

const KIND_VARIANTS: Record<AuditRow["subject_kind"], "default" | "secondary" | "outline"> = {
  self: "default",
  parent_for_user: "secondary",
  parent_for_child: "secondary",
  parent_for_league_player: "secondary",
  admin_override: "outline",
};

export function RsvpAuditLogSection({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["rsvp-audit-log", eventId],
    enabled: open,
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from("rsvp_audit_log" as any)
        .select(
          "id, rsvp_id, action, old_status, new_status, actor_user_id, subject_kind, subject_label, source, created_at",
        )
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as AuditRow[];
    },
  });

  const actorIds = Array.from(
    new Set((rows || []).map((r) => r.actor_user_id).filter(Boolean) as string[]),
  );

  const { data: actors } = useQuery({
    queryKey: ["rsvp-audit-log-actors", eventId, actorIds.sort().join(",")],
    enabled: open && actorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", actorIds);
      if (error) throw error;
      const map = new Map<string, string>();
      (data || []).forEach((p: any) => {
        const name = `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Member";
        map.set(p.id, name);
      });
      return map;
    },
  });

  return (
    <section className="space-y-3">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-between text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <ScrollText className="h-4 w-4" />
          RSVP audit log
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </Button>

      {open && (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {isLoading && (
            <div className="p-6 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          )}
          {!isLoading && (rows || []).length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No RSVP activity yet.
            </div>
          )}
          {!isLoading &&
            (rows || []).map((r) => {
              const actorName = r.actor_user_id
                ? actors?.get(r.actor_user_id) || "Member"
                : "System";
              const subject = r.subject_label || "—";
              const statusText =
                r.action === "delete"
                  ? `removed RSVP (was ${r.old_status ?? "—"})`
                  : r.action === "insert"
                    ? `set RSVP to ${r.new_status ?? "—"}`
                    : `changed RSVP ${r.old_status ?? "—"} → ${r.new_status ?? "—"}`;
              return (
                <div key={r.id} className="p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={KIND_VARIANTS[r.subject_kind]} className="shrink-0">
                      {KIND_LABELS[r.subject_kind]}
                    </Badge>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="text-foreground">
                    <span className="font-medium">{actorName}</span>{" "}
                    <span className="text-muted-foreground">{statusText} for</span>{" "}
                    <span className="font-medium">{subject}</span>
                    {r.source && r.source !== "user" && (
                      <span className="text-xs text-muted-foreground"> · {r.source}</span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </section>
  );
}
