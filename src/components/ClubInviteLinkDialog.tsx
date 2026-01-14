import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Copy, Check, Loader2, Download, Share2, QrCode, Sparkles, Crown, UserPlus } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import TrackInviteSheet from "./TrackInviteSheet";

const CLUB_ADMIN_ROLE = "club_admin";

interface ClubInviteLinkDialogProps {
  clubId: string;
  clubName: string;
}

function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function ClubInviteLinkDialog({ clubId, clubName }: ClubInviteLinkDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showTrackSheet, setShowTrackSheet] = useState(false);

  const getQRCodeAsFile = async (): Promise<File | null> => {
    const svg = document.getElementById('club-invite-qr-code');
    if (!svg) return null;
    
    return new Promise((resolve) => {
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = document.createElement('img');
      const scale = 2;
      img.onload = () => {
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        if (ctx) {
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `${clubName}-invite-qr.png`, { type: 'image/png' });
            resolve(file);
          } else {
            resolve(null);
          }
        }, 'image/png');
      };
      img.onerror = () => resolve(null);
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    });
  };

  const handleShare = async (includeQR: boolean) => {
    if (!generatedLink) return;
    setIsSharing(true);
    
    try {
      const qrFile = includeQR ? await getQRCodeAsFile() : null;
      
      if (navigator.share) {
        const shareData: ShareData = { url: generatedLink };
        if (qrFile && navigator.canShare?.({ files: [qrFile] })) {
          shareData.files = [qrFile];
        }
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(generatedLink);
        toast({ title: "Link copied to clipboard" });
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(generatedLink);
          toast({ title: "Link copied to clipboard" });
        } catch {
          toast({ title: "Failed to share", variant: "destructive" });
        }
      }
    } finally {
      setIsSharing(false);
    }
  };

  const createInviteMutation = useMutation({
    mutationFn: async () => {
      const token = generateToken();
      const { error } = await supabase.from("club_invites").insert({
        club_id: clubId,
        role: CLUB_ADMIN_ROLE,
        token,
        created_by: user!.id,
      });
      if (error) throw error;
      return token;
    },
    onSuccess: (token) => {
      const link = `https://igniteclubhq.app/join-club/${token}?install=true`;
      setGeneratedLink(link);
      setGeneratedToken(token);
      queryClient.invalidateQueries({ queryKey: ["club-invites", clubId] });
    },
    onError: () => {
      toast({ title: "Failed to create invite link", variant: "destructive" });
    },
  });

  const handleCopy = async () => {
    if (generatedLink) {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      toast({ title: "Link copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setGeneratedLink(null);
      setGeneratedToken(null);
      setCopied(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Link2 className="h-4 w-4 mr-2" />
        Invite Link
      </Button>
      <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-full bg-primary/10">
                <Link2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <ResponsiveDialogTitle>Create Invite Link</ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="text-sm">
                  {clubName}
                </ResponsiveDialogDescription>
              </div>
            </div>
          </ResponsiveDialogHeader>
          
          <div className="space-y-5 pt-2 pb-4">
            {!generatedLink ? (
              <div className="space-y-5">
                {/* Info Card */}
                <div className="rounded-xl bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/20 p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-purple-500/20">
                      <Crown className="h-4 w-4 text-purple-600" />
                    </div>
                    <span className="font-semibold">Club Admin Invite</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Anyone with this link can join as a Club Admin with full management permissions.
                  </p>
                </div>

                <Button 
                  onClick={() => createInviteMutation.mutate()} 
                  disabled={createInviteMutation.isPending}
                  className="w-full h-12 text-base font-semibold"
                >
                  {createInviteMutation.isPending ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-5 w-5 mr-2" />
                  )}
                  Generate Invite Link
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* QR Code */}
                <div className="flex justify-center">
                  <div className="p-4 bg-white rounded-2xl shadow-sm border">
                    <QRCodeSVG 
                      id="club-invite-qr-code"
                      value={generatedLink} 
                      size={160}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                </div>
                
                {/* Link Input */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-purple-500/20 text-purple-600 border-purple-500/30">
                      <Crown className="h-3 w-3 mr-1" />
                      Club Admin
                    </Badge>
                    <span className="text-xs text-muted-foreground">• Unlimited uses</span>
                  </div>
                  <div className="flex gap-2">
                    <Input 
                      value={generatedLink} 
                      readOnly 
                      className="font-mono text-xs bg-muted/50" 
                    />
                    <Button size="icon" variant="outline" onClick={handleCopy} className="shrink-0">
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    disabled={isSharing}
                    onClick={() => handleShare(false)}
                    className="h-11"
                  >
                    {isSharing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4 mr-2" />
                    )}
                    Share Link
                  </Button>
                  <Button
                    disabled={isSharing}
                    onClick={() => handleShare(true)}
                    className="h-11"
                  >
                    {isSharing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <QrCode className="h-4 w-4 mr-2" />
                    )}
                    Share QR
                  </Button>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="outline" 
                    onClick={async () => {
                      const qrFile = await getQRCodeAsFile();
                      if (qrFile) {
                        const url = URL.createObjectURL(qrFile);
                        const downloadLink = document.createElement('a');
                        downloadLink.download = `${clubName}-invite-qr.png`;
                        downloadLink.href = url;
                        downloadLink.click();
                        URL.revokeObjectURL(url);
                      }
                    }}
                    className="h-11"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Save QR
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setGeneratedLink(null);
                      setGeneratedToken(null);
                    }}
                    className="h-11"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    New Link
                  </Button>
                </div>

                {/* Track & Send Button */}
                <Button
                  variant="secondary"
                  onClick={() => setShowTrackSheet(true)}
                  className="w-full h-11"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Track & Send to Someone
                </Button>
              </div>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Track Invite Sheet */}
      {generatedLink && generatedToken && (
        <TrackInviteSheet
          open={showTrackSheet}
          onOpenChange={setShowTrackSheet}
          inviteToken={generatedToken}
          inviteLink={generatedLink}
          role={CLUB_ADMIN_ROLE}
          clubId={clubId}
          entityName={clubName}
        />
      )}
    </>
  );
}
