// The live build's HTML entry is live-index.html (see frontend/live-index.html
// and rollupOptions.input in vite.live.config.ts), but static hosting serves
// "/" and the SPA fallback from index.html. Netlify publishes frontend/dist-live
// directly, so without this copy every URL on the hosted site answers
// "Page not found". scripts/build-preview.mjs and
// frontend/scripts/prepare-canister-dist.mjs do the same copy for their own
// outputs; this is the copy for the hosting publish directory itself.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function ensureLiveIndex(distDir) {
  const liveIndex = path.join(distDir, "live-index.html");
  const rootIndex = path.join(distDir, "index.html");
  if (!existsSync(liveIndex)) {
    throw new Error(
      `live-index.html missing from ${distDir}; the live build produced no page for hosting to serve`,
    );
  }
  // Re-copy whenever the content differs, so a rebuild never leaves a stale
  // index.html behind (same-length rebuilds included).
  const entry = readFileSync(liveIndex, "utf8");
  if (!existsSync(rootIndex) || readFileSync(rootIndex, "utf8") !== entry) {
    writeFileSync(rootIndex, entry);
  }
  return rootIndex;
}
