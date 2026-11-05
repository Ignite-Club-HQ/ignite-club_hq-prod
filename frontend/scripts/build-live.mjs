import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureLiveIndex } from "./ensure-live-index.mjs";

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "build", "--config", "vite.live.config.ts", "--mode", "live"],
  {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, IGNITE_LIVE_BUILD: "1" },
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

// Hosting serves "/" and the SPA fallback from index.html; the live build
// writes live-index.html. Fail the build rather than publish a folder that
// makes every hosted URL answer "Page not found".
ensureLiveIndex(fileURLToPath(new URL("../dist-live", import.meta.url)));
