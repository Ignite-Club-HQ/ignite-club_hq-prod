import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface AutoSubNotifyArgs {
  teamId: string;
  teamName: string;
  /** Player coming on. */
  playerInName: string;
  /** Player going off. */
  playerOutName: string;
  /** Court position the change is happening at. */
  position: string;
  /** Optional period label (e.g. "Q2", "H1") for context in the push body. */
  periodLabel?: string;
}

/**
 * Sends a push notification to every team_admin / coach of the team when an
 * auto-sub fires on the netball or basketball board. Used so assistant
 * coaches on the sideline see the change even if they aren't running the
 * board themselves.
 *
 * Recipients:
 *   - team_admin / coach for the team
 *   - Anyone assigned the "Subs Manager" duty for the linked event (so a
 *     parent running the board on match-day still gets pushes)
 *
 * - Fan-out happens in the background (not awaited) so the board UI never
 *   blocks on the network round-trip.
 * - We dedupe per (player-out + player-in + position + minute) inside a
 *   single board session to avoid double-firing during React strict-mode
 *   re-renders or rapid-fire ticks.
 * - Failures are swallowed + logged; a missed push must never break the
 *   coach's live sub.
 */
export function useAutoSubNotify(
  teamId: string,
  teamName: string,
  linkedEventId?: string | null,
) {
  const sentRef = useRef<Set<string>>(new Set());

  const notify = useCallback(
    async (args: Omit<AutoSubNotifyArgs, "teamId" | "teamName">) => {
      if (!teamId) return;
      const dedupeKey = `${args.playerOutName}|${args.playerInName}|${args.position}|${args.periodLabel ?? ""}|${Math.floor(Date.now() / 60000)}`;
      if (sentRef.current.has(dedupeKey)) return;
      sentRef.current.add(dedupeKey);

      try {
        const recipientIds = new Set<string>();
        const isEventGroup = teamId.startsWith("event-group-");

        if (isEventGroup) {
          // Mini-league match: notify Referee + Subs Manager assignees for this group
          const groupId = teamId.replace("event-group-", "");
          const { data: matchDuties, error: dutyErr } = await supabase
            .from("event_group_duties")
            .select("assigned_to")
            .eq("group_id", groupId)
            .in("name", ["Referee", "Subs Manager"])
            .not("assigned_to", "is", null);
          if (dutyErr) {
            console.error("[AutoSubNotify] mini-league duty lookup failed:", dutyErr);
          } else {
            (matchDuties ?? []).forEach((d: any) => {
              if (d.assigned_to) recipientIds.add(d.assigned_to as string);
            });
          }
        } else {
          // Team admins AND coaches receive auto-sub execution pushes.
          // The Subs Manager duty assignee is added below.
          const { data: roles, error } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("team_id", teamId)
            .in("role", ["team_admin", "coach"]);
          if (error) {
            console.error("[AutoSubNotify] role lookup failed:", error);
          } else {
            (roles ?? []).forEach((r) => {
              if (r.user_id) recipientIds.add(r.user_id as string);
            });
          }

          // Include anyone with the "Subs Manager" duty for the linked event —
          // they're effectively running the board today even without a coach role.
          if (linkedEventId) {
            const { data: subsManagers, error: dutyErr } = await supabase
              .from("duties")
              .select("assigned_to")
              .eq("event_id", linkedEventId)
              .eq("name", "Subs Manager")
              .not("assigned_to", "is", null);
            if (dutyErr) {
              console.error("[AutoSubNotify] subs-manager lookup failed:", dutyErr);
            } else {
              (subsManagers ?? []).forEach((d: any) => {
                if (d.assigned_to) recipientIds.add(d.assigned_to as string);
              });
            }
          }
        }

        const userIds = Array.from(recipientIds);
        if (userIds.length === 0) return;

        const title = `${teamName} — Auto-sub`;
        const body = `${args.playerInName} ON for ${args.playerOutName} at ${args.position}${
          args.periodLabel ? ` (${args.periodLabel})` : ""
        }`;
        // Fire-and-forget per recipient; we do NOT await the whole batch
        // because pitch boards run on a 1Hz tick and any latency here is
        // user-perceivable.
        for (const userId of userIds) {
          supabase.functions
            .invoke("send-push-notification", {
              body: {
                userId,
                title,
                body,
                tag: `auto-sub-${teamId}`,
                notificationType: "pitch_board_auto_sub",
              },
            })
            .catch((err) => {
              console.error(`[AutoSubNotify] push failed for ${userId}:`, err);
            });
        }
      } catch (err) {
        console.error("[AutoSubNotify] unexpected error:", err);
      }
    },
    [teamId, teamName, linkedEventId],
  );

  return notify;
}
