import { defineConfig, devices } from "@playwright/test";

const localAppPort = process.env.PLAYWRIGHT_BASELINE_PORT || "4173";
const localAppUrl = `http://127.0.0.1:${localAppPort}`;

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
    {
      name: "chromium",
      grepInvert: /Android|iOS/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Runs only explicitly Android-labelled lifecycle journeys in a
      // touch/mobile Chromium profile. This is Android-like coverage; the
      // genuine Capacitor WebView/Doze layer belongs in Android device CI.
      name: "android-webview-like",
      grep: /Android/,
      use: {
        ...devices["Pixel 7"],
      },
    },
    {
      // Runs only explicitly iOS-labelled lifecycle journeys with an iPhone
      // touch profile and Capacitor's iOS branch selected by the fixture.
      // A genuine WKWebView/iOS lifecycle run still requires macOS simulator CI.
      name: "ios-webview-like",
      grep: /iOS/,
      use: {
        ...devices["iPhone 15"],
      },
    },
  ],
  webServer: {
    command:
      "env VITE_SUPABASE_URL=http://127.0.0.1:54321 " +
      "VITE_SUPABASE_PUBLISHABLE_KEY=local-synthetic-anon-key " +
      `npx vite --host 127.0.0.1 --port ${localAppPort} --strictPort`,
    url: localAppUrl,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
