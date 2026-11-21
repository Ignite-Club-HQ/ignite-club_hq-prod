// Live assistants must request members' igniteclubhq.app identity; TEST keeps the canister's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./prepare-canister-dist.mjs", import.meta.url));
const PROD_ID = "u3mrq-uiaaa-aaaac-bgioq-cai";

function run(env) {
  // The generator imports both a sibling II policy and the parent scripts
  // discovery module. Reproduce their actual relative layout in this isolated
  // fixture rather than relying on files accidentally present under /tmp.
  const root = mkdtempSync(join(tmpdir(), "canister-dist-"));
  const frontend = join(root, "frontend");
  mkdirSync(join(frontend, "scripts"), { recursive: true });
  mkdirSync(join(frontend, "dist-live"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(frontend, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(frontend, "dist-live", "index.html"), "<html></html>");
  cpSync(script, join(frontend, "scripts", "prepare-canister-dist.mjs"));
  cpSync(new URL("./iiOriginPolicy.mjs", import.meta.url), join(frontend, "scripts", "iiOriginPolicy.mjs"));
  cpSync(new URL("../../scripts/group2-mcp-discovery.mjs", import.meta.url), join(root, "scripts", "group2-mcp-discovery.mjs"));
  try {
    execFileSync(process.execPath, [join(frontend, "scripts", "prepare-canister-dist.mjs")], {
      cwd: frontend, env: { PATH: process.env.PATH, IGNITE_MCP_DEV_GROUP2_DISCOVERY: "0", ...env }, stdio: "pipe",
    });
    const wk = join(frontend, "dist-canister", ".well-known");
    return {
      derivation: readFileSync(join(wk, "ii-derivation-origin"), "utf8").trim(),
      alts: JSON.parse(readFileSync(join(wk, "ii-alternative-origins"), "utf8")).alternativeOrigins,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("PROD assistants derive igniteclubhq.app and the list admits the canister", () => {
  const r = run({ IGNITE_FRONTEND_ENV: "prod", FRONTEND_CANISTER_ID: PROD_ID });
  assert.equal(r.derivation, "https://igniteclubhq.app");
  assert.ok(r.alts.includes(`https://${PROD_ID}.icp0.io`));
  assert.ok(r.alts.includes("https://igniteclubhq.app"));
  for (const kept of ["https://igniteclubhq.com", "https://www.igniteclubhq.com", "https://ignite-club-heart.lovable.app"]) {
    assert.ok(r.alts.includes(kept), kept);
  }
  assert.ok(!r.alts.includes("https://ignite-club-launchpad.lovable.app"));
});

test("TEST keeps the DEV canister identity", () => {
  const r = run({});
  assert.equal(r.derivation, "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io");
  assert.ok(!r.alts.includes("https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io"));
  assert.ok(!r.alts.includes("https://igniteclubhq.app"));
});
