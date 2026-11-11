import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Folder, ChevronLeft, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { fetchVaultItems, fetchVaultSubfolders } from "@/features/vault/vaultReadRepository";
import type { VaultFolderView } from "@/features/vault/types";
import type { VaultPickerItem } from "./VaultPickerSheet";

/** Host club comes from competition authority, never the viewer's club. */
async function resolveCompetitionHost(competitionId: string): Promise<string | null> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { data } = await supabase.from("competitions").select("organizer_club_id").eq("id", competitionId).maybeSingle();
      return (data?.organizer_club_id as string | null) ?? null;
    },
    icp: async ctx => {
      const [{ connectLiveCompetitionDomain }, { unwrapCandid }] = await Promise.all([
        import("@/live/domains"), import("@/live/features/candid"),
      ]);
      const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
      const access = await unwrapCandid(actor.get_vault_access(competitionId, ctx.identity.getPrincipal()), "Check competition file access");
      return access.is_member && access.club_id ? access.club_id : null;
    },
  }, { competitionId });
}

export function CompetitionVaultPickerSheet({ open, onOpenChange, competitionId, onPick }: {
  open: boolean; onOpenChange: (open: boolean) => void; competitionId: string; onPick: (item: VaultPickerItem) => void;
}) {
  const [stack, setStack] = useState<{ id: string; name: string }[]>([]);
  const current = stack[stack.length - 1];
  const host = useQuery({ queryKey: ["competition-vault-host", competitionId], queryFn: () => resolveCompetitionHost(competitionId), enabled: open });
  const view: VaultFolderView | null = host.data ? {
    type: "competition", clubId: host.data, clubName: "", competitionId, competitionName: "",
    folderId: current?.id, folderName: current?.name,
  } : null;
  const contents = useQuery({
    queryKey: ["competition-vault-picker", competitionId, host.data, current?.id ?? null],
    enabled: open && !!view,
    queryFn: async () => {
      const [folders, files] = await Promise.all([
        fetchVaultSubfolders({ view: view!, isAppAdmin: false, isClubAdmin: true, isCoachOrTeamAdmin: false, clubRoles: new Set() }),
        fetchVaultItems({ view: view!, isClubAdmin: true, isCoachOrTeamAdmin: false }),
      ]);
      return { folders, files };
    },
  });
  const loading = host.isLoading || contents.isLoading;
  const empty = !loading && (!host.data || ((contents.data?.folders.length ?? 0) + (contents.data?.files.length ?? 0) === 0));
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) setStack([]); onOpenChange(o); }}>
      <SheetContent side="bottom" className="p-0 rounded-t-3xl border-t border-border max-h-[80dvh] flex flex-col">
        <SheetHeader className="px-5 pt-4 pb-3 flex-row items-center gap-2 space-y-0">
          {current && (
            <button type="button" aria-label="Back" onClick={() => setStack(s => s.slice(0, -1))} className="p-1 -ml-1 rounded-full hover:bg-muted">
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <SheetTitle className="text-left text-[17px] font-semibold truncate">{current?.name ?? "Competition Vault"}</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto px-3 pb-6 flex-1">
          {loading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {host.isError || contents.isError ? <p className="text-sm text-muted-foreground text-center py-8">Couldn't open the competition Vault. Please try again.</p>
            : empty && <p className="text-sm text-muted-foreground text-center py-8">{host.data === null ? "You don't have access to this competition's Vault." : "No files here yet."}</p>}
          {current && (
            <button type="button" onClick={() => onPick({ kind: "folder", id: current.id, name: current.name })}
              className="w-full mb-2 rounded-xl border border-border px-4 py-3 text-sm font-medium text-primary hover:bg-muted">
              Share this whole folder
            </button>
          )}
          {contents.data?.folders.map(f => (
            <button key={f.id} type="button" onClick={() => setStack(s => [...s, { id: f.id, name: f.name }])}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-muted text-left">
              <Folder className="h-5 w-5 text-primary shrink-0" /><span className="truncate text-sm">{f.name}</span>
            </button>
          ))}
          {contents.data?.files.map(f => (
            <button key={f.id} type="button" onClick={() => onPick({ kind: "file", id: f.id, name: f.name })}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-muted text-left">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" /><span className="truncate text-sm">{f.name}</span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
