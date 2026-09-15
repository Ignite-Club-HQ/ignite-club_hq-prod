import { Mail, MessageSquare, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface SingleInvitationDeliveryStepProps {
  deliveryMethod: "email" | "share";
  email: string;
  showMessageEditor: boolean;
  customMessage: string;
  onDeliveryMethodChange: (method: "email" | "share") => void;
  onEmailChange: (value: string) => void;
  onMessageEditorChange: (open: boolean) => void;
  onCustomMessageChange: (value: string) => void;
}

export function SingleInvitationDeliveryStep({
  deliveryMethod,
  email,
  showMessageEditor,
  customMessage,
  onDeliveryMethodChange,
  onEmailChange,
  onMessageEditorChange,
  onCustomMessageChange,
}: SingleInvitationDeliveryStepProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-sm font-medium">How to deliver invite?</Label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDeliveryMethodChange("email")}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              deliveryMethod === "email"
                ? "bg-primary/10 border-primary text-primary"
                : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Mail className="h-4 w-4" />
            Email
          </button>
          <button
            type="button"
            onClick={() => onDeliveryMethodChange("share")}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              deliveryMethod === "share"
                ? "bg-primary/10 border-primary text-primary"
                : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Share2 className="h-4 w-4" />
            Share Link
          </button>
        </div>
        {deliveryMethod === "email" && (
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="email"
              placeholder="e.g., john@example.com"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              className="pl-10"
              autoFocus
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5 text-sm">
            <MessageSquare className="h-3.5 w-3.5" />
            Custom Message
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onMessageEditorChange(!showMessageEditor)}
          >
            {showMessageEditor ? "Hide" : "Add message"}
          </Button>
        </div>
        {showMessageEditor && (
          <Textarea
            aria-label="Custom Message"
            placeholder={`Add a personal note (optional). Example:\n\nHi! We're using Ignite Club HQ to keep everything organised — fixtures, chat, and team updates all in one place. Tap the link to join.`}
            value={customMessage}
            onChange={(event) => onCustomMessageChange(event.target.value)}
            rows={4}
            className="text-sm resize-none"
          />
        )}
      </div>
    </>
  );
}
