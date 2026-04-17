import { useQuery } from "@tanstack/react-query";
import { BarChart3, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PollAttachmentPreviewProps {
  pollId: string;
  onRemove: () => void;
  disabled?: boolean;
}

/**
 * Compact preview card shown above the chat composer when a poll is attached.
 * Mirrors the attachment-preview UX of images and event picks.
 */
export function PollAttachmentPreview({ pollId, onRemove, disabled }: PollAttachmentPreviewProps) {
  const { data } = useQuery({
    queryKey: ["poll-preview", pollId],
    queryFn: async () => {
      const [pollRes, optsRes] = await Promise.all([
        supabase.from("polls").select("question, allow_multiple").eq("id", pollId).maybeSingle(),
        supabase.from("poll_options").select("id", { count: "exact", head: true }).eq("poll_id", pollId),
      ]);
      return {
        question: pollRes.data?.question ?? "Poll",
        allowMultiple: pollRes.data?.allow_multiple ?? false,
        optionCount: optsRes.count ?? 0,
      };
    },
    staleTime: 60_000,
  });

  return (
    <div className="px-3 pt-2">
      <div className="flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-2 shadow-sm">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <BarChart3 className="h-4.5 w-4.5" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {data?.question || "Poll attached"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            Poll attached
            {data?.optionCount ? ` · ${data.optionCount} option${data.optionCount === 1 ? "" : "s"}` : ""}
            {data?.allowMultiple ? " · Multiple choice" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remove poll attachment"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
