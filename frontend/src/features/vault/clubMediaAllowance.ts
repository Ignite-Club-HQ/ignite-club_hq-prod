import { CLUB_MEDIA_BYTES, mediaAllowance, type MediaSubscription } from "@/lib/subscriptionPlans";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

export const CLUB_MEDIA_BASE_BYTES = CLUB_MEDIA_BYTES;
type Client = SupabaseClient<Database>;
export type StoredClubMedia = { path: string; bucket: string; size: number };

function assertSupabaseMediaAllowancePath(): void {
  if (isFeatureRoutedToIcp("vault")) {
    throw new Error("Club storage must be checked through its Internet Computer photo store.");
  }
}

// Count physical objects, not gallery/vault mirrors or forwarded message URLs.
// Storage listing is paged and errors never masquerade as zero usage.
export async function listStoredClubMedia(clubId: string, client: Client = supabase): Promise<StoredClubMedia[]> {
  assertSupabaseMediaAllowancePath();
  const objects: StoredClubMedia[] = [];
  // Independent folders can be counted together. Never reuse a cached total:
  // that could admit an upload against stale capacity or another caller's access.
  const pending = ["photos", "chat-attachments", "competition-vault"].map(bucket => ({
    bucket, folder: `clubs/${clubId}`, offset: 0,
  }));
  const scanPage = async ({ bucket, folder, offset }: typeof pending[number]) => {
    const { data, error } = await client.storage.from(bucket).list(folder, {
      limit: 1000, offset, sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = `${folder}/${entry.name}`;
      if (!entry.id && !entry.metadata) pending.push({ bucket, folder: path, offset: 0 });
      else {
        const size = Number(entry.metadata?.size);
        if (!Number.isFinite(size) || size < 0) throw new Error("Could not check club storage. Please try again.");
        objects.push({ path, bucket, size });
      }
    }
    if (data && data.length === 1000) pending.push({ bucket, folder, offset: offset + 1000 });
  };
  // Bound network work on phones while eliminating one round trip per folder.
  while (pending.length) {
    await Promise.all(pending.splice(0, 6).map(scanPage));
  }
  return objects;
}

export function clubMediaLimit(purchasedGb: number): number {
  if (!Number.isFinite(purchasedGb) || purchasedGb < 0) throw new Error("Could not check storage allowance.");
  return CLUB_MEDIA_BASE_BYTES + purchasedGb * 1024 ** 3;
}

export function assertClubMediaFits(used: number, requested: number, purchasedGb: number): void {
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(requested) || requested < 0) {
    throw new Error("Could not check club storage. Please try again.");
  }
  if (used + requested > clubMediaLimit(purchasedGb)) {
    throw new Error("Your club has used all of its storage. Delete files or purchase more storage to keep uploading.");
  }
}

const uploads = new Map<string, Promise<unknown>>();

// Include SDK auth waits and body parsing, not just the network fetch. A timed
// out preparation never advances to the write, even if a late read completes.
async function boundedStorageCheck<T>(check: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + 60_000;
  let fail: (() => void) | undefined;
  const onVisible = () => { if (document.visibilityState === "visible" && Date.now() >= deadline) fail?.(); };
  const timeout = new Promise<never>((_resolve, reject) => {
    fail = () => reject(new Error("Couldn't finish checking storage. Check your connection and try attaching the file again."));
    timer = setTimeout(fail, 60_000);
  });
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  try { return await Promise.race([check(), timeout]); }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  }
}

type MeasuredUpload = { bucket: string; path: string; file: Blob; vault?: boolean };

/** App-side only: serialize same-device uploads through the check and write. */
export async function uploadWithinClubMediaAllowance<T>(
  clubId: string | null | undefined,
  bytes: number,
  upload: () => Promise<T>,
  client: Client = supabase,
  teamId?: string | null,
  measuredUpload?: MeasuredUpload,
): Promise<T> {
  assertSupabaseMediaAllowancePath();
  if (!clubId) return upload(); // Personal/competition-only chats have no club pot.
  const previous = uploads.get(clubId) ?? Promise.resolve();
  // A stalled earlier upload must not block every later attach on this device.
  const previousSettled = Promise.race([
    previous.catch(() => undefined),
    new Promise(resolve => setTimeout(resolve, 90_000)),
  ]);
  const current = previousSettled.then(async () => {
    assertSupabaseMediaAllowancePath();
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Could not check file size.");
    if (measuredUpload) {
      if (bytes !== measuredUpload.file.size) throw new Error("File size does not match the upload.");
      if (!measuredUpload.path.startsWith(`clubs/${clubId}/`) ||
          measuredUpload.path.split("/").some(part => !part || part === "." || part === "..") ||
          !["photos", "chat-attachments", "competition-vault"].includes(measuredUpload.bucket)) {
        throw new Error("Upload does not belong to this club's storage.");
      }
    }
    await boundedStorageCheck(async () => {
    // Start the club storage total alongside the plan read (club-wide uploads).
    const canRpc = typeof (client as { rpc?: unknown }).rpc === "function";
    const clubTotal = !teamId && canRpc
      ? Promise.resolve((client.rpc as any)("club_media_used_bytes", { _club_id: clubId })).catch((e: unknown) => ({ data: null, error: e }))
      : null;
    const baseColumns = "plan, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at, is_trial, trial_ends_at, storage_purchased_gb";
    let { data: sub, error } = await client.from("club_subscriptions")
      .select(`${baseColumns}, pricing_version`).eq("club_id", clubId).maybeSingle();
    // Older databases lack the optional pricing column; retry once without it
    // (missing pricing_version means legacy pricing). Other errors still stop the upload.
    if (error && (error as { code?: string }).code === "42703" && /pricing_version/.test(error.message ?? "")) {
      ({ data: sub, error } = await client.from("club_subscriptions")
        .select(baseColumns).eq("club_id", clubId).maybeSingle() as any);
    }
    if (error) throw error;
    let teamSub: MediaSubscription = null;
    if (teamId) {
      // Team checks run together instead of one after another.
      const [{ data: team, error: teamError }, { data, error: subscriptionError }] = await Promise.all([
        client.from("teams").select("club_id, deleted_at").eq("id", teamId).maybeSingle(),
        client.from("team_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at, is_trial, trial_ends_at")
          .eq("team_id", teamId).maybeSingle(),
      ]);
      if (teamError) throw teamError;
      if (team?.club_id !== clubId || team.deleted_at) throw new Error("Team does not belong to this club.");
      if (subscriptionError) throw subscriptionError;
      teamSub = data;
    }
    const allowance = mediaAllowance(sub, teamSub);
    // One server-side sum of the club's stored files; folder-by-folder listing is
    // kept only for team-scoped plans and databases without the sum function.
    let used: number | null = null;
    if (allowance.teamScoped && teamId && typeof (client as { rpc?: unknown }).rpc === "function") {
      const { data: rows, error: rowsError } = await (client.rpc as any)("club_media_storage_breakdown", { _club_id: clubId });
      if (!rowsError && Array.isArray(rows)) {
        used = rows.filter((row: { team_id: string | null }) => row.team_id === teamId)
          .reduce((sum: number, row: { bytes: number | string }) => sum + (Number(row.bytes) || 0), 0);
      } else if (rowsError && !["PGRST202", "42883"].includes((rowsError as { code?: string }).code ?? "")) throw rowsError;
    }
    if (used === null && !allowance.teamScoped && typeof (client as { rpc?: unknown }).rpc === "function") {
      const { data: total, error: totalError } = await (clubTotal ?? (client.rpc as any)("club_media_used_bytes", { _club_id: clubId }));
      if (!totalError && Number.isFinite(Number(total)) && Number(total) >= 0) used = Number(total);
      else if (totalError && !["PGRST202", "42883"].includes((totalError as { code?: string }).code ?? "")) throw totalError;
    }
    if (used === null) {
      const objects = await listStoredClubMedia(clubId, client);
      const scoped = allowance.teamScoped ? objects.filter(object => object.path.startsWith(`clubs/${clubId}/teams/${teamId}/`) || object.path.startsWith(`clubs/${clubId}/vault/teams/${teamId}/`)) : objects;
      used = scoped.reduce((sum, object) => sum + object.size, 0);
    }
    if (used + bytes > allowance.limitBytes) {
      throw new Error(allowance.premium ? "Your storage allowance is full. Delete files or purchase more storage to keep uploading." : "Your club has used its 250 MB Free storage. Delete files or upgrade to Pro to keep uploading.");
    }
    });
    assertSupabaseMediaAllowancePath();
    // Use the caller's authenticated Storage SDK client and original options.
    // Its environment selects DEV/PROD; Storage RLS still authorizes the write.
    // Receipt verification is not a media endpoint. Never retry a denied or
    // unknown Storage write through another service or elevated credentials.
    return upload();
  });
  uploads.set(clubId, current);
  try { return await current; }
  finally { if (uploads.get(clubId) === current) uploads.delete(clubId); }
}