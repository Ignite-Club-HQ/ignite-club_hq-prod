import { expect, test, type Page, type Route } from "@playwright/test";

const api = "http://127.0.0.1:54321";
const userId = "00000000-0000-4000-8000-000000009001";
const teamId = "00000000-0000-4000-8000-000000009002";
const clubId = "00000000-0000-4000-8000-000000009003";
const targetId = "00000000-0000-4000-8000-000000009020";
const olderSearchId = "00000000-0000-4000-8000-000000009021";
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "synthetic.messaging@local.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const messages = Array.from({ length: 90 }, (_, i) => ({
  id: i === 18 ? targetId : `00000000-0000-4000-8000-${String(9100 + i).padStart(12, "0")}`,
  team_id: teamId, author_id: i % 2 ? userId : "00000000-0000-4000-8000-000000009099",
  text: i === 18 ? "Exact synthetic notification target" : `Synthetic history message ${i}`,
  image_url: null, reply_to_id: null, deleted_at: null, is_club_announcement: false,
  club_announcement_name: null, is_system_message: false, forwarded_from_user_id: null,
  forwarded_at: null, forwarded_source_label: null,
  created_at: new Date(Date.UTC(2026, 6, 27, 10, i)).toISOString(),
}));

function json(route: Route, body: unknown, status = 200) { return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); }
type BellCase = { type: string; table: string; scopeColumn: string; scopeId: string; expectedPath: string; targetExists?: boolean };
const defaultBell: BellCase = { type: "team_message", table: "team_messages", scopeColumn: "team_id", scopeId: teamId, expectedPath: `/messages/${teamId}` };

async function install(page: Page, bell: BellCase = defaultBell) {
  await page.addInitScript(({ user, userId }) => {
    const enc = (v: object) => btoa(JSON.stringify(v)).replaceAll("=", "");
    const token = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: userId, role: "authenticated", exp: 4102444800 })}.synthetic`;
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user }));
    localStorage.setItem("ignite_cached_profile", JSON.stringify({
      userId,
      cachedAt: Date.now(),
      profile: { id: userId, display_name: "Synthetic Member", avatar_url: null, theme_preference: "light", active_club_theme_id: null },
    }));
    localStorage.setItem("ios-install-prompt-dismissed", Date.now().toString());
  }, { user, userId });
  await page.route("**/*", async route => {
    const req = route.request(); const url = new URL(req.url());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return route.abort("blockedbyclient");
    if (url.origin !== api) return route.continue();
    const singular = req.headers()["accept"]?.includes("application/vnd.pgrst.object");
    if (url.pathname === "/auth/v1/user") return json(route, user);
    if (url.pathname === "/rest/v1/teams") return json(route, singular ? { id: teamId, club_id: clubId, name: "Synthetic Messaging Team", logo_url: null, clubs: { id: clubId, name: "Synthetic Club", logo_url: null } } : [{ id: teamId, club_id: clubId, name: "Synthetic Messaging Team" }]);
    if (url.pathname === "/rest/v1/clubs") return json(route, singular ? { id: clubId, name: "Synthetic Club", is_pro: true } : [{ id: clubId, name: "Synthetic Club", is_pro: true }]);
    if (url.pathname === "/rest/v1/profiles") {
      const rows = [{ id: userId, display_name: "Synthetic Member", avatar_url: null, active_club_id: clubId }, { id: "00000000-0000-4000-8000-000000009099", display_name: "Alex Member", avatar_url: null, active_club_id: clubId }];
      return json(route, singular ? rows.find(row => url.searchParams.get("id")?.includes(row.id)) ?? rows[0] : rows);
    }
    if (url.pathname === "/rest/v1/user_roles") return json(route, [{ user_id: userId, role: "player", club_id: clubId, team_id: teamId }]);
    if (url.pathname === "/rest/v1/team_messages") {
      const requested = url.searchParams.get("id")?.replace("eq.", "");
      const isHistorySearch = [...url.searchParams.keys()].some(key => key === "text") &&
        [...url.searchParams.getAll("text")].some(value => value.includes("ilike"));
      const olderSearchMessage = {
        ...messages[0],
        id: olderSearchId,
        text: "Needle from archived synthetic history",
        created_at: "2025-01-01T09:00:00.000Z",
      };
      const rows = isHistorySearch
        ? [olderSearchMessage]
        : requested
          ? (bell.targetExists === false ? [] : messages.filter(m => m.id === requested))
          : messages;
      return json(route, singular ? rows[0] ?? null : rows);
    }
    if (url.pathname === `/rest/v1/${bell.table}`) {
      const row = { id: targetId, [bell.scopeColumn]: bell.scopeId, author_id: "00000000-0000-4000-8000-000000009099" };
      return json(route, bell.targetExists === false ? (singular ? null : []) : (singular ? row : [row]));
    }
    if (url.pathname === "/rest/v1/notifications") return json(route, [{ id: "00000000-0000-4000-8000-000000009030", user_id: userId, type: bell.type, message: "Alex sent a message", read: false, is_read: false, related_id: targetId, club_id: clubId, created_at: "2026-07-27T12:00:00Z" }]);
    if (url.pathname.startsWith("/rest/v1/rpc/")) return json(route, 0);
    if (url.pathname.startsWith("/rest/v1/")) return json(route, []);
    if (url.pathname.startsWith("/functions/v1/")) return json(route, {});
    return json(route, {});
  });
}

test.beforeEach(async ({ page }) => install(page));

test("cold message deep link lands the exact Virtuoso row above the composer", async ({ page }) => {
  await page.goto(`/messages/${teamId}?message=${targetId}`);
  await expect(page.getByRole("heading", { name: "Synthetic Messaging Team", exact: true })).toBeVisible({ timeout: 15_000 });
  const target = page.locator(`#message-${targetId}`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  await expect(target).toContainText("Exact synthetic notification target");
  const geometry = await target.evaluate(el => { const r = el.getBoundingClientRect(); const composer = document.querySelector('[data-chat-composer="true"]')?.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, viewport: innerHeight, composerTop: composer?.top ?? innerHeight }; });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.composerTop + 1);
});

test("full-history search finds an older message outside the initially loaded page and closes cleanly", async ({ page }) => {
  await page.goto(`/messages/${teamId}`);
  await expect(page.getByText("Synthetic Messaging Team", { exact: true })).toBeVisible();
  await expect(page.getByText("Needle from archived synthetic history", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Search messages" }).click();
  await page.getByPlaceholder("Search messages...").fill("Needle from archived");

  const result = page.locator(`#message-${olderSearchId}`);
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result).toContainText("Needle from archived synthetic history");
  await expect(result.locator("[data-search-highlight]")).not.toHaveCount(0);

  await page.getByPlaceholder("Search messages...").locator("xpath=../..").getByRole("button").first().click();
  await expect(page.getByPlaceholder("Search messages...")).toHaveCount(0);
  await expect(result).toBeVisible();
  await expect(page.getByText("Synthetic history message 0", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Type a message..." })).toBeVisible();
});

test("notification bell resolves a team notification to its exact message", async ({ page }) => {
  await page.goto("/notifications");
  await page.getByText("Alex sent a message", { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/messages/${teamId}\\?.*message=${targetId}`));
  await expect(page.locator(`#message-${targetId}`)).toContainText("Exact synthetic notification target", { timeout: 15_000 });
});

test("notification bell falls back safely when its message is deleted or inaccessible", async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await install(page, { ...defaultBell, targetExists: false });
  await page.goto("/notifications");
  await page.getByText("Alex sent a message", { exact: true }).click();
  await expect(page).toHaveURL(/\/messages$/);
});

for (const bell of [
  { type: "club_message", table: "club_messages", scopeColumn: "club_id", scopeId: clubId, expectedPath: `/messages/club/${clubId}` },
  { type: "group_message", table: "group_messages", scopeColumn: "group_id", scopeId: "00000000-0000-4000-8000-000000009004", expectedPath: "/groups/00000000-0000-4000-8000-000000009004" },
  { type: "direct_message", table: "direct_messages", scopeColumn: "conversation_id", scopeId: "00000000-0000-4000-8000-000000009005", expectedPath: "/messages/dm/00000000-0000-4000-8000-000000009005" },
  { type: "club_admin_message", table: "club_admin_messages", scopeColumn: "conversation_id", scopeId: "00000000-0000-4000-8000-000000009006", expectedPath: "/messages/club-admin/00000000-0000-4000-8000-000000009006" },
  { type: "broadcast", table: "broadcast_messages", scopeColumn: "id", scopeId: targetId, expectedPath: "/messages/broadcast" },
] satisfies BellCase[]) {
  test(`notification bell resolves ${bell.type} to its exact chat and message`, async ({ page }) => {
    await page.unrouteAll({ behavior: "wait" });
    await install(page, bell);
    await page.goto("/notifications");
    await page.getByText("Alex sent a message", { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${bell.expectedPath.replaceAll("/", "\\/")}\\?.*message=${targetId}`));
  });
}
