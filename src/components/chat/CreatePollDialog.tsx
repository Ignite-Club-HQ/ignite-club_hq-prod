import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, BarChart3 } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import type { Database } from "@/integrations/supabase/types";

export type PollChatType = Database["public"]["Enums"]["poll_chat_type"];

interface CreatePollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatType: PollChatType;
  chatId: string;
  onCreated: (pollId: string) => void;
}

const MAX_OPTIONS = 10;
const MIN_OPTIONS = 2;

export function CreatePollDialog({ open, onOpenChange, chatType, chatId, onCreated }: CreatePollDialogProps) {
  const { user } = useAuth();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [closesAt, setClosesAt] = useState<string>(""); // datetime-local string

  const reset = () => {
    setQuestion("");
    setOptions(["", ""]);
    setAllowMultiple(false);
    setClosesAt("");
  };

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    setOptions([...options, ""]);
  };
  const removeOption = (idx: number) => {
    if (options.length <= MIN_OPTIONS) return;
    setOptions(options.filter((_, i) => i !== idx));
  };
  const updateOption = (idx: number, val: string) =>
    setOptions(options.map((o, i) => (i === idx ? val : o)));

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const cleanQuestion = question.trim();
      if (!cleanQuestion) throw new Error("Question is required");
      const cleanOptions = options.map(o => o.trim()).filter(Boolean);
      if (cleanOptions.length < MIN_OPTIONS) throw new Error(`Add at least ${MIN_OPTIONS} options`);
      if (new Set(cleanOptions.map(o => o.toLowerCase())).size !== cleanOptions.length) {
        throw new Error("Options must be unique");
      }

      let closesAtIso: string | null = null;
      if (closesAt) {
        const t = new Date(closesAt);
        if (Number.isNaN(t.getTime())) throw new Error("Invalid close time");
        if (t.getTime() <= Date.now()) throw new Error("Close time must be in the future");
        closesAtIso = t.toISOString();
      }

      const { data: poll, error: pollErr } = await supabase
        .from("polls")
        .insert({
          chat_type: chatType,
          chat_id: chatId,
          created_by: user.id,
          question: cleanQuestion,
          allow_multiple: allowMultiple,
          closes_at: closesAtIso,
        })
        .select("id")
        .single();
      if (pollErr || !poll) throw pollErr || new Error("Failed to create poll");

      const optionRows = cleanOptions.map((label, i) => ({
        poll_id: poll.id,
        label,
        position: i,
      }));
      const { error: optErr } = await supabase.from("poll_options").insert(optionRows);
      if (optErr) {
        // best-effort cleanup
        await supabase.from("polls").delete().eq("id", poll.id);
        throw optErr;
      }

      return poll.id as string;
    },
    onSuccess: (pollId) => {
      onCreated(pollId);
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || "Failed to create poll"),
  });

  const minDateTime = format(new Date(Date.now() + 5 * 60 * 1000), "yyyy-MM-dd'T'HH:mm");

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !create.isPending) reset();
        onOpenChange(v);
      }}
    >
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Create poll
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Ask a question and let the chat vote.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <Label htmlFor="poll-question">Question</Label>
            <Input
              id="poll-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, 300))}
              placeholder="e.g. What time should we train Saturday?"
              maxLength={300}
            />
          </div>

          <div className="space-y-2">
            <Label>Options</Label>
            {options.map((opt, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  value={opt}
                  onChange={(e) => updateOption(idx, e.target.value.slice(0, 200))}
                  placeholder={`Option ${idx + 1}`}
                  maxLength={200}
                />
                {options.length > MIN_OPTIONS && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeOption(idx)}
                    aria-label={`Remove option ${idx + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {options.length < MAX_OPTIONS && (
              <Button variant="outline" size="sm" onClick={addOption} className="w-full">
                <Plus className="h-4 w-4 mr-1" /> Add option
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Allow multiple selections</p>
              <p className="text-xs text-muted-foreground">Voters can choose more than one option</p>
            </div>
            <Switch checked={allowMultiple} onCheckedChange={setAllowMultiple} />
          </div>

          <div>
            <Label htmlFor="poll-closes">Close time (optional)</Label>
            <Input
              id="poll-closes"
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              min={minDateTime}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty to keep the poll open until you close it manually.
            </p>
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button
            className="w-full"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <BarChart3 className="h-4 w-4 mr-2" />
            )}
            Create poll
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
