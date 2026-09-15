import { expect, test } from "@playwright/test";

const userId = "51000000-0000-4000-8000-000000000001";
const clubId = "51000000-0000-4000-8000-000000000002";
const teamId = "51000000-0000-4000-8000-000000000003";
const parentId = "51000000-0000-4000-8000-000000000004";

const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "synthetic.series.admin@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

function occurrence(id: string, date: string, parentEventId: string | null) {
  return {
    id,
    club_id: clubId,
    team_id: teamId,
    mini_league_id: null,
    created_by: userId,
    title: "Synthetic Weekly Training",
    type: "training",
    event_date: `${date}T09:00:00.000Z`,
    start_time: `${date}T09:00:00.000Z`,
    end_time: `${date}T10:30:00.000Z`,
    address: "Synthetic Oval",
    description: "A local-only recurring event",
    is_cancelled: false,
    is_recurring: true,
    recurrence_pattern: "weekly",
    recurrence_interval: 1,
    recurrence_days: null,
    recurrence_end_date: "2099-08-15",
    parent_event_id: parentEventId,
    reminder_hours_before: null,
    reminder_sent: false,
    amount: null,
    opponent: null,
    arrival_minutes_before: null,
    rsvp_audience: "all",
    rsvp_grouping: null,
    is_bye: false,
    allow_guests: null,
    max_guests_per_member: null,
    restricted_to_roles: null,
    adults_only: false,
    clubs: { name: "Synthetic Riverside FC" },
    teams: { name: "Synthetic U10" },
    mini_leagues: null,
  };
}

test("club admin extends a recurring series end date from the edit journey", async ({ page }) => {
  test.setTimeout(30_000);
  const events = [
    occurrence(parentId, "2099-08-01", null),
    occurrence("51000000-0000-4000-8000-000000000005", "2099-08-08", parentId),
    occurrence("51000000-0000-4000-8000-000000000006", "2099-08-15", parentId),
  ];
  const writes: Array<{ method: string; body: any; search: string }> = [];
  let rejectSeriesUpdate = false;
  let seriesUpdateAttempts = 0;

  await page.addInitScript(({ user, userId }) => {
    const encode = (value: object) => btoa(JSON.stringify(value)).replaceAll("=", "");
    const token =
      `${encode({ alg: "HS256", typ: "JWT" })}.` +
      `${encode({ sub: userId, role: "authenticated", exp: 4102444800 })}.synthetic`;
    localStorage.setItem(
      "sb-127-auth-token",
      JSON.stringify({
        access_token: token,
        refresh_token: "synthetic",
        expires_at: 4102444800,
        expires_in: 3600,
        token_type: "bearer",
        user,
      }),
    );
    localStorage.setItem("ios-install-prompt-dismissed", Date.now().toString());
  }, { user, userId });

  await page.route("**/*", async (route) => {
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
      const select = url.searchParams.get("select") ?? "";
      if (select === "club_id") return json([{ club_id: clubId }]);
      if (select === "team_id") return json([{ team_id: teamId }]);
      if (select.includes("team_id") && select.includes("teams(")) {
        return json([{
          team_id: teamId,
          teams: {
            id: teamId,
            name: "Synthetic U10",
            club_id: clubId,
            default_match_arrival_minutes: null,
          },
        }]);
      }
      return json([{
        id: "synthetic-admin-role",
        role: "club_admin",
        club_id: clubId,
        team_id: null,
        user_id: userId,
        profiles: { id: userId, display_name: "Synthetic Series Admin" },
      }]);
    }
    if (url.pathname === "/rest/v1/clubs") {
      return json([{ id: clubId, name: "Synthetic Riverside FC" }]);
    }
    if (url.pathname === "/rest/v1/club_subscriptions") {
      return json([{ is_pro: true, is_pro_football: false, expires_at: null }]);
    }
    if (url.pathname === "/rest/v1/teams") {
      return json([{ id: teamId, club_id: clubId, name: "Synthetic U10", age_group: "U10" }]);
    }
    if (url.pathname === "/rest/v1/events" && request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push({ method: "POST", body, search: url.search });
      const rows = (Array.isArray(body) ? body : [body]).map((row, index) => ({
        ...row,
        id: `51000000-0000-4000-8000-00000000010${index}`,
      }));
      events.push(...rows);
      return json(rows);
    }
    if (url.pathname === "/rest/v1/events" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      writes.push({ method: "PATCH", body, search: url.search });
      const parentFilter = url.searchParams.get("parent_event_id");
      const idFilter = url.searchParams.get("id");
      for (const event of events) {
        if (
          (parentFilter === `eq.${parentId}` && event.parent_event_id === parentId) ||
          (idFilter === `eq.${parentId}` && event.id === parentId)
        ) {
          Object.assign(event, body);
        }
      }
      return json([]);
    }
    if (url.pathname === "/rest/v1/events") {
      const select = url.searchParams.get("select") ?? "";
      const parentFilter = url.searchParams.get("parent_event_id");
      const idFilter = url.searchParams.get("id");
      let result = events;
      if (parentFilter === `eq.${parentId}`) {
        result = events.filter((event) => event.parent_event_id === parentId);
      } else if (idFilter === `eq.${parentId}`) {
        result = events.filter((event) => event.id === parentId);
      }
      const singular = request.headers()["accept"]?.includes("application/vnd.pgrst.object");
      // SeriesEndDateEditor requests a narrow projection; returning extra
      // fields is valid PostgREST JSON and keeps this fake behaviour-focused.
      return json(singular ? result[0] ?? null : result);
    }
    if (url.pathname === "/rest/v1/rpc/update_event_series") {
      seriesUpdateAttempts += 1;
      if (rejectSeriesUpdate) {
        return json({ code: "42501", message: "synthetic series update denied" }, 403);
      }
      return json(null);
    }
    if (url.pathname === "/rest/v1/profiles") {
      return json([{ id: userId, display_name: "Synthetic Series Admin" }]);
    }
    if (url.pathname.startsWith("/rest/v1/")) return json([]);
    return json({});
  });

  await page.goto(`/events/${parentId}/edit`);

  const endDate = page.getByLabel("Series ends on");
  await expect(endDate).toHaveValue("2099-08-15");
  await expect(page.getByText(/3 occurrences/i)).toBeVisible();
  await endDate.fill("2099-08-29");
  await page.getByRole("button", { name: "Update" }).click();

  await expect(page.getByRole("heading", { name: "Extend series?" })).toBeVisible();
  await expect(page.getByText(/add 2 new occurrences/i)).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect.poll(() => writes.filter((write) => write.method === "POST").length).toBe(1);
  const inserted = writes.find((write) => write.method === "POST")!.body;
  expect(inserted).toHaveLength(2);
  expect(inserted).toEqual([
    expect.objectContaining({
      event_date: "2099-08-22T09:00:00.000Z",
      start_time: "2099-08-22T09:00:00.000Z",
      end_time: "2099-08-22T10:30:00.000Z",
      parent_event_id: parentId,
      recurrence_end_date: "2099-08-29",
    }),
    expect.objectContaining({
      event_date: "2099-08-29T09:00:00.000Z",
      start_time: "2099-08-29T09:00:00.000Z",
      end_time: "2099-08-29T10:30:00.000Z",
      parent_event_id: parentId,
      recurrence_end_date: "2099-08-29",
    }),
  ]);
  await expect.poll(() => writes.filter((write) => write.method === "PATCH").length).toBe(2);
  expect(writes.filter((write) => write.method === "PATCH")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        body: { recurrence_end_date: "2099-08-29" },
        search: expect.stringContaining(`id=eq.${parentId}`),
      }),
      expect.objectContaining({
        body: { recurrence_end_date: "2099-08-29" },
        search: expect.stringContaining(`parent_event_id=eq.${parentId}`),
      }),
    ]),
  );

  rejectSeriesUpdate = true;
  await page.goto(`/events/${parentId}/edit`);
  await page.getByLabel("Event Title").fill("Must not update the series");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByRole("heading", { name: /Apply changes to/i })).toBeVisible();
  await page.getByRole("button", { name: "Entire Series" }).click();
  await expect.poll(() => seriesUpdateAttempts).toBe(1);
  await expect(page).toHaveURL(`/events/${parentId}/edit`);
  await expect(page.getByText("Failed to update event. Please try again.", { exact: true })).toBeVisible();
});
