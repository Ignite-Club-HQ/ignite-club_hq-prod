import { useEffect, useState } from "react";
import { format, addHours, setHours, setMinutes, setSeconds, addDays, nextMonday } from "date-fns";
import { Calendar as CalendarIcon, Clock, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ScheduleTarget,
  ScheduledMessageRow,
  useCreateScheduledMessage,
  useUpdateScheduledMessage,
} from "@/hooks/useScheduledMessages";

interface ScheduleMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ScheduleTarget;
  /** Pre-fill from current composer state. Optional. */
  initialText?: string;
  initialImageUrl?: string | null;
  /** When provided, the dialog edits this existing scheduled row instead of creating a new one. */
  editingRow?: ScheduledMessageRow | null;
  /** Called after successful save with the chosen Date — useful so the composer can clear itself. */
  onScheduled?: () => void;
}

const QUICK_PRESETS: Array<{ label: string; build: () => Date }> = [
  { label: "In 1 hour", build: () => addHours(new Date(), 1) },
  {
    label: "Tomorrow 9am",
    build: () => setSeconds(setMinutes(setHours(addDays(new Date(), 1), 9), 0), 0),
  },
  {
    label: "Monday 9am",
    build: () => {
      const d = nextMonday(new Date());
      return setSeconds(setMinutes(setHours(d, 9), 0), 0);
    },
  },
];

function roundToNext5Min(d: Date): Date {
  const ms = 5 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

function localTimezoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  } catch {
    return "local time";
  }
}

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  target,
  initialText = "",
  initialImageUrl = null,
  editingRow = null,
  onScheduled,
}: ScheduleMessageDialogProps) {
  const isEditing = !!editingRow;
  const create = useCreateScheduledMessage();
  const update = useUpdateScheduledMessage();
  const isSaving = create.isPending || update.isPending;

  const [text, setText] = useState(initialText);
  // Image URL is reused as-is (uploaded by the composer beforehand). If we're
  // editing, surface the existing image_url so users see what's attached.
  const [imageUrl] = useState<string | null>(initialImageUrl);

  // Default scheduled time: next 5-min boundary at least 5 minutes from now
  const defaultDate = roundToNext5Min(addHours(new Date(), 0.1));
  const [date, setDate] = useState<Date>(defaultDate);
  const [timeStr, setTimeStr] = useState<string>(format(defaultDate, "HH:mm"));

  // Reset state whenever the dialog opens (or target/editingRow changes)
  useEffect(() => {
    if (!open) return;
    if (editingRow) {
      const d = new Date(editingRow.scheduled_for);
      setText(editingRow.text || "");
      setDate(d);
      setTimeStr(format(d, "HH:mm"));
    } else {
      setText(initialText);
      const d = roundToNext5Min(addHours(new Date(), 0.1));
      setDate(d);
      setTimeStr(format(d, "HH:mm"));
    }
  }, [open, editingRow, initialText]);

  const buildScheduledDate = (): Date | null => {
    const [hh, mm] = timeStr.split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const out = new Date(date);
    out.setHours(hh, mm, 0, 0);
    return out;
  };

  const scheduledDate = buildScheduledDate();
  const minMs = Date.now() + 60 * 1000; // must be at least 1 min in the future
  const isInFuture = scheduledDate ? scheduledDate.getTime() > minMs : false;
  const hasContent = text.trim().length > 0 || !!imageUrl;
  const canSave = hasContent && isInFuture && !isSaving;

  const applyPreset = (preset: () => Date) => {
    const d = roundToNext5Min(preset());
    setDate(d);
    setTimeStr(format(d, "HH:mm"));
  };

  const handleSave = async () => {
    const when = buildScheduledDate();
    if (!when) {
      toast.error("Please choose a valid time");
      return;
    }
    if (when.getTime() <= minMs) {
      toast.error("Please choose a time at least 1 minute in the future");
      return;
    }
    if (!hasContent) {
      toast.error("Add a message or image first");
      return;
    }

    try {
      if (isEditing && editingRow) {
        await update.mutateAsync({
          id: editingRow.id,
          text: text.trim(),
          scheduled_for: when,
        });
        toast.success("Scheduled message updated");
      } else {
        await create.mutateAsync({
          ...target,
          text: text.trim(),
          image_url: imageUrl,
          scheduled_for: when,
        });
        toast.success(`Message scheduled for ${format(when, "PPp")}`);
      }
      onScheduled?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error("[schedule-dialog] save failed", err);
      toast.error(err?.message || "Failed to schedule message");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit scheduled message" : "Schedule message"}
          </DialogTitle>
          <DialogDescription>
            Times shown in your local timezone ({localTimezoneLabel()}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="schedule-text">Message</Label>
            <Textarea
              id="schedule-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write your message…"
              rows={4}
              className="resize-none"
            />
          </div>

          {imageUrl && (
            <div className="space-y-2">
              <Label>Attachment</Label>
              <img
                src={imageUrl}
                alt="Attachment preview"
                className="h-24 w-24 object-cover rounded-md border border-border"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {QUICK_PRESETS.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyPreset(p.build)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(date, "MMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    disabled={(d) => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      return d < today;
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule-time">Time</Label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="schedule-time"
                  type="time"
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {scheduledDate && (
            <p
              className={cn(
                "text-xs",
                isInFuture ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {isInFuture
                ? `Will send on ${format(scheduledDate, "EEEE, MMM d 'at' h:mm a")}`
                : "Choose a time in the future"}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
