import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => false }));
import { uploadWithinClubMediaAllowance } from "./clubMediaAllowance";

// No hosted calls: exercise the real Storage SDK against intercepted transport.
const club = "11111111-1111-4111-8111-111111111111";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("Environment-scoped photo and file transport", () => {
  for (const project of ["ecsdwrarzfexssxtrymj", "yabcfiuntwqjwvschnji"]) {
    for (const [bucket, name, mime] of [["photos", "photo.png", "image/png"], ["photos", "document.pdf", "application/pdf"], ["chat-attachments", "attachment.pdf", "application/pdf"], ["competition-vault", "official.pdf", "application/pdf"]]) {
      it(`sends ${name} to ${project} Storage, never purchase verification`, async () => {
        const path = `clubs/${club}/${name}`;
        const transport = vi.fn(async () => new Response(JSON.stringify({ Key: `${bucket}/${path}`, Id: "uploaded" }), { status: 200, headers: { "content-type": "application/json" } }));
        const client = createClient<Database>(`https://${project}.supabase.co`, "synthetic-public-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { is_pro: true, pricing_version: "usd_v2", storage_purchased_gb: 0 }, error: null }) };
        vi.spyOn(client, "from").mockReturnValue(query as never);
        const storageFrom = client.storage.from.bind(client.storage);
        vi.spyOn(client.storage, "from").mockImplementation(bucketName => {
          const storage = storageFrom(bucketName);
          vi.spyOn(storage, "list").mockResolvedValue({ data: [], error: null });
          return storage;
        });
        const unrelatedFetch = vi.fn(async () => { throw new Error("Purchase-receipt upload path invoked"); });
        vi.stubGlobal("fetch", unrelatedFetch);
        const file = new Blob(["actual-file-bytes"], { type: mime });
        const result = await uploadWithinClubMediaAllowance(club, file.size, () => client.storage.from(bucket).upload(path, file, { contentType: mime, upsert: false }), client, null, { bucket, path, file });
        expect(result.error).toBeNull();
        expect(result.data?.path).toBe(path);
        expect(transport).toHaveBeenCalledTimes(1);
        const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(`https://${project}.supabase.co/storage/v1/object/${bucket}/${path}`);
        expect(options.method).toBe("POST");
        expect((options.body as FormData).get("")).toBe(file);
        expect(unrelatedFetch).not.toHaveBeenCalled();
      });
    }
  }
});