import { expect, test, type Page, type Route } from "@playwright/test";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const invitePath = "/join/p/synthetic-committee-invite";
const signupUser = {
  id: "00000000-0000-4000-8000-00000000c011",
  aud: "authenticated",
  role: "authenticated",
  email: "new.committee@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-08-09T00:00:00.000Z",
};

type SignupBehavior = "success" | "server-error" | "slow-success";
type EmailInviteRole =
  | "club_admin"
  | "committee_member"
  | "team_admin"
  | "coach"
  | "player"
  | "parent"
  | "league_admin";

type InviteEntry = {
  role: EmailInviteRole;
  teamScoped?: boolean;
  metadata?: Record<string, unknown>;
};

const otherEmailInviteRoles: Array<InviteEntry & { label: string }> = [
  { role: "club_admin", label: "Club Admin" },
  { role: "team_admin", label: "Team Admin", teamScoped: true },
  { role: "coach", label: "Coach", teamScoped: true },
  { role: "player", label: "Player", teamScoped: true },
  {
    role: "parent",
    label: "Parent",
    teamScoped: true,
    metadata: { children: [{ name: "Synthetic Child", yearOfBirth: 2017 }] },
  },
  {
    role: "league_admin",
    label: "League Admin",
    metadata: {
      mini_league_id: "00000000-0000-4000-8000-00000000c105",
      kind: "mini_league_admin_invite",
    },
  },
];

async function installNativePlatform(page: Page, platform: "Android" | "iOS") {
  await page.addInitScript((nativePlatform) => {
    if (nativePlatform === "Android") {
      (window as any).androidBridge = {};
    } else {
      const webkit = (window as any).webkit ?? {};
      webkit.messageHandlers = webkit.messageHandlers ?? { bridge: { postMessage: () => undefined } };
      (window as any).webkit = webkit;
    }
  }, platform);
}

async function installCommitteeInviteState(page: Page, platform: "Android" | "iOS") {
  await installNativePlatform(page, platform);
  await page.addInitScript(({ path, isIOS }) => {
    sessionStorage.setItem("authDefaultTab", "signup");
    sessionStorage.setItem("redirectAfterAuth", path);
    sessionStorage.setItem("autoJoinAfterAuth", "true");
    localStorage.setItem("inviteFlowContext", JSON.stringify({
      active: true,
      clubName: "Synthetic Riverside FC",
      role: "committee_member",
      inviteToken: "synthetic-committee-invite",
      isIOS,
      currentStep: "auth",
    }));
    localStorage.setItem("ios-install-prompt-dismissed", Date.now().toString());
  }, { path: invitePath, isIOS: platform === "iOS" });
}

async function installIsolatedAuthRoutes(
  page: Page,
  behavior: SignupBehavior,
  options: { inviteEntry?: InviteEntry } = {},
) {
  await page.addInitScript(({ signupBehavior, user }) => {
    const nativeFetch = window.fetch.bind(window);
    const state = window as typeof window & { __committeeSignupRequests?: string[] };
    state.__committeeSignupRequests = [];
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/auth/v1/signup")) return nativeFetch(input, init);
      state.__committeeSignupRequests!.push(typeof init?.body === "string" ? init.body : "");
      if (signupBehavior === "slow-success") {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      if (signupBehavior === "server-error") {
        return new Response(JSON.stringify({ message: "synthetic signup rejection" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ user, session: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, { signupBehavior: behavior, user: signupUser });

  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      await route.abort("blockedbyclient");
      return;
    }
    if (url.origin !== "http://127.0.0.1:54321") {
      await route.continue();
      return;
    }
    const corsHeaders = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      return;
    }
    if (url.pathname === "/auth/v1/signup") {
      await route.abort("blockedbyclient");
      return;
    }
    if (url.pathname.startsWith("/auth/v1/")) {
      await route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders, body: JSON.stringify({ user: null }) });
      return;
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      if (options.inviteEntry && url.pathname === "/rest/v1/rpc/get_pending_invite_by_token") {
        const entry = options.inviteEntry;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: corsHeaders,
          body: JSON.stringify([{
            id: "00000000-0000-4000-8000-00000000c101",
            team_id: entry.teamScoped ? "00000000-0000-4000-8000-00000000c103" : null,
            club_id: "00000000-0000-4000-8000-00000000c102",
            role: entry.role,
            invited_label: `New ${entry.role}`,
            status: "pending",
            team_name: entry.teamScoped ? "Synthetic Role Team" : null,
            team_logo_url: null,
            club_name: "Synthetic Riverside FC",
            club_logo_url: null,
            metadata: entry.metadata ?? {},
          }]),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders, body: "[]" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: corsHeaders, body: "{}" });
  });
}

async function fillValidSignup(page: Page) {
  // Native biometric/keyboard capability checks can replace the initial auth
  // layout immediately after mount. Wait for that one-time shell transition
  // before typing so the test interacts with the same stable form a person
  // sees, then assert that no values are subsequently lost.
  await page.waitForTimeout(500);
  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password", { exact: true });
  const confirmation = page.getByLabel("Confirm Password");
  await email.fill("");
  await email.pressSequentially("new.committee@example.test", { delay: 5 });
  await password.fill("");
  await password.pressSequentially("StrongPass1", { delay: 8 });
  await confirmation.fill("");
  await confirmation.pressSequentially("StrongPass1", { delay: 8 });
  await expect(email).toHaveValue("new.committee@example.test");
  await expect(password).toHaveValue("StrongPass1");
  await expect(confirmation).toHaveValue("StrongPass1");
  await page.getByRole("checkbox").check();
}

async function observeSignupBusyFeedback(page: Page) {
  await page.evaluate(() => {
    (window as any).__sawCommitteeSignupBusy = false;
    const sample = () => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === "Create Account" ||
          candidate.querySelector("svg.animate-spin"),
      ) as HTMLButtonElement | undefined;
      if (button?.disabled && button.querySelector("svg.animate-spin")) {
        (window as any).__sawCommitteeSignupBusy = true;
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

const signupRequestCount = (page: Page) => page.evaluate(
  () => ((window as typeof window & { __committeeSignupRequests?: string[] }).__committeeSignupRequests || []).length,
);

const firstSignupRequest = (page: Page) => page.evaluate(
  () => ((window as typeof window & { __committeeSignupRequests?: string[] }).__committeeSignupRequests || [])[0],
);

async function openAndFillInviteSignup(page: Page) {
  await page.goto("/auth?mode=signup");
  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();
  await expect(page.getByText("Create Account", { exact: true }).first()).toBeVisible();
  await fillValidSignup(page);
}

for (const platform of ["Android", "iOS"] as const) {
  test(`${platform} emailed club committee invite completes the real invite-to-signup handoff and the submit tap cannot be inert`, async ({ page }) => {
    test.setTimeout(30_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await installNativePlatform(page, platform);
    await installIsolatedAuthRoutes(page, "slow-success", {
      inviteEntry: { role: "committee_member" },
    });

    // Start at the same deep link delivered by email. Do not pre-seed any
    // invite/session state: the join page must establish the handoff itself.
    await page.goto(invitePath);
    await expect(page.getByRole("heading", { name: "Join Synthetic Riverside FC" })).toBeVisible();
    await expect(page.getByText("Committee Member", { exact: true })).toBeVisible();

    const joinButton = page.getByRole("button", { name: "Create Account to Join" });
    await expect(joinButton).toBeVisible();
    await expect(joinButton).toBeEnabled();
    await joinButton.tap();

    await expect(page).toHaveURL(/\/auth\?.*mode=signup/);
    const authUrl = new URL(page.url());
    expect(authUrl.searchParams.get("next")).toBe(invitePath);
    expect(authUrl.searchParams.get("invite")).toBe("synthetic-committee-invite");
    await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible({ timeout: 5_000 });
    expect(consoleErrors.some((message) => message.includes("Maximum update depth exceeded"))).toBe(false);
    await expect(page.getByText(/steps? remaining/)).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("redirectAfterAuth"))).toBe(invitePath);
    expect(await page.evaluate(() => sessionStorage.getItem("autoJoinAfterAuth"))).toBe("true");

    await fillValidSignup(page);
    const submit = page.getByRole("button", { name: "Create Account" });
    await observeSignupBusyFeedback(page);
    const requestStartedAt = Date.now();
    await submit.tap();

    // This is the critical regression contract: one tap must immediately
    // produce both network activity and visible busy feedback. A swallowed
    // handler, covered button, validation no-op, or lost touch event fails.
    await expect.poll(() => signupRequestCount(page), { timeout: 1_500 }).toBe(1);
    expect(Date.now() - requestStartedAt).toBeLessThan(1_500);
    await expect.poll(() => page.evaluate(() => (window as any).__sawCommitteeSignupBusy)).toBe(true);
    expect(JSON.parse(await firstSignupRequest(page))).toMatchObject({
      email: "new.committee@example.test",
      password: "StrongPass1",
    });

    // The separate rapid-double-click journey proves duplicate suppression;
    // this full-link journey verifies the invite survives the whole async wait.
    expect(await page.evaluate(() => sessionStorage.getItem("redirectAfterAuth"))).toBe(invitePath);
    await expect(submit).toBeEnabled({ timeout: 5_000 });
  });

  test(`${platform} committee invite creates an account with one touch and preserves the invite`, async ({ page }) => {
    await installCommitteeInviteState(page, platform);
    await installIsolatedAuthRoutes(page, "success");
    await openAndFillInviteSignup(page);

    const submit = page.getByRole("button", { name: "Create Account" });
    await submit.tap();
    await expect.poll(() => signupRequestCount(page)).toBe(1);
    expect(JSON.parse(await firstSignupRequest(page))).toMatchObject({
      email: "new.committee@example.test",
      password: "StrongPass1",
    });
    expect(await page.evaluate(() => sessionStorage.getItem("redirectAfterAuth"))).toBe(invitePath);
    expect(await page.evaluate(() => sessionStorage.getItem("autoJoinAfterAuth"))).toBe("true");
  });

  test(`${platform} committee signup remains reachable after focusing the final keyboard field`, async ({ page }) => {
    await installCommitteeInviteState(page, platform);
    await installIsolatedAuthRoutes(page, "success");
    await openAndFillInviteSignup(page);

    await page.getByLabel("Confirm Password").focus();
    const submit = page.getByRole("button", { name: "Create Account" });
    await submit.scrollIntoViewIfNeeded();
    const box = await submit.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    await submit.tap();
    await expect.poll(() => signupRequestCount(page)).toBe(1);
  });

  test(`${platform} committee signup suppresses duplicate requests during a slow response`, async ({ page }) => {
    await installCommitteeInviteState(page, platform);
    await installIsolatedAuthRoutes(page, "slow-success");
    await openAndFillInviteSignup(page);

    const submit = page.getByRole("button", { name: "Create Account" });
    await submit.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => signupRequestCount(page)).toBe(1);
    await expect(submit).toBeEnabled({ timeout: 5_000 });
  });
}

for (const platform of ["Android", "iOS"] as const) {
  for (const roleCase of otherEmailInviteRoles) {
    test(`${platform} ${roleCase.label} emailed invite reaches actionable signup with exact role and destination intact`, async ({ page }) => {
      test.setTimeout(30_000);
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await installNativePlatform(page, platform);
      await installIsolatedAuthRoutes(page, "slow-success", { inviteEntry: roleCase });

      await page.goto(invitePath);
      await expect(page.getByRole("heading", { name: /^Join / })).toBeVisible();
      await expect(page.getByText(roleCase.label, { exact: true })).toBeVisible();
      const joinButton = page.getByRole("button", { name: "Create Account to Join" });
      await expect(joinButton).toBeVisible();
      await expect(joinButton).toBeEnabled();
      await joinButton.tap();

      await expect(page).toHaveURL(/\/auth\?.*mode=signup/);
      const authUrl = new URL(page.url());
      expect(authUrl.searchParams.get("next")).toBe(invitePath);
      expect(authUrl.searchParams.get("invite")).toBe("synthetic-committee-invite");
      await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(/steps? remaining/)).toBeVisible();
      expect(consoleErrors.some((message) => message.includes("Maximum update depth exceeded"))).toBe(false);
      expect(await page.evaluate(() => sessionStorage.getItem("redirectAfterAuth"))).toBe(invitePath);
      expect(await page.evaluate(() => sessionStorage.getItem("autoJoinAfterAuth"))).toBe("true");

      await fillValidSignup(page);
      const submit = page.getByRole("button", { name: "Create Account" });
      await observeSignupBusyFeedback(page);
      await submit.tap();
      await expect.poll(() => signupRequestCount(page), { timeout: 1_500 }).toBe(1);
      await expect.poll(() => page.evaluate(() => (window as any).__sawCommitteeSignupBusy)).toBe(true);
      expect(JSON.parse(await firstSignupRequest(page))).toMatchObject({
        email: "new.committee@example.test",
        password: "StrongPass1",
      });
      expect(await page.evaluate(() => sessionStorage.getItem("redirectAfterAuth"))).toBe(invitePath);
      await expect(submit).toBeEnabled({ timeout: 5_000 });
    });
  }
}

test("Android committee signup reports a returned server failure and permits retry", async ({ page }) => {
  await installCommitteeInviteState(page, "Android");
  await installIsolatedAuthRoutes(page, "server-error");
  await openAndFillInviteSignup(page);

  await page.getByRole("button", { name: "Create Account" }).tap();
  await expect.poll(() => signupRequestCount(page)).toBe(1);
  await expect(page.getByText("synthetic signup rejection", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Account" })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem("redirectAfterAuth"))).toBe(invitePath);
});

test("iOS invalid committee signup gives visible validation without sending a request", async ({ page }) => {
  await installCommitteeInviteState(page, "iOS");
  await installIsolatedAuthRoutes(page, "success");
  await page.goto("/auth?mode=signup");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill("StrongPass1");
  await page.getByLabel("Confirm Password").fill("StrongPass1");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create Account" }).tap();

  await expect(page.getByText("Please enter a valid email", { exact: true })).toBeVisible();
  expect(await signupRequestCount(page)).toBe(0);
});

test("Android emailed committee invite still reaches an actionable signup when sessionStorage is unavailable", async ({ page }) => {
  test.setTimeout(30_000);
  await installNativePlatform(page, "Android");
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() { throw new DOMException("Synthetic storage denial", "SecurityError"); },
    });
  });
  await installIsolatedAuthRoutes(page, "slow-success", {
    inviteEntry: { role: "committee_member" },
  });

  await page.goto(invitePath);
  await page.getByRole("button", { name: "Create Account to Join" }).tap();
  await expect(page).toHaveURL(/\/auth\?.*mode=signup/);
  const authUrl = new URL(page.url());
  expect(authUrl.searchParams.get("next")).toBe(invitePath);
  expect(authUrl.searchParams.get("invite")).toBe("synthetic-committee-invite");

  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible({ timeout: 5_000 });
  await fillValidSignup(page);
  const submit = page.getByRole("button", { name: "Create Account" });
  await observeSignupBusyFeedback(page);
  await submit.tap();
  await expect.poll(() => signupRequestCount(page), { timeout: 1_500 }).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__sawCommitteeSignupBusy)).toBe(true);
  await expect(submit).toBeEnabled({ timeout: 5_000 });
});
