import { defineConfig, devices } from "@playwright/test";

const localAppUrl = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e-baseline",
  timeout: 20_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: localAppUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command:
      "env VITE_SUPABASE_URL=http://127.0.0.1:54321 " +
      "VITE_SUPABASE_PUBLISHABLE_KEY=local-synthetic-anon-key " +
      "npx vite --host 127.0.0.1 --port 4173 --strictPort",
    url: localAppUrl,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
