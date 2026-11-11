// Hashed assets must be immutable only; "/*" must not add Cache-Control (rules merge).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./prepare-canister-dist.mjs", import.meta.url));
function headers() {
  const root = mkdtempSync(join(tmpdir(), "canister-cache-"));
  mkdirSync(join(root, "scripts")); mkdirSync(join(root, "dist-live"));
  writeFileSync(join(root, "dist-live", "index.html"), "<html></html>");
  cpSync(script, join(root, "scripts", "prepare-canister-dist.mjs"));
  execFileSync(process.execPath, [join(root, "scripts", "prepare-canister-dist.mjs")], { cwd: root, env: { PATH: process.env.PATH, IGNITE_MCP_DEV_GROUP2_DISCOVERY: "0" }, stdio: "pipe" });
  const blocks = {};
  for (const block of readFileSync(join(root, "dist-canister", "_headers"), "utf8").split(/\n\s*\n/)) {
    const [path, ...rest] = block.trim().split("\n");
    blocks[path.trim()] = rest.map(l => l.trim());
  }
  return blocks;
}
test("catch-all rule sets no Cache-Control", () => {
  assert.ok(!headers()["/*"].some(l => /^cache-control:/i.test(l)));
});
test("hashed assets are immutable and entry pages revalidate", () => {
  const h = headers();
  assert.deepEqual(h["/assets/*"], ["Cache-Control: public, max-age=31536000, immutable"]);
  for (const p of ["/index.html", "/live-index.html", "/.well-known/*"]) assert.ok(h[p].includes("Cache-Control: no-cache"), p);
});
