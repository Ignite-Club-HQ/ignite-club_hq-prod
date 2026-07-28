import { expect, test, type Page, type Route } from "@playwright/test";

const api = "http://127.0.0.1:54321";
const userId = "00000000-0000-4000-8000-000000008001";
const otherId = "00000000-0000-4000-8000-000000008002";
const clubId = "00000000-0000-4000-8000-000000008003";
const teamId = "00000000-0000-4000-8000-000000008004";
const groupId = "00000000-0000-4000-8000-000000008005";
const conversationId = "00000000-0000-4000-8000-000000008006";
const adminConversationId = "00000000-0000-4000-8000-000000008007";
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "cross-surface@local.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

const surfaces = [
  { name: "club", path: `/messages/club/${clubId}`, table: "club_messages", scope: { club_id: clubId } },
  { name: "group", path: `/groups/${groupId}`, table: "group_messages", scope: { group_id: groupId } },
  { name: "direct", path: `/messages/dm/${conversationId}`, table: "direct_messages", scope: { conversation_id: conversationId } },
  { name: "club admin", path: `/messages/club-admin/${adminConversationId}`, table: "club_admin_messages", scope: { conversation_id: adminConversationId } },
] as const;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function install(page: Page, options: { appAdmin?: boolean; insertFailure?: boolean } = {}) {
  const inserts: Array<{ table: string; body: Record<string, unknown> }> = [];
  const uploads: string[] = [];
  await page.addInitScript(({ user, userId, clubId }) => {
    const enc = (value: object) => btoa(JSON.stringify(value)).replaceAll("=", "");
    const token = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: userId, role: "authenticated", exp: 4102444800 })}.synthetic`;
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user }));
    localStorage.setItem("ignite_cached_profile", JSON.stringify({
      userId,
      cachedAt: Date.now(),
      profile: { id: userId, display_name: "Synthetic Sender", avatar_url: null, active_club_id: clubId },
    }));
    localStorage.setItem("ios-install-prompt-dismissed", Date.now().toString());
  }, { user, userId, clubId });

  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return route.abort("blockedbyclient");
    if (url.origin !== api) return route.continue();
    const singular = request.headers()["accept"]?.includes("application/vnd.pgrst.object");
    if (url.pathname === "/auth/v1/user") return json(route, user);
    if (url.pathname === "/rest/v1/profiles") {
      const rows = [
        { id: userId, display_name: "Synthetic Sender", avatar_url: null, active_club_id: clubId },
        { id: otherId, display_name: "Synthetic Recipient", avatar_url: null, active_club_id: clubId },
      ];
      const id = url.searchParams.get("id")?.replace("eq.", "");
      return json(route, singular ? rows.find(row => row.id === id) ?? rows[0] : (id ? rows.filter(row => row.id === id) : rows));
    }
    if (url.pathname === "/rest/v1/clubs") return json(route, singular ? { id: clubId, name: "Synthetic Club", is_pro: true } : [{ id: clubId, name: "Synthetic Club", is_pro: true }]);
    if (url.pathname === "/rest/v1/teams") return json(route, singular ? { id: teamId, club_id: clubId, name: "Synthetic Team" } : [{ id: teamId, club_id: clubId, name: "Synthetic Team" }]);
    if (url.pathname === "/rest/v1/chat_groups") return json(route, singular ? {
      id: groupId, name: "Synthetic Group", club_id: clubId, team_id: teamId,
      allow_forwarding: true, created_by: userId, allowed_roles: [], membership_mode: "invite",
      category: "team", mini_league_id: null, join_policy: "invite_only",
    } : [{ id: groupId, name: "Synthetic Group", club_id: clubId, allowed_roles: [] }]);
    if (url.pathname === "/rest/v1/direct_conversations") return json(route, singular ? { id: conversationId, participant_1: userId, participant_2: otherId, created_at: "2026-01-01T00:00:00Z" } : [{ id: conversationId, participant_1: userId, participant_2: otherId }]);
    if (url.pathname === "/rest/v1/club_admin_conversations") return json(route, singular ? { id: adminConversationId, club_id: clubId, member_id: userId } : [{ id: adminConversationId, club_id: clubId, member_id: userId }]);
    if (url.pathname === "/rest/v1/user_roles") {
      const isAppAdminLookup = url.searchParams.get("role") === "eq.app_admin";
      return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Content-Range": options.appAdmin === false ? "*/0" : "0-0/1" },
      body: JSON.stringify(options.appAdmin === false
        ? (singular ? null : [])
        : (isAppAdminLookup || singular ? { id: "role-1" } : [{ id: "role-1", user_id: userId, role: "app_admin", club_id: clubId, team_id: teamId }])),
      });
    }
    if (url.pathname === "/rest/v1/club_subscriptions") return json(route, [{ club_id: clubId, status: "active" }]);

    const table = url.pathname.replace("/rest/v1/", "");
    if (surfaces.some(surface => surface.table === table) || table === "team_messages" || table === "broadcast_messages") {
      if (request.method() === "POST") {
        inserts.push({ table, body: (request.postDataJSON() ?? {}) as Record<string, unknown> });
        if (options.insertFailure) return json(route, { code: "42501", message: "synthetic insert denied" }, 403);
        return json(route, [], 201);
      }
      return json(route, []);
    }
    if (url.pathname.startsWith("/storage/v1/object/chat-attachments/")) {
      if (request.method() === "POST") {
        uploads.push(decodeURIComponent(url.pathname.slice("/storage/v1/object/chat-attachments/".length)));
        return json(route, { Key: url.pathname });
      }
      return json(route, {});
    }
    if (url.pathname === "/rest/v1/rpc/get_messages_page_bootstrap") return json(route, {
      is_app_admin: options.appAdmin !== false,
      is_committee_member: false,
      admin_club_ids: options.appAdmin === false ? [] : [clubId],
      admin_team_ids: [], all_roles: [], member_club_ids: [clubId], member_team_ids: [teamId],
      pro_club_ids: [clubId], pro_team_ids: [teamId], has_any_pro: true,
      admin_clubs: [], club_pro_status: { [clubId]: true },
    });
    if (url.pathname.startsWith("/rest/v1/rpc/")) return json(route, 0);
    if (url.pathname.startsWith("/rest/v1/")) return json(route, []);
    if (url.pathname.startsWith("/functions/v1/")) return json(route, {});
    return json(route, {});
  });
  return { inserts, uploads };
}

for (const surface of surfaces) {
  test(`${surface.name} chat sends through its exact table and scope`, async ({ page }) => {
    const { inserts } = await install(page);
    await page.goto(surface.path);
    const composer = page.getByRole("textbox", { name: "Type a message..." });
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await composer.fill(`Synthetic ${surface.name} contract`);
    await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();

    await expect.poll(() => inserts.length).toBe(1);
    expect(inserts[0]).toEqual({
      table: surface.table,
      body: expect.objectContaining({
        ...surface.scope,
        author_id: userId,
        text: `Synthetic ${surface.name} contract`,
        reply_to_id: null,
      }),
    });
  });
}

test("an app admin can send a broadcast through the broadcast-only table", async ({ page }) => {
  const { inserts } = await install(page, { appAdmin: true });
  await page.goto("/messages/broadcast");
  const composer = page.getByRole("textbox", { name: "Type a message..." });
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.fill("Synthetic administrator broadcast");
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();

  await expect.poll(() => inserts.filter(row => row.table === "broadcast_messages").length).toBe(1);
  expect(inserts.find(row => row.table === "broadcast_messages")?.body).toEqual(expect.objectContaining({
    author_id: userId,
    text: "Synthetic administrator broadcast",
    image_url: null,
    reply_to_id: null,
  }));
});

test("an ordinary user can read broadcasts but is not offered a broadcast composer", async ({ page }) => {
  const { inserts } = await install(page, { appAdmin: false });
  await page.goto("/messages/broadcast");
  await expect(page.getByRole("heading", { name: "Announcements" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Type a message..." })).toHaveCount(0);
  expect(inserts.filter(row => row.table === "broadcast_messages")).toHaveLength(0);
});

test("an image is uploaded into the scoped chat path and its URL is sent with the team message", async ({ page }) => {
  const { inserts, uploads } = await install(page);
  await page.goto(`/messages/${teamId}`);
  const fileInput = page.locator('input[type="file"][accept="image/*,video/*"]').first();
  await expect(fileInput).toBeAttached({ timeout: 15_000 });
  await fileInput.setInputFiles({
    name: "synthetic-chat.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });

  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0]).toMatch(new RegExp(`^clubs/${clubId}/teams/${teamId}/${userId}/\\d+\\.png$`));
  await expect(page.getByRole("img", { name: "Attachment preview" })).toBeVisible();
  await page.getByRole("textbox", { name: "Type a message..." }).fill("Synthetic image caption");
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();

  await expect.poll(() => inserts.filter(row => row.table === "team_messages").length).toBe(1);
  const sent = inserts.find(row => row.table === "team_messages")!.body;
  expect(sent).toEqual(expect.objectContaining({ team_id: teamId, author_id: userId, text: "Synthetic image caption" }));
  expect(String(sent.image_url)).toContain(`/storage/v1/object/public/chat-attachments/${uploads[0]}`);
});

test("a failed image send restores both the caption and retryable attachment", async ({ page }) => {
  const { inserts, uploads } = await install(page, { insertFailure: true });
  await page.goto(`/messages/${teamId}`);
  const fileInput = page.locator('input[type="file"][accept="image/*,video/*"]').first();
  await expect(fileInput).toBeAttached({ timeout: 15_000 });
  await fileInput.setInputFiles({
    name: "synthetic-retry.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect.poll(() => uploads.length).toBe(1);
  const composer = page.getByRole("textbox", { name: "Type a message..." });
  await composer.fill("Retryable synthetic image");
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();

  await expect.poll(() => inserts.filter(row => row.table === "team_messages").length).toBe(1);
  await expect(page.getByText("Failed to send message", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Retryable synthetic image");
  await expect(page.getByRole("button", { name: "Remove attachment" })).toBeVisible();
});
