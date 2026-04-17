import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, Clock, Lock, Loader2, MoreVertical, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PollCardProps {
  pollId: string;
}

interface PollRow {
  id: string;
  question: string;
  allow_multiple: boolean;
  closes_at: string | null;
  closed_at: string | null;
  created_by: string;
  created_at: string;
}

interface PollOptionRow {
  id: string;
  label: string;
  position: number;
}

interface PollVoteRow {
  id: string;
  option_id: string;
  user_id: string;
}

export function PollCard({ pollId }: PollCardProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busyOptionId, setBusyOptionId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["poll", pollId],
    queryFn: async () => {
      const [pollRes, optsRes, votesRes] = await Promise.all([
        supabase.from("polls").select("*").eq("id", pollId).maybeSingle(),
        supabase.from("poll_options").select("*").eq("poll_id", pollId).order("position", { ascending: true }),
        supabase.from("poll_votes").select("id, option_id, user_id").eq("poll_id", pollId),
      ]);
      if (pollRes.error) throw pollRes.error;
      if (!pollRes.data) return null;
      return {
        poll: pollRes.data as PollRow,
        options: (optsRes.data || []) as PollOptionRow[],
        votes: (votesRes.data || []) as PollVoteRow[],
      };
    },
    staleTime: 15_000,
  });

  // Realtime: refresh on any vote change for this poll
  useEffect(() => {
    const channel = supabase
      .channel(`poll-${pollId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "poll_votes", filter: `poll_id=eq.${pollId}` },
        () => refetch()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "polls", filter: `id=eq.${pollId}` },
        () => refetch()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [pollId, refetch]);

  const isClosed = useMemo(() => {
    if (!data?.poll) return false;
    if (data.poll.closed_at) return true;
    if (data.poll.closes_at && new Date(data.poll.closes_at).getTime() <= Date.now()) return true;
    return false;
  }, [data?.poll]);

  const totalVotes = data?.votes.length ?? 0;
  const myVoteOptionIds = useMemo(
    () => new Set((data?.votes || []).filter(v => v.user_id === user?.id).map(v => v.option_id)),
    [data?.votes, user?.id]
  );

  const voteCountByOption = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of data?.votes || []) {
      map.set(v.option_id, (map.get(v.option_id) || 0) + 1);
    }
    return map;
  }, [data?.votes]);

  const voteMutation = useMutation({
    mutationFn: async (optionId: string) => {
      if (!user || !data?.poll) return;
      setBusyOptionId(optionId);
      const alreadyVoted = myVoteOptionIds.has(optionId);

      if (alreadyVoted) {
        const { error } = await supabase
          .from("poll_votes")
          .delete()
          .eq("poll_id", pollId)
          .eq("option_id", optionId)
          .eq("user_id", user.id);
        if (error) throw error;
        return;
      }

      // Single-choice: clear any previous vote first
      if (!data.poll.allow_multiple && myVoteOptionIds.size > 0) {
        const { error: delErr } = await supabase
          .from("poll_votes")
          .delete()
          .eq("poll_id", pollId)
          .eq("user_id", user.id);
        if (delErr) throw delErr;
      }

      const { error } = await supabase
        .from("poll_votes")
        .insert({ poll_id: pollId, option_id: optionId, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      refetch();
    },
    onError: (e: any) => {
      toast.error(e?.message || "Failed to record vote");
    },
    onSettled: () => setBusyOptionId(null),
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("polls")
        .update({ closed_at: new Date().toISOString() })
        .eq("id", pollId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Poll closed");
      refetch();
    },
    onError: (e: any) => toast.error(e?.message || "Failed to close poll"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("polls").delete().eq("id", pollId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Poll deleted");
      qc.invalidateQueries({ queryKey: ["poll", pollId] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to delete poll"),
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card/50 p-3 max-w-sm">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading poll…
        </div>
      </div>
    );
  }

  if (!data?.poll) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-3 max-w-sm text-sm text-muted-foreground">
        Poll unavailable
      </div>
    );
  }

  const { poll, options } = data;
  const isCreator = user?.id === poll.created_by;
  const closesIn = poll.closes_at ? new Date(poll.closes_at) : null;

  return (
    <div className="rounded-xl border border-border bg-card p-3 max-w-sm w-full shadow-sm">
      <div className="flex items-start gap-2 mb-2">
        <BarChart3 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug break-words">{poll.question}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {poll.allow_multiple ? "Multiple choice" : "Single choice"}
            {isClosed && " · Closed"}
          </p>
        </div>
        {isCreator && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
                aria-label="Poll actions"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isClosed && (
                <DropdownMenuItem onClick={() => closeMutation.mutate()}>
                  <Lock className="h-4 w-4 mr-2" /> Close poll
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  if (confirm("Delete this poll? Votes will be removed.")) deleteMutation.mutate();
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete poll
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="space-y-1.5">
        {options.map((opt) => {
          const count = voteCountByOption.get(opt.id) || 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const selected = myVoteOptionIds.has(opt.id);
          const disabled = isClosed || voteMutation.isPending || busyOptionId !== null;
          return (
            <button
              key={opt.id}
              onClick={() => !disabled && voteMutation.mutate(opt.id)}
              disabled={disabled}
              className={`relative w-full text-left rounded-lg border overflow-hidden transition-colors ${
                selected ? "border-primary" : "border-border"
              } ${disabled && !selected ? "opacity-80" : "hover:bg-muted/50"} ${
                disabled ? "cursor-default" : "cursor-pointer"
              }`}
            >
              <div
                className={`absolute inset-y-0 left-0 ${
                  selected ? "bg-primary/15" : "bg-muted/40"
                } transition-[width] duration-300`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  {selected ? (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 shrink-0" />
                  )}
                  <span className="text-sm truncate">{opt.label}</span>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                  {count} · {pct}%
                </span>
              </div>
              {busyOptionId === opt.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{totalVotes} {totalVotes === 1 ? "vote" : "votes"}</span>
        {closesIn && !isClosed && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Closes {formatDistanceToNow(closesIn, { addSuffix: true })}
          </span>
        )}
      </div>
    </div>
  );
}
