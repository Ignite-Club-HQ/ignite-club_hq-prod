import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { fetchProfilesWithCache } from "@/lib/profileCache";

interface PollVotersDialogProps {
  pollId: string;
  question: string;
  options: Array<{ id: string; label: string }>;
  votes: Array<{ option_id: string; user_id: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PollVotersDialog({ pollId, question, options, votes, open, onOpenChange }: PollVotersDialogProps) {
  const userIds = [...new Set(votes.map(vote => vote.user_id))].sort();
  const { data: profiles, isLoading, isError, refetch } = useQuery({
    queryKey: ["poll-voter-profiles", pollId, userIds],
    enabled: open && userIds.length > 0,
    queryFn: () => fetchProfilesWithCache(userIds),
    staleTime: 60_000,
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Poll votes</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="break-words">{question}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-5 py-2" aria-live="polite">
          {isLoading && userIds.length > 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading voters…
            </div>
          ) : isError ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Couldn't load voters.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
            </div>
          ) : options.map(option => {
            const voterIds = [...new Set(votes.filter(vote => vote.option_id === option.id).map(vote => vote.user_id))];
            return (
              <section key={option.id} aria-label={`${option.label} voters`}>
                <h3 className="flex items-start justify-between gap-3 text-sm font-semibold border-b border-border pb-2">
                  <span className="min-w-0 break-words">{option.label}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{voterIds.length}</span>
                </h3>
                {voterIds.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">No votes yet</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {voterIds.map(id => (
                      <li key={id} className="py-3 text-sm break-words">
                        {profiles?.get(id)?.display_name?.trim() || "Member (name unavailable)"}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}