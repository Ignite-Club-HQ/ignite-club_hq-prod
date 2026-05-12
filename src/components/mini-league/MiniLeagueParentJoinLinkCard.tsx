import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Copy, Check, Link2, QrCode, Share2, Download } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const APP_URL = "https://igniteclubhq.app";
const TOKEN_METADATA_KIND = "mini_league_parent_join_link";

interface Props {
  miniLeagueId: string;
  miniLeagueName: string;
  clubId: string;
}

interface JoinLinkRow {
  id: string;
  invite_token: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

function generateShortToken(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export default function MiniLeagueParentJoinLinkCard({ miniLeagueId, miniLeagueName, clubId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const queryKey = ["mini-league-parent-join-link", miniLeagueId];

  const { data: link, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, invite_token, created_at, metadata")
        .eq("club_id", clubId)
        .eq("role", "parent" as any)
        .eq("status", "pending")
        .contains("metadata", { kind: TOKEN_METADATA_KIND, mini_league_id: miniLeagueId })
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as JoinLinkRow | undefined) ?? null;
    },
    staleTime: 30_000,
  });

  const createOrRotate = useMutation({
    mutationFn: async ({ rotate }: { rotate: boolean }) => {
      if (!user) throw new Error("Not signed in");
      if (rotate && link) {
        await supabase.from("pending_invites").delete().eq("id", link.id);
      }
      const token = generateShortToken();
      const { data, error } = await supabase
        .from("pending_invites")
        .insert({
          club_id: clubId,
          role: "parent" as any,
          invited_by_user_id: user.id,
          invited_user_id: null,
          invited_label: `${miniLeagueName} – Parent join link`,
          invited_email: null,
          invite_token: token,
          metadata: {
            kind: TOKEN_METADATA_KIND,
            mini_league_id: miniLeagueId,
          },
        } as any)
        .select("id, invite_token, created_at, metadata")
        .single();
      if (error) throw error;
      return data as JoinLinkRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Parent join link ready", description: "Share it with parents — they'll add their child after joining." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't create link", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  const revoke = useMutation({
    mutationFn: async () => {
      if (!link) return;
      const { error } = await supabase.from("pending_invites").delete().eq("id", link.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Link revoked", description: "The previous link no longer works." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't revoke", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  const fullUrl = useMemo(() => (link ? `${APP_URL}/join/p/${link.invite_token}` : ""), [link]);

  const handleCopy = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleShare = async () => {
    if (!fullUrl) return;
    const title = `Join ${miniLeagueName}`;
    const text = `Tap to join ${miniLeagueName} as a parent and add your child:`;
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({ title, text, url: fullUrl, dialogTitle: "Share parent join link" });
        return;
      } catch {/* cancelled */}
    }
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try {
        await (navigator as any).share({ title, text, url: fullUrl });
        return;
      } catch {/* cancelled */}
    }
    handleCopy();
  };

  const handleSaveQR = async () => {
    if (!link) return;
    const container = document.getElementById(`ml-parent-qr-${link.id}`);
    const svg = container?.querySelector("svg");
    if (!svg) return;
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const svg64 = btoa(unescape(encodeURIComponent(xml)));
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${svg64}`;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const size = 720;
      const pad = 48;
      const canvas = document.createElement("canvas");
      canvas.width = size + pad * 2;
      canvas.height = size + pad * 2 + 60;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, pad, pad, size, size);
      ctx.fillStyle = "#0f172a";
      ctx.font = "600 22px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Join ${miniLeagueName} – Parent`, canvas.width / 2, size + pad + 38);
      const dataUrl = canvas.toDataURL("image/png");
      const filename = `parent-join-${miniLeagueName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;

      if (Capacitor.isNativePlatform()) {
        const base64 = dataUrl.split(",")[1];
        const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        await Share.share({ title: `Join ${miniLeagueName}`, url: written.uri, dialogTitle: "Share QR code" });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast({ title: "QR saved", description: filename });
      }
    } catch (e: any) {
      toast({ title: "Couldn't save QR", description: e?.message ?? "Unknown error", variant: "destructive" });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Link2 className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Share a parent join link</p>
          <p className="text-xs text-muted-foreground">
            One link any parent can tap to join {miniLeagueName} and add their child. Reuse it for as many families as you like.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : !link ? (
        <div className="space-y-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={createOrRotate.isPending}
            onClick={() => createOrRotate.mutate({ rotate: false })}
          >
            {createOrRotate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            Generate parent join link
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Creates a permanent link — you only need to do this once.
          </p>
          {isError && (
            <button
              type="button"
              onClick={() => refetch()}
              className="w-full text-[11px] text-muted-foreground underline"
            >
              Couldn't load existing link — tap to retry
            </button>
          )}
        </div>
      ) : (
        <>
          <Button type="button" className="w-full h-11 text-sm font-semibold" onClick={handleShare}>
            <Share2 className="h-4 w-4 mr-2" />
            Share link
          </Button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy join link"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors min-h-[40px]"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-primary" />
                  <span className="text-primary">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy link</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowQR((v) => !v)}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors min-h-[40px]"
            >
              <QrCode className="h-3.5 w-3.5" />
              {showQR ? "Hide QR" : "Show QR"}
            </button>
          </div>

          <Collapsible open={showQR}>
            <CollapsibleContent>
              <div className="flex flex-col items-center gap-2 py-3 bg-background rounded-md border border-border">
                <div id={`ml-parent-qr-${link.id}`} className="bg-white p-3 rounded-md">
                  <QRCodeSVG value={fullUrl} size={180} level="M" includeMargin={false} />
                </div>
                <p className="text-[11px] text-muted-foreground">Point a camera at the code to join as a parent</p>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={handleSaveQR}>
                  <Download className="h-3 w-3 mr-1" />
                  {Capacitor.isNativePlatform() ? "Share QR image" : "Download QR"}
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground/80 pt-1">
            <span>never expires</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="hover:text-foreground transition-colors disabled:opacity-50"
                onClick={() => setConfirmRegenerate(true)}
                disabled={createOrRotate.isPending}
              >
                Regenerate
              </button>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="hover:text-destructive transition-colors disabled:opacity-50"
                onClick={() => revoke.mutate()}
                disabled={revoke.isPending}
              >
                Revoke
              </button>
            </div>
          </div>
        </>
      )}

      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate parent join link?</AlertDialogTitle>
            <AlertDialogDescription>
              The current link will stop working immediately. Anyone you've already shared it with won't be able to join — you'll need to send them the new link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRegenerate(false);
                createOrRotate.mutate({ rotate: true });
              }}
            >
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
