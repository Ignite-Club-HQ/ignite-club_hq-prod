import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pin, Folder, FileText, ExternalLink, EyeOff, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { hapticSelectionTick } from "@/lib/haptics";
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

export function PinnedVaultBanner({ record, isAdmin = false }: PinnedVaultBannerProps) {
  const navigate = useNavigate();

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
    navigate(target.href);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 bg-primary/5 border-b border-primary/20 hover:bg-primary/10 active:bg-primary/15 transition-colors text-left"
      aria-label={`Open pinned vault: ${target.label}`}
    >
      <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center relative">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <Pin className="h-2.5 w-2.5 text-primary absolute -top-0.5 -right-0.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-primary uppercase tracking-wide">
            Pinned vault
          </span>
        </div>
        <p className="text-sm text-foreground truncate leading-tight mt-0.5">
          {target.label}
        </p>
        <p className="text-[11px] text-muted-foreground truncate leading-tight">
          {target.sublabel}
        </p>
      </div>
      <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
}
