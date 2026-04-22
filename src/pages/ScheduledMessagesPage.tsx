import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";
import {
  ArrowLeft,
  Clock,
  Pencil,
  X,
  AlertCircle,
  Image as ImageIcon,
  Repeat,
  CheckCircle2,
  Users,
  Hash,
  User as UserIcon,
  Megaphone,
  Shield,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ScheduledMessageRow,
  useAllScheduledMessages,
  useCancelScheduledMessage,
} from "@/hooks/useScheduledMessages";
import { ScheduleMessageDialog } from "@/components/chat/ScheduleMessageDialog";

interface ThreadInfo {
  label: string;
  sublabel?: string;
  href?: string;
}

function rowTarget(row: ScheduledMessageRow) {
  return {
    chat_type: row.chat_type,
    team_id: row.team_id,
    club_id: row.club_id,
    group_id: row.group_id,
    conversation_id: row.conversation_id,
  };
}

function dateGroupLabel(d: Date): string {
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEEE, MMM d");
}

/**
 * Resolve human-readable thread labels for a list of scheduled rows.
 * Batches one query per table to avoid N+1.
 */
function useThreadLabels(rows: ScheduledMessageRow[]) {
  const teamIds = [...new Set(rows.filter((r) => r.team_id).map((r) => r.team_id!))];
  const clubIds = [...new Set(rows.filter((r) => r.club_id).map((r) => r.club_id!))];
  const groupIds = [...new Set(rows.filter((r) => r.group_id).map((r) => r.group_id!))];
  const dmConvIds = [
    ...new Set(
      rows
        .filter((r) => r.chat_type === "direct" && r.conversation_id)
        .map((r) => r.conversation_id!),
    ),
  ];
  const adminConvIds = [
    ...new Set(
      rows
        .filter((r) => r.chat_type === "club_admin" && r.conversation_id)
        .map((r) => r.conversation_id!),
    ),
  ];

  const key = [
    teamIds.join(","),
    clubIds.join(","),
    groupIds.join(","),
    dmConvIds.join(","),
    adminConvIds.join(","),
  ].join("|");

  return useQuery({
    queryKey: ["scheduled-message-thread-labels", key],
    queryFn: async () => {
      const labels: Record<string, ThreadInfo> = {};
      const tasks: Promise<void>[] = [];

      if (teamIds.length > 0) {
        tasks.push((async () => {
          const { data } = await supabase
            .from("teams")
            .select("id, name, clubs(name)")
            .in("id", teamIds);
          (data || []).forEach((t: any) => {
            labels[`team:${t.id}`] = {
              label: `${t.name} chat`,
              sublabel: t.clubs?.name,
              href: `/teams/${t.id}/chat`,
            };
          });
        })());
      }
      if (clubIds.length > 0) {
        tasks.push((async () => {
          const { data } = await supabase.from("clubs").select("id, name").in("id", clubIds);
          (data || []).forEach((c: any) => {
            labels[`club:${c.id}`] = {
              label: `${c.name} club chat`,
              href: `/clubs/${c.id}/chat`,
            };
          });
        })());
      }
      if (groupIds.length > 0) {
        tasks.push((async () => {
          const { data } = await supabase
            .from("chat_groups")
            .select("id, name")
            .in("id", groupIds);
          (data || []).forEach((g: any) => {
            labels[`group:${g.id}`] = {
              label: g.name,
              sublabel: "Group chat",
              href: `/groups/${g.id}/chat`,
            };
          });
        })());
      }
      if (dmConvIds.length > 0) {
        tasks.push((async () => {
          const { data } = await supabase
            .from("direct_conversations")
            .select("id, participant_1, participant_2")
            .in("id", dmConvIds);
          const convs = data || [];
          const userIds = [
            ...new Set(convs.flatMap((c: any) => [c.participant_1, c.participant_2])),
          ];
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, display_name")
            .in("id", userIds);
          const profMap: Record<string, string> = {};
          (profiles || []).forEach((p: any) => {
            profMap[p.id] = p.display_name || "Unknown";
          });
          const me = (await supabase.auth.getUser()).data.user?.id;
          convs.forEach((c: any) => {
            const otherId = c.participant_1 === me ? c.participant_2 : c.participant_1;
            labels[`direct:${c.id}`] = {
              label: profMap[otherId] || "Direct message",
              sublabel: "Direct message",
              href: `/messages/dm/${c.id}`,
            };
          });
        })());
      }
      if (adminConvIds.length > 0) {
        tasks.push((async () => {
          const { data } = await supabase
            .from("club_admin_conversations")
            .select("id, club_id, clubs(name)")
            .in("id", adminConvIds);
          (data || []).forEach((c: any) => {
            labels[`club_admin:${c.id}`] = {
              label: `${c.clubs?.name || "Club"} admin`,
              sublabel: "Club admin chat",
            };
          });
        })());
      }

      await Promise.all(tasks);
      return labels;
    },
    enabled: rows.length > 0,
    staleTime: 60 * 1000,
  });
}

function lookupLabel(
  row: ScheduledMessageRow,
  labels: Record<string, ThreadInfo>,
): ThreadInfo {
  switch (row.chat_type) {
    case "team":
      return labels[`team:${row.team_id}`] || { label: "Team chat" };
    case "club":
      return labels[`club:${row.club_id}`] || { label: "Club chat" };
    case "group":
      return labels[`group:${row.group_id}`] || { label: "Group chat" };
    case "direct":
      return labels[`direct:${row.conversation_id}`] || { label: "Direct message" };
    case "club_admin":
      return labels[`club_admin:${row.conversation_id}`] || { label: "Club admin chat" };
    case "broadcast":
      return { label: "App broadcast", sublabel: "Sent to all users" };
  }
}

export default function ScheduledMessagesPage() {
  const navigate = useNavigate();
  const { data: pendingRows = [], isLoading: loadingPending } = useAllScheduledMessages([
    "pending",
  ]);
  const { data: recentRows = [] } = useAllScheduledMessages(["sent", "failed"]);
  const allRows = useMemo(() => [...pendingRows, ...recentRows], [pendingRows, recentRows]);
  const { data: labels = {} } = useThreadLabels(allRows);

  const [editingRow, setEditingRow] = useState<ScheduledMessageRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const cancelMut = useCancelScheduledMessage();

  const handleCancel = async () => {
    if (!confirmDeleteId) return;
    try {
      await cancelMut.mutateAsync(confirmDeleteId);
      toast.success("Scheduled message cancelled");
    } catch (e: any) {
      toast.error(e?.message || "Failed to cancel");
    } finally {
      setConfirmDeleteId(null);
    }
  };

  // Group pending by date
  const groupedPending = useMemo(() => {
    const map = new Map<string, ScheduledMessageRow[]>();
    for (const row of pendingRows) {
      const d = new Date(row.scheduled_for);
      const key = format(d, "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: dateGroupLabel(new Date(items[0].scheduled_for)),
      items,
    }));
  }, [pendingRows]);

  // Recent (last 7 days) — already filtered to sent/failed
  const recentSorted = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return [...recentRows]
      .filter((r) => new Date(r.updated_at).getTime() >= sevenDaysAgo)
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )
      .slice(0, 20);
  }, [recentRows]);

  return (
    <div className="py-6 space-y-6 max-w-2xl mx-auto px-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Scheduled messages</h1>
          <p className="text-sm text-muted-foreground">
            Messages you've scheduled to send later
          </p>
        </div>
      </div>

      {/* Pending */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Upcoming
        </h2>
        {loadingPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : pendingRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Clock className="h-8 w-8 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="font-medium">No scheduled messages</p>
            <p className="text-sm text-muted-foreground mt-1">
              Schedule a message from any chat to send it later.
            </p>
          </div>
        ) : (
          groupedPending.map((group) => (
            <div key={group.key} className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground">
                {group.label}
              </h3>
              <ul className="space-y-2">
                {group.items.map((row) => {
                  const info = lookupLabel(row, labels);
                  return (
                    <li
                      key={row.id}
                      className="rounded-lg border border-border bg-card p-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => info.href && navigate(info.href)}
                            className="text-left"
                            disabled={!info.href}
                          >
                            <p className="text-sm font-semibold truncate hover:underline">
                              {info.label}
                            </p>
                            {info.sublabel && (
                              <p className="text-xs text-muted-foreground truncate">
                                {info.sublabel}
                              </p>
                            )}
                          </button>
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                            <span>{format(new Date(row.scheduled_for), "h:mm a")}</span>
                            {row.recurrence && row.recurrence !== "none" && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                <Repeat className="h-2.5 w-2.5" />
                                {row.recurrence}
                              </span>
                            )}
                          </p>
                          <div className="mt-2 flex items-start gap-1.5">
                            {row.image_url && (
                              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            )}
                            <p className="text-sm break-words line-clamp-3">
                              {row.text || (row.image_url ? "(Image only)" : "")}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setEditingRow(row)}
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setConfirmDeleteId(row.id)}
                            aria-label="Cancel"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      {/* Recent */}
      {recentSorted.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Recent (last 7 days)
          </h2>
          <ul className="space-y-2">
            {recentSorted.map((row) => {
              const info = lookupLabel(row, labels);
              const failed = row.status === "failed";
              return (
                <li
                  key={row.id}
                  className="rounded-lg border border-border bg-card p-3 opacity-90"
                >
                  <div className="flex items-start gap-2">
                    {failed && (
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{info.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {failed ? "Failed " : "Sent "}
                        {format(new Date(row.updated_at), "MMM d, h:mm a")}
                      </p>
                      {failed && row.error_message && (
                        <p className="text-xs text-destructive mt-1">
                          {row.error_message}
                        </p>
                      )}
                      <p className="text-sm break-words line-clamp-2 mt-1">
                        {row.text || (row.image_url ? "(Image only)" : "")}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ScheduleMessageDialog
        open={!!editingRow}
        onOpenChange={(o) => !o && setEditingRow(null)}
        target={editingRow ? rowTarget(editingRow) : { chat_type: "broadcast" }}
        editingRow={editingRow}
      />

      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel scheduled message?</AlertDialogTitle>
            <AlertDialogDescription>
              This message won't be sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>
              Cancel message
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
