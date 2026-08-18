import { Baby, CheckCircle2, Copy, Mail, MessageSquare, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface SingleInvitationSuccessContentProps {
  memberName: string;
  isParent: boolean;
  childNames: string[];
  teamName: string;
  invitedEmail: string;
  phone: string;
  shareMessage: string;
  isAndroid: boolean;
  onPhoneChange: (value: string) => void;
  onOpenSms: (href: string) => void;
  onOpenWhatsApp: (href: string) => void;
  onMoreShare: () => void | Promise<void>;
  onCopyLink: () => void | Promise<void>;
  onAddAnother: () => void;
  onDone: () => void;
}

export function SingleInvitationSuccessContent({
  memberName,
  isParent,
  childNames,
  teamName,
  invitedEmail,
  phone,
  shareMessage,
  isAndroid,
  onPhoneChange,
  onOpenSms,
  onOpenWhatsApp,
  onMoreShare,
  onCopyLink,
  onAddAnother,
  onDone,
}: SingleInvitationSuccessContentProps) {
  const cleanedPhone = phone.replace(/[^\d+]/g, "");
  const whatsappPhone = cleanedPhone.replace(/^\+/, "");
  const hasPhone = cleanedPhone.length >= 4;
  const encodedMessage = encodeURIComponent(shareMessage.trim());
  const smsHref = hasPhone
    ? `sms:${cleanedPhone}${isAndroid ? "?" : "&"}body=${encodedMessage}`
    : `sms:?body=${encodedMessage}`;
  const whatsappHref = hasPhone
    ? `https://wa.me/${whatsappPhone}?text=${encodedMessage}`
    : `https://wa.me/?text=${encodedMessage}`;

  return (
    <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl">
      <SheetHeader className="mb-6">
        <SheetTitle className="flex items-center gap-2 text-green-600">
          <CheckCircle2 className="h-5 w-5" />
          Member Added
        </SheetTitle>
        <SheetDescription className="sr-only">
          Review the created invitation and choose how to share it.
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 pb-6">
        <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
          <p className="font-medium mb-1">{memberName}</p>
          {isParent && childNames.length > 0 && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Baby className="h-3.5 w-3.5" />
              {childNames.length === 1
                ? `${childNames[0]} added to ${teamName || "the team"}`
                : `${childNames.join(", ")} added to ${teamName || "the team"}`}
            </p>
          )}
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            {invitedEmail ? `Invite sent to ${invitedEmail}` : "Invite link created — share it with them"}
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-center">Share invite via</p>
          <div className="space-y-1.5">
            <Label htmlFor="share-phone" className="text-xs text-muted-foreground">
              Phone number (optional — opens SMS or WhatsApp)
            </Label>
            <Input id="share-phone" type="tel" inputMode="tel" autoComplete="off" placeholder="e.g. +61 412 345 678" value={phone} onChange={(event) => onPhoneChange(event.target.value)} />
            <p className="text-[11px] text-muted-foreground">Not saved — used only to open your messaging app.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => onOpenSms(smsHref)}><MessageSquare className="h-4 w-4 mr-2" />SMS</Button>
            <Button variant="outline" onClick={() => onOpenWhatsApp(whatsappHref)}><Share2 className="h-4 w-4 mr-2" />WhatsApp</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => void onMoreShare()}><Share2 className="h-4 w-4 mr-2" />More</Button>
            <Button variant="outline" className="flex-1" onClick={() => void onCopyLink()}><Copy className="h-4 w-4 mr-2" />Copy Link</Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground text-center">
          When they accept the invite, their name will be pre-filled as "{memberName}"
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onAddAnother}>Add Another</Button>
          <Button className="flex-1" onClick={onDone}>Done</Button>
        </div>
      </div>
    </SheetContent>
  );
}
