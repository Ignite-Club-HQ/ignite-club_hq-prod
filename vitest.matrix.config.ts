import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Phase 6 — slow fairness matrix sweep (~240 cases). Kept separate from the
// main `vitest run` so PR CI stays fast; run locally with `bun run test:matrix`
// before shipping planner tuning changes.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.matrix.test.ts"],
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
