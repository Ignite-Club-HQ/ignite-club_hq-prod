// Live assistants must request members' igniteclubhq.app identity; TEST keeps the canister's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./prepare-canister-dist.mjs", import.meta.url));
const PROD_ID = "u3mrq-uiaaa-aaaac-bgioq-cai";

function run(env) {
  const root = mkdtempSync(join(tmpdir(), "canister-dist-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "dist-live"));
  writeFileSync(join(root, "dist-live", "index.html"), "<html></html>");
  cpSync(script, join(root, "scripts", "prepare-canister-dist.mjs"));
  execFileSync(process.execPath, [join(root, "scripts", "prepare-canister-dist.mjs")], {
    cwd: root, env: { PATH: process.env.PATH, ...env }, stdio: "pipe",
  });
  const wk = join(root, "dist-canister", ".well-known");
  return {
    derivation: readFileSync(join(wk, "ii-derivation-origin"), "utf8").trim(),
    alts: JSON.parse(readFileSync(join(wk, "ii-alternative-origins"), "utf8")).alternativeOrigins,
  };
}

test("PROD assistants derive igniteclubhq.app and the list admits the canister", () => {
  const r = run({ IGNITE_FRONTEND_ENV: "prod", FRONTEND_CANISTER_ID: PROD_ID });
  assert.equal(r.derivation, "https://igniteclubhq.app");
  assert.ok(r.alts.includes(`https://${PROD_ID}.icp0.io`));
  for (const kept of ["https://igniteclubhq.com", "https://www.igniteclubhq.com", "https://ignite-club-heart.lovable.app"]) {
    assert.ok(r.alts.includes(kept), kept);
  }
  assert.ok(!r.alts.includes("https://ignite-club-launchpad.lovable.app"));
});

test("TEST keeps the DEV canister identity", () => {
  const r = run({});
  assert.equal(r.derivation, "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io");
  assert.ok(!r.alts.includes("https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io"));
});
