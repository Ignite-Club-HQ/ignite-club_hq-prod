import { expect, test } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000101";
const clubId = "00000000-0000-4000-8000-000000000102";
const eventId = "00000000-0000-4000-8000-000000000103";
const user = {
  id: userId, aud: "authenticated", role: "authenticated",
  email: "synthetic.club.admin@example.test",
  app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
};

test("club admin creates a club-wide game by grade, edits it to team grouping, and sees grouped attendance", async ({ page }) => {
  let grouping: "level" | "team" = "level";
  const writes: Array<{ method: string; body: any }> = [];

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
      if (select === "team_id") return json([]);
      return json([{
        id: "role-1", role: "club_admin", club_id: clubId, user_id: userId,
        team_id: "team-u8-blue",
        profiles: { id: userId, display_name: "Synthetic Admin" },
      }, {
        id: "role-2", role: "coach", club_id: clubId, user_id: "synthetic-coach-u10",
        team_id: "team-u10-red",
        profiles: { id: "synthetic-coach-u10", display_name: "Synthetic U10 Coach" },
      }]);
    }
    if (url.pathname === "/rest/v1/clubs") return json([{
      id: clubId, name: "Synthetic Riverside FC",
      allow_guests_default: false, max_guests_per_member_default: 2,
    }]);
    if (url.pathname === "/rest/v1/teams") return json([
      { id: "team-u8-blue", club_id: clubId, name: "U8 Blue", age_group: "U8" },
      { id: "team-u10-red", club_id: clubId, name: "U10 Red", age_group: "U10" },
    ]);
    if (url.pathname === "/rest/v1/club_subscriptions") return json([]);
    if (url.pathname === "/rest/v1/events" && request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push({ method: "POST", body });
      grouping = body.rsvp_grouping;
      return json([{ ...body, id: eventId, is_cancelled: false }]);
    }
    if (url.pathname === "/rest/v1/events" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      writes.push({ method: "PATCH", body });
      grouping = body.rsvp_grouping;
      return json([{ id: eventId, ...body }]);
    }
    if (url.pathname === "/rest/v1/events") {
      const event = {
      id: eventId, club_id: clubId, team_id: null, created_by: userId,
      title: "Synthetic Club Game", type: "game", event_date: "2099-08-01T10:00:00Z",
      address: "Synthetic Oval", rsvp_grouping: grouping, is_cancelled: false,
      clubs: { name: "Synthetic Riverside FC" }, teams: null, mini_leagues: null,
      };
      const singular = request.headers()["accept"]?.includes("application/vnd.pgrst.object");
      return json(singular ? event : [event]);
    }
    if (url.pathname === "/rest/v1/profiles") return json([{
      id: userId, display_name: "Synthetic Admin",
    }]);
    if (url.pathname === "/rest/v1/child_team_assignments") return json([]);
    if (url.pathname === "/rest/v1/rsvps") return json([]);
    if (url.pathname.startsWith("/rest/v1/")) return json([]);
    return json({});
  });

  await page.goto("/events/new");
  await page.getByRole("button", { name: /Game/ }).click();
  await page.getByLabel("Event Title").fill("Synthetic Club Game");
  await page.getByLabel("Date & Time").fill("2099-08-01T10:00");
  await page.getByPlaceholder("Search for address...").fill("Synthetic Oval");

  const groupingSelect = page.getByText("RSVP grouping", { exact: true }).locator("..").getByRole("combobox");
  await groupingSelect.click();
  await page.getByRole("option", { name: /Group by age level/ }).click();

  const create = page.getByRole("button", { name: "Create Event" });
  await expect(create).toBeEnabled();
  await create.click();
  await expect.poll(() => writes[0]?.body).toMatchObject({
    club_id: clubId, team_id: null, type: "game", rsvp_grouping: "level",
  });

  await page.goto(`/events/${eventId}/edit`);
  await page.getByRole("button", { name: "Club & Team" }).click();
  const editGrouping = page.getByText("RSVP grouping", { exact: true }).locator("..").getByRole("combobox");
  await editGrouping.click();
  const teamOption = page.getByRole("option", { name: /Group by team/ });
  await expect(teamOption).toBeVisible();
  await page.evaluate(() => {
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find(node => node.textContent?.includes("Group by team"));
    option?.click();
  });
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect.poll(() => writes.find(write => write.method === "PATCH")?.body).toMatchObject({
    team_id: null, rsvp_grouping: "team",
  });

  await page.goto(`/events/${eventId}`);
  await expect(page.getByText("Attendance by team")).toBeVisible();
  await expect(page.getByRole("button", { name: /U8 Blue/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /U10 Red/ })).toBeVisible();
});
