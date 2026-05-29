import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pin, Folder, FileText, ExternalLink, EyeOff, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { hapticSelectionTick } from "@/lib/haptics";
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
import type { PinnedVaultRecord } from "@/hooks/useChatPinnedVault";


interface PinnedVaultBannerProps {
  record: PinnedVaultRecord | null;
  /** When admin and disabled, render a subtle "hidden" hint so they can re-enable from the menu. */
  isAdmin?: boolean;
  /** When provided, render an ✕ button on the banner to remove the pin. Caller decides who can unpin. */
  onUnpin?: () => void;
}

interface ResolvedTarget {
  label: string;
  sublabel: string;
  href: string;
  icon: "folder" | "file" | "root";
}

async function resolveTarget(record: PinnedVaultRecord): Promise<ResolvedTarget | null> {
  if (record.vault_file_id) {
    const { data } = await supabase
      .from("vault_files")
      .select("id, name, is_external_link")
      .eq("id", record.vault_file_id)
      .maybeSingle();
    if (!data) return null;
    return {
      label: data.name ?? "Vault file",
      sublabel: data.is_external_link ? "External link" : "Vault file",
      href: `/vault?file=${data.id}`,
      icon: "file",
    };
  }
  if (record.vault_folder_id) {
    const { data } = await supabase
      .from("vault_folders")
      .select("id, name")
      .eq("id", record.vault_folder_id)
      .maybeSingle();
    if (!data) return null;
    return {
      label: data.name ?? "Vault folder",
      sublabel: "Vault folder",
      href: `/vault/folder/${data.id}`,
      icon: "folder",
    };
  }
  if (record.root_scope && record.root_id) {
    if (record.root_scope === "team") {
      const { data } = await supabase
        .from("teams")
        .select("id, name")
        .eq("id", record.root_id)
        .maybeSingle();
      if (!data) return null;
      return {
        label: data.name ?? "Team vault",
        sublabel: "Team vault · All files & folders",
        href: `/vault?team=${data.id}`,
        icon: "root",
      };
    }
    const { data } = await supabase
      .from("clubs")
      .select("id, name")
      .eq("id", record.root_id)
      .maybeSingle();
    if (!data) return null;
    return {
      label: data.name ?? "Club vault",
      sublabel: "Club vault · All files & folders",
      href: `/vault?club=${data.id}`,
      icon: "root",
    };
  }
  return null;
}

export function PinnedVaultBanner({ record, isAdmin = false, onUnpin }: PinnedVaultBannerProps) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);


  const cacheKey = useMemo(() => {
    if (!record) return "none";
    return [
      record.id,
      record.vault_file_id ?? "",
      record.vault_folder_id ?? "",
      record.root_scope ?? "",
      record.root_id ?? "",
    ].join("|");
  }, [record]);

  const { data: target } = useQuery({
    queryKey: ["chat-pinned-vault-target", cacheKey],
    enabled: !!record,
    queryFn: () => (record ? resolveTarget(record) : null),
    staleTime: 60 * 1000,
  });

  if (!record) return null;

  // Disabled: show a tiny chip for admins so they can re-enable; nothing for members
  if (!record.enabled) {
    if (!isAdmin) return null;
    return (
      <div className="w-full flex items-center gap-2 px-4 py-1.5 bg-muted/40 border-b border-border text-[11px] text-muted-foreground">
        <EyeOff className="h-3 w-3" />
        Pinned vault hidden — re-enable from the chat menu
      </div>
    );
  }

  if (!target) return null;

  const Icon = target.icon === "folder" || target.icon === "root" ? Folder : FileText;

  const handleClick = () => {
    hapticSelectionTick();
    navigate(target.href, { state: { fromChat: true } });
  };

  return (
    <>
    <div className="w-full px-2 pt-2 pb-1">
      <div className="flex items-center gap-2.5 rounded-2xl bg-card border border-border/60 shadow-[0_1px_2px_0_hsl(var(--foreground)/0.04)] px-2.5 py-2">
        <button
          type="button"
          onClick={handleClick}
          className="flex-1 min-w-0 flex items-center gap-2.5 rounded-xl hover:bg-muted/60 active:bg-muted transition-colors text-left -mx-1 px-1 py-0.5"
          aria-label={`Open pinned vault: ${target.label}`}
        >
          <div className="flex-shrink-0 h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center relative">
            <Icon className="h-[18px] w-[18px] text-primary" strokeWidth={2.2} />
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary flex items-center justify-center ring-2 ring-card">
              <Pin className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={2.5} />
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.06em] leading-none">
              {target.icon === "file" ? "Pinned file" : target.icon === "folder" ? "Pinned folder" : "Pinned vault"}
            </p>
            <p className="text-[14px] font-semibold text-foreground truncate leading-tight mt-1">
              {target.label}
            </p>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground/70 flex-shrink-0" />
        </button>
        {onUnpin && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              hapticSelectionTick();
              setConfirmOpen(true);
            }}
            className="flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Unpin vault"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>

    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove pinned vault?</AlertDialogTitle>
          <AlertDialogDescription>
            This will unpin "{target?.label ?? "this vault"}" from the chat for everyone. You can pin it again from the chat menu.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => { onUnpin?.(); setConfirmOpen(false); }}>
            Unpin
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>

  );
}
