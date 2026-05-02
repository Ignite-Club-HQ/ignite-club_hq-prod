import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Copy, RefreshCw, Check, Link2, QrCode, Share2, AlertTriangle } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
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

  const queryKey = ["team-join-links", teamId];

  // Load all role-variant links for this team in one query
  const { data: links, isLoading } = useQuery({
    queryKey,
    enabled: !!teamId,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<RoleVariant, JoinLinkRow | null>> => {
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
      for (const row of data ?? []) {
        const meta = (row.metadata ?? {}) as { kind?: string; role_variant?: RoleVariant };
        // Fall back to row.role for legacy rows that didn't store role_variant in metadata
        const variant = (meta.role_variant ?? (row.role as RoleVariant)) as RoleVariant;
        if (!ROLE_OPTIONS.some((o) => o.value === variant)) continue;
        if (map[variant]) continue; // keep newest only
        if (row.expires_at && new Date(row.expires_at) < new Date()) continue;
        map[variant] = { ...(row as any), metadata: meta };
      }
      return map;
    },
  });

  const link = links?.[activeRole] ?? null;

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
    onSuccess: ({ role, row }) => {
      queryClient.setQueryData<Record<RoleVariant, JoinLinkRow | null>>(queryKey, (prev) => ({
        parent: null, player: null, coach: null, team_admin: null,
        ...(prev ?? {}),
        [role]: row,
      }));
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
      queryClient.setQueryData<Record<RoleVariant, JoinLinkRow | null>>(queryKey, (prev) => ({
        parent: null, player: null, coach: null, team_admin: null,
        ...(prev ?? {}),
        [role]: null,
      }));
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
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleRoleChange(opt.value)}
              className={`relative px-2 py-1.5 text-xs rounded transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
              {has && (
                <span
                  className={`absolute top-1 right-1 h-1.5 w-1.5 rounded-full ${
                    isActive ? "bg-primary-foreground" : "bg-emerald-500"
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
          onClick={() => createOrRotate.mutate({ rotate: false, role: activeRole })}
        >
          {createOrRotate.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Link2 className="h-4 w-4 mr-2" />
          )}
          Generate {activeRoleLabel.toLowerCase()} link
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
                <p className="text-[11px] text-muted-foreground">Point a camera at the code to join as {activeRoleLabel.toLowerCase()}</p>
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
                onClick={() => createOrRotate.mutate({ rotate: true, role: activeRole })}
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
    </div>
  );
}
