import { expect, test, type Page, type Route } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000701";
const clubId = "00000000-0000-4000-8000-000000000702";
const reservationId = "00000000-0000-4000-8000-000000000703";
const localApi = "http://127.0.0.1:54321";

const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "synthetic.vault.admin@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

type VaultScenario = {
  quotaError?: boolean;
  metadataError?: boolean;
  deletionError?: boolean;
  role?: "club_admin" | "coach";
  initialFile?: "active" | "deleted";
};

type VaultTrace = {
  steps: string[];
  uploadedPaths: string[];
  removedPaths: string[];
  insertedRows: Record<string, unknown>[];
  settlements: Array<{ reservationId: string; committed: boolean }>;
  deletionBodies: Record<string, unknown>[];
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installSession(page: Page) {
  await page.addInitScript(({ syntheticUser, syntheticUserId }) => {
    const encode = (value: object) => btoa(JSON.stringify(value)).replaceAll("=", "");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
      sub: syntheticUserId,
      role: "authenticated",
      exp: 4_102_444_800,
    })}.synthetic`;
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: token,
      refresh_token: "synthetic-refresh",
      expires_at: 4_102_444_800,
      expires_in: 3600,
      token_type: "bearer",
      user: syntheticUser,
    }));
    localStorage.setItem("ios-install-prompt-dismissed", Date.now().toString());
  }, { syntheticUser: user, syntheticUserId: userId });
}

async function installVaultBackend(page: Page, scenario: VaultScenario = {}): Promise<VaultTrace> {
  const trace: VaultTrace = {
    steps: [],
    uploadedPaths: [],
    removedPaths: [],
    insertedRows: [],
    settlements: [],
    deletionBodies: [],
  };
  const syntheticExistingFile = {
    id: "00000000-0000-4000-8000-000000000705",
    club_id: clubId,
    team_id: null,
    folder_id: null,
    uploaded_by: "00000000-0000-4000-8000-000000000799",
    name: "Synthetic safety policy",
    file_url: `${localApi}/storage/v1/object/public/photos/${clubId}/safety-policy.pdf`,
    file_type: "application/pdf",
    file_size: 2048,
    created_at: "2026-07-01T00:00:00Z",
    deleted_at: scenario.initialFile === "deleted" ? "2026-07-26T00:00:00Z" : null,
    deleted_by: scenario.initialFile === "deleted" ? userId : null,
    team: null,
    folder: null,
  };
  let vaultRows: Record<string, unknown>[] = scenario.initialFile ? [syntheticExistingFile] : [];

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      await route.abort("blockedbyclient");
      return;
    }
    if (url.origin !== localApi) {
      await route.continue();
      return;
    }

    if (url.pathname === "/auth/v1/user") return json(route, user);

    if (url.pathname === "/rest/v1/user_roles") {
      if (url.searchParams.get("role") === "eq.app_admin") return json(route, null);
      if (url.searchParams.get("select") === "club_id,team_id") {
        return json(route, [{ club_id: clubId, team_id: null }]);
      }
      return json(route, [{
        role: scenario.role ?? "club_admin",
        club_id: clubId,
        team_id: null,
        user_id: userId,
      }]);
    }

    if (url.pathname === "/rest/v1/clubs") {
      return json(route, [{
        id: clubId,
        name: "Synthetic Vault FC",
        is_pro: true,
        storage_used_bytes: 0,
      }]);
    }
    if (url.pathname === "/rest/v1/club_subscriptions") {
      const subscription = {
        club_id: clubId,
        is_pro: true,
        is_pro_football: false,
        admin_pro_override: false,
        admin_pro_football_override: false,
        storage_purchased_gb: 0,
        expires_at: null,
      };
      const singular = request.headers()["accept"]?.includes("application/vnd.pgrst.object");
      return json(route, singular ? subscription : [subscription]);
    }

    if (url.pathname === "/rest/v1/rpc/reserve_vault_storage") {
      trace.steps.push("reserve");
      if (scenario.quotaError) {
        return json(route, { code: "53100", message: "quota_exceeded" }, 400);
      }
      return json(route, [{ reservation_id: reservationId, limit_bytes: 5_368_709_120, used_bytes: 0 }]);
    }
    if (url.pathname === "/rest/v1/rpc/settle_vault_storage") {
      const body = request.postDataJSON() as { _reservation_id: string; _committed: boolean };
      trace.steps.push(body._committed ? "settle:committed" : "settle:released");
      trace.settlements.push({ reservationId: body._reservation_id, committed: body._committed });
      return json(route, body._committed ? "committed" : "released");
    }

    if (url.pathname.startsWith("/storage/v1/object/photos")) {
      if (request.method() === "POST") {
        const path = decodeURIComponent(url.pathname.slice("/storage/v1/object/photos/".length));
        trace.steps.push("upload-bytes");
        trace.uploadedPaths.push(path);
        return json(route, { Key: `photos/${path}` });
      }
      if (request.method() === "DELETE") {
        trace.steps.push("remove-orphan");
        const body = request.postDataJSON() as { prefixes?: string[] };
        trace.removedPaths.push(...(body.prefixes ?? []));
        return json(route, []);
      }
    }

    if (url.pathname === "/rest/v1/vault_files") {
      if (request.method() === "POST") {
        trace.steps.push("insert-metadata");
        const body = request.postDataJSON() as Record<string, unknown>;
        trace.insertedRows.push(body);
        if (scenario.metadataError) {
          return json(route, { code: "23514", message: "synthetic metadata rejection" }, 400);
        }
        vaultRows = [{
          id: "00000000-0000-4000-8000-000000000704",
          deleted_at: null,
          created_at: "2026-07-27T00:00:00Z",
          ...body,
        }];
        return json(route, []);
      }
      const asksForTrash = url.searchParams.get("deleted_at") === "not.is.null";
      const visibleRows = vaultRows.filter((row) => asksForTrash ? row.deleted_at : !row.deleted_at);
      return json(route, visibleRows);
    }

    if (url.pathname === "/rest/v1/profiles") {
      return json(route, [{ id: userId, display_name: "Synthetic Vault Admin" }]);
    }
    if (url.pathname.startsWith("/rest/v1/")) return json(route, []);
    if (url.pathname === "/functions/v1/permanent-delete-photos") {
      trace.steps.push("permanent-delete");
      trace.deletionBodies.push(request.postDataJSON() as Record<string, unknown>);
      if (scenario.deletionError) {
        return json(route, { message: "synthetic storage deletion failure" }, 500);
      }
      vaultRows = [];
      return json(route, { photosDeleted: 0, filesDeleted: 1, failed: [] });
    }
    if (url.pathname.startsWith("/functions/v1/")) return json(route, {});
    return json(route, {});
  });

  return trace;
}

async function openTrash(page: Page) {
  const more = page.locator('button:has(svg.lucide-ellipsis-vertical)').last();
  await expect(more).toBeVisible();
  await more.click();
  await page.getByRole("menuitem", { name: "View Trash" }).click();
  await expect(page.getByText("Items in trash are automatically deleted after 30 days.")).toBeVisible();
}

async function openClubVault(page: Page, options: { expectUpload?: boolean } = {}) {
  await page.goto("/vault");
  await expect(page.getByRole("heading", { name: "Vault" })).toBeVisible({ timeout: 12_000 });
  await page.getByLabel("Main content").getByText("Synthetic Vault FC", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic Vault FC" })).toBeVisible();
  if (options.expectUpload ?? true) {
    await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
  }
}

async function chooseDocument(page: Page, name = "synthetic-plan.pdf") {
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Upload to Synthetic Vault FC/i });
  await dialog.getByRole("button", { name: "File", exact: true }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from("synthetic local vault document"),
  });
  await expect(dialog.getByRole("paragraph").filter({ hasText: name })).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await installSession(page);
});

test("Vault upload reserves quota before bytes and commits only after metadata is durable", async ({ page }) => {
  const trace = await installVaultBackend(page);
  await openClubVault(page);
  const dialog = await chooseDocument(page);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();

  await expect(page.getByText("synthetic-plan", { exact: true })).toBeVisible();
  await expect.poll(() => trace.steps).toEqual([
    "reserve",
    "upload-bytes",
    "insert-metadata",
    "settle:committed",
  ]);
  expect(trace.insertedRows[0]).toMatchObject({
    club_id: clubId,
    uploaded_by: userId,
    name: "synthetic-plan",
    storage_bucket: "photos",
  });
  expect(trace.insertedRows[0].storage_path).toBe(trace.uploadedPaths[0]);
  expect(trace.settlements).toEqual([{ reservationId, committed: true }]);
  expect(trace.removedPaths).toEqual([]);
});

test("Vault quota rejection is visible and prevents both byte upload and metadata creation", async ({ page }) => {
  const trace = await installVaultBackend(page, { quotaError: true });
  await openClubVault(page);
  const dialog = await chooseDocument(page, "too-large.pdf");
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();

  await expect(page.getByText(/Storage limit reached/i)).toBeVisible();
  expect(trace.steps).toEqual(["reserve"]);
  expect(trace.uploadedPaths).toEqual([]);
  expect(trace.insertedRows).toEqual([]);
  expect(trace.settlements).toEqual([]);
});

test("Vault metadata rejection removes orphaned bytes and releases the reservation", async ({ page }) => {
  const trace = await installVaultBackend(page, { metadataError: true });
  await openClubVault(page);
  const dialog = await chooseDocument(page, "metadata-fails.pdf");
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();

  await expect(page.getByText(/synthetic metadata rejection/i)).toBeVisible();
  await expect.poll(() => trace.steps).toEqual([
    "reserve",
    "upload-bytes",
    "insert-metadata",
    "remove-orphan",
    "settle:released",
  ]);
  expect(trace.removedPaths).toEqual(trace.uploadedPaths);
  expect(trace.settlements).toEqual([{ reservationId, committed: false }]);
});

test("Vault permanent deletion removes the trashed item only after Edge success", async ({ page }) => {
  const trace = await installVaultBackend(page, { initialFile: "deleted" });
  await openClubVault(page);
  await openTrash(page);
  await expect(page.getByText("Synthetic safety policy", { exact: true })).toBeVisible();

  const deletedFiles = page.getByText("Deleted Files (1)").locator("..");
  await deletedFiles.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Permanently Delete File" })).toBeVisible();
  await page.getByRole("button", { name: "Delete Permanently" }).click();

  await expect(page.getByText("File permanently deleted")).toBeVisible();
  await expect(page.getByText("Trash is empty", { exact: true })).toBeVisible();
  expect(trace.deletionBodies).toEqual([{
    fileIds: ["00000000-0000-4000-8000-000000000705"],
    deletionType: "permanent",
  }]);
});

test("Vault deletion failure stays visible in Trash and can be retried", async ({ page }) => {
  const trace = await installVaultBackend(page, { initialFile: "deleted", deletionError: true });
  await openClubVault(page);
  await openTrash(page);

  const deletedFiles = page.getByText("Deleted Files (1)").locator("..");
  await deletedFiles.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete Permanently" }).click();

  await expect(page.getByText(/Edge Function returned a non-2xx status code|Failed to permanently delete file/i)).toBeVisible();
  await expect(page.getByText("Synthetic safety policy", { exact: true })).toBeVisible();
  expect(trace.steps.filter((step) => step === "permanent-delete")).toHaveLength(1);
});

test("Vault hides loose club-root files and destructive controls from a coach", async ({ page }) => {
  const trace = await installVaultBackend(page, { initialFile: "active", role: "coach" });
  await openClubVault(page, { expectUpload: false });
  await expect(page.getByText("This folder is empty", { exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic safety policy", { exact: true })).toHaveCount(0);
  expect(trace.deletionBodies).toEqual([]);
});
