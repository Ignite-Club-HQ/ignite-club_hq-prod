import { expect, test, type Page, type Route } from "@playwright/test";

const api = "http://127.0.0.1:54321";
const userId = "00000000-0000-4000-8000-000000009001";
const teamId = "00000000-0000-4000-8000-000000009002";
const clubId = "00000000-0000-4000-8000-000000009003";
const targetId = "00000000-0000-4000-8000-000000009020";
const olderSearchId = "00000000-0000-4000-8000-000000009021";
const syntheticImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30'%3E%3Crect width='40' height='30' fill='%23007acc'/%3E%3C/svg%3E";
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "synthetic.messaging@local.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const messages = Array.from({ length: 90 }, (_, i) => ({
  id: i === 18 ? targetId : `00000000-0000-4000-8000-${String(9100 + i).padStart(12, "0")}`,
  team_id: teamId, author_id: i % 2 ? userId : "00000000-0000-4000-8000-000000009099",
  text: i === 18 ? "Exact synthetic notification target" : `Synthetic history message ${i}`,
  image_url: i === 28 ? syntheticImage : null, reply_to_id: null, deleted_at: null, is_club_announcement: false,
  club_announcement_name: null, is_system_message: false, forwarded_from_user_id: null,
  forwarded_at: null, forwarded_source_label: null,
  created_at: new Date(Date.UTC(2026, 6, 27, 10, i)).toISOString(),
}));

function json(route: Route, body: unknown, status = 200) { return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); }
type BellCase = { type: string; table: string; scopeColumn: string; scopeId: string; expectedPath: string; targetExists?: boolean };
type HarnessBehavior = {
  insert?: "success" | "failure" | "deferred-success" | "deferred-failure";
  edit?: "success" | "failure";
  delete?: "success" | "failure";
  paginated?: boolean;
  deferOlderPage?: boolean;
  mockRealtime?: boolean;
  deferInboxResume?: boolean;
  nativeRuntime?: "android" | "ios";
};
type HarnessState = {
  inserts: Record<string, unknown>[];
  patches: Array<{ body: Record<string, unknown>; id: string | null }>;
  deletes: string[];
  olderRequests: number;
  olderResponses: number;
  releaseInsert: () => void;
  releaseOlderPage: () => void;
  beginInboxResume: () => void;
  releaseInboxResume: () => void;
  resumeRequests: () => number;
};
const defaultBell: BellCase = { type: "team_message", table: "team_messages", scopeColumn: "team_id", scopeId: teamId, expectedPath: `/messages/${teamId}` };

async function install(page: Page, bell: BellCase = defaultBell, behavior: HarnessBehavior = {}): Promise<HarnessState> {
  let insertRelease!: () => void;
  let olderRelease!: () => void;
  let resumeRelease!: () => void;
  const insertGate = new Promise<void>(resolve => { insertRelease = resolve; });
  const olderGate = new Promise<void>(resolve => { olderRelease = resolve; });
  const resumeGate = new Promise<void>(resolve => { resumeRelease = resolve; });
  let inboxResumeActive = false;
  let inboxResumeRequests = 0;
  const state: HarnessState = {
    inserts: [], patches: [], deletes: [], olderRequests: 0, olderResponses: 0,
    releaseInsert: insertRelease,
    releaseOlderPage: olderRelease,
    beginInboxResume: () => { inboxResumeActive = true; },
    releaseInboxResume: resumeRelease,
    resumeRequests: () => inboxResumeRequests,
  };
  if (behavior.nativeRuntime) {
    // Capacitor detects Android/iOS from their native bridge globals when
    // @capacitor/core first loads. Select the real app branch while keeping
    // all APIs intercepted and synthetic in this browser harness.
    await page.addInitScript((platform) => {
      if (platform === "android") {
        (window as any).androidBridge = {};
      } else {
        const webkit = (window as any).webkit ?? {};
        webkit.messageHandlers = {
          ...(webkit.messageHandlers ?? {}),
          bridge: { postMessage: () => {} },
        };
        (window as any).webkit = webkit;
      }
    }, behavior.nativeRuntime);
  }
  if (behavior.mockRealtime) {
    await page.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      const sockets: any[] = [];
      (window as any).__syntheticRealtimeSockets = sockets;
      class SyntheticRealtimeSocket {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3;
        readyState = 0; protocol = ""; extensions = ""; bufferedAmount = 0; binaryType: BinaryType = "blob";
        onopen: ((event: Event) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        url: string; channels: Array<{ topic: string; bindings: Array<{ id: number; table: string; event: string }> }> = [];
        constructor(url: string | URL) {
          this.url = String(url); sockets.push(this);
          setTimeout(() => { this.readyState = 1; this.onopen?.(new Event("open")); }, 0);
        }
        addEventListener(type: string, listener: EventListener) { (this as any)[`on${type}`] = listener; }
        removeEventListener(type: string, listener: EventListener) { if ((this as any)[`on${type}`] === listener) (this as any)[`on${type}`] = null; }
        dispatchEvent() { return true; }
        send(raw: string) {
          const parsed = JSON.parse(String(raw));
          const message = Array.isArray(parsed)
            ? { join_ref: parsed[0], ref: parsed[1], topic: parsed[2], event: parsed[3], payload: parsed[4] }
            : parsed;
          if (message.event === "phx_join") {
            const changes = message.payload?.config?.postgres_changes ?? [];
            const bindings = changes.map((change: any, index: number) => ({ id: index + 1, ...change }));
            this.channels = [...this.channels.filter(channel => channel.topic !== message.topic), { topic: message.topic, bindings }];
            this.reply(message, { status: "ok", response: { postgres_changes: bindings } });
          } else if (message.event === "heartbeat" || message.event === "access_token") {
            this.reply(message, { status: "ok", response: {} });
          } else if (message.event === "phx_leave") {
            this.reply(message, { status: "ok", response: {} });
          }
        }
        reply(message: any, payload: any) {
          setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({
            join_ref: message.join_ref, ref: message.ref, topic: message.topic, event: "phx_reply", payload,
          }) })), 0);
        }
        close() { this.readyState = 3; this.onclose?.(new CloseEvent("close", { code: 1000, wasClean: true })); }
      }
      (window as any).WebSocket = function(url: string | URL, protocols?: string | string[]) {
        if (String(url).includes("/realtime/")) return new SyntheticRealtimeSocket(url);
        return new NativeWebSocket(url, protocols as any);
      } as any;
      Object.assign((window as any).WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
      (window as any).__emitSyntheticPostgresChange = (table: string, type: string, next: any, old: any = {}) => {
        for (const socket of sockets) {
          for (const channel of socket.channels) {
            const ids = channel.bindings.filter((binding: any) => binding.table === table && (binding.event === "*" || binding.event === type)).map((binding: any) => binding.id);
            if (!ids.length) continue;
            socket.onmessage?.(new MessageEvent("message", { data: JSON.stringify({
              join_ref: null, ref: null, topic: channel.topic, event: "postgres_changes", payload: { ids, data: {
              schema: "public", table, commit_timestamp: new Date().toISOString(), type,
              columns: Object.keys({ ...old, ...next }).map(name => ({ name, type: "text" })),
              record: next, old_record: old, errors: null,
              } },
            }) }));
          }
        }
      };
    });
  }
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
    localStorage.setItem("cookie-consent", "accepted");
  }, { user, userId });
  await page.route("**/*", async route => {
    const req = route.request(); const url = new URL(req.url());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return route.abort("blockedbyclient");
    if (url.origin !== api) return route.continue();
    if (behavior.deferInboxResume && inboxResumeActive && (
      url.pathname.startsWith("/rest/v1/rpc/get_messages_page_bootstrap") ||
      url.pathname.startsWith("/rest/v1/rpc/get_inbox_latest_") ||
      ["/rest/v1/teams", "/rest/v1/clubs", "/rest/v1/chat_groups", "/rest/v1/direct_conversations"].includes(url.pathname)
    )) {
      inboxResumeRequests += 1;
      await resumeGate;
    }
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
      if (req.method() === "DELETE") {
        state.deletes.push(url.searchParams.get("id")?.replace("eq.", "") ?? "");
        if (behavior.delete === "failure") return json(route, { code: "42501", message: "synthetic delete denied" }, 403);
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

test("an image message opens the exact attachment without triggering gallery publication", async ({ page }) => {
  await page.goto(`/messages/${teamId}`);
  const imageMessage = page.locator(`#message-${messages[28].id}`);
  await expect(imageMessage).toBeVisible({ timeout: 15_000 });
  await expect(imageMessage.getByRole("img", { name: "Attachment" })).toBeVisible();

  await imageMessage.click({ button: "right" });
  await page.getByRole("button", { name: "More…" }).click();
  await page.getByRole("button", { name: "View Image" }).click();

  const viewer = page.getByRole("img", { name: "Attachment" }).last();
  await expect(viewer).toBeVisible();
  await expect(page.getByText("Added to media gallery", { exact: true })).toHaveCount(0);
});

test("a denied delete restores the exact message and reports the moderation failure", async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, { delete: "failure" });
  await page.goto(`/messages/${teamId}`);
  const own = page.locator(`#message-${messages[29].id}`);
  await expect(own).toBeVisible({ timeout: 15_000 });

  await own.click({ button: "right" });
  await page.getByRole("button", { name: "More…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delete message?" })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect.poll(() => state.deletes).toEqual([messages[29].id]);
  await expect(page.getByText("Failed to delete message", { exact: true })).toBeVisible();
  await expect(own).toBeVisible();
});

test("a mounted chat reconciles incoming realtime messages and reactions", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, { mockRealtime: true });
  await page.goto(`/messages/${teamId}`);
  await expect(page.getByRole("heading", { name: "Synthetic Messaging Team" })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__syntheticRealtimeSockets
    .flatMap((socket: any) => socket.channels.flatMap((channel: any) => channel.bindings))
    .filter((binding: any) => binding.table === "team_messages").length)).toBeGreaterThan(0);
  // The mock records bindings as soon as it receives phx_join. Allow the
  // client's asynchronous join-reply handler to move the channel to SUBSCRIBED
  // before delivering database changes.
  await page.waitForTimeout(250);
  const realtimeId = "00000000-0000-4000-8000-000000009777";
  const reactionId = "00000000-0000-4000-8000-000000009778";
  const row = {
    ...messages[0], id: realtimeId, text: "Realtime mounted insert", created_at: "2026-07-27T10:15:30.000Z",
  };

  await page.evaluate(({ row }) => (window as any).__emitSyntheticPostgresChange("team_messages", "INSERT", row), { row });
  const bubble = page.locator(`#message-${realtimeId}`);
  await expect(bubble).toContainText("Realtime mounted insert", { timeout: 15_000 });

  await page.evaluate(({ reactionId, realtimeId, otherId }) => (window as any).__emitSyntheticPostgresChange("message_reactions", "INSERT", {
    id: reactionId, team_message_id: realtimeId, user_id: otherId, reaction_type: "like",
  }), { reactionId, realtimeId, otherId: "00000000-0000-4000-8000-000000009099" });
  await expect(bubble.getByRole("button", { name: "1 like reaction" })).toBeVisible({ timeout: 15_000 });

});

test("a mounted chat applies realtime edits and soft-deletes to an existing row", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, { mockRealtime: true });
  await page.goto(`/messages/${teamId}`);
  const existing = page.locator(`#message-${messages[29].id}`);
  await expect(existing).toContainText("Synthetic history message 29", { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__syntheticRealtimeSockets
    .flatMap((socket: any) => socket.channels.flatMap((channel: any) => channel.bindings))
    .filter((binding: any) => binding.table === "team_messages" && binding.event === "UPDATE").length)).toBeGreaterThan(0);
  await page.waitForTimeout(250);

  const edited = { ...messages[29], text: "Realtime corrected existing message" };
  await page.evaluate(({ edited, old }) => (window as any).__emitSyntheticPostgresChange("team_messages", "UPDATE", edited, old), {
    edited, old: messages[29],
  });
  await expect(existing).toContainText("Realtime corrected existing message", { timeout: 15_000 });

  await page.evaluate(({ edited }) => (window as any).__emitSyntheticPostgresChange("team_messages", "UPDATE", {
    ...edited, deleted_at: "2026-07-28T05:00:00.000Z",
  }, edited), { edited });
  await expect(existing).toHaveCount(0);
});

test("duplicate realtime delivery renders one message and one reaction only", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, { mockRealtime: true });
  await page.goto(`/messages/${teamId}`);
  await expect(page.getByRole("heading", { name: "Synthetic Messaging Team" })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__syntheticRealtimeSockets
    .flatMap((socket: any) => socket.channels.flatMap((channel: any) => channel.bindings))
    .filter((binding: any) => binding.table === "team_messages").length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__syntheticRealtimeSockets
    .flatMap((socket: any) => socket.channels.flatMap((channel: any) => channel.bindings))
    .filter((binding: any) => binding.table === "message_reactions" && binding.event === "INSERT").length)).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  const duplicateId = "00000000-0000-4000-8000-000000009779";
  const reactionId = "00000000-0000-4000-8000-000000009780";
  const row = { ...messages[0], id: duplicateId, text: "Exactly once realtime row", created_at: "2026-07-27T10:16:30.000Z" };
  const reaction = { id: reactionId, team_message_id: duplicateId, user_id: "00000000-0000-4000-8000-000000009099", reaction_type: "like" };

  await page.evaluate(({ row }) => {
    (window as any).__emitSyntheticPostgresChange("team_messages", "INSERT", row);
    (window as any).__emitSyntheticPostgresChange("team_messages", "INSERT", row);
  }, { row });
  await expect(page.locator(`#message-${duplicateId}`)).toHaveCount(1);
  await page.evaluate(({ reaction }) => {
    (window as any).__emitSyntheticPostgresChange("message_reactions", "INSERT", reaction);
    (window as any).__emitSyntheticPostgresChange("message_reactions", "INSERT", reaction);
  }, { reaction });
  const bubble = page.locator(`#message-${duplicateId}`);
  await expect(bubble.getByRole("button", { name: "1 like reaction" })).toHaveCount(1);
});

test("a team draft survives leaving the chat and remounting the route", async ({ page }) => {
  await page.goto(`/messages/${teamId}`);
  const composer = page.getByRole("textbox", { name: "Type a message..." });
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.fill("Synthetic remount-safe draft");
  await page.goto("/messages");
  await page.goto(`/messages/${teamId}`);
  await expect(page.getByRole("textbox", { name: "Type a message..." })).toHaveValue("Synthetic remount-safe draft", { timeout: 15_000 });
});

for (const nativeCase of [
  { label: "Android", platform: "android" },
  { label: "iOS", platform: "ios" },
] as const) {
test(`${nativeCase.label} online resume does not start foreground refetches or block an inbox thread tap`, async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, { deferInboxResume: true, nativeRuntime: nativeCase.platform });
  await page.goto("/messages");

  const thread = page.getByText("Synthetic Messaging Team", { exact: true }).first();
  await expect(thread).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).Capacitor?.getPlatform?.())).toBe(nativeCase.platform);
  // Mobile layout/hydration can settle later than desktop even after the row
  // first paints. Establish a quiet baseline before attributing requests to
  // the synthetic resume signal.
  await page.waitForTimeout(1_000);

  state.beginInboxResume();
  await page.evaluate(() => {
    let syntheticVisibility: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => syntheticVisibility,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    syntheticVisibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // Resume while already online is not a reconnect. A bounded refresh of the
  // currently mounted chat read-model is intentional so stale/blank threads
  // recover, but the old global active-query storm must not return.
  await page.waitForTimeout(500);
  expect(state.resumeRequests()).toBeLessThanOrEqual(4);
  await thread.click({ timeout: 1_000 });
  await expect(page).toHaveURL(new RegExp(`/messages/${teamId}$`), { timeout: 1_000 });

  state.releaseInboxResume();
  await expect(page.getByRole("heading", { name: "Synthetic Messaging Team" })).toBeVisible({ timeout: 15_000 });
});

test(`${nativeCase.label} request saturation keeps Inbox, Schedule and Media navigation responsive`, async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, { deferInboxResume: true, nativeRuntime: nativeCase.platform });
  await page.goto("/messages");

  const thread = page.getByText("Synthetic Messaging Team", { exact: true }).first();
  await expect(thread).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).Capacitor?.getPlatform?.())).toBe(nativeCase.platform);
  await page.waitForTimeout(1_000);

  state.beginInboxResume();
  await page.evaluate(() => {
    let syntheticVisibility: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => syntheticVisibility,
    });
    // Model a native WebView returning after a long Android Doze period. A
    // resume can emit visibility, focus and pageshow in a tight burst.
    document.dispatchEvent(new Event("visibilitychange"));
    syntheticVisibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await page.waitForTimeout(500);
  const scopedResumeRequests = state.resumeRequests();
  expect(scopedResumeRequests).toBeLessThanOrEqual(4);

  // Saturate the Android/WebView-style per-origin request pool with many
  // foreground refetches. Do not await them: they intentionally remain held
  // until releaseInboxResume(), just like requests suspended through Doze.
  await page.evaluate((apiOrigin) => {
    for (let i = 0; i < 30; i += 1) {
      void fetch(`${apiOrigin}/rest/v1/teams?android_resume_stress=${i}`).catch(() => {});
    }
  }, api);
  await expect.poll(state.resumeRequests, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(scopedResumeRequests + 6);

  // Slow/hung foreground refetches must never swallow the user's tab taps.
  await page.getByRole("link", { name: "Schedule" }).click({ timeout: 1_000 });
  await expect(page).toHaveURL(/\/events(?:\?|$)/, { timeout: 1_000 });

  // Even while Schedule is legitimately waiting on the held network request,
  // its bottom navigation must remain touchable so the app never feels frozen.
  await page.getByRole("link", { name: "Media" }).click({ timeout: 1_000 });
  await expect(page).toHaveURL(/\/media(?:\?|$)/, { timeout: 1_000 });

  state.releaseInboxResume();
  await expect(page.getByRole("heading", { name: "Media" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Add photo" }).click({ timeout: 1_000 });
  await expect(page.getByRole("heading", { name: /^Upload Media/ })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("link", { name: "Schedule" }).click({ timeout: 1_000 });
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible({ timeout: 15_000 });
});
}

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
