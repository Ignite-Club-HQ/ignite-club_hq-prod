import { expect, test, type Page, type Route } from "@playwright/test";

const api = "http://127.0.0.1:54321";
const userId = "00000000-0000-4000-8000-000000008001";
const otherId = "00000000-0000-4000-8000-000000008002";
const clubId = "00000000-0000-4000-8000-000000008003";
const teamId = "00000000-0000-4000-8000-000000008004";
const groupId = "00000000-0000-4000-8000-000000008005";
const conversationId = "00000000-0000-4000-8000-000000008006";
const adminConversationId = "00000000-0000-4000-8000-000000008007";
const groupReactionMessageId = "00000000-0000-4000-8000-000000008008";
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

async function install(page: Page, options: {
  appAdmin?: boolean;
  insertFailure?: boolean;
  insertFailureDelayMs?: number;
  seedOldDuplicateClubMessage?: boolean;
  canDm?: boolean;
  clubAdminPreviewMessage?: boolean;
  clubAdminThreadDelayMs?: number;
  clubAdminTransientEmpty?: boolean;
  clubAdminThreadResponses?: Array<"empty" | "message" | "error">;
  seedOneMessageClubAdminCache?: boolean;
  seedGroupReactionMessage?: boolean;
  holdGroupReactionInsert?: boolean;
  groupReactionInsertFailure?: boolean;
} = {}) {
  const inserts: Array<{ table: string; body: Record<string, unknown> }> = [];
  const uploads: string[] = [];
  const reactionWrites: Record<string, unknown>[] = [];
  let releaseGroupReactionInsert: (() => void) | undefined;
  const groupReactionInsertGate = new Promise<void>((resolve) => {
    releaseGroupReactionInsert = resolve;
  });
  let clubAdminThreadReads = 0;
  await page.addInitScript(({ user, userId, clubId, adminConversationId, otherId, seedOneMessageClubAdminCache }) => {
    const enc = (value: object) => btoa(JSON.stringify(value)).replaceAll("=", "");
    const token = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: userId, role: "authenticated", exp: 4102444800 })}.synthetic`;
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user }));
    localStorage.setItem("ignite_cached_profile", JSON.stringify({
      userId,
      cachedAt: Date.now(),
      profile: { id: userId, display_name: "Synthetic Sender", avatar_url: null, active_club_id: clubId },
    }));
    localStorage.setItem("ios-install-prompt-dismissed", Date.now().toString());
    if (seedOneMessageClubAdminCache) {
      localStorage.setItem(`ignite_message_cache_club_admin_${adminConversationId}`, JSON.stringify({
        timestamp: Date.now(),
        messages: [{
          id: "00000000-0000-4000-8000-000000008099",
          text: "Exact all-admin preview must open in thread",
          author_id: otherId,
          created_at: "2026-07-29T07:30:00.000Z",
          image_url: null,
          reply_to_id: null,
          profiles: { display_name: "Synthetic Recipient", avatar_url: null },
          reactions: [],
          reply_to: null,
        }],
      }));
    }
  }, { user, userId, clubId, adminConversationId, otherId, seedOneMessageClubAdminCache: options.seedOneMessageClubAdminCache });

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
    if (url.pathname === "/rest/v1/club_admin_conversations") return json(route, singular
      ? { id: adminConversationId, club_id: clubId, member_user_id: otherId, member_id: otherId, updated_at: "2026-07-29T07:30:00.000Z" }
      : [{ id: adminConversationId, club_id: clubId, member_user_id: otherId, member_id: otherId, updated_at: "2026-07-29T07:30:00.000Z" }]);
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
    if (url.pathname === "/rest/v1/club_subscriptions") {
      return json(route, [{
        club_id: clubId,
        status: "active",
        is_pro: true,
        is_pro_football: false,
        admin_pro_override: false,
        admin_pro_football_override: false,
        expires_at: null,
      }]);
    }
    if (url.pathname === "/rest/v1/message_reactions") {
      if (request.method() === "POST") {
        const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
        reactionWrites.push(body);
        if (options.holdGroupReactionInsert) await groupReactionInsertGate;
        if (options.groupReactionInsertFailure) {
          return json(route, { code: "42501", message: "synthetic reaction denied" }, 403);
        }
        const row = { id: "reaction-server", ...body };
        return json(route, singular ? row : [row], 201);
      }
      return json(route, singular ? null : []);
    }

    const table = url.pathname.replace("/rest/v1/", "");
    if (surfaces.some(surface => surface.table === table) || table === "team_messages" || table === "broadcast_messages") {
      if (request.method() === "POST") {
        inserts.push({ table, body: (request.postDataJSON() ?? {}) as Record<string, unknown> });
        if (options.insertFailureDelayMs) {
          await new Promise(resolve => setTimeout(resolve, options.insertFailureDelayMs));
        }
        if (options.insertFailure) return json(route, { code: "42501", message: "synthetic insert denied" }, 403);
        return json(route, [], 201);
      }
      if (table === "club_messages" && options.seedOldDuplicateClubMessage) {
        const oldDuplicate = {
          id: "00000000-0000-4000-8000-000000008088",
          club_id: clubId,
          author_id: userId,
          text: "Repeated identical draft",
          image_url: null,
          reply_to_id: null,
          created_at: "2025-01-01T00:00:00.000Z",
        };
        return json(route, singular ? oldDuplicate : [oldDuplicate]);
      }
      if (table === "club_admin_messages" && options.clubAdminPreviewMessage) {
        const row = {
          id: "00000000-0000-4000-8000-000000008099",
          conversation_id: adminConversationId,
          author_id: otherId,
          text: "Exact all-admin preview must open in thread",
          image_url: null,
          reply_to_id: null,
          deleted_at: null,
          created_at: "2026-07-29T07:30:00.000Z",
        };
        const scopeFilter = url.searchParams.get("conversation_id") ?? "";
        const isThreadRead = scopeFilter === `eq.${adminConversationId}`;
        if (isThreadRead) {
          clubAdminThreadReads += 1;
          if (options.clubAdminThreadDelayMs) {
            await new Promise(resolve => setTimeout(resolve, options.clubAdminThreadDelayMs));
          }
          if (options.clubAdminTransientEmpty && clubAdminThreadReads === 1) {
            return json(route, []);
          }
          const response = options.clubAdminThreadResponses?.[
            Math.min(clubAdminThreadReads - 1, options.clubAdminThreadResponses.length - 1)
          ];
          if (response === "empty") return json(route, []);
          if (response === "error") {
            return json(route, { code: "503", message: "synthetic mobile recovery failure" }, 503);
          }
        }
        return json(route, singular ? row : [row]);
      }
      if (table === "group_messages" && options.seedGroupReactionMessage) {
        const row = {
          id: groupReactionMessageId,
          group_id: groupId,
          author_id: otherId,
          text: "Operational reaction target",
          image_url: null,
          reply_to_id: null,
          deleted_at: null,
          is_system_message: false,
          forwarded_from_user_id: null,
          forwarded_at: null,
          forwarded_source_label: null,
          created_at: "2026-07-31T04:00:00.000Z",
        };
        return json(route, singular ? row : [row]);
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
    if (url.pathname === "/rest/v1/rpc/can_dm_user") return json(route, options.canDm ?? true);
    if (url.pathname === "/rest/v1/rpc/dm_attachments_disabled") return json(route, false);
    if (url.pathname.startsWith("/rest/v1/rpc/")) return json(route, 0);
    if (url.pathname.startsWith("/rest/v1/")) return json(route, []);
    if (url.pathname.startsWith("/functions/v1/")) return json(route, {});
    return json(route, {});
  });
  return {
    inserts,
    uploads,
    reactionWrites,
    releaseGroupReactionInsert: () => releaseGroupReactionInsert?.(),
    getClubAdminThreadReads: () => clubAdminThreadReads,
  };
}

test("a user denied DM permission sees the intentional access screen rather than a broken composer", async ({ page }) => {
  const { inserts } = await install(page, { canDm: false });
  await page.goto(`/messages/dm/${conversationId}`);
  await expect(page.getByRole("heading", { name: "Pro Feature" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Type a message..." })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Send message/ })).toHaveCount(0);
  expect(inserts.filter(row => row.table === "direct_messages")).toHaveLength(0);
});

test("messages inbox exposes the button that starts a new direct-message flow", async ({ page }) => {
  await install(page);
  await page.goto("/messages");

  const newMessage = page.getByRole("button", { name: "New message" });
  await expect(newMessage).toBeVisible({ timeout: 15_000 });
  await newMessage.click();
  const newDm = page.getByRole("button", { name: /New Message Select one or more people/ });
  await expect(newDm).toBeVisible();
  await newDm.click();
  const dmDialog = page.getByRole("dialog", { name: /New Message/ });
  await expect(dmDialog.getByRole("heading", { name: "New Message" })).toBeVisible();
  await expect(dmDialog.getByText("Select one person", { exact: true })).toBeVisible();
});

test("an all-club-admin inbox preview opens the same non-blank message thread", async ({ page }) => {
  await install(page, { clubAdminPreviewMessage: true });
  await page.goto("/messages");

  const preview = page.getByText("Exact all-admin preview must open in thread", { exact: false });
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await preview.click();
  await expect(page).toHaveURL(`/messages/club-admin/${adminConversationId}`);

  const threadMessage = page.locator("#message-00000000-0000-4000-8000-000000008099");
  await expect(threadMessage).toBeVisible({ timeout: 15_000 });
  await expect(threadMessage).toContainText("Exact all-admin preview must open in thread");
  await expect(page.getByText(/Start a conversation with/)).toHaveCount(0);
});

test("a cold all-club-admin thread waits for a delayed response and then renders the previewed message", async ({ page }) => {
  const harness = await install(page, {
    clubAdminPreviewMessage: true,
    clubAdminThreadDelayMs: 1_200,
  });
  await page.goto("/messages");
  await page.getByText("Exact all-admin preview must open in thread", { exact: false }).click();

  await expect(page).toHaveURL(`/messages/club-admin/${adminConversationId}`);
  await expect(page.locator("#message-00000000-0000-4000-8000-000000008099"))
    .toContainText("Exact all-admin preview must open in thread", { timeout: 15_000 });
  // React Strict Mode / refetch-on-mount may perform one replacement read,
  // but a delayed success must never fan out into a retry storm.
  expect(harness.getClubAdminThreadReads()).toBeGreaterThanOrEqual(1);
  expect(harness.getClubAdminThreadReads()).toBeLessThanOrEqual(2);
  await expect(page.getByText(/Start a conversation with/)).toHaveCount(0);
});

test("a transient empty all-club-admin response recovers automatically and manual refresh remains available", async ({ page }) => {
  const harness = await install(page, {
    clubAdminPreviewMessage: true,
    clubAdminTransientEmpty: true,
  });
  await page.goto("/messages");
  await page.getByText("Exact all-admin preview must open in thread", { exact: false }).click();
  await expect(page).toHaveURL(`/messages/club-admin/${adminConversationId}`);
  await expect.poll(() => harness.getClubAdminThreadReads()).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#message-00000000-0000-4000-8000-000000008099"))
    .toContainText("Exact all-admin preview must open in thread", { timeout: 15_000 });

  const readsBeforeManualRefresh = harness.getClubAdminThreadReads();
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Refresh messages" }).click();
  await expect.poll(() => harness.getClubAdminThreadReads()).toBeGreaterThan(readsBeforeManualRefresh);
  await expect(page.locator("#message-00000000-0000-4000-8000-000000008099"))
    .toContainText("Exact all-admin preview must open in thread", { timeout: 15_000 });
  await expect(page.getByText(/Start a conversation with/)).toHaveCount(0);
});

test("an inbox-backed club-admin thread automatically survives two transient empty responses", async ({ page }) => {
  test.setTimeout(30_000);
  const harness = await install(page, {
    clubAdminPreviewMessage: true,
    clubAdminThreadResponses: ["empty", "empty", "message"],
  });
  await page.goto("/messages");
  await page.getByText("Exact all-admin preview must open in thread", { exact: false }).click();
  await expect(page).toHaveURL(`/messages/club-admin/${adminConversationId}`);

  // The inbox proves this thread is non-empty. A transient RLS/network-shaped
  // empty must therefore stay in recovery rather than claiming this is a new
  // conversation while bounded automatic retries are still running.
  await expect(page.getByText(/Start a conversation with/)).toHaveCount(0);
  await expect.poll(() => harness.getClubAdminThreadReads(), { timeout: 12_000 }).toBeGreaterThanOrEqual(3);
  await expect(page.locator("#message-00000000-0000-4000-8000-000000008099"))
    .toContainText("Exact all-admin preview must open in thread", { timeout: 15_000 });
});

test("a valid one-message club-admin cache remains visible while the authoritative fetch is delayed", async ({ page }) => {
  await install(page, {
    clubAdminPreviewMessage: true,
    seedOneMessageClubAdminCache: true,
    clubAdminThreadDelayMs: 10_000,
  });
  await page.goto("/messages");
  await page.getByText("Exact all-admin preview must open in thread", { exact: false }).click();
  await expect(page).toHaveURL(`/messages/club-admin/${adminConversationId}`);

  // This assertion intentionally completes before the 10s network response.
  // A real one-message cache is usable content, not a blank notification-only
  // preload, and must protect a new admin conversation during mobile recovery.
  await expect(page.locator("#message-00000000-0000-4000-8000-000000008099"))
    .toContainText("Exact all-admin preview must open in thread", { timeout: 2_500 });
  await expect(page.getByText(/Start a conversation with/)).toHaveCount(0);
});

test("exhausted club-admin message failures render an explicit retry action instead of a blank scroller", async ({ page }) => {
  test.setTimeout(55_000);
  const harness = await install(page, {
    clubAdminPreviewMessage: true,
    clubAdminThreadResponses: ["error"],
  });
  await page.goto("/messages");
  await page.getByText("Exact all-admin preview must open in thread", { exact: false }).click();
  await expect(page).toHaveURL(`/messages/club-admin/${adminConversationId}`);

  await expect.poll(() => harness.getClubAdminThreadReads(), { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  // Each bounded recovery refetch still receives React Query's own retry
  // policy, so exhaustion is deliberately slower than the first four HTTP
  // attempts. Wait for the user-facing terminal state, not an implementation
  // read count.
  await expect(page.getByText("Messages could not be loaded", { exact: false })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole("button", { name: /Retry/i })).toBeVisible();
  await expect(page.locator('[data-testid="virtuoso-scroller"]')).toHaveCount(0);
  await expect(page.getByText(/Start a conversation with/)).toHaveCount(0);
});

test("an authoritative empty club-admin conversation still shows the intentional empty state", async ({ page }) => {
  await install(page, {
    clubAdminPreviewMessage: false,
    clubAdminThreadResponses: ["empty"],
  });
  await page.goto(`/messages/club-admin/${adminConversationId}`);
  await expect(page.getByText(/Start a conversation with/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="virtuoso-scroller"]')).toHaveCount(0);
});

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

for (const surface of [
  { name: "team", path: `/messages/${teamId}`, table: "team_messages" },
  ...surfaces.map(({ name, path, table }) => ({ name, path, table })),
  { name: "broadcast", path: "/messages/broadcast", table: "broadcast_messages" },
]) {
  test(`${surface.name} chat restores an unsent draft after an online insert failure`, async ({ page }) => {
    const { inserts } = await install(page, { insertFailure: true, appAdmin: true });
    await page.goto(surface.path);
    const composer = page.getByRole("textbox", { name: "Type a message..." });
    const draft = `Retryable ${surface.name} draft`;
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await composer.fill(draft);
    await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();

    await expect.poll(() => inserts.filter(row => row.table === surface.table).length).toBe(1);
    await expect(page.getByText(/Failed to send message/, { exact: false }).first()).toBeVisible();
    await expect(composer).toHaveValue(draft);
  });
}

test("a delayed failed send never overwrites a newer club-chat draft", async ({ page }) => {
  const { inserts } = await install(page, { insertFailure: true, insertFailureDelayMs: 500 });
  await page.goto(`/messages/club/${clubId}`);
  const composer = page.getByRole("textbox", { name: "Type a message..." });
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.fill("Original failed draft");
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();
  await composer.fill("New draft typed while sending");

  await expect.poll(() => inserts.filter(row => row.table === "club_messages").length).toBe(1);
  await expect(page.getByText("Failed to send message", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("New draft typed while sending");
});

test("an older identical club message cannot falsely confirm a failed new send", async ({ page }) => {
  const { inserts } = await install(page, {
    insertFailure: true,
    seedOldDuplicateClubMessage: true,
  });
  await page.goto(`/messages/club/${clubId}`);
  const composer = page.getByRole("textbox", { name: "Type a message..." });
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Repeated identical draft", { exact: true })).toHaveCount(1);

  await composer.fill("Repeated identical draft");
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();

  await expect.poll(() => inserts.filter(row => row.table === "club_messages").length).toBe(1);
  await expect(page.getByText("Failed to send message", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Repeated identical draft");
  await expect(page.locator("#message-00000000-0000-4000-8000-000000008088")).toContainText("Repeated identical draft");
  await expect(page.locator('div[id^="message-temp-"]')).toHaveCount(0);
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "narrow phone", width: 360, height: 740 },
]) {
  test(`direct-message send button stays visible and usable on a ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { inserts } = await install(page);
    await page.goto(`/messages/dm/${conversationId}`);

    const composer = page.getByRole("textbox", { name: "Type a message..." });
    const send = page.getByRole("button", { name: "Send message (hold to schedule)" });
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await expect(send).toBeVisible();
    await expect(send).toBeDisabled();

    const box = await send.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

    await composer.fill(`Visible ${viewport.name} DM send`);
    await expect(send).toBeEnabled();
    await send.click();
    await expect.poll(() => inserts.filter(row => row.table === "direct_messages").length).toBe(1);
    expect(inserts.find(row => row.table === "direct_messages")?.body).toEqual(expect.objectContaining({
      conversation_id: conversationId,
      author_id: userId,
      text: `Visible ${viewport.name} DM send`,
    }));
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

test("an operational-group heart appears before its delayed write completes and is not duplicated", async ({ page }) => {
  const harness = await install(page, {
    seedGroupReactionMessage: true,
    holdGroupReactionInsert: true,
  });
  await page.goto(`/groups/${groupId}`);

  const message = page.locator(`#message-${groupReactionMessageId}`);
  await expect(message).toContainText("Operational reaction target", { timeout: 15_000 });
  await message.locator(".chat-bubble-stable").locator("..").dispatchEvent("contextmenu");

  const heart = page.locator("button").filter({ hasText: /^❤️$/ });
  await expect(heart).toBeVisible();
  // The picker deliberately ignores synthetic WebView clicks for its first
  // 500 ms, so exercise the accepted user interaction rather than bypassing it.
  await page.waitForTimeout(550);
  await heart.click();

  await expect.poll(() => harness.reactionWrites.length).toBe(1);
  expect(harness.reactionWrites[0]).toEqual({
    group_message_id: groupReactionMessageId,
    user_id: userId,
    reaction_type: "❤️",
  });
  // The request is still blocked: this assertion proves the badge is
  // optimistic rather than an echo of the server response or Realtime.
  const optimisticBadge = message.locator("button").filter({ hasText: /^❤️$/ });
  await expect(optimisticBadge).toBeVisible();

  harness.releaseGroupReactionInsert();
  await expect(optimisticBadge).toHaveCount(1);
});

test("an operational-group reaction is rolled back when its write is denied", async ({ page }) => {
  const harness = await install(page, {
    seedGroupReactionMessage: true,
    groupReactionInsertFailure: true,
  });
  await page.goto(`/groups/${groupId}`);

  const message = page.locator(`#message-${groupReactionMessageId}`);
  await expect(message).toContainText("Operational reaction target", { timeout: 15_000 });
  await message.locator(".chat-bubble-stable").locator("..").dispatchEvent("contextmenu");
  const heart = page.locator("button").filter({ hasText: /^❤️$/ });
  await expect(heart).toBeVisible();
  await page.waitForTimeout(550);
  await heart.click();

  await expect.poll(() => harness.reactionWrites.length).toBe(1);
  await expect(page.getByText("Couldn't update reaction. Please try again.", { exact: true })).toBeVisible();
  await expect(message.locator("button").filter({ hasText: /^❤️$/ })).toHaveCount(0);
});
