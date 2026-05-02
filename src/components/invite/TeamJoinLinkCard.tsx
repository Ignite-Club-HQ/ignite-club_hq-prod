import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Copy, RefreshCw, Check, Link2, QrCode, Share2, AlertTriangle, Download } from "lucide-react";
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
const DEFAULT_EXPIRY_DAYS = 30;
const TOKEN_METADATA_KIND = "team_join_link";

type RoleVariant = "parent" | "player" | "coach" | "team_admin";

const ROLE_OPTIONS: { value: RoleVariant; label: string }[] = [
  { value: "parent", label: "Parent" },
  { value: "player", label: "Player" },
  { value: "coach", label: "Coach" },
  { value: "team_admin", label: "Admin" },
];

const ROLE_DESCRIPTIONS: Record<RoleVariant, string> = {
  parent: "One link anyone can tap to join as a parent. Great for WhatsApp groups or sign-up nights.",
  player: "Anyone with this link joins as a player. Best for senior squads and adult teams.",
  coach: "Anyone with this link joins as a coach with edit access. Share carefully.",
  team_admin: "Anyone with this link joins as a team admin with full access. Share carefully.",
};

const SENSITIVE_ROLES: RoleVariant[] = ["coach", "team_admin"];

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
  metadata: { kind?: string; role_variant?: RoleVariant } | null;
}

function generateShortToken(): string {
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
  const [activeRole, setActiveRole] = useState<RoleVariant>("parent");
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [autoSelected, setAutoSelected] = useState(false);

  const queryKey = ["team-join-links", teamId];

  // Load all persistent join links for this team from DB so admins
  // can reuse a previously generated link instead of regenerating.
  const { data: links, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_invites")
        .select("id, token, expires_at, uses_count, max_uses, created_at, metadata, role")
        .eq("team_id", teamId)
        .contains("metadata", { kind: TOKEN_METADATA_KIND })
        .order("created_at", { ascending: false });
      if (error) throw error;
      const map: Record<RoleVariant, JoinLinkRow | null> = {
        parent: null, player: null, coach: null, team_admin: null,
      };
      for (const row of (data ?? []) as any[]) {
        const role = (row.metadata?.role_variant ?? row.role) as RoleVariant;
        if (role && map[role] === null) map[role] = row as JoinLinkRow;
      }
      return map;
    },
    staleTime: 30_000,
  });

  // Auto-jump to a role that already has a link the first time we load,
  // so admins land on a usable link instead of an empty Generate state.
  if (!autoSelected && links) {
    const order: RoleVariant[] = ["parent", "player", "coach", "team_admin"];
    const existing = order.find((r) => links[r]);
    if (existing && existing !== activeRole) {
      setActiveRole(existing);
    }
    setAutoSelected(true);
  }

  const link = links[activeRole] ?? null;

  const createOrRotate = useMutation({
    mutationFn: async ({ rotate, role }: { rotate: boolean; role: RoleVariant }) => {
      if (!user) throw new Error("Not signed in");
      const existing = links?.[role];
      if (rotate && existing) {
        await supabase.from("team_invites").delete().eq("id", existing.id);
      }
      const token = generateShortToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + DEFAULT_EXPIRY_DAYS);
      const { data, error } = await supabase
        .from("team_invites")
        .insert({
          team_id: teamId,
          token,
          role,
          created_by: user.id,
          expires_at: expiresAt.toISOString(),
          max_uses: null,
          metadata: { kind: TOKEN_METADATA_KIND, role_variant: role },
        })
        .select("id, token, expires_at, uses_count, max_uses, created_at, metadata")
        .single();
      if (error) throw error;
      return { role, row: data as JoinLinkRow };
    },
    onSuccess: ({ role }) => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Join link ready", description: `Share it with anyone joining as ${ROLE_OPTIONS.find(r => r.value === role)?.label.toLowerCase()}.` });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't create link", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  const revoke = useMutation({
    mutationFn: async (role: RoleVariant) => {
      const existing = links?.[role];
      if (!existing) return role;
      const { error } = await supabase.from("team_invites").delete().eq("id", existing.id);
      if (error) throw error;
      return role;
    },
    onSuccess: (role) => {
      setSessionLinks((prev) => ({ ...prev, [role]: null }));
      toast({ title: "Link revoked", description: "The previous link no longer works." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't revoke", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  const fullUrl = useMemo(() => (link ? `${APP_URL}/join/${link.token}` : ""), [link]);
  const isSensitive = SENSITIVE_ROLES.includes(activeRole);
  const activeRoleLabel = ROLE_OPTIONS.find((r) => r.value === activeRole)?.label ?? "";

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
          text: `Tap to join ${teamName} as ${activeRoleLabel.toLowerCase()}:`,
          url: fullUrl,
          dialogTitle: "Share team join link",
        });
        return;
      } catch {/* cancelled */}
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${teamName}`, text: `Tap to join ${teamName} as ${activeRoleLabel.toLowerCase()}:`, url: fullUrl });
        return;
      } catch {/* cancelled */}
    }
    handleCopy();
  };

  const handleRoleChange = (role: RoleVariant) => {
    setActiveRole(role);
    setShowQR(false);
    setCopied(false);
  };

  const handleSaveQR = async (linkId: string) => {
    const container = document.getElementById(`qr-${linkId}`);
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
      ctx.fillText(`Join ${teamName}`, canvas.width / 2, size + pad + 38);
      const dataUrl = canvas.toDataURL("image/png");
      const filename = `join-${teamName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${activeRole}.png`;

      if (Capacitor.isNativePlatform()) {
        const base64 = dataUrl.split(",")[1];
        const written = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
        });
        await Share.share({ title: `Join ${teamName}`, url: written.uri, dialogTitle: "Share QR code" });
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
          <p className="text-sm font-semibold">Share a join link</p>
          <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[activeRole]}</p>
        </div>
      </div>

      {/* Role selector */}
      <div className="grid grid-cols-4 gap-1 rounded-md bg-background border border-border p-1">
        {ROLE_OPTIONS.map((opt) => {
          const has = !!links?.[opt.value];
          const isActive = activeRole === opt.value;
          const sensitive = SENSITIVE_ROLES.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleRoleChange(opt.value)}
              aria-label={`${opt.label} link — ${sensitive ? "sensitive, grants edit access" : "safe to share"}`}
              className={`relative px-2 py-1.5 text-xs rounded transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    sensitive ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  aria-hidden
                />
                {opt.label}
              </span>
              {has && (
                <span
                  className={`absolute top-1 right-1 h-1.5 w-1.5 rounded-full ring-1 ring-background ${
                    isActive ? "bg-primary-foreground" : "bg-sky-500"
                  }`}
                  aria-label="Active link"
                />
              )}
            </button>
          );
        })}
      </div>


      {isSensitive && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            {activeRoleLabel} links grant {activeRole === "team_admin" ? "full team admin" : "coach edit"} access. Only share with people you trust, and revoke when no longer needed.
          </span>
        </div>
      )}

      {isLoading && !links ? (
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
            onClick={() => {
              if (isSensitive) setConfirmGenerate(true);
              else createOrRotate.mutate({ rotate: false, role: activeRole });
            }}
          >
            {createOrRotate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            Generate {activeRoleLabel.toLowerCase()} link
          </Button>
          {isError && (
            <button
              type="button"
              onClick={() => refetch()}
              className="w-full text-[11px] text-muted-foreground underline"
            >
              Couldn't load existing links — tap to retry
            </button>
          )}
        </div>
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
                <div id={`qr-${link.id}`} className="bg-white p-3 rounded-md">
                  <QRCodeSVG value={fullUrl} size={180} level="M" includeMargin={false} />
                </div>
                <p className="text-[11px] text-muted-foreground">Point a camera at the code to join as {activeRoleLabel.toLowerCase()}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => handleSaveQR(link.id)}
                >
                  <Download className="h-3 w-3 mr-1" />
                  {Capacitor.isNativePlatform() ? "Share QR image" : "Download QR"}
                </Button>
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
                onClick={() => setConfirmRegenerate(true)}
                disabled={createOrRotate.isPending}
              >
                <RefreshCw className="h-3 w-3 inline mr-0.5" />
                Regenerate
              </button>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="underline hover:text-destructive transition-colors disabled:opacity-50"
                onClick={() => revoke.mutate(activeRole)}
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
            <AlertDialogTitle>Regenerate {activeRoleLabel.toLowerCase()} link?</AlertDialogTitle>
            <AlertDialogDescription>
              The current link will stop working immediately. Anyone you've already shared
              it with won't be able to join — you'll need to send them the new link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRegenerate(false);
                createOrRotate.mutate({ rotate: true, role: activeRole });
              }}
            >
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a {activeRoleLabel.toLowerCase()} join link?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone with this link can join {teamName} as a {activeRoleLabel.toLowerCase()} —
              that grants {activeRole === "team_admin" ? "full team admin" : "coach edit"} access.
              Only share it with people you trust, and revoke it when no longer needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                setConfirmGenerate(false);
                createOrRotate.mutate({ rotate: false, role: activeRole });
              }}
            >
              Yes, create link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
