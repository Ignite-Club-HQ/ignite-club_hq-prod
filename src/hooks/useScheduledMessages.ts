import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

export type ScheduledChatType =
  | "team"
  | "club"
  | "group"
  | "direct"
  | "club_admin"
  | "broadcast";

export type ScheduledMessageStatus = "pending" | "sent" | "failed" | "cancelled";

export interface ScheduledMessageRow {
  id: string;
  author_id: string;
  chat_type: ScheduledChatType;
  team_id: string | null;
  club_id: string | null;
  group_id: string | null;
  conversation_id: string | null;
  text: string;
  image_url: string | null;
  reply_to_id: string | null;
  scheduled_for: string;
  status: ScheduledMessageStatus;
  sent_message_id: string | null;
  error_message: string | null;
  attempted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleTarget {
  chat_type: ScheduledChatType;
  team_id?: string | null;
  club_id?: string | null;
  group_id?: string | null;
  conversation_id?: string | null;
}

export interface CreateScheduledMessageInput extends ScheduleTarget {
  text: string;
  image_url?: string | null;
  reply_to_id?: string | null;
  scheduled_for: Date;
}

function targetKey(t: ScheduleTarget): string {
  return [
    t.chat_type,
    t.team_id || "",
    t.club_id || "",
    t.group_id || "",
    t.conversation_id || "",
  ].join("|");
}

function targetMatches(row: ScheduledMessageRow, t: ScheduleTarget): boolean {
  if (row.chat_type !== t.chat_type) return false;
  return (
    (row.team_id || null) === (t.team_id || null) &&
    (row.club_id || null) === (t.club_id || null) &&
    (row.group_id || null) === (t.group_id || null) &&
    (row.conversation_id || null) === (t.conversation_id || null)
  );
}

/**
 * Pending scheduled messages for a specific thread (current user only).
 */
export function useThreadScheduledMessages(target: ScheduleTarget | null) {
  const { user } = useAuth();
  const key = target ? targetKey(target) : "";

  return useQuery({
    queryKey: ["scheduled-messages-thread", user?.id, key],
    queryFn: async (): Promise<ScheduledMessageRow[]> => {
      if (!user?.id || !target) return [];
      let q = supabase
        .from("scheduled_messages" as any)
        .select("*")
        .eq("author_id", user.id)
        .eq("status", "pending")
        .eq("chat_type", target.chat_type)
        .order("scheduled_for", { ascending: true });

      if (target.team_id) q = q.eq("team_id", target.team_id);
      else q = q.is("team_id", null);
      if (target.club_id) q = q.eq("club_id", target.club_id);
      else q = q.is("club_id", null);
      if (target.group_id) q = q.eq("group_id", target.group_id);
      else q = q.is("group_id", null);
      if (target.conversation_id) q = q.eq("conversation_id", target.conversation_id);
      else q = q.is("conversation_id", null);

      const { data, error } = await q;
      if (error) {
        console.error("[scheduled-messages] thread fetch error", error);
        return [];
      }
      return (data || []) as unknown as ScheduledMessageRow[];
    },
    enabled: !!user?.id && !!target,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

/**
 * All of the user's scheduled messages, optionally filtered by status.
 */
export function useAllScheduledMessages(statuses: ScheduledMessageStatus[] = ["pending"]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["scheduled-messages-all", user?.id, statuses.join(",")],
    queryFn: async (): Promise<ScheduledMessageRow[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("scheduled_messages" as any)
        .select("*")
        .eq("author_id", user.id)
        .in("status", statuses)
        .order("scheduled_for", { ascending: true });
      if (error) {
        console.error("[scheduled-messages] all fetch error", error);
        return [];
      }
      return (data || []) as unknown as ScheduledMessageRow[];
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
}

export function useCreateScheduledMessage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateScheduledMessageInput) => {
      if (!user?.id) throw new Error("Not authenticated");
      const payload: any = {
        author_id: user.id,
        chat_type: input.chat_type,
        team_id: input.team_id ?? null,
        club_id: input.club_id ?? null,
        group_id: input.group_id ?? null,
        conversation_id: input.conversation_id ?? null,
        text: input.text || "",
        image_url: input.image_url ?? null,
        reply_to_id: input.reply_to_id ?? null,
        scheduled_for: input.scheduled_for.toISOString(),
      };
      const { data, error } = await supabase
        .from("scheduled_messages" as any)
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as ScheduledMessageRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-messages-thread"] });
      qc.invalidateQueries({ queryKey: ["scheduled-messages-all"] });
    },
  });
}

export function useUpdateScheduledMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      text?: string;
      image_url?: string | null;
      scheduled_for?: Date;
    }) => {
      const patch: any = {};
      if (input.text !== undefined) patch.text = input.text;
      if (input.image_url !== undefined) patch.image_url = input.image_url;
      if (input.scheduled_for) patch.scheduled_for = input.scheduled_for.toISOString();
      const { data, error } = await supabase
        .from("scheduled_messages" as any)
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as ScheduledMessageRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-messages-thread"] });
      qc.invalidateQueries({ queryKey: ["scheduled-messages-all"] });
    },
  });
}

export function useCancelScheduledMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Hard delete — simpler than tracking a 'cancelled' status the user has to ignore.
      const { error } = await supabase
        .from("scheduled_messages" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-messages-thread"] });
      qc.invalidateQueries({ queryKey: ["scheduled-messages-all"] });
    },
  });
}

export { targetMatches };
