import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// We tune Vitest specifically so that the iOS-like touch-gesture tests in
// src/components/chat/FullscreenImageViewer.*.test.tsx behave identically on
// developer laptops AND in CI:
//
//   * pool: "forks" + singleFork:true → no parallel test interleaving means
//     module-level mock state (the `pinchActive` flag, lastTap refs, etc.)
//     can never bleed between files.
//   * environmentOptions.url → some libraries probe location.origin during
//     module init; pinning it avoids flakes inside CI containers where
//     jsdom defaults can drift.
//   * retry: 1 in CI → guards against the rare CI-only timing flake without
//     hiding real bugs (locally retry stays at 0 so flakes surface fast).
const isCI = !!process.env.CI;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Phase 6 matrix sweep is a slow regression suite — run separately
    // via `bun run test:matrix` (vitest.matrix.config.ts).
    exclude: ["**/node_modules/**", "**/*.matrix.test.ts"],
    // Forks + single-fork = deterministic test ordering and no shared-memory
    // races between gesture mocks. Slightly slower than threads but the
    // FullscreenImageViewer suites are tiny so the trade-off is worth it.
    pool: "forks",
    forks: { singleFork: true },
    // Pin the simulated origin so window.location-based code paths produce
    // identical output everywhere.
    environmentOptions: {
      jsdom: {
        url: "https://test.local/",
        pretendToBeVisual: true,
      },
    },
    // CI gets one extra retry to absorb cold-start jitter; locally we want
    // failures to be loud and immediate.
    retry: isCI ? 1 : 0,
    // 10s per test is plenty — gesture sequences advance fake timers, so
    // anything taking longer is genuinely stuck.
    testTimeout: 10_000,
    hookTimeout: 10_000,
    reporters: isCI ? ["default", "junit"] : ["default"],
    outputFile: isCI ? { junit: "./test-results/junit.xml" } : undefined,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});

