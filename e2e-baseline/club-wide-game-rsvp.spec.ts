import { expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000101";
const clubId = "00000000-0000-4000-8000-000000000102";
const eventId = "00000000-0000-4000-8000-000000000103";
const user = {
  id: userId, aud: "authenticated", role: "authenticated",
  email: "synthetic.club.admin@example.test",
  app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
};

async function installClubWideGameHarness(page: Page) {
  let grouping: "level" | "team" = "level";
  let targetTeamIds: string[] | null = null;
  let currentEvent: Record<string, any> = {
    id: eventId, club_id: clubId, team_id: null, created_by: userId,
    title: "Synthetic Club Game", type: "game", event_date: "2099-08-01T10:00:00Z",
    start_time: "2099-08-01T10:00:00Z", end_time: "2099-08-01T11:00:00Z",
    address: "Synthetic Oval", rsvp_grouping: grouping,
    target_team_ids: targetTeamIds, is_cancelled: false,
  };
  const state = { exposeExistingDuty: false };
  const writes: Array<{ method: string; body: any }> = [];
  const rpcWrites: Array<{ event: any; duties: any[]; childDates: string[] | null }> = [];
  const teams = [
    { id: "team-u8-blue", club_id: clubId, name: "U8 Blue", age_group: "U8" },
    { id: "team-u8-red", club_id: clubId, name: "U8 Red", age_group: "U8" },
    { id: "team-u10-red", club_id: clubId, name: "U10 Red", age_group: "U10" },
    { id: "team-u12-green", club_id: clubId, name: "U12 Green", age_group: "U12" },
  ];

  await page.addInitScript(({ user, userId }) => {
    const enc = (v: object) => btoa(JSON.stringify(v)).replaceAll("=", "");
    const token = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: userId, role: "authenticated", exp: 4102444800 })}.synthetic`;
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: token, refresh_token: "synthetic", expires_at: 4102444800,
      expires_in: 3600, token_type: "bearer", user,
    }));
    localStorage.setItem("ios-install-prompt-dismissed", Date.now().toString());
  }, { user, userId });

  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      await route.abort("blockedbyclient");
      return;
    }
    if (url.origin !== "http://127.0.0.1:54321") {
      await route.continue();
      return;
    }

    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/auth/v1/user") return json(user);
    if (url.pathname === "/rest/v1/user_roles") {
      const select = url.searchParams.get("select") || "";
      if (select === "club_id") return json([{ club_id: clubId }]);
      if (select === "team_id") return json(teams.map(({ id }) => ({ team_id: id })));
      return json([{
        id: "role-1", role: "club_admin", club_id: clubId, user_id: userId,
        team_id: "team-u8-blue",
        profiles: { id: userId, display_name: "Synthetic Admin" },
      }, {
        id: "role-u8-red", role: "parent", club_id: clubId, user_id: "adult-u8-red",
        team_id: "team-u8-red",
        profiles: { id: "adult-u8-red", display_name: "Riley U8 Red" },
      }, {
        id: "role-2", role: "coach", club_id: clubId, user_id: "synthetic-coach-u10",
        team_id: "team-u10-red",
        profiles: { id: "synthetic-coach-u10", display_name: "Synthetic U10 Coach" },
      }, {
        id: "role-u12", role: "coach", club_id: clubId, user_id: "adult-u12",
        team_id: "team-u12-green",
        profiles: { id: "adult-u12", display_name: "Excluded U12 Coach" },
      }]);
    }
    if (url.pathname === "/rest/v1/clubs") return json([{
      id: clubId, name: "Synthetic Riverside FC",
      allow_guests_default: false, max_guests_per_member_default: 2,
    }]);
    if (url.pathname === "/rest/v1/teams") {
      const idFilter = url.searchParams.get("id");
      const rows = idFilter?.startsWith("in.")
        ? teams.filter(({ id }) => targetTeamIds?.includes(id))
        : idFilter?.startsWith("eq.")
          ? teams.filter(({ id }) => id === idFilter.slice(3))
          : teams;
      const singular = request.headers()["accept"]?.includes("application/vnd.pgrst.object");
      return json(singular ? (rows[0] ?? null) : rows);
    }
    if (url.pathname === "/rest/v1/club_subscriptions") {
      return json([{ is_pro: true, is_pro_football: false, expires_at: null }]);
    }
    if (url.pathname === "/rest/v1/rpc/create_event_with_duties") {
      const body = request.postDataJSON();
      const eventBody = body.p_event;
      writes.push({ method: "POST", body: eventBody });
      rpcWrites.push({ event: eventBody, duties: body.p_duties, childDates: body.p_child_dates });
      grouping = eventBody.rsvp_grouping;
      targetTeamIds = eventBody.target_team_ids;
      currentEvent = { ...currentEvent, ...eventBody, id: eventId, is_cancelled: false };
      return json(eventId);
    }
    if (url.pathname === "/rest/v1/rpc/sync_event_duties") return json([]);
    if (url.pathname === "/rest/v1/events" && request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push({ method: "POST", body });
      grouping = body.rsvp_grouping;
      targetTeamIds = body.target_team_ids;
      return json({ ...body, id: eventId, is_cancelled: false });
    }
    if (url.pathname === "/rest/v1/events" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      writes.push({ method: "PATCH", body });
      grouping = body.rsvp_grouping;
      targetTeamIds = body.target_team_ids;
      currentEvent = { ...currentEvent, ...body };
      return json({ id: eventId, ...body });
    }
    if (url.pathname === "/rest/v1/events") {
      const event = {
      ...currentEvent, rsvp_grouping: grouping, target_team_ids: targetTeamIds,
      clubs: { name: "Synthetic Riverside FC" }, teams: null, mini_leagues: null,
      };
      if (event.team_id) event.teams = teams.find(team => team.id === event.team_id) ?? null;
      const singular = request.headers()["accept"]?.includes("application/vnd.pgrst.object");
      return json(singular ? event : [event]);
    }
    if (url.pathname === "/rest/v1/duties" && request.method() === "GET") {
      return json(state.exposeExistingDuty ? [{
        id: "duty-existing",
        event_id: eventId,
        name: "Existing scorer",
        assigned_to: null,
      }] : []);
    }
    if (url.pathname === "/rest/v1/profiles") return json([{
      id: userId, display_name: "Synthetic Admin",
    }]);
    if (url.pathname === "/rest/v1/children") return json([
      { id: "child-u8-blue", name: "Bailey Blue", parent_id: userId },
      { id: "child-u8-red", name: "Robin Red", parent_id: "adult-u8-red" },
      { id: "child-u10-red", name: "Taylor U10", parent_id: "synthetic-coach-u10" },
      { id: "child-u12", name: "Excluded U12 Child", parent_id: "adult-u12" },
    ]);
    if (url.pathname === "/rest/v1/rpc/get_targeted_event_attendance_roster") {
      const roster = [
        { kind: "adult", person_id: userId, display_name: "Synthetic Admin", parent_id: null, team_ids: ["team-u8-blue"] },
        { kind: "adult", person_id: "adult-u8-red", display_name: "Riley U8 Red", parent_id: null, team_ids: ["team-u8-red"] },
        { kind: "adult", person_id: "synthetic-coach-u10", display_name: "Synthetic U10 Coach", parent_id: null, team_ids: ["team-u10-red"] },
        { kind: "adult", person_id: "adult-u12", display_name: "Excluded U12 Coach", parent_id: null, team_ids: ["team-u12-green"] },
        { kind: "child", person_id: "child-u8-blue", display_name: "Bailey Blue", parent_id: userId, team_ids: ["team-u8-blue"] },
        { kind: "child", person_id: "child-u8-red", display_name: "Robin Red", parent_id: "adult-u8-red", team_ids: ["team-u8-red"] },
        { kind: "child", person_id: "child-u10-red", display_name: "Taylor U10", parent_id: "synthetic-coach-u10", team_ids: ["team-u10-red"] },
        { kind: "child", person_id: "child-u12", display_name: "Excluded U12 Child", parent_id: "adult-u12", team_ids: ["team-u12-green"] },
      ];
      return json(roster.filter(row =>
        targetTeamIds?.some(teamId => row.team_ids.includes(teamId)),
      ));
    }
    if (url.pathname === "/rest/v1/child_team_assignments") return json([
      { child_id: "child-u8-blue", team_id: "team-u8-blue", children: { id: "child-u8-blue", name: "Bailey Blue" } },
      { child_id: "child-u8-red", team_id: "team-u8-red", children: { id: "child-u8-red", name: "Robin Red" } },
      { child_id: "child-u10-red", team_id: "team-u10-red", children: { id: "child-u10-red", name: "Taylor U10" } },
      { child_id: "child-u12", team_id: "team-u12-green", children: { id: "child-u12", name: "Excluded U12 Child" } },
    ]);
    if (url.pathname === "/rest/v1/rsvps") {
      const teamForAttendee: Record<string, string> = {
        [userId]: "team-u8-blue",
        "adult-u8-red": "team-u8-red",
        "child-u8-blue": "team-u8-blue",
        "child-u10-red": "team-u10-red",
        "adult-u12": "team-u12-green",
      };
      const rows = [
        { id: "rsvp-admin", user_id: userId, child_id: null, status: "going", profiles: { id: userId, display_name: "Synthetic Admin" }, children: null },
        { id: "rsvp-u8-red", user_id: "adult-u8-red", child_id: null, status: "not_going", profiles: { id: "adult-u8-red", display_name: "Riley U8 Red" }, children: null },
        { id: "rsvp-u8-blue-child", user_id: null, child_id: "child-u8-blue", status: "maybe", profiles: null, children: { id: "child-u8-blue", name: "Bailey Blue" } },
        { id: "rsvp-u10-child", user_id: null, child_id: "child-u10-red", status: "going", profiles: null, children: { id: "child-u10-red", name: "Taylor U10" } },
        { id: "rsvp-u12", user_id: "adult-u12", child_id: null, status: "going", profiles: { id: "adult-u12", display_name: "Excluded U12 Coach" }, children: null },
      ];
      return json(rows.filter(row => {
        if (!targetTeamIds) return true;
        const attendeeId = row.child_id || row.user_id!;
        return targetTeamIds.includes(teamForAttendee[attendeeId]);
      }));
    }
    if (url.pathname.startsWith("/rest/v1/")) return json([]);
    return json({});
  });

  return {
    writes,
    rpcWrites,
    state,
    getGrouping: () => grouping,
  };
}

test("team game journey creates the correct scoped payload and renders its team detail", async ({ page }) => {
  const { rpcWrites } = await installClubWideGameHarness(page);

  await page.goto("/events/new");
  await page.getByRole("button", { name: /Game/ }).click();
  await page.getByLabel("Event Title").fill("U8 Blue home game");
  await page.getByLabel("Date & Time").fill("2099-08-15T09:30");
  await page.getByPlaceholder("Search for address...").fill("Blue Team Oval");
  const teamSelect = page.getByText("Team", { exact: true }).locator("..").getByRole("combobox");
  await teamSelect.click();
  await page.getByRole("option", { name: "U8 Blue", exact: true }).click();

  const dutyInput = page.getByPlaceholder("e.g., BBQ duty, Scorer, First Aid");
  await dutyInput.fill("Ground marshal");
  await dutyInput.press("Enter");
  await page.getByRole("button", { name: "Create Event" }).click();

  await expect(page).toHaveURL(`/events/${eventId}`);
  await expect.poll(() => rpcWrites[0]).toMatchObject({
    event: {
      club_id: clubId,
      team_id: "team-u8-blue",
      type: "game",
      title: "U8 Blue home game",
      rsvp_grouping: null,
      target_team_ids: null,
    },
    duties: [{ name: "Ground marshal", assigned_to: null }],
    childDates: null,
  });
  await expect(page.getByText("U8 Blue home game", { exact: true })).toBeVisible();
  await expect(page.getByText("U8 Blue", { exact: true }).first()).toBeVisible();
});

test("club admin creates a club-wide game by grade, edits it to team grouping, and sees grouped attendance", async ({ page }) => {
  test.setTimeout(45_000);
  const { writes } = await installClubWideGameHarness(page);

  await page.goto("/events/new");
  await page.getByRole("button", { name: /Game/ }).click();
  await page.getByLabel("Event Title").fill("Synthetic Club Game");
  await page.getByLabel("Date & Time").fill("2099-08-01T10:00");
  await page.getByPlaceholder("Search for address...").fill("Synthetic Oval");

  const groupingSelect = page.getByText("RSVP grouping", { exact: true }).locator("..").getByRole("combobox");
  await groupingSelect.click();
  await page.getByRole("option", { name: /Group by age level/ }).click();

  await page.getByRole("button", { name: /Only selected teams/i }).click();
  await page.getByRole("checkbox", { name: "U8 Blue" }).click();
  await page.getByRole("checkbox", { name: "U8 Red" }).click();

  const create = page.getByRole("button", { name: "Create Event" });
  await expect(create).toBeEnabled();
  await create.click();
  await expect.poll(() => writes[0]?.body).toMatchObject({
    club_id: clubId, team_id: null, type: "game", rsvp_grouping: "level",
    target_team_ids: ["team-u8-blue", "team-u8-red"],
  });

  // Verify the user-visible result inside the unified attendance buckets, not
  // just the create payload. Both selected U8 teams map to the same grade.
  await page.goto(`/events/${eventId}`);
  const initialAttendance = page.locator("section").filter({ hasText: "Attendance" }).last();
  const initialMaybe = page.locator(`#attendance-group-maybe-${eventId}`);
  await expect(initialMaybe).toBeVisible();
  await expect(initialMaybe.getByText(/U8\s*\(1\)/i)).toBeVisible();
  await expect(initialMaybe.getByText("Bailey Blue", { exact: true })).toBeVisible();
  await expect(initialAttendance.getByText(/U10\s*\(/i)).not.toBeVisible();
  await expect(initialAttendance.getByText(/U12\s*\(/i)).not.toBeVisible();
  await expect(initialAttendance.getByText(/Other\s*\(/i)).not.toBeVisible();

  await page.goto(`/events/${eventId}/edit`);
  await page.getByRole("button", { name: "Club & Team" }).click();
  const editGrouping = () =>
    page
      .getByRole("combobox")
      .filter({ hasText: /Group by (?:age level|team)/ })
      .first();
  await expect(editGrouping()).toContainText("Group by age level");
  // Radix can replace an option node while its portal settles. Reacquire the
  // currently attached option rather than retaining a detached locator action.
  await editGrouping().click();
  await expect(async () => {
    let teamGroupingOption = page.getByRole("option", { name: /Group by team/ });
    if (!(await teamGroupingOption.isVisible())) {
      await editGrouping().click({ timeout: 1_500 });
      teamGroupingOption = page.getByRole("option", { name: /Group by team/ });
    }
    await expect(teamGroupingOption).toBeVisible({ timeout: 1_500 });
    await teamGroupingOption.click({ timeout: 1_500 });
  }).toPass({ timeout: 8_000 });
  await expect(editGrouping()).toContainText("Group by team");

  await page.getByRole("checkbox", { name: "U8 Red" }).click();
  await expect(page.getByText(/Select at least 2 teams/i)).toBeVisible();
  await page.getByRole("checkbox", { name: "U10 Red" }).click();
  await expect(page.getByText(/Select at least 2 teams/i)).not.toBeVisible();

  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect.poll(() => writes.find(write => write.method === "PATCH")?.body).toMatchObject({
    team_id: null,
    rsvp_grouping: "team",
    target_team_ids: ["team-u8-blue", "team-u10-red"],
  });

  await page.goto(`/events/${eventId}`);
  const editedAttendance = page.locator("section").filter({ hasText: "Attendance" }).last();
  const editedGoing = page.locator(`#attendance-group-going-${eventId}`);
  const editedMaybe = page.locator(`#attendance-group-maybe-${eventId}`);
  await expect(editedGoing.getByText(/U10 Red\s*\(1\)/i)).toBeVisible();
  await expect(editedGoing.getByText("Taylor U10", { exact: true })).toBeVisible();
  await expect(editedMaybe.getByText(/U8 Blue\s*\(1\)/i)).toBeVisible();
  await expect(editedMaybe.getByText("Bailey Blue", { exact: true })).toBeVisible();
  await expect(editedAttendance.getByText(/U8 Red\s*\(/i)).not.toBeVisible();
  await expect(editedAttendance.getByText(/U12 Green\s*\(/i)).not.toBeVisible();
  await expect(editedAttendance.getByText(/Other\s*\(/i)).not.toBeVisible();

  // A denied roster read must never masquerade as a valid empty RSVP list.
  // This is the failure mode the original route-only assertions could not see.
  await page.route("**/rest/v1/rpc/get_targeted_event_attendance_roster*", route =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        code: "42501",
        message: "permission denied for grouped RSVP roster",
      }),
    }),
  );
  await page.reload();
  const groupedAttendanceFailure = page.getByRole("alert").filter({
    hasText: /grouped attendance (?:couldn.t be loaded|could not be loaded|is unavailable)/i,
  });
  await expect(groupedAttendanceFailure).toBeVisible({ timeout: 15_000 });
});

test("a denied club-wide event edit remains retryable without changing committed state", async ({ page }) => {
  const { writes, getGrouping } = await installClubWideGameHarness(page);
  // A denied edit must not navigate away or replace the last committed event
  // with a false success state. This exercises the real form and mutation
  // boundary rather than only validating a helper payload.
  await page.route("**/rest/v1/events*", async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "42501", message: "synthetic event update denied" }),
    });
  });
  await page.goto(`/events/${eventId}/edit`);
  await page.getByLabel("Event Title").fill("Must not be committed");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page).toHaveURL(`/events/${eventId}/edit`);
  await expect(page.getByText("Failed to update event. Please try again.", { exact: true })).toBeVisible();
  expect(getGrouping()).toBe("level");
  expect(writes.filter(write => write.method === "PATCH")).toHaveLength(0);
});

test("a denied club-wide event creation remains on the form and permits retry", async ({ page }) => {
  const { writes } = await installClubWideGameHarness(page);
  await page.route("**/rest/v1/rpc/create_event_with_duties*", async route => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "42501", message: "synthetic event creation denied" }),
    });
  });
  const postsBeforeDeniedCreate = writes.filter(write => write.method === "POST").length;
  await page.goto("/events/new");
  await page.getByRole("button", { name: /Game/ }).click();
  await page.getByLabel("Event Title").fill("Denied synthetic event");
  await page.getByLabel("Date & Time").fill("2099-09-01T10:00");
  await page.getByPlaceholder("Search for address...").fill("Synthetic Oval");
  await page.getByRole("button", { name: "Create Event" }).click();
  await expect(page).toHaveURL("/events/new");
  await expect(
    page.getByText("Failed to create event. synthetic event creation denied", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Event" })).toBeEnabled();
  expect(writes.filter(write => write.method === "POST")).toHaveLength(postsBeforeDeniedCreate);
});

test("a denied duty write reports partial failure without claiming event success", async ({ page }) => {
  await installClubWideGameHarness(page);
  let deniedDutyWrites = 0;
  await page.route("**/rest/v1/rpc/create_event_with_duties*", async route => {
    deniedDutyWrites += 1;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "42501", message: "synthetic duty creation denied" }),
    });
  });
  await page.goto("/events/new");
  await page.getByRole("button", { name: /Game/ }).click();
  await page.getByLabel("Event Title").fill("Event with denied duty");
  await page.getByLabel("Date & Time").fill("2099-10-01T10:00");
  await page.getByPlaceholder("Search for address...").fill("Synthetic Oval");
  const dutyInput = page.getByPlaceholder("e.g., BBQ duty, Scorer, First Aid");
  await dutyInput.fill("First Aid");
  await dutyInput.press("Enter");
  await page.getByRole("button", { name: "Create Event" }).click();
  await expect.poll(() => deniedDutyWrites).toBe(1);
  await expect(page).toHaveURL("/events/new");
  await expect(
    page.getByText("Failed to create event. synthetic duty creation denied", { exact: true }),
  ).toBeVisible();
});

test("repeated create taps produce only one club-wide event mutation", async ({ page }) => {
  await installClubWideGameHarness(page);
  let deferredCreateAttempts = 0;
  let releaseDeferredCreate!: () => void;
  const deferredCreate = new Promise<void>(resolve => { releaseDeferredCreate = resolve; });
  await page.route("**/rest/v1/rpc/create_event_with_duties*", async route => {
    deferredCreateAttempts += 1;
    await deferredCreate;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(eventId),
    });
  });

  await page.goto("/events/new");
  await page.getByRole("button", { name: /Game/ }).click();
  await page.getByLabel("Event Title").fill("Single synthetic event");
  await page.getByLabel("Date & Time").fill("2099-10-01T10:00");
  await page.getByPlaceholder("Search for address...").fill("Synthetic Oval");
  const createWhilePending = page.locator("div.sticky").getByRole("button");
  await expect(createWhilePending).toBeEnabled();
  const firstClick = createWhilePending.click();
  await expect.poll(() => deferredCreateAttempts).toBe(1);
  await expect(createWhilePending).toBeDisabled();
  await createWhilePending.click({ force: true });
  expect(deferredCreateAttempts).toBe(1);
  releaseDeferredCreate();
  await firstClick;
  await expect(page).toHaveURL(`/events/${eventId}`);
  expect(deferredCreateAttempts).toBe(1);
});

test("a denied duty addition during event editing remains visible and retryable", async ({ page }) => {
  await installClubWideGameHarness(page);
  let deniedEditDutyWrites = 0;
  await page.route("**/rest/v1/rpc/sync_event_duties*", async route => {
    deniedEditDutyWrites += 1;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "42501", message: "synthetic edited duty denied" }),
    });
  });
  await page.goto(`/events/${eventId}/edit`);
  await page.getByRole("button", { name: /Duties/ }).click();
  const editDutyInput = page.getByPlaceholder("e.g., BBQ duty, Scorer, First Aid");
  await editDutyInput.fill("Ground marshal");
  await editDutyInput.press("Enter");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect.poll(() => deniedEditDutyWrites).toBe(1);
  await expect(page).toHaveURL(`/events/${eventId}/edit`);
  await expect(page.getByText("Event saved, duties not saved", { exact: true })).toBeVisible();
});

test("a denied duty deletion during event editing remains visible and retryable", async ({ page }) => {
  const { state } = await installClubWideGameHarness(page);
  state.exposeExistingDuty = true;
  let deniedDutyDeletes = 0;
  await page.route("**/rest/v1/rpc/sync_event_duties*", async route => {
    deniedDutyDeletes += 1;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "42501", message: "synthetic duty deletion denied" }),
    });
  });
  await page.goto(`/events/${eventId}/edit`);
  await page.getByRole("button", { name: /Duties/ }).click();
  const existingDuty = page.getByText("Existing scorer", { exact: true });
  await expect(existingDuty).toBeVisible();
  await existingDuty.locator("..").getByRole("button").click();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect.poll(() => deniedDutyDeletes).toBe(1);
  await expect(page).toHaveURL(`/events/${eventId}/edit`);
  await expect(page.getByText("Event saved, duties not saved", { exact: true })).toBeVisible();
});
