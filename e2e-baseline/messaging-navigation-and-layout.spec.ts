import { expect, test, type Page, type Route } from "@playwright/test";

const api = "http://127.0.0.1:54321";
const userId = "00000000-0000-4000-8000-000000009001";
const teamId = "00000000-0000-4000-8000-000000009002";
const secondTeamId = "00000000-0000-4000-8000-000000009012";
const clubId = "00000000-0000-4000-8000-000000009003";
const otherClubId = "00000000-0000-4000-8000-000000009013";
const targetId = "00000000-0000-4000-8000-000000009020";
const olderSearchId = "00000000-0000-4000-8000-000000009021";
const oldPushTargetId = "00000000-0000-4000-8000-000000009022";
const recreatedTeamMessageId = "00000000-0000-4000-8000-000000009023";
const syntheticImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30'%3E%3Crect width='40' height='30' fill='%23007acc'/%3E%3C/svg%3E";
const offlineEventTitle = "Synthetic cached offline fixture";
const offlinePhotoTitle = "Synthetic cached offline photo";
const futureEventDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
  multipleInboxTeams?: boolean;
  nativeRuntime?: "android" | "ios";
  reactionDelayMs?: number;
  deferHomeEvents?: boolean;
  deferMessageHistory?: boolean;
  pitchBoardController?: boolean;
  wrongActiveClub?: boolean;
  wrongScopeCachedMessages?: boolean;
  recreatedTeamIsolation?: boolean;
  deferAuthorizedScopes?: boolean;
};
type HarnessState = {
  inserts: Record<string, unknown>[];
  rsvpInserts: Record<string, unknown>[];
  patches: Array<{ body: Record<string, unknown>; id: string | null }>;
  deletes: string[];
  olderRequests: number;
  olderResponses: number;
  releaseInsert: () => void;
  releaseOlderPage: () => void;
  beginInboxResume: () => void;
  releaseInboxResume: () => void;
  resumeRequests: () => number;
  setApiAvailable: (available: boolean) => void;
  addServerMessage: (message: Record<string, unknown>) => void;
  setReactionAvailable: (available: boolean) => void;
  releaseHomeEvents: () => void;
  releaseMessageHistory: () => void;
  releaseAuthorizedScopes: () => void;
};
const defaultBell: BellCase = { type: "team_message", table: "team_messages", scopeColumn: "team_id", scopeId: teamId, expectedPath: `/messages/${teamId}` };

async function install(page: Page, bell: BellCase = defaultBell, behavior: HarnessBehavior = {}): Promise<HarnessState> {
  let insertRelease!: () => void;
  let olderRelease!: () => void;
  let resumeRelease!: () => void;
  let homeEventsRelease!: () => void;
  let messageHistoryRelease!: () => void;
  let authorizedScopesRelease!: () => void;
  const insertGate = new Promise<void>(resolve => { insertRelease = resolve; });
  const olderGate = new Promise<void>(resolve => { olderRelease = resolve; });
  const resumeGate = new Promise<void>(resolve => { resumeRelease = resolve; });
  const homeEventsGate = new Promise<void>(resolve => { homeEventsRelease = resolve; });
  const messageHistoryGate = new Promise<void>(resolve => { messageHistoryRelease = resolve; });
  const authorizedScopesGate = new Promise<void>(resolve => { authorizedScopesRelease = resolve; });
  let inboxResumeActive = false;
  let inboxResumeRequests = 0;
  let apiAvailable = true;
  const serverMessages: Record<string, unknown>[] = [];
  let reactionAvailable = false;
  const state: HarnessState = {
    inserts: [], rsvpInserts: [], patches: [], deletes: [], olderRequests: 0, olderResponses: 0,
    releaseInsert: insertRelease,
    releaseOlderPage: olderRelease,
    beginInboxResume: () => { inboxResumeActive = true; },
    releaseInboxResume: resumeRelease,
    resumeRequests: () => inboxResumeRequests,
    setApiAvailable: (available) => { apiAvailable = available; },
    addServerMessage: (message) => { serverMessages.push(message); },
    setReactionAvailable: (available) => { reactionAvailable = available; },
    releaseHomeEvents: homeEventsRelease,
    releaseMessageHistory: messageHistoryRelease,
    releaseAuthorizedScopes: authorizedScopesRelease,
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
  await page.addInitScript(({ user, userId, teamId, secondTeamId, otherClubId, wrongActiveClub, wrongScopeCachedMessages }) => {
    let syntheticOnline = localStorage.getItem("synthetic-network-offline") !== "1";
    if (!syntheticOnline) {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => syntheticOnline,
      });
    }
    (window as any).__setSyntheticOnline = (online: boolean) => {
      syntheticOnline = online;
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => syntheticOnline,
      });
      if (online) localStorage.removeItem("synthetic-network-offline");
      else localStorage.setItem("synthetic-network-offline", "1");
      window.dispatchEvent(new Event(online ? "online" : "offline"));
    };
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
    if (wrongActiveClub) {
      localStorage.setItem(`ignite-club-theme-${userId}`, otherClubId);
      localStorage.setItem(`ignite-club-theme-data-${userId}`, JSON.stringify({
        clubId: otherClubId,
        clubName: "Other Synthetic Club",
        primaryColor: "#112233",
        secondaryColor: "#445566",
        logoUrl: null,
        sport: null,
        cachedAt: Date.now(),
      }));
    }
    if (wrongScopeCachedMessages) {
      localStorage.setItem(`ignite_message_cache_team_${teamId}`, JSON.stringify({
        timestamp: Date.now(),
        messages: Array.from({ length: 5 }, (_, index) => ({
          id: `00000000-0000-4000-8000-${String(9800 + index).padStart(12, "0")}`,
          team_id: secondTeamId,
          author_id: userId,
          text: `Wrong-thread cached message ${index}`,
          created_at: new Date(Date.UTC(2026, 6, 27, 8, index)).toISOString(),
          image_url: null,
          reply_to_id: null,
          profiles: { display_name: "Wrong Thread User", avatar_url: null },
          reactions: [],
          reply_to: null,
        })),
      }));
    }
  }, { user, userId, teamId, secondTeamId, otherClubId, wrongActiveClub: !!behavior.wrongActiveClub, wrongScopeCachedMessages: !!behavior.wrongScopeCachedMessages });
  await page.route("**/*", async route => {
    const req = route.request(); const url = new URL(req.url());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return route.abort("blockedbyclient");
    if (url.origin !== api) return route.continue();
    if (!apiAvailable) return route.abort("internetdisconnected");
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
    if (url.pathname === "/rest/v1/teams") {
      const teamRows = behavior.recreatedTeamIsolation ? [
        { id: secondTeamId, club_id: clubId, name: "Synthetic Messaging Team", logo_url: null, team_type: "mixed", deleted_at: null, clubs: { id: clubId, name: "Synthetic Club", logo_url: null, sport: null, is_pro: true } },
      ] : [
        { id: teamId, club_id: clubId, name: "Synthetic Messaging Team", logo_url: null, team_type: "mixed", clubs: { id: clubId, name: "Synthetic Club", logo_url: null, sport: behavior.pitchBoardController ? "soccer" : null, is_pro: true } },
        ...(behavior.multipleInboxTeams
          ? [{ id: secondTeamId, club_id: clubId, name: "Synthetic Older Team", logo_url: null, clubs: { id: clubId, name: "Synthetic Club", logo_url: null } }]
          : []),
      ];
      const exactId = url.searchParams.get("id")?.replace("eq.", "");
      return json(route, singular ? teamRows.find((row) => row.id === exactId) ?? teamRows[0] : teamRows);
    }
    if (url.pathname === "/rest/v1/clubs") {
      const clubRows = [
        { id: clubId, name: "Synthetic Club", is_pro: true },
        ...(behavior.wrongActiveClub ? [{ id: otherClubId, name: "Other Synthetic Club", is_pro: true }] : []),
      ];
      const exactId = url.searchParams.get("id")?.replace("eq.", "");
      return json(route, singular ? clubRows.find((row) => row.id === exactId) ?? clubRows[0] : clubRows);
    }
    if (url.pathname === "/rest/v1/profiles") {
      const rows = [{ id: userId, display_name: "Synthetic Member", avatar_url: null, active_club_id: clubId, active_club_theme_id: behavior.wrongActiveClub ? otherClubId : null }, { id: "00000000-0000-4000-8000-000000009099", display_name: "Alex Member", avatar_url: null, active_club_id: clubId }];
      const exactId = url.searchParams.get("id")?.startsWith("eq.") ? url.searchParams.get("id")!.slice(3) : null;
      return json(route, singular || exactId ? rows.find(row => row.id === exactId) ?? rows[0] : rows);
    }
    if (
      behavior.deferAuthorizedScopes &&
      url.pathname === "/rest/v1/user_roles" &&
      url.searchParams.get("select") === "club_id,team_id"
    ) {
      await authorizedScopesGate;
    }
    if (url.pathname === "/rest/v1/user_roles") return json(route, [
      { user_id: userId, role: behavior.pitchBoardController ? "coach" : "player", club_id: clubId, team_id: behavior.recreatedTeamIsolation ? secondTeamId : teamId },
      ...(behavior.wrongActiveClub
        ? [{ user_id: userId, role: "club_member", club_id: otherClubId, team_id: null }]
        : []),
      ...(behavior.multipleInboxTeams
        ? [{ user_id: userId, role: "player", club_id: clubId, team_id: secondTeamId }]
        : []),
    ]);
    if (url.pathname === "/rest/v1/events") {
      if (behavior.deferHomeEvents) await homeEventsGate;
      const eventRows = [{
      id: "00000000-0000-4000-8000-000000009040",
      title: offlineEventTitle,
      type: "game",
      event_date: `${futureEventDate}T00:00:00.000Z`,
      start_time: behavior.pitchBoardController ? `${futureEventDate}T10:00:00.000Z` : "10:00:00",
      end_time: "11:00:00",
      description: "Cached journey fixture",
      address: "1 Local Test Road",
      suburb: "Testville",
      state: "SA",
      postcode: "5000",
      location_name: "Synthetic Ground",
      club_id: clubId,
      team_id: teamId,
      mini_league_id: null,
      is_cancelled: false,
      is_bye: false,
      is_recurring: false,
      parent_event_id: null,
      opponent: "Synthetic Opponent",
      arrival_minutes_before: 30,
      rsvp_audience: "all",
      adults_only: false,
      updated_at: "2026-07-31T00:00:00.000Z",
      teams: { name: "Synthetic Messaging Team", default_match_arrival_minutes: 30, default_rsvp_audience: "all" },
      clubs: { name: "Synthetic Club", sport: "soccer" },
      }];
      const teamCardSingle = behavior.pitchBoardController && url.searchParams.has("team_id");
      // The pitch-board entry journey does not need a next-event card. Return
      // an intentional empty maybeSingle result so unrelated date rendering
      // cannot obscure the entry/resume behavior under test.
      if (teamCardSingle) return json(route, null);
      return json(route, singular ? eventRows[0] : eventRows);
    }
    if (url.pathname === "/rest/v1/photos") return json(route, [{
      id: "00000000-0000-4000-8000-000000009041",
      file_url: syntheticImage,
      image_url: syntheticImage,
      title: offlinePhotoTitle,
      caption: "Available from the local offline cache",
      created_at: "2026-07-31T00:00:00.000Z",
      club_id: clubId,
      team_id: teamId,
      event_id: null,
      mini_league_id: null,
      uploader_id: userId,
      album_id: null,
      clubs: { name: "Synthetic Club", is_pro: true },
      teams: { name: "Synthetic Messaging Team", club_id: clubId, clubs: { name: "Synthetic Club" } },
      mini_leagues: null,
    }]);
    if (url.pathname === "/rest/v1/rsvps") {
      if (req.method() === "POST") {
        state.rsvpInserts.push((req.postDataJSON() ?? {}) as Record<string, unknown>);
        return json(route, [], 201);
      }
      return json(route, []);
    }
    if (url.pathname === "/rest/v1/team_subscriptions") {
      const subscription = {
      team_id: teamId,
      status: "active",
      is_pro: true,
      is_pro_football: true,
      minutes_per_half: 20,
      team_size: 7,
      };
      return json(route, singular ? subscription : (behavior.pitchBoardController ? [subscription] : []));
    }
    if (url.pathname === "/rest/v1/club_subscriptions") {
      const subscription = {
      club_id: clubId,
      status: "active",
      is_pro: true,
      is_pro_football: true,
      };
      return json(route, singular ? subscription : [subscription]);
    }
    if (url.pathname === "/rest/v1/message_reactions") {
      if (!reactionAvailable) return json(route, []);
      if (behavior.reactionDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, behavior.reactionDelayMs));
      }
      return json(route, [{
        id: "00000000-0000-4000-8000-000000009014",
        user_id: "00000000-0000-4000-8000-000000009099",
        reaction_type: "like",
        team_message_id: messages[29].id,
      }]);
    }
    if (url.pathname === "/rest/v1/team_messages") {
      // Let notification routing resolve the target row by exact id first;
      // hold only the thread-history/bootstrap request that powers skeleton
      // replacement after navigation.
      if (behavior.deferMessageHistory && !url.searchParams.get("id")) {
        await messageHistoryGate;
      }
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
      if (behavior.multipleInboxTeams && url.searchParams.get("team_id") === `eq.${secondTeamId}`) {
        return json(route, [{
          ...messages[0],
          id: "00000000-0000-4000-8000-000000009013",
          team_id: secondTeamId,
          text: "Older team preview",
          created_at: "2026-07-26T09:00:00.000Z",
        }]);
      }
      const requested = url.searchParams.get("id")?.replace("eq.", "");
      if (behavior.recreatedTeamIsolation) {
        const requestedTeam = url.searchParams.get("team_id")?.replace("eq.", "");
        const newTeamMessage = {
          ...messages[0],
          id: recreatedTeamMessageId,
          team_id: secondTeamId,
          text: "New event auto-post for the recreated team",
          is_system_message: true,
          created_at: "2026-08-06T01:00:00.000Z",
        };
        if (requested === recreatedTeamMessageId) return json(route, singular ? newTeamMessage : [newTeamMessage]);
        if (requestedTeam === teamId) return json(route, singular ? null : []);
        if (requestedTeam === secondTeamId || !requestedTeam) return json(route, singular ? newTeamMessage : [newTeamMessage]);
      }
      const isHistorySearch = [...url.searchParams.keys()].some(key => key === "text") &&
        [...url.searchParams.getAll("text")].some(value => value.includes("ilike"));
      const olderSearchMessage = {
        ...messages[0],
        id: olderSearchId,
        text: "Needle from archived synthetic history",
        created_at: "2025-01-01T09:00:00.000Z",
      };
      const oldPushTarget = {
        ...messages[0],
        id: oldPushTargetId,
        text: "Exact notification target from last season",
        created_at: "2024-03-02T09:00:00.000Z",
      };
      const isOlderPage = !!url.searchParams.get("created_at")?.startsWith("lt.");
      const isOldPushWindow =
        url.searchParams.get("created_at")?.includes(oldPushTarget.created_at) ||
        url.searchParams.get("created_at")?.includes("2024-03-02");
      if (isOlderPage) state.olderRequests += 1;
      if (isOlderPage && behavior.deferOlderPage) await olderGate;
      if (isOlderPage) state.olderResponses += 1;
      const rows = isHistorySearch
        ? [olderSearchMessage]
        : requested === oldPushTargetId
          ? [oldPushTarget]
          : requested
            ? [...serverMessages, ...messages].filter(m => m.id === requested)
        : isOldPushWindow
          ? [oldPushTarget]
        : behavior.paginated && isOlderPage
          ? messages.slice(0, 39).reverse()
          : behavior.paginated && !requested
            ? messages.slice(39)
          : [...serverMessages, ...messages];
      if (requested && bell.targetExists === false) {
        return json(route, singular ? null : []);
      }
      return json(route, singular ? rows[0] ?? null : rows);
    }
    if (url.pathname === `/rest/v1/${bell.table}`) {
      const row = { id: targetId, [bell.scopeColumn]: bell.scopeId, author_id: "00000000-0000-4000-8000-000000009099" };
      return json(route, bell.targetExists === false ? (singular ? null : []) : (singular ? row : [row]));
    }
    if (url.pathname === "/rest/v1/notifications") return json(route, [{ id: "00000000-0000-4000-8000-000000009030", user_id: userId, type: bell.type, message: behavior.recreatedTeamIsolation ? "New team event posted" : "Alex sent a message", read: false, is_read: false, related_id: behavior.recreatedTeamIsolation ? recreatedTeamMessageId : targetId, club_id: clubId, created_at: "2026-07-27T12:00:00Z" }]);
    if (
      behavior.recreatedTeamIsolation &&
      url.pathname === "/rest/v1/rpc/get_inbox_latest_team_messages"
    ) {
      return json(route, [{
        team_id: secondTeamId,
        text: "New event auto-post for the recreated team",
        author_display_name: "Ignite Bot",
        created_at: "2026-08-06T01:00:00.000Z",
        image_url: null,
        is_club_announcement: true,
        club_announcement_name: "Synthetic Club",
      }]);
    }
    if (
      behavior.multipleInboxTeams &&
      url.pathname === "/rest/v1/rpc/get_inbox_latest_team_messages"
    ) {
      return json(route, [
        {
          team_id: teamId,
          text: "Authoritative newest team preview",
          author_display_name: "Coach",
          created_at: "2026-07-27T10:30:00.000Z",
          image_url: null,
          is_club_announcement: false,
          club_announcement_name: null,
        },
        {
          team_id: secondTeamId,
          text: "Authoritative older team preview",
          author_display_name: "Coach",
          created_at: "2026-07-26T09:00:00.000Z",
          image_url: null,
          is_club_announcement: false,
          club_announcement_name: null,
        },
      ]);
    }
    if (behavior.pitchBoardController && [
      "/rest/v1/rpc/has_active_pro_for_team",
      "/rest/v1/rpc/has_active_pro_for_club",
      "/rest/v1/rpc/user_has_any_club_pro",
    ].includes(url.pathname)) return json(route, true);
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

test("a notification for a message outside the loaded history fetches and lands on that exact old row", async ({ page }) => {
  test.setTimeout(40_000);
  await page.goto(`/messages/${teamId}?message=${oldPushTargetId}&jump=1722400000000`);

  const target = page.locator(`#message-${oldPushTargetId}`);
  await expect(target).toContainText("Exact notification target from last season", {
    timeout: 15_000,
  });
  const geometry = await target.evaluate((element) => {
    const row = element.getBoundingClientRect();
    const composer = document
      .querySelector('[data-chat-composer="true"]')
      ?.getBoundingClientRect();
    return {
      top: row.top,
      bottom: row.bottom,
      composerTop: composer?.top ?? innerHeight,
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.composerTop + 1);
});

test("Android cached inbox waits for fresh ordering, then reveals once without any row jolt", async ({ page }) => {
  test.setTimeout(45_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, {
    deferInboxResume: true,
    nativeRuntime: "android",
    multipleInboxTeams: true,
  });

  await page.goto("/messages");
  const thread = page.getByText("Synthetic Messaging Team", { exact: true }).first();
  await expect(thread).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Synthetic Older Team", { exact: true })).toBeVisible();
  // Inbox disk persistence is deliberately idle/debounced.
  await page.waitForTimeout(5_000);
  // Deliberately make the persisted timestamps disagree with the fresh
  // server order. If cached rows are painted before reconciliation, these two
  // cards will visibly swap — precisely the native jolt this contract forbids.
  await page.evaluate(({ firstId, secondId }) => {
    const raw = localStorage.getItem("messages-page-cache-v2");
    if (!raw) throw new Error("expected persisted messages cache");
    const cache = JSON.parse(raw);
    cache.latestTeamMessages ||= {};
    cache.latestTeamMessages[firstId] = {
      text: "Stale cached first-team preview",
      author: "Coach",
      created_at: "2025-01-01T00:00:00.000Z",
    };
    cache.latestTeamMessages[secondId] = {
      text: "Stale cached second-team preview",
      author: "Coach",
      created_at: "2027-01-01T00:00:00.000Z",
    };
    localStorage.setItem("messages-page-cache-v2", JSON.stringify(cache));
  }, { firstId: teamId, secondId: secondTeamId });

  state.beginInboxResume();
  await page.reload();

  // Showing cached rows immediately is not inherently better: stale activity
  // timestamps can reorder them once the fresh previews land. It is acceptable
  // to hold a short skeleton, but the wait must be bounded and the final list
  // must reveal in its settled order exactly once.
  await expect(page.locator(".animate-pulse").first()).toBeVisible({ timeout: 1_500 });
  await expect(thread).toHaveCount(0);
  const releaseTs = Date.now();
  state.releaseInboxResume();
  await expect(thread).toBeVisible({ timeout: 2_500 });
  const orderedNames = await page.locator(
    `a[href="/messages/${teamId}"] h3, a[href="/messages/${secondTeamId}"] h3`,
  ).allTextContents();
  expect(orderedNames).toEqual([
    "Synthetic Messaging Team",
    "Synthetic Older Team",
  ]);
  expect(Date.now() - releaseTs).toBeLessThan(2_500);

  // Sample every animation frame after first reveal. Any late sort/reflow that
  // moves the card is a native UX regression even when the final order is right.
  const positions = await page.evaluate(async ({ href }) => {
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const element = document.querySelector(`a[href="${href}"] h3`);
      samples.push(element ? element.getBoundingClientRect().top : -10_000);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return samples;
  }, { href: `/messages/${teamId}` });
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);

  await thread.click({ timeout: 1_500 });
  await expect(page).toHaveURL(new RegExp(`/messages/${teamId}`), { timeout: 2_000 });
});

test("Performance: a normal inbox thread tap paints usable messages within budget", async ({ page }) => {
  await page.goto("/messages");
  const thread = page.getByText("Synthetic Messaging Team", { exact: true }).first();
  await expect(thread).toBeVisible({ timeout: 15_000 });

  const started = Date.now();
  await thread.click();
  await expect(page.locator(`#message-${targetId}`)).toBeVisible({ timeout: 4_000 });
  await expect(page.getByRole("textbox", { name: "Type a message..." })).toBeEditable();
  expect(Date.now() - started).toBeLessThan(4_000);
});

test("Performance: an in-app notification tap paints its exact message within budget", async ({ page }) => {
  await page.goto("/notifications");
  const notification = page.getByText("Alex sent a message", { exact: true });
  await expect(notification).toBeVisible({ timeout: 15_000 });

  const started = Date.now();
  await notification.click();
  await expect(page.locator(`#message-${targetId}`)).toContainText(
    "Exact synthetic notification target",
    { timeout: 3_500 },
  );
  expect(Date.now() - started).toBeLessThan(3_500);
});

test("Performance: a cold notification deep link paints its exact old message within budget", async ({ page }) => {
  const started = Date.now();
  await page.goto(`/messages/${teamId}?message=${oldPushTargetId}&jump=1722400000001`);
  await expect(page.locator(`#message-${oldPushTargetId}`)).toContainText(
    "Exact notification target from last season",
    { timeout: 5_000 },
  );
  expect(Date.now() - started).toBeLessThan(5_000);
});

test("full-history search finds an older message outside the initially loaded page and closes cleanly", async ({ page }) => {
  await page.goto(`/messages/${teamId}`);
  await expect(
    page.getByRole("heading", { name: "Synthetic Messaging Team", level: 1 }),
  ).toBeVisible({ timeout: 15_000 });
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
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).evaluate((button) => {
    // Keep all attempts in one browser task so neither React's loading render
    // nor the backend response can mask a duplicate-submit race.
    button.click();
    button.click();
    button.click();
  });

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
  await target.locator(".relative.min-w-0.max-w-full.select-none").first().dispatchEvent("contextmenu");
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
  await own.locator(".relative.min-w-0.max-w-full.select-none").first().dispatchEvent("contextmenu");
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

  await imageMessage.locator(".relative.min-w-0.max-w-full.select-none").first().dispatchEvent("contextmenu");
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

  await own.locator(".relative.min-w-0.max-w-full.select-none").first().dispatchEvent("contextmenu");
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

test("a mounted thread rejects a realtime message belonging to another team", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, { mockRealtime: true });
  await page.goto(`/messages/${teamId}`);
  await expect(page.getByRole("heading", { name: "Synthetic Messaging Team" })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__syntheticRealtimeSockets
    .flatMap((socket: any) => socket.channels.flatMap((channel: any) => channel.bindings))
    .filter((binding: any) => binding.table === "team_messages").length)).toBeGreaterThan(0);
  await page.waitForTimeout(250);

  const foreignId = "00000000-0000-4000-8000-000000009779";
  const foreignRow = {
    ...messages[0],
    id: foreignId,
    team_id: secondTeamId,
    text: "Must never render in the open team thread",
    created_at: "2026-07-27T10:16:30.000Z",
  };
  await page.evaluate(({ row }) => {
    (window as any).__emitSyntheticPostgresChange("team_messages", "INSERT", row);
  }, { row: foreignRow });
  await page.waitForTimeout(500);

  await expect(page.locator(`#message-${foreignId}`)).toHaveCount(0);
  await expect(page.getByText("Must never render in the open team thread", { exact: true })).toHaveCount(0);
  await expect(page.locator(`#message-${messages[29].id}`)).toBeVisible();
});

test("a thread never paints cached rows whose immutable team scope belongs elsewhere", async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, {
    deferMessageHistory: true,
    wrongScopeCachedMessages: true,
  });

  try {
    await page.goto(`/messages/${teamId}`);
    await expect(page.getByRole("heading", { name: "Synthetic Messaging Team" })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await expect(page.getByText(/Wrong-thread cached message/)).toHaveCount(0);
  } finally {
    state.releaseMessageHistory();
  }
  await expect(page.locator(`#message-${messages[29].id}`)).toBeVisible({ timeout: 15_000 });
});

test("a realtime inbox preview and the subsequently opened thread converge on the same new message", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, { mockRealtime: true });
  await page.goto("/messages");

  await expect(page.getByText("Synthetic Messaging Team", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(() => page.evaluate(() => (window as any).__syntheticRealtimeSockets
    .flatMap((socket: any) => socket.channels.flatMap((channel: any) => channel.bindings))
    .filter((binding: any) => binding.table === "team_messages").length)).toBeGreaterThan(0);
  await page.waitForTimeout(250);

  const row = {
    ...messages[0],
    id: "00000000-0000-4000-8000-000000009776",
    text: "Realtime preview and thread must agree",
    created_at: "2026-07-27T10:17:30.000Z",
  };
  state.addServerMessage(row);
  await page.evaluate(({ row }) => {
    (window as any).__emitSyntheticPostgresChange("team_messages", "INSERT", row);
  }, { row });

  const preview = page.getByText("Realtime preview and thread must agree", { exact: true });
  await expect(preview).toBeVisible({ timeout: 3_000 });
  await preview.click();
  await expect(page.locator(`#message-${row.id}`)).toContainText(
    "Realtime preview and thread must agree",
    { timeout: 5_000 },
  );
});

test("Android replays an inbox message that arrives while authorization scopes are hydrating", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, {
    mockRealtime: true,
    nativeRuntime: "android",
    deferAuthorizedScopes: true,
  });

  try {
    await page.goto("/messages");
    await expect(page.getByText("Synthetic Messaging Team", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(() => page.evaluate(() => (window as any).__syntheticRealtimeSockets
      .flatMap((socket: any) => socket.channels.flatMap((channel: any) => channel.bindings))
      .filter((binding: any) => binding.table === "team_messages").length)).toBeGreaterThan(0);

    const row = {
      ...messages[0],
      id: "00000000-0000-4000-8000-000000009778",
      text: "Message received during authorization hydration",
      created_at: "2026-08-07T01:00:00.000Z",
    };
    await page.evaluate(({ row }) => {
      (window as any).__emitSyntheticPostgresChange("team_messages", "INSERT", row);
    }, { row });

    state.releaseAuthorizedScopes();
    await expect(page.getByText(row.text, { exact: true })).toBeVisible({ timeout: 3_000 });
  } finally {
    state.releaseAuthorizedScopes();
  }
});

test("deleting and recreating a same-named team produces a fresh chat, event post and notification route", async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await install(page, {
    type: "team_message",
    table: "team_messages",
    scopeColumn: "team_id",
    scopeId: secondTeamId,
    expectedPath: `/messages/${secondTeamId}`,
  }, { recreatedTeamIsolation: true });

  await page.goto("/messages");
  const recreatedTeam = page.locator(`a[href="/messages/${secondTeamId}"]`);
  await expect(recreatedTeam).toContainText("Synthetic Messaging Team", { timeout: 15_000 });
  await expect(recreatedTeam).toContainText("New event auto-post for the recreated team");
  await expect(page.locator(`a[href="/messages/${teamId}"]`)).toHaveCount(0);
  await expect(page.getByText("Synthetic history message 0", { exact: true })).toHaveCount(0);

  await recreatedTeam.click();
  await expect(page).toHaveURL(new RegExp(`/messages/${secondTeamId}$`));
  await expect(page.locator(`#message-${recreatedTeamMessageId}`)).toContainText(
    "New event auto-post for the recreated team",
    { timeout: 8_000 },
  );
  await expect(page.getByText("Synthetic history message 0", { exact: true })).toHaveCount(0);

  await page.goto("/notifications");
  await page.getByText("New team event posted", { exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/messages/${secondTeamId}\\?.*message=${recreatedTeamMessageId}`),
  );
  await expect(page.locator(`#message-${recreatedTeamMessageId}`)).toContainText(
    "New event auto-post for the recreated team",
    { timeout: 8_000 },
  );
});

test("a cached chat never paints a reaction-free message before its existing emoji is reconciled", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, { reactionDelayMs: 1_000 });

  // Warm a realistic stale cache from a visit made before the reaction existed.
  await page.goto(`/messages/${teamId}`);
  const target = page.locator(`#message-${messages[29].id}`);
  await expect(target).toBeVisible({ timeout: 15_000 });
  await expect(target.getByRole("button", { name: "1 like reaction" })).toHaveCount(0);
  await page.goto("/messages");
  await expect(page.getByText("Synthetic Messaging Team", { exact: true }).first()).toBeVisible();

  state.setReactionAvailable(true);
  await page.evaluate(({ messageId }) => {
    const timings: { message?: number; reaction?: number } = {};
    (window as any).__reactionPaintTimings = timings;
    const check = () => {
      const row = document.getElementById(`message-${messageId}`);
      if (row && timings.message === undefined) timings.message = performance.now();
      if (
        row?.querySelector('[aria-label="1 like reaction"]') &&
        timings.reaction === undefined
      ) {
        timings.reaction = performance.now();
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    (window as any).__reactionPaintObserver = observer;
    check();
  }, { messageId: messages[29].id });
  await page.getByText("Synthetic Messaging Team", { exact: true }).first().click();

  // The stale message row is available immediately, but it must not be
  // revealed without the already-existing server reaction and then mutate a
  // second later. Message + emoji are one first-paint contract.
  await expect(target).toBeVisible({ timeout: 5_000 });
  await expect(target.getByRole("button", { name: "1 like reaction" })).toBeVisible({
    timeout: 5_000,
  });
  const timings = await page.evaluate(() => {
    (window as any).__reactionPaintObserver?.disconnect();
    return (window as any).__reactionPaintTimings as {
      message?: number;
      reaction?: number;
    };
  });
  expect(timings.message).toBeDefined();
  expect(timings.reaction).toBeDefined();
  expect((timings.reaction ?? 0) - (timings.message ?? 0)).toBeLessThanOrEqual(100);
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
  await expect(page.locator(`#message-${duplicateId}`)).toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(({ reaction }) => {
    (window as any).__emitSyntheticPostgresChange("message_reactions", "INSERT", reaction);
    (window as any).__emitSyntheticPostgresChange("message_reactions", "INSERT", reaction);
  }, { reaction });
  const bubble = page.locator(`#message-${duplicateId}`);
  await expect(bubble.getByRole("button", { name: "1 like reaction" })).toHaveCount(1, { timeout: 15_000 });
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

test("offline navigation shows saved Home, Schedule, Media and chat data then recovers without freezing", async ({ page }) => {
  test.setTimeout(60_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page);
  await page.setViewportSize({ width: 900, height: 800 });
  // This journey verifies cache persistence and responsive offline navigation,
  // not deep-link positioning. Use a row guaranteed to be in Virtuoso's
  // initial rendered window so virtualization cannot masquerade as cache loss.
  const cachedChatMessage = messages[0];

  // Warm each user-facing cache using synthetic local responses.
  await page.goto("/");
  await expect(page.getByRole("button", { name: new RegExp(offlineEventTitle) }).first()).toBeVisible({ timeout: 15_000 });

  await page.goto("/events");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(offlineEventTitle, { exact: false }).first()).toBeVisible();

  await page.goto("/media");
  await expect(page.getByRole("heading", { name: "Media" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("img", { name: offlinePhotoTitle }).first()).toBeVisible();
  // Media persistence is deliberately deferred so gallery hydration does not
  // jank the native main thread. Remain mounted until that production write
  // has had the same opportunity as in the cold-offline persistence journey.
  await page.waitForTimeout(1_500);

  await page.goto(`/messages/${teamId}`);
  await expect(page.locator(`#message-${cachedChatMessage.id}`)).toContainText(
    cachedChatMessage.text,
    { timeout: 15_000 },
  );
  // Message and media disk writes are intentionally idle/debounced to avoid
  // Android WebView main-thread freezes; wait for those production paths.
  await page.waitForTimeout(2_000);
  await page.getByRole("link", { name: "Messages" }).click();
  await expect(page.getByText("Synthetic Messaging Team", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  // Inbox persistence is also deliberately deferred (1.5s debounce plus an
  // idle callback with a 3s timeout) to protect native WebView responsiveness.
  await page.waitForTimeout(5_000);

  // Model loss of remote services while keeping the local frontend available.
  // Native Android/iOS assets are packaged in the WebView; taking Playwright's
  // entire browser context offline also blocks Vite-served lazy chunks and is
  // therefore not representative of the production native app.
  state.setApiAvailable(false);
  await page.evaluate(() => (window as any).__setSyntheticOnline(false));
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();

  // All navigation is SPA-local. Each assertion must complete while remote
  // services are unavailable, proving the interface does not wait on the API.
  await page.getByRole("link", { name: "Home" }).click({ timeout: 1_500 });
  await expect(page).toHaveURL(/\/$/, { timeout: 1_500 });
  await expect(page.getByRole("button", { name: new RegExp(offlineEventTitle) }).first()).toBeVisible({ timeout: 3_000 });

  await page.getByRole("link", { name: "Schedule" }).click({ timeout: 1_500 });
  await expect(page).toHaveURL(/\/events(?:\?|$)/, { timeout: 1_500 });
  await expect(page.getByText(offlineEventTitle, { exact: false }).first()).toBeVisible({ timeout: 3_000 });

  await page.getByRole("link", { name: "Media" }).click({ timeout: 1_500 });
  await expect(page).toHaveURL(/\/media(?:\?|$)/, { timeout: 1_500 });
  await expect(page.getByRole("img", { name: offlinePhotoTitle }).first()).toBeVisible({ timeout: 3_000 });

  await page.getByRole("link", { name: "Messages" }).click({ timeout: 1_500 });
  const thread = page.getByText("Synthetic Messaging Team", { exact: true }).first();
  await expect(thread).toBeVisible({ timeout: 3_000 });
  await thread.click({ timeout: 1_500 });
  await expect(page.locator(`#message-${cachedChatMessage.id}`)).toContainText(
    cachedChatMessage.text,
    { timeout: 3_000 },
  );

  state.setApiAvailable(true);
  await page.evaluate(() => (window as any).__setSyntheticOnline(true));
  await expect(page.getByText("Offline", { exact: true })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("textbox", { name: "Type a message..." })).toBeEditable();
  await page.getByRole("link", { name: "Schedule" }).click({ timeout: 1_500 });
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible({ timeout: 5_000 });
});

test("a cold offline remount restores saved content without contacting the API", async ({ page }) => {
  test.setTimeout(60_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page);
  await page.setViewportSize({ width: 900, height: 800 });
  // Prime and verify a row that is guaranteed to be inside Virtuoso's first
  // rendered window. The exact-target navigation contract is covered by the
  // dedicated notification tests; this journey is about disk persistence.
  const cachedChatMessageId = messages[0].id;

  await page.goto("/");
  await expect(page.getByRole("button", { name: new RegExp(offlineEventTitle) }).first()).toBeVisible({ timeout: 15_000 });
  await page.goto("/events");
  await expect(page.getByText(offlineEventTitle, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await page.goto("/media");
  await expect(page.getByRole("img", { name: offlinePhotoTitle }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
  await page.goto(`/messages/${teamId}`);
  await expect(page.locator(`#message-${cachedChatMessageId}`)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_000);
  await page.goto("/messages");
  await expect(page.getByText("Synthetic Messaging Team", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  // Inbox persistence is intentionally debounced and idle-scheduled
  // (1.5s debounce + up to 3s idle timeout) to protect Android's main thread.
  await page.waitForTimeout(5_000);

  await page.goto("/");
  await page.evaluate(() => (window as any).__setSyntheticOnline(false));
  state.setApiAvailable(false);
  await page.reload();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(page.getByText("Offline", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: new RegExp(offlineEventTitle) }).first()).toBeVisible({ timeout: 5_000 });
  await page.getByRole("link", { name: "Schedule" }).click({ timeout: 1_500 });
  await expect(page.getByText(offlineEventTitle, { exact: false }).first()).toBeVisible({ timeout: 5_000 });
  await page.getByRole("link", { name: "Media" }).click({ timeout: 1_500 });
  await expect(page.getByRole("img", { name: offlinePhotoTitle }).first()).toBeVisible({ timeout: 5_000 });
  await page.getByRole("link", { name: "Messages" }).click({ timeout: 1_500 });
  await page.getByText("Synthetic Messaging Team", { exact: true }).first().click({ timeout: 2_000 });
  await expect(page.locator(`#message-${cachedChatMessageId}`)).toBeVisible({ timeout: 5_000 });

  state.setApiAvailable(true);
  await page.evaluate(() => (window as any).__setSyntheticOnline(true));
  await expect(page.getByText("Offline", { exact: true })).toHaveCount(0, { timeout: 10_000 });
});

test("a cold offline remount with no saved schedule shows an unavailable state rather than false empty data", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page);
  await page.goto("/events");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (
        key.startsWith("ignite_events_list_") ||
        key.startsWith("ignite_event_detail_") ||
        key.startsWith("ignite_event_rsvps_")
      ) {
        localStorage.removeItem(key);
      }
    }
    (window as any).__setSyntheticOnline(false);
  });
  state.setApiAvailable(false);
  await page.reload();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(page.getByText("Offline", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByText("You're offline and no saved schedule is available yet.", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("No upcoming events", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Messages" }).click({ timeout: 1_500 });
  await expect(page).toHaveURL(/\/messages(?:\?|$)/, { timeout: 1_500 });
});

test("a cold offline Media remount displays its saved photo instead of freezing", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page);
  await page.goto("/media");
  await expect(page.getByRole("img", { name: offlinePhotoTitle }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_500);

  await page.evaluate(() => (window as any).__setSyntheticOnline(false));
  state.setApiAvailable(false);
  await page.reload();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(page.getByTestId("media-offline-label")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Media" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("img", { name: offlinePhotoTitle }).first()).toBeVisible({ timeout: 5_000 });
  await page.getByRole("link", { name: "Messages" }).click({ timeout: 1_500 });
  await expect(page).toHaveURL(/\/messages(?:\?|$)/, { timeout: 1_500 });
});

test("a cold offline chat remount displays saved messages and keeps its navigation responsive", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(`/messages/${teamId}`);
  await expect(page.locator(`#message-${targetId}`)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_000);

  await page.evaluate(() => (window as any).__setSyntheticOnline(false));
  state.setApiAvailable(false);
  await page.reload();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(page.getByText("Offline", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(`#message-${targetId}`)).toContainText(
    "Exact synthetic notification target",
    { timeout: 5_000 },
  );
  await expect(page.getByRole("textbox", { name: "Type a message..." })).toBeEditable();
  await page.getByRole("link", { name: "Home" }).click({ timeout: 1_500 });
  await expect(page).toHaveURL(/\/$/, { timeout: 1_500 });
});

test("an offline queued chat message synchronizes once when connectivity returns", async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page);
  await page.goto(`/messages/${teamId}`);
  const composer = page.getByRole("textbox", { name: "Type a message..." });
  await expect(composer).toBeVisible({ timeout: 15_000 });

  state.setApiAvailable(false);
  await page.evaluate(() => (window as any).__setSyntheticOnline(false));
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await composer.fill("Synthetic queued offline message");
  await page.getByRole("button", { name: "Send message (hold to schedule)" }).click();

  await expect(page.getByText("Synthetic queued offline message", { exact: true })).toBeVisible();
  await expect(page.getByText(/Offline • 1 pending/)).toBeVisible({ timeout: 3_000 });
  expect(state.inserts).toHaveLength(0);

  state.setApiAvailable(true);
  await page.evaluate(() => (window as any).__setSyntheticOnline(true));
  await expect.poll(() => state.inserts.length, { timeout: 10_000 }).toBe(1);
  expect(state.inserts[0]).toEqual(expect.objectContaining({
    team_id: teamId,
    author_id: userId,
    text: "Synthetic queued offline message",
  }));
  await expect(page.getByText(/Offline • 1 pending/)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByText("Synthetic queued offline message", { exact: true })).toHaveCount(1);
});

test("an offline queued RSVP synchronizes once when connectivity returns", async ({ page }) => {
  test.setTimeout(30_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: new RegExp(offlineEventTitle) }).first()).toBeVisible({ timeout: 15_000 });

  state.setApiAvailable(false);
  await page.evaluate(({ eventId, userId }) => {
    localStorage.setItem("ignite_rsvp_queue", JSON.stringify([{
      id: "queued-rsvp-offline-1",
      eventId,
      userId,
      status: "going",
      queuedAt: new Date().toISOString(),
      retryCount: 0,
    }]));
    (window as any).__setSyntheticOnline(false);
  }, { eventId: "00000000-0000-4000-8000-000000009040", userId });

  await expect(page.getByText(/Offline • 1 pending/)).toBeVisible({ timeout: 3_000 });
  state.setApiAvailable(true);
  await page.evaluate(() => (window as any).__setSyntheticOnline(true));

  await expect.poll(() => state.rsvpInserts.length, { timeout: 10_000 }).toBe(1);
  expect(state.rsvpInserts[0]).toEqual(expect.objectContaining({
    event_id: "00000000-0000-4000-8000-000000009040",
    user_id: userId,
    status: "going",
    source: "user",
  }));
  await expect(page.getByText(/1 pending/)).toHaveCount(0, { timeout: 5_000 });
});

test("repeated connection loss and restoration never blocks primary navigation", async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page);
  await page.goto("/messages");
  await expect(page.getByText("Synthetic Messaging Team", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  for (let cycle = 0; cycle < 3; cycle += 1) {
    state.setApiAvailable(false);
    await page.evaluate(() => (window as any).__setSyntheticOnline(false));
    await expect(page.getByText("Offline", { exact: true })).toBeVisible({ timeout: 3_000 });
    const destination = cycle % 2 === 0 ? "Schedule" : "Media";
    await page.getByRole("link", { name: destination }).click({ timeout: 1_500 });
    await expect(page).toHaveURL(destination === "Schedule" ? /\/events/ : /\/media/, { timeout: 1_500 });

    state.setApiAvailable(true);
    await page.evaluate(() => (window as any).__setSyntheticOnline(true));
    await expect(page.getByText("Offline", { exact: true })).toHaveCount(0, { timeout: 5_000 });
    await page.getByRole("link", { name: "Messages", exact: true }).click({ timeout: 1_500 });
    await expect(page).toHaveURL(/\/messages(?:\?|$)/, { timeout: 1_500 });
  }
});

for (const nativeCase of [
  { label: "Android", platform: "android" },
  { label: "iOS", platform: "ios" },
] as const) {
test(`${nativeCase.label} Home reveals Next Up and My Teams together without pushing content`, async ({ page }) => {
  test.setTimeout(30_000);
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, {
    nativeRuntime: nativeCase.platform,
    deferHomeEvents: true,
  });

  await page.goto("/");
  await expect.poll(() => page.evaluate(() => (window as any).Capacitor?.getPlatform?.()))
    .toBe(nativeCase.platform);
  await expect(page.getByRole("heading", { name: /Welcome,/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".animate-pulse").first()).toBeVisible({ timeout: 5_000 });
  // My Teams must not paint high on the page while Next Up is unresolved and
  // then get shoved down when the event card arrives.
  await expect(page.getByRole("heading", { name: /^My Teams/ })).toHaveCount(0);

  state.releaseHomeEvents();
  await expect(page.getByRole("heading", { name: "Next Up", exact: true })).toBeVisible({ timeout: 8_000 });
  const myTeams = page.getByRole("heading", { name: /^My Teams/ });
  await expect(myTeams).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".animate-pulse")).toHaveCount(0, { timeout: 8_000 });

  const samples = await myTeams.evaluate(async (element) => {
    const positions: number[] = [];
    // Half a second of consecutive frames is sufficient to catch the delayed
    // Next Up insertion without consuming most of the journey's time budget.
    for (let frame = 0; frame < 30; frame += 1) {
      positions.push(element.getBoundingClientRect().top);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return positions;
  });
  expect(Math.max(...samples) - Math.min(...samples)).toBeLessThanOrEqual(1);
});

test(`${nativeCase.label} in-app message notification reveals and pins the exact row without jolt`, async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, {
    nativeRuntime: nativeCase.platform,
    deferMessageHistory: true,
  });
  await page.goto("/notifications");
  await page.getByText("Alex sent a message", { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/messages/${teamId}\\?.*message=${targetId}`));
  await expect(page.locator(`#message-${targetId}`)).toHaveCount(0);

  // Observe continuously before releasing the target history. The jump
  // lifecycle begins as that data becomes available, and a fast native-like
  // renderer may align and start fading between two Playwright assertions.
  // Recording the transition proves the list was fully masked while aligning
  // without requiring the mask to remain up after the row is stable.
  await page.evaluate(() => {
    (window as any).__sawOpaqueChatJumpHydration = false;
    const sample = () => {
      const overlays = document.querySelectorAll('[data-chat-jump-hydration="true"]');
      if ([...overlays].some((overlay) => Number(getComputedStyle(overlay).opacity) > 0.99)) {
        (window as any).__sawOpaqueChatJumpHydration = true;
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  state.releaseMessageHistory();
  const target = page.locator(`#message-${targetId}`);
  await expect(target).toContainText("Exact synthetic notification target", { timeout: 8_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__sawOpaqueChatJumpHydration)).toBe(true);
  // The jump overlay intentionally masks Virtuoso's final target alignment.
  // Measure stability only once the row is actually visible to the user.
  await expect.poll(
    () => target.evaluate((element) => {
      let current: Element | null = element;
      while (current) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        current = current.parentElement;
      }
      return true;
    }),
    { timeout: 10_000 },
  ).toBe(true);
  const geometry = await target.evaluate(async (element) => {
    const tops: number[] = [];
    const bottoms: number[] = [];
    for (let frame = 0; frame < 60; frame += 1) {
      const rect = element.getBoundingClientRect();
      tops.push(rect.top);
      bottoms.push(rect.bottom);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const composerTop = document.querySelector('[data-chat-composer="true"]')
      ?.getBoundingClientRect().top ?? innerHeight;
    return { tops, bottoms, composerTop };
  });
  expect(Math.min(...geometry.tops)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...geometry.bottoms)).toBeLessThanOrEqual(geometry.composerTop + 1);
  expect(Math.max(...geometry.tops) - Math.min(...geometry.tops)).toBeLessThanOrEqual(1);
});

test(`${nativeCase.label} cold push to old history reveals and pins only its exact message`, async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const state = await install(page, defaultBell, {
    nativeRuntime: nativeCase.platform,
    deferMessageHistory: true,
  });
  await page.goto(`/messages/${teamId}?message=${oldPushTargetId}&jump=1722400000001`);
  await expect(page.locator(`#message-${oldPushTargetId}`)).toHaveCount(0);

  state.releaseMessageHistory();
  const target = page.locator(`#message-${oldPushTargetId}`);
  await expect(target).toContainText("Exact notification target from last season", { timeout: 10_000 });
  expect(oldPushTargetId).not.toBe(targetId);
  const geometry = await target.evaluate(async (element) => {
    const tops: number[] = [];
    const bottoms: number[] = [];
    for (let frame = 0; frame < 60; frame += 1) {
      const rect = element.getBoundingClientRect();
      tops.push(rect.top);
      bottoms.push(rect.bottom);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const composerTop = document.querySelector('[data-chat-composer="true"]')
      ?.getBoundingClientRect().top ?? innerHeight;
    return { tops, bottoms, composerTop };
  });
  expect(Math.min(...geometry.tops)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...geometry.bottoms)).toBeLessThanOrEqual(geometry.composerTop + 1);
  expect(Math.max(...geometry.tops) - Math.min(...geometry.tops)).toBeLessThanOrEqual(1);
});

test(`${nativeCase.label} cold WebView restart returns to the exact open pitchboard route`, async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, { nativeRuntime: nativeCase.platform });
  const pitchBoardPath = `/teams/${teamId}?from=game-day&tab=lineup`;

  await page.goto("/");
  await expect.poll(() => page.evaluate(() => (window as any).Capacitor?.getPlatform?.()))
    .toBe(nativeCase.platform);
  await page.evaluate(({ pitchBoardPath, teamId }) => {
    localStorage.setItem("ignite-pitch-board-open", "true");
    localStorage.setItem("ignite-pitch-board-open-path", pitchBoardPath);
    localStorage.setItem("ignite-pitch-board-open-at", String(Date.now()));
    localStorage.setItem("ignite-pitch-board-last-context", JSON.stringify({
      teamId,
      teamName: "Synthetic Messaging Team",
      readOnly: false,
    }));
  }, { pitchBoardPath, teamId });

  // A native OS may destroy the WebView while the phone is locked. Reloading
  // deliberately drops all in-memory React/global state while retaining only
  // the same local persistence that survives a genuine process recreation.
  await page.reload().catch((error) => {
    // Restoring the durable pitchboard route may redirect before Playwright's
    // original reload load event completes. That interruption is expected.
    const message = String(error);
    if (!message.includes("Frame load interrupted") && !message.includes("WebKit encountered an internal error")) {
      throw error;
    }
  });

  await expect(page).toHaveURL(
    new RegExp(`/teams/${teamId}\\?from=game-day&tab=lineup&openPitchBoard=1$`),
    { timeout: 5_000 },
  );
  await expect(page).not.toHaveURL(/\/(?:messages|events|media)(?:\/|\?|$)/);
});

test(`${nativeCase.label} cold WebView restart overrides a stale non-pitchboard history entry`, async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, { nativeRuntime: nativeCase.platform });
  const pitchBoardPath = `/teams/${teamId}?from=game-day&tab=lineup`;

  await page.goto("/messages");
  await page.evaluate(({ pitchBoardPath, teamId }) => {
    localStorage.setItem("ignite-pitch-board-open", "true");
    localStorage.setItem("ignite-pitch-board-open-path", pitchBoardPath);
    localStorage.setItem("ignite-pitch-board-open-at", String(Date.now()));
    localStorage.setItem("ignite-pitch-board-last-context", JSON.stringify({
      teamId,
      teamName: "Synthetic Messaging Team",
      readOnly: false,
    }));
  }, { pitchBoardPath, teamId });

  // Recreate the document on the wrong history entry while retaining only
  // the durable state that survives a native process/WebView recreation.
  await page.reload().catch((error) => {
    // The restore hook may redirect while the reload is still awaiting its
    // original load event. That interrupted navigation is the behaviour under
    // test; any other reload failure remains fatal.
    if (!String(error).includes("Frame load interrupted")) throw error;
  });

  await expect(page).toHaveURL(
    new RegExp(`/teams/${teamId}\\?from=game-day&tab=lineup&openPitchBoard=1$`),
    { timeout: 6_000 },
  );
});

test(`${nativeCase.label} warm unlock restores a lost pitchboard modal without changing page`, async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, { nativeRuntime: nativeCase.platform });
  const pitchBoardPath = `/teams/${teamId}?from=game-day`;
  await page.goto(pitchBoardPath);
  await expect.poll(() => page.evaluate(() => (window as any).Capacitor?.getPlatform?.()))
    .toBe(nativeCase.platform);

  await page.evaluate(({ pitchBoardPath, teamId }) => {
    localStorage.setItem("ignite-pitch-board-open", "true");
    localStorage.setItem("ignite-pitch-board-open-path", pitchBoardPath);
    localStorage.setItem("ignite-pitch-board-last-context", JSON.stringify({
      teamId,
      teamName: "Synthetic Messaging Team",
      readOnly: false,
    }));
    (window as any).__pitchBoardMountedThisSession = true;
    (window as any).__pitchBoardMounted = false;

    let visibility: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
  }, { pitchBoardPath, teamId });

  await expect(page).toHaveURL(
    new RegExp(`/teams/${teamId}\\?from=game-day&openPitchBoard=1$`),
    { timeout: 5_000 },
  );
});

test(`${nativeCase.label} Team page entry reopens the actual pitchboard after WebView recreation`, async ({ page }) => {
  test.slow();
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, {
    nativeRuntime: nativeCase.platform,
    pitchBoardController: true,
  });
  await page.goto(`/teams/${teamId}`);

  const entry = page.getByRole("button", { name: "Pitch Board" });
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await entry.click();

  await expect.poll(() => page.evaluate(() => ({
    open: localStorage.getItem("ignite-pitch-board-open"),
    path: localStorage.getItem("ignite-pitch-board-open-path"),
    mounted: (window as any).__pitchBoardMounted === true,
  })), { timeout: 15_000 }).toEqual({
    open: "true",
    path: `/teams/${teamId}`,
    mounted: true,
  });

  // A native OS can destroy and recreate the WebView during lock. This drops
  // React modal state and globals while retaining localStorage.
  await page.evaluate(() => {
    (window as any).__pitchBoardPreRecreationDocument = true;
  });
  await page.reload().catch((error) => {
    const message = String(error);
    // WebKit occasionally reports an internal navigation error after the new
    // document has already loaded. The assertions below still require proof
    // that the old document was destroyed and the pitchboard was restored.
    if (
      !message.includes("Frame load interrupted")
      && !message.includes("WebKit encountered an internal error")
    ) {
      throw error;
    }
  });

  await expect.poll(() => page.evaluate(() => ({
    recreated: (window as any).__pitchBoardPreRecreationDocument !== true,
    open: localStorage.getItem("ignite-pitch-board-open"),
    mounted: (window as any).__pitchBoardMounted === true,
  })), { timeout: 15_000 }).toEqual({ recreated: true, open: "true", mounted: true });
  await expect(page).toHaveURL(new RegExp(`/teams/${teamId}(?:\\?|$)`));
});

test(`${nativeCase.label} warm unlock repairs non-pitchboard route drift while locked`, async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, { nativeRuntime: nativeCase.platform });
  const pitchBoardPath = `/teams/${teamId}?from=game-day&tab=lineup`;
  await page.goto("/media");

  await page.evaluate(({ pitchBoardPath, teamId }) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    localStorage.setItem("ignite-pitch-board-open", "true");
    localStorage.setItem("ignite-pitch-board-open-path", pitchBoardPath);
    localStorage.setItem("ignite-pitch-board-open-at", String(Date.now()));
    localStorage.setItem("ignite-pitch-board-last-context", JSON.stringify({
      teamId,
      teamName: "Synthetic Messaging Team",
      readOnly: false,
    }));
    (window as any).__pitchBoardMountedThisSession = true;
    (window as any).__pitchBoardMounted = false;
  }, { pitchBoardPath, teamId });

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
  });

  await expect(page).toHaveURL(
    new RegExp(`/teams/${teamId}\\?from=game-day&tab=lineup&openPitchBoard=1$`),
    { timeout: 6_000 },
  );
});

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

test(`${nativeCase.label} opening Inbox after inactivity reaches stable conversations within budget`, async ({ page }) => {
  test.setTimeout(40_000);
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, { nativeRuntime: nativeCase.platform });

  // Warm the user-scoped inbox cache, leave the route, then model a long
  // background stint before opening Inbox again.
  await page.goto("/messages");
  await expect(page.getByText("Synthetic Messaging Team", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(5_000);
  await page.getByRole("link", { name: "Home" }).click();
  await page.evaluate(() => {
    let visibility: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
  });

  const started = Date.now();
  await page.getByRole("link", { name: "Messages", exact: true }).click({
    timeout: 1_500,
  });
  // Do not let a same-named team card on the route we are leaving satisfy the
  // readiness assertion. On slower mobile navigation that made the geometry
  // sampler start before the Messages route had committed, incorrectly
  // recording a missing inbox row as a post-reveal disappearance.
  await expect(page).toHaveURL(/\/messages(?:\?|$)/, { timeout: 4_000 });
  const thread = page.locator(`a[href="/messages/${teamId}"]`).filter({
    has: page.getByRole("heading", { name: "Synthetic Messaging Team", exact: true }),
  });
  await expect(thread).toBeVisible({ timeout: 4_000 });
  expect(Date.now() - started).toBeLessThan(4_000);
  await expect(page.locator(".animate-pulse")).toHaveCount(0);

  // Once revealed, the first card must remain geometrically stable.
  const positions = await page.evaluate(async ({ href }) => {
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const element = document.querySelector(`a[href="${href}"] h3`);
      samples.push(element ? element.getBoundingClientRect().top : -10_000);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return samples;
  }, { href: `/messages/${teamId}` });
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
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

test("a cross-club message notification switches club context before revealing its exact thread", async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await install(page, defaultBell, { wrongActiveClub: true });
  await page.goto("/notifications");

  await expect.poll(() => page.evaluate(({ userId }) =>
    localStorage.getItem(`ignite-club-theme-${userId}`), { userId })).toBe(otherClubId);
  await page.getByText("Alex sent a message", { exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/messages/${teamId}\\?.*message=${targetId}`));
  await expect(page.locator(`#message-${targetId}`)).toContainText(
    "Exact synthetic notification target",
    { timeout: 15_000 },
  );
  await expect.poll(() => page.evaluate(({ userId }) =>
    localStorage.getItem(`ignite-club-theme-${userId}`), { userId })).toBe(clubId);
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
