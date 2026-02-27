import { useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ReportCommentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  commentId: string;
}

const REPORT_REASONS = [
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "offensive", label: "Offensive or harmful" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "spam", label: "Spam or misleading" },
  { value: "other", label: "Other" },
];

export function ReportCommentDialog({ isOpen, onClose, commentId }: ReportCommentDialogProps) {
  const [reason, setReason] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!reason) {
      toast.error("Please select a reason for your report");
      return;
    }

    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in to report a comment");
        return;
      }

      const response = await supabase.functions.invoke("send-comment-report-email", {
        body: {
          commentId,
          reason: REPORT_REASONS.find(r => r.value === reason)?.label || reason,
          additionalDetails: additionalDetails.trim() || undefined,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      toast.success("Report submitted successfully. Our team will review it.");
      handleClose();
    } catch (error) {
      console.error("Failed to submit report:", error);
      toast.error("Failed to submit report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason("");
    setAdditionalDetails("");
    onClose();
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleClose}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-base">
            <Flag className="h-5 w-5 text-destructive shrink-0" />
            Report Comment
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-sm">
            Help us maintain a safe community by reporting inappropriate comments. All reports are reviewed and actioned within 24 hours.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 py-2 px-4">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Why are you reporting this comment?</Label>
            <RadioGroup value={reason} onValueChange={setReason} className="space-y-2">
              {REPORT_REASONS.map((option) => (
                <div key={option.value} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 -mx-2">
                  <RadioGroupItem value={option.value} id={`comment-${option.value}`} />
                  <Label htmlFor={`comment-${option.value}`} className="font-normal cursor-pointer text-sm flex-1">
                    {option.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comment-details" className="text-sm font-medium">Additional details (optional)</Label>
            <Textarea
              id="comment-details"
              placeholder="Provide any additional context..."
              value={additionalDetails}
              onChange={(e) => setAdditionalDetails(e.target.value)}
              rows={3}
              maxLength={500}
              className="resize-none text-base"
            />
            <p className="text-xs text-muted-foreground text-right">
              {additionalDetails.length}/500
            </p>
          </div>
        </div>

        <ResponsiveDialogFooter className="flex-col gap-2 px-4 pb-4">
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!reason || submitting}
            className="w-full"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Flag className="h-4 w-4" />
                Submit Report
              </>
            )}
          </Button>
          <Button variant="outline" onClick={handleClose} disabled={submitting} className="w-full">
            Cancel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
