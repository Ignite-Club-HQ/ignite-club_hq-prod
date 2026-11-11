import { writeOnce } from "@/live/clubScope";
import { withFeatureBackend } from "@/live/featureRouter";
import { tryUploadMediaToBlobStore } from "@/live/mediaUpload";
import { makeVaultFileToken } from "@/lib/chatVaultLinks";

/** Competition authority supplies the host; never borrow the viewer's club. */
export async function uploadIcpCompetitionChatDocument(file: File, competitionId: string): Promise<string> {
  if (!competitionId) throw new Error("Choose a competition before attaching a file");
  return withFeatureBackend("vault", {
    supabase: () => { throw new Error("File sharing could not connect to ICP. Please try again."); },
    icp: async ctx => {
      const [{ connectLiveCompetitionDomain }, { unwrapCandid }] = await Promise.all([
        import("@/live/domains"), import("@/live/features/candid"),
      ]);
      const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
      const access = await unwrapCandid(actor.get_vault_access(competitionId, ctx.identity.getPrincipal()), "Check competition file access");
      if (!access.is_member || !access.can_manage || !access.club_id) {
        throw new Error("Only competition organisers can upload competition files. Ask an organiser to share this file.");
      }
      const id = crypto.randomUUID();
      const extension = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
      const mime = file.type || "application/octet-stream";
      const uploaded = await tryUploadMediaToBlobStore({
        context: ctx, storagePath: `clubs/${access.club_id}/competitions/${competitionId}/chat/files/${id}.${extension}`,
        competitionId, file, mime, lock: "own",
      });
      if (!uploaded) throw new Error("File upload could not connect to ICP storage. Please try again.");
      const { registerLiveVaultFile } = await import("@/live/features/vault");
      await registerLiveVaultFile(ctx, id, "", access.club_id, null, file.name, uploaded.url, file.size, mime, false, uploaded.blobRef, null, competitionId);
      return makeVaultFileToken(id);
    },
  }, writeOnce({ competitionId }));
}

/** Register encrypted chat documents before exposing a shareable token. */
export async function uploadIcpChatDocument(file: File, clubId: string, teamId?: string): Promise<string> {
  if (!clubId) throw new Error("Choose a club before attaching a file");
  const id = crypto.randomUUID();
  const extension = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const mime = file.type || "application/octet-stream";
  return withFeatureBackend("vault", {
    supabase: () => { throw new Error("File sharing could not connect to ICP. Please try again."); },
    icp: async (ctx) => {
      const uploaded = await tryUploadMediaToBlobStore({
        context: ctx,
        storagePath: `clubs/${clubId}/chat/files/${id}.${extension}`,
        file,
        mime,
        lock: "own",
      });
      if (!uploaded) throw new Error("File upload could not connect to ICP storage. Please try again.");
      const { registerLiveVaultFile } = await import("@/live/features/vault");
      await registerLiveVaultFile(ctx, id, "", clubId, teamId ?? null, file.name, uploaded.url, file.size, mime, false, uploaded.blobRef);
      return makeVaultFileToken(id);
    },
  }, writeOnce({ clubId }));
}