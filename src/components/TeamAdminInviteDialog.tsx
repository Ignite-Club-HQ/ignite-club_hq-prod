import { useState } from "react";
import { Copy, Check, Mail, Link2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

interface TeamAdminInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamName: string;
  inviteLink: string;
  onDone: () => void;
}

export function TeamAdminInviteDialog({
  open,
  onOpenChange,
  teamName,
  inviteLink,
  onDone,
}: TeamAdminInviteDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success("Link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const handleShareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${teamName} as Team Admin`,
          text: `You've been invited to manage ${teamName}. Click the link to join:`,
          url: inviteLink
        });
        toast.success("Link shared!");
      } catch (err: any) {
        // User cancelled - don't show error
        if (err?.name !== 'AbortError') {
          // Fallback to copy if share fails
          handleCopyLink();
        }
      }
    } else {
      handleCopyLink();
    }
  };

  const handleDone = () => {
    onOpenChange(false);
    onDone();
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Link2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <ResponsiveDialogTitle>Team Created!</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Share this invite link with your Team Admin
              </ResponsiveDialogDescription>
            </div>
          </div>
        </ResponsiveDialogHeader>

        <div className="space-y-4 py-4">
          {/* QR Code */}
          <div className="flex justify-center py-4 bg-white rounded-lg">
            <QRCodeSVG value={inviteLink} size={160} />
          </div>

          {/* Link Input */}
          <div className="flex gap-2">
            <Input 
              value={inviteLink} 
              readOnly 
              className="text-xs"
            />
            <Button 
              variant="outline" 
              size="icon"
              onClick={handleCopyLink}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          {/* Share Button */}
          <Button 
            className="w-full"
            onClick={handleShareLink}
          >
            <Mail className="h-4 w-4 mr-2" />
            Share Invite Link
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Share this link with the person you want to manage <strong>{teamName}</strong>.
            They'll be added as Team Admin when they sign up and join.
          </p>
        </div>

        <ResponsiveDialogFooter>
          <Button 
            variant="outline" 
            onClick={handleDone}
            className="w-full"
          >
            Done
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
