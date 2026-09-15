import { expect, test } from "@playwright/test";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const syntheticUser = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "synthetic.member@example.test",
  email_confirmed_at: "2026-01-01T00:00:00.000Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
};
const syntheticClubs = [
  {
    id: "00000000-0000-4000-8000-0000000000a1", name: "Synthetic Alpha FC", logo_url: null,
    show_logo_in_header: false, show_name_in_header: true, logo_only_mode: false, sport: "football",
    is_pro: true, theme_enabled: true, theme_primary_h: 150, theme_primary_s: 60, theme_primary_l: 35,
    theme_secondary_h: 210, theme_secondary_s: 60, theme_secondary_l: 40,
    theme_accent_h: 40, theme_accent_s: 80, theme_accent_l: 50,
    theme_dark_primary_h: null, theme_dark_primary_s: null, theme_dark_primary_l: null,
    theme_dark_secondary_h: null, theme_dark_secondary_s: null, theme_dark_secondary_l: null,
    theme_dark_accent_h: null, theme_dark_accent_s: null, theme_dark_accent_l: null,
    club_subscriptions: [{ is_pro: true, is_pro_football: false, expires_at: null }],
  },
  {
    id: "00000000-0000-4000-8000-0000000000b2", name: "Synthetic Beta FC", logo_url: null,
    show_logo_in_header: false, show_name_in_header: true, logo_only_mode: false, sport: "football",
    is_pro: true, theme_enabled: true, theme_primary_h: 220, theme_primary_s: 65, theme_primary_l: 45,
    theme_secondary_h: 280, theme_secondary_s: 55, theme_secondary_l: 45,
    theme_accent_h: 15, theme_accent_s: 80, theme_accent_l: 55,
    theme_dark_primary_h: null, theme_dark_primary_s: null, theme_dark_primary_l: null,
    theme_dark_secondary_h: null, theme_dark_secondary_s: null, theme_dark_secondary_l: null,
    theme_dark_accent_h: null, theme_dark_accent_s: null, theme_dark_accent_l: null,
    club_subscriptions: [{ is_pro: true, is_pro_football: false, expires_at: null }],
  },
];

function syntheticJwt() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: syntheticUser.id, role: "authenticated", aud: "authenticated", exp: 4_102_444_800 })}.synthetic`;
}

async function installSyntheticSession(page: import("@playwright/test").Page) {
  const accessToken = syntheticJwt();
  await page.addInitScript(
    ({ user, token }) => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify({
        access_token: token,
        refresh_token: "synthetic-refresh-token",
        expires_at: 4_102_444_800,
        expires_in: 3600,
        token_type: "bearer",
        user,
      }));
    },
    { user: syntheticUser, token: accessToken },
  );
}

test.beforeEach(async ({ page }) => {
  // These journeys exercise authentication and account/club boundaries, not
  // the delayed app-install promotion. Mark that unrelated prompt as recently
  // dismissed so it cannot cover an interaction on a slower CI runner.
  await page.addInitScript(() => {
    localStorage.setItem("ios-install-prompt-dismissed", Date.now().toString());
  });

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      await route.abort("blockedbyclient");
      return;
    }

    if (url.origin === "http://127.0.0.1:54321") {
      if (url.pathname === "/auth/v1/user") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(syntheticUser) });
        return;
      }
      if (url.pathname.includes("/auth/v1/token")) {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "synthetic authentication rejection" }) });
        return;
      }
      if (url.pathname.includes("/auth/v1/recover")) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "synthetic delivery failure" }) });
        return;
      }
      if (url.pathname === "/rest/v1/profiles") {
        const profile = {
          id: syntheticUser.id,
          display_name: "Synthetic Member",
          first_name: "Synthetic",
          last_name: "Member",
          active_club_theme_id: null,
        };
        const singular = route.request().headers()["accept"]?.includes("application/vnd.pgrst.object");
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(singular ? profile : [profile]) });
        return;
      }
      if (url.pathname === "/rest/v1/user_roles") {
        const select = url.searchParams.get("select") || "";
        const isPermissionProbe = url.searchParams.has("role");
        const body = isPermissionProbe
          ? []
          : select.includes("club_id") && !select.includes("teams")
            ? syntheticClubs.map((club) => ({ club_id: club.id }))
            : [];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        return;
      }
      if (url.pathname === "/rest/v1/clubs") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(syntheticClubs) });
        return;
      }
      if (url.pathname === "/rest/v1/club_subscriptions") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ is_pro: true, is_pro_football: false, expires_at: null }]),
        });
        return;
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        await route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": "0-0/0" }, body: "[]" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }

    await route.continue();
  });
});

test("a signed-out visitor cannot remain on a protected route", async ({ page }) => {
  const protectedDestination = "/events?view=calendar#upcoming";
  await page.goto(protectedDestination);
  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("redirectAfterAuth"))).toBe(
    protectedDestination,
  );
});

test("password-recovery deep links remain public and preserve their email parameter", async ({ page }) => {
  await page.goto("/verify-reset-code?email=member%2Bparent%40example.test");

  await expect(
    page.getByRole("heading", { name: "Enter your reset code" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("member+parent@example.test");
  await expect(page).toHaveURL(
    /\/verify-reset-code\?email=member%2Bparent%40example\.test$/,
  );
});

test("an auth URL containing a hostile redirect value cannot leave the app origin", async ({ page }) => {
  await page.goto(
    "/auth?redirect=%5C%5Cattacker.example%2Fphishing%3Fsession%3Dstolen",
  );

  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  const current = new URL(page.url());
  expect(LOOPBACK_HOSTS.has(current.hostname)).toBe(true);
  expect(current.pathname).toBe("/auth");
});

test("authentication returns to the protected deep link without corrupting browser history", async ({ page }) => {
  const priorPublicLocation =
    "/verify-reset-code?email=history%40example.test";
  await page.goto(priorPublicLocation);
  await expect(
    page.getByRole("heading", { name: "Enter your reset code" }),
  ).toBeVisible();

  const protectedDestination = "/events?view=calendar#upcoming";
  await page.goto(protectedDestination);
  await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  expect(await page.evaluate(() => sessionStorage.getItem("redirectAfterAuth"))).toBe(
    protectedDestination,
  );

  const accessToken = syntheticJwt();
  await page.evaluate(
    ({ user, token }) => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify({
        access_token: token,
        refresh_token: "synthetic-refresh-token",
        expires_at: 4_102_444_800,
        expires_in: 3600,
        token_type: "bearer",
        user,
      }));
    },
    { user: syntheticUser, token: accessToken },
  );
  await page.reload();

  await expect(page).toHaveURL(
    /\/events\?view=calendar#upcoming$/,
    { timeout: 12_000 },
  );
  expect(await page.evaluate(() => sessionStorage.getItem("redirectAfterAuth"))).toBeNull();

  await page.goBack();
  await expect(page).toHaveURL(
    /\/verify-reset-code\?email=history%40example\.test$/,
  );
  await page.goForward();
  await expect(page).toHaveURL(/\/events\?view=calendar#upcoming$/);
});

test("invalid sign-in input is rejected without an authentication request", async ({ page }) => {
  let tokenRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/auth/v1/token")) tokenRequests += 1;
  });

  await page.goto("/auth");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByLabel("Email")).toHaveJSProperty("validity.valid", false);
  expect(tokenRequests).toBe(0);
});

test("failed recovery delivery never reports that a code was sent", async ({ page }) => {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").fill("synthetic.user@example.test");
  await dialog.getByRole("button", { name: "Send Code" }).click();

  await expect(page.getByText("Code sent")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Send Code" })).toBeVisible();
  await expect(dialog.getByText(/enter the 6-digit code/i)).toHaveCount(0);
});

test("an authenticated non-admin cannot see application administration tools", async ({ page }) => {
  await installSyntheticSession(page);
  await page.goto("/admin");

  await expect(page.getByText("Access denied. Admin role required.")).toBeVisible();
  await expect(page.getByText("Management tools and settings")).toHaveCount(0);
  await expect(page.getByText("App Administration")).toHaveCount(0);
});

test("a non-admin is redirected before notification report data is requested", async ({ page }) => {
  const sensitiveRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/rest/v1/push_subscriptions") || pathname.includes("/rest/v1/notification_preferences")) {
      sensitiveRequests.push(pathname);
    }
  });
  await installSyntheticSession(page);
  await page.goto("/admin/notification-preferences");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Notification Preferences" })).toHaveCount(0);
  expect(sensitiveRequests).toEqual([]);
});

test("sign-out clears the previous account's local caches but preserves unrelated settings", async ({ page }) => {
  await installSyntheticSession(page);
  await page.addInitScript(() => {
    localStorage.setItem("ignite_cached_profile", JSON.stringify({ id: "previous-user-private" }));
    localStorage.setItem("ignite_message_cache_team_private-team", JSON.stringify([{ id: "private-message" }]));
    localStorage.setItem("ignite_active_club_theme_00000000-0000-4000-8000-000000000001", "private-club");
    localStorage.setItem("third_party_consent", "preserve-me");
    localStorage.setItem("ios-install-prompt-dismissed", Date.now().toString());
  });
  await page.goto("/events");

  // The header is rendered before membership and schedule loading completes.
  // Wait for the page's observable ready state so an initial rerender cannot
  // replace the open menu between pointer-down and selection.
  await expect(page.getByText("No upcoming events", { exact: true })).toBeVisible();

  const profileButton = page.locator("header button").last();
  await profileButton.click();
  const signOutMenuItem = page.getByRole("menuitem", { name: "Sign Out" });
  await expect(signOutMenuItem).toBeEnabled();
  await signOutMenuItem.click();

  // Sign-out awaits session revocation before clearing user state. Under a
  // loaded CI worker that transition can legitimately exceed Playwright's
  // five-second assertion default, so allow this one async boundary enough
  // time without weakening the required destination or storage assertions.
  await expect(page).toHaveURL(/\/auth(?:\?|$)/, { timeout: 12_000 });
  const storage = await page.evaluate(() => ({
    igniteKeys: Object.keys(localStorage).filter((key) => key.startsWith("ignite_")),
    unrelated: localStorage.getItem("third_party_consent"),
    authSession: localStorage.getItem("sb-127-auth-token"),
  }));
  expect(storage.igniteKeys).toEqual([]);
  expect(storage.unrelated).toBe("preserve-me");
  expect(storage.authSession).toBeNull();
});

test("switching clubs replaces the active filter and cached theme atomically", async ({ page }) => {
  await installSyntheticSession(page);
  await page.goto("/events");

  await page.locator("header button").filter({ hasText: "Ignite" }).first().click();
  await page.getByText("Synthetic Alpha FC", { exact: true }).click();
  await expect(page.locator("header")).toContainText("Synthetic Alpha");

  let selection = await page.evaluate((userId) => ({
    club: localStorage.getItem(`ignite-club-theme-${userId}`),
    data: JSON.parse(localStorage.getItem(`ignite-club-theme-data-${userId}`) || "null"),
  }), syntheticUser.id);
  expect(selection.club).toBe(syntheticClubs[0].id);
  expect(selection.data?.clubId).toBe(syntheticClubs[0].id);

  await page.locator("header button").filter({ hasText: "Synthetic Alpha" }).first().click();
  await page.getByText("Synthetic Beta FC", { exact: true }).click();
  await expect(page.locator("header")).toContainText("Synthetic Beta");

  selection = await page.evaluate((userId) => ({
    club: localStorage.getItem(`ignite-club-theme-${userId}`),
    data: JSON.parse(localStorage.getItem(`ignite-club-theme-data-${userId}`) || "null"),
  }), syntheticUser.id);
  expect(selection.club).toBe(syntheticClubs[1].id);
  expect(selection.data?.clubId).toBe(syntheticClubs[1].id);
});
