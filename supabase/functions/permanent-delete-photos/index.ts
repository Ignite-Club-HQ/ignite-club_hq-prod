// Permanent deletion of Vault photos / files.
//
// Security model:
//  - Caller identity comes ONLY from a verified bearer token.
//  - Authorization is decided server-side, per record, by
//    `public.authorize_vault_deletion`, which resolves the record's effective
//    club through its own club_id / team / mini-league relationships. Client
//    supplied club/team/league ids, roles and storage paths are never trusted.
//  - Every deletion runs through a durable job ledger so a failure between
//    storage removal and metadata removal is recoverable and retryable.
//  - Responses expose stable public codes only; raw DB/storage errors stay in logs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseVaultDeleteRequest,
  resolveStorageRef,
} from "../_shared/vaultDeleteRequest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "X-Content-Type-Options": "nosniff",
};

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const MAX_BODY_BYTES = 64 * 1024;

type ItemKind = "photo" | "file";

interface ItemResult {
  id: string;
  kind: ItemKind;
  code: string;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // --- Authentication -----------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { success: false, error: "unauthorized" });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return json(401, { success: false, error: "unauthorized" });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authError } = await userClient.auth.getUser(token);
    const user = userData?.user;
    if (authError || !user) {
      return json(401, { success: false, error: "unauthorized" });
    }

    // --- Request validation (before any privileged query) -------------------
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return json(413, { success: false, error: "invalid_request" });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return json(400, { success: false, error: "invalid_request", message: "Malformed JSON body" });
    }

    const parsed = parseVaultDeleteRequest(parsedBody);
    if (!parsed.ok) {
      return json(400, { success: false, error: parsed.code, message: parsed.message });
    }
    const { photoIds, fileIds, deletionType } = parsed.value;

    const admin = createClient(supabaseUrl, serviceKey);

    const succeeded: ItemResult[] = [];
    const failed: ItemResult[] = [];
    let storageDeleted = 0;

    const items: Array<{ id: string; kind: ItemKind }> = [
      ...photoIds.map((id) => ({ id, kind: "photo" as const })),
      ...fileIds.map((id) => ({ id, kind: "file" as const })),
    ];

    for (const item of items) {
      // 1. Per-item authorization — never batch-authorize.
      const { data: authRows, error: authRpcError } = await admin.rpc(
        "authorize_vault_deletion",
        { _caller_id: user.id, _kind: item.kind, _record_id: item.id },
      );

      if (authRpcError) {
        console.error(`[permanent-delete] authorize failed ${item.kind}:${item.id}`);
        failed.push({ ...item, code: "unexpected_error" });
        continue;
      }

      const auth = Array.isArray(authRows) ? authRows[0] : authRows;
      if (!auth?.authorized) {
        const reason = auth?.reason;
        const code =
          reason === "not_found"
            ? "not_found"
            : reason === "scope_conflict" || reason === "no_scope" ||
                reason === "unresolvable_team_scope" || reason === "unresolvable_league_scope"
            ? "forbidden"
            : "forbidden";
        console.warn(`[permanent-delete] denied ${item.kind}:${item.id} reason=${reason}`);
        failed.push({ ...item, code });
        continue;
      }

      // 2. Canonical storage location — resolved from stored metadata or a
      //    strictly-validated URL, never from the request body.
      const ref = resolveStorageRef(
        {
          storage_bucket: auth.storage_bucket ?? null,
          storage_path: auth.storage_path ?? null,
          url: (auth.file_url ?? auth.image_url) ?? null,
        },
        supabaseUrl,
      );

      // 3. Durable job + audit record, atomically.
      const { data: jobRows, error: jobError } = await admin.rpc("begin_vault_deletion", {
        _caller_id: user.id,
        _kind: item.kind,
        _record_id: item.id,
        _bucket: ref?.bucket ?? null,
        _object_path: ref?.path ?? null,
        _deletion_type: deletionType,
      });

      if (jobError) {
        console.error(`[permanent-delete] audit/job failed ${item.kind}:${item.id}`);
        failed.push({ ...item, code: "audit_failed" });
        continue;
      }

      const job = Array.isArray(jobRows) ? jobRows[0] : jobRows;
      const jobId = job?.job_id as string | undefined;
      if (!jobId) {
        failed.push({ ...item, code: "audit_failed" });
        continue;
      }

      // 4. Storage removal (idempotent: a missing object is not an error).
      if (ref) {
        const { error: storageError } = await admin.storage.from(ref.bucket).remove([ref.path]);
        if (storageError) {
          console.error(`[permanent-delete] storage delete failed ${item.kind}:${item.id}`);
          await admin.rpc("fail_vault_deletion", {
            _job_id: jobId,
            _error_code: "storage_delete_failed",
          });
          failed.push({ ...item, code: "storage_delete_failed" });
          continue; // metadata intentionally retained
        }
        storageDeleted++;
      }

      // 5. Metadata removal only after storage succeeded.
      const { error: finalizeError } = await admin.rpc("finalize_vault_deletion", {
        _job_id: jobId,
      });
      if (finalizeError) {
        console.error(`[permanent-delete] metadata delete failed ${item.kind}:${item.id}`);
        await admin.rpc("fail_vault_deletion", {
          _job_id: jobId,
          _error_code: "metadata_delete_failed",
        });
        failed.push({ ...item, code: "metadata_delete_failed" });
        continue;
      }

      succeeded.push({ ...item, code: "deleted" });
    }

    const photosDeleted = succeeded.filter((i) => i.kind === "photo").length;
    const filesDeleted = succeeded.filter((i) => i.kind === "file").length;

    console.log(
      `[permanent-delete] caller=${user.id} ok=${succeeded.length} failed=${failed.length} storage=${storageDeleted}`,
    );

    const body = {
      success: failed.length === 0,
      photosDeleted,
      filesDeleted,
      storageDeleted,
      succeeded: succeeded.map((i) => ({ id: i.id, kind: i.kind })),
      failed: failed.map((i) => ({ id: i.id, kind: i.kind, code: i.code })),
    };

    return json(failed.length === 0 ? 200 : 207, body);
  } catch (error) {
    console.error("[permanent-delete] unexpected error:", error instanceof Error ? error.message : "unknown");
    return json(500, { success: false, error: "unexpected_error" });
  }
});
