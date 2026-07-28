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
type HarnessBehavior = {
  insert?: "success" | "failure" | "deferred-success" | "deferred-failure";
  edit?: "success" | "failure";
  paginated?: boolean;
  deferOlderPage?: boolean;
};
type HarnessState = {
  inserts: Record<string, unknown>[];
  patches: Array<{ body: Record<string, unknown>; id: string | null }>;
  olderRequests: number;
  olderResponses: number;
  releaseInsert: () => void;
  releaseOlderPage: () => void;
};
const defaultBell: BellCase = { type: "team_message", table: "team_messages", scopeColumn: "team_id", scopeId: teamId, expectedPath: `/messages/${teamId}` };

async function install(page: Page, bell: BellCase = defaultBell, behavior: HarnessBehavior = {}): Promise<HarnessState> {
  let insertRelease!: () => void;
  let olderRelease!: () => void;
  const insertGate = new Promise<void>(resolve => { insertRelease = resolve; });
  const olderGate = new Promise<void>(resolve => { olderRelease = resolve; });
  const state: HarnessState = { inserts: [], patches: [], olderRequests: 0, olderResponses: 0, releaseInsert: insertRelease, releaseOlderPage: olderRelease };
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
      const exactId = url.searchParams.get("id")?.startsWith("eq.") ? url.searchParams.get("id")!.slice(3) : null;
      return json(route, singular || exactId ? rows.find(row => row.id === exactId) ?? rows[0] : rows);
    }
    if (url.pathname === "/rest/v1/user_roles") return json(route, [{ user_id: userId, role: "player", club_id: clubId, team_id: teamId }]);
    if (url.pathname === "/rest/v1/team_messages") {
      if (req.method() === "POST") {
        state.inserts.push((req.postDataJSON() ?? {}) as Record<string, unknown>);
        if (behavior.insert?.startsWith("deferred")) await insertGate;
        if (behavior.insert === "failure" || behavior.insert === "deferred-failure") {
          return json(route, { code: "42501", message: "synthetic insert denied" }, 403);
        }
        return json(route, [], 201);
      }
      if (req.method() === "PATCH") {
        state.patches.push({ body: (req.postDataJSON() ?? {}) as Record<string, unknown>, id: url.searchParams.get("id")?.replace("eq.", "") ?? null });
        if (behavior.edit === "failure") return json(route, { code: "42501", message: "synthetic update denied" }, 403);
        return json(route, [], 204);
      }
      const requested = url.searchParams.get("id")?.replace("eq.", "");
      const isHistorySearch = [...url.searchParams.keys()].some(key => key === "text") &&
        [...url.searchParams.getAll("text")].some(value => value.includes("ilike"));
      const olderSearchMessage = {
        ...messages[0],
        id: olderSearchId,
        text: "Needle from archived synthetic history",
        created_at: "2025-01-01T09:00:00.000Z",
      };
      const isOlderPage = !!url.searchParams.get("created_at")?.startsWith("lt.");
      if (isOlderPage) state.olderRequests += 1;
      if (isOlderPage && behavior.deferOlderPage) await olderGate;
      if (isOlderPage) state.olderResponses += 1;
      const rows = isHistorySearch
        ? [olderSearchMessage]
        : behavior.paginated && isOlderPage
          ? messages.slice(0, 39).reverse()
          : behavior.paginated && !requested
            ? messages.slice(39)
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
  return state;
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

test("send is optimistic, keeps exact scope, and never renders a duplicate while the insert settles", async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, { insert: "deferred-success" });
  await page.goto(`/messages/${teamId}`);
  const composer = page.getByRole("textbox", { name: "Type a message..." });
  await composer.fill("Synthetic optimistic send");
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();

  await expect(page.getByText("Synthetic optimistic send", { exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic optimistic send", { exact: true })).toHaveCount(1);
  await expect.poll(() => state.inserts.length).toBe(1);
  expect(state.inserts[0]).toMatchObject({ team_id: teamId, author_id: userId, text: "Synthetic optimistic send", reply_to_id: null });

  state.releaseInsert();
  await expect(page.getByText("Synthetic optimistic send", { exact: true })).toHaveCount(1);
});

test("failed send removes the optimistic row, reports the error, and restores the unsent draft", async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, { insert: "deferred-failure" });
  await page.goto(`/messages/${teamId}`);
  const composer = page.getByRole("textbox", { name: "Type a message..." });
  await composer.fill("Draft that must survive denial");
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();
  const optimisticBubble = page.locator('div[id^="message-"]').filter({ hasText: "Draft that must survive denial" });
  await expect(optimisticBubble).toHaveCount(1);

  state.releaseInsert();
  await expect(page.getByText("Failed to send message", { exact: true })).toBeVisible();
  await expect(optimisticBubble).toHaveCount(0);
  await expect(composer).toHaveValue("Draft that must survive denial");
});

test("loading older history preserves the visible anchor and avoids duplicate boundary rows", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, { paginated: true, deferOlderPage: true });
  await page.goto(`/messages/${teamId}`);
  await expect(page.getByRole("heading", { name: "Synthetic Messaging Team" })).toBeVisible({ timeout: 15_000 });
  const scroller = page.getByTestId("virtuoso-scroller");
  await expect(scroller).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Synthetic history message 68", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.waitForTimeout(1_200);
  await scroller.dispatchEvent("wheel", { deltaY: -120 });
  await scroller.evaluate(element => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(4);
  // A second upward gesture while already pinned at the edge exercises the
  // explicit edge-pull fallback used by touch devices and Chromium alike.
  await scroller.dispatchEvent("wheel", { deltaY: -120 });
  await expect.poll(() => state.olderRequests).toBeGreaterThan(0);

  const anchor = page.getByText("Synthetic history message 39", { exact: true });
  await expect(anchor).toBeVisible();
  const before = await anchor.evaluate(element => element.getBoundingClientRect().top);
  state.releaseOlderPage();
  await expect.poll(() => state.olderResponses, { timeout: 15_000 }).toBeGreaterThan(0);
  const after = await anchor.evaluate(element => element.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  await expect(page.getByText("Synthetic history message 39", { exact: true })).toHaveCount(1);
});

test("reply focuses the composer and sends the immutable parent message id", async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, { insert: "success" });
  await page.goto(`/messages/${teamId}`);
  const target = page.locator(`#message-${messages[28].id}`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  await target.click({ button: "right" });
  await page.getByRole("button", { name: "Reply", exact: true }).click();

  const composer = page.getByRole("textbox", { name: "Type a message..." });
  await expect(page.getByText("Replying to Alex Member", { exact: true })).toBeVisible();
  await expect(composer).toBeFocused();
  await composer.fill("Synthetic threaded reply");
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();
  await expect.poll(() => state.inserts.length).toBe(1);
  expect(state.inserts[0]).toMatchObject({ text: "Synthetic threaded reply", reply_to_id: messages[28].id });
  await expect(page.getByText("Replying to Alex Member", { exact: true })).toHaveCount(0);
});

test("editing updates the existing own message instead of inserting a replacement", async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, { edit: "success" });
  await page.goto(`/messages/${teamId}`);
  const own = page.locator(`#message-${messages[29].id}`);
  await expect(own).toBeVisible({ timeout: 15_000 });
  await own.click({ button: "right" });
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  const composer = page.getByRole("textbox", { name: "Type a message..." });
  await expect(page.getByText("Editing message", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Synthetic history message 29");
  await composer.fill("Corrected synthetic message");
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({ body: { text: "Corrected synthetic message" }, id: messages[29].id });
  expect(state.inserts).toHaveLength(0);
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
