import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Copy, RefreshCw, Check, Link2, QrCode, Share2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const APP_URL = "https://igniteclubhq.app";
const DEFAULT_EXPIRY_DAYS = 30;
const TOKEN_METADATA_KIND = "team_join_link";

interface TeamJoinLinkCardProps {
  teamId: string;
  teamName: string;
}

interface JoinLinkRow {
  id: string;
  token: string;
  expires_at: string | null;
  uses_count: number;
  max_uses: number | null;
  created_at: string;
}

function generateShortToken(): string {
  // 16 url-safe chars
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export default function TeamJoinLinkCard({ teamId, teamName }: TeamJoinLinkCardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const queryKey = ["team-join-link", teamId];

  const { data: link, isLoading } = useQuery({
    queryKey,
    enabled: !!teamId,
    staleTime: 60_000,
    queryFn: async (): Promise<JoinLinkRow | null> => {
      const { data, error } = await supabase
        .from("team_invites")
        .select("id, token, expires_at, uses_count, max_uses, created_at, metadata")
        .eq("team_id", teamId)
        .contains("metadata", { kind: TOKEN_METADATA_KIND })
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = data?.[0];
      if (!row) return null;
      // Treat expired or revoked rows as nonexistent
      if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
      return row as JoinLinkRow;
    },
  });

  const createOrRotate = useMutation({
    mutationFn: async (rotate: boolean) => {
      if (!user) throw new Error("Not signed in");
      // Revoke prior link by setting expires_at = now() (delete is fine too)
      if (rotate && link) {
        await supabase.from("team_invites").delete().eq("id", link.id);
      }
      const token = generateShortToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + DEFAULT_EXPIRY_DAYS);
      const { data, error } = await supabase
        .from("team_invites")
        .insert({
          team_id: teamId,
          token,
          role: "parent",
          created_by: user.id,
          expires_at: expiresAt.toISOString(),
          max_uses: null,
          metadata: { kind: TOKEN_METADATA_KIND },
        })
        .select("id, token, expires_at, uses_count, max_uses, created_at")
        .single();
      if (error) throw error;
      return data as JoinLinkRow;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(queryKey, row);
      toast({ title: "Join link ready", description: "Share it with anyone joining the team." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't create link", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  const revoke = useMutation({
    mutationFn: async () => {
      if (!link) return;
      const { error } = await supabase.from("team_invites").delete().eq("id", link.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKey, null);
      toast({ title: "Link revoked", description: "The previous link no longer works." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't revoke", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  const fullUrl = useMemo(() => (link ? `${APP_URL}/join/${link.token}` : ""), [link]);

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
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({
          title: `Join ${teamName} on Ignite`,
          text: `Tap to join ${teamName}:`,
          url: fullUrl,
          dialogTitle: "Share team join link",
        });
        return;
      } catch {
        // user cancelled or unsupported — fall through
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${teamName}`, text: `Tap to join ${teamName}:`, url: fullUrl });
        return;
      } catch {/* cancelled */}
    }
    handleCopy();
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Link2 className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Share a join link</p>
          <p className="text-xs text-muted-foreground">
            One link anyone can tap to join as a parent. Great for WhatsApp groups or sign-up nights.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : !link ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full"
          disabled={createOrRotate.isPending}
          onClick={() => createOrRotate.mutate(false)}
        >
          {createOrRotate.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Link2 className="h-4 w-4 mr-2" />
          )}
          Generate join link
        </Button>
      ) : (
        <>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
            <span className="text-xs font-mono truncate flex-1 min-w-0">{fullUrl}</span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={handleCopy}
              aria-label="Copy link"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="default" className="flex-1 min-w-[7rem]" onClick={handleShare}>
              <Share2 className="h-3.5 w-3.5 mr-1.5" />
              Share
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1 min-w-[7rem]"
              onClick={() => setShowQR((v) => !v)}
            >
              <QrCode className="h-3.5 w-3.5 mr-1.5" />
              {showQR ? "Hide QR" : "Show QR"}
            </Button>
          </div>

          <Collapsible open={showQR}>
            <CollapsibleContent>
              <div className="flex flex-col items-center gap-2 py-3 bg-background rounded-md border border-border">
                <div className="bg-white p-3 rounded-md">
                  <QRCodeSVG value={fullUrl} size={180} level="M" includeMargin={false} />
                </div>
                <p className="text-[11px] text-muted-foreground">Point a camera at the code to join</p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
            <span>
              {link.uses_count} {link.uses_count === 1 ? "join" : "joins"} · expires{" "}
              {link.expires_at ? new Date(link.expires_at).toLocaleDateString() : "never"}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="underline hover:text-foreground transition-colors disabled:opacity-50"
                onClick={() => createOrRotate.mutate(true)}
                disabled={createOrRotate.isPending}
              >
                <RefreshCw className="h-3 w-3 inline mr-0.5" />
                Regenerate
              </button>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="underline hover:text-destructive transition-colors disabled:opacity-50"
                onClick={() => revoke.mutate()}
                disabled={revoke.isPending}
              >
                Revoke
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
