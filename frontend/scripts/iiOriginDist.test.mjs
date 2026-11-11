import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEV_FRONTEND = "proe7-kqaaa-aaaas-qg6gq-cai";
const PROD_FRONTEND = "pjx2u-tiaaa-aaaac-qhj3a-cai";
const DEV_CLUB = "mzzzv-taaaa-aaaal-qxlrq-cai";
const PROD_CLUB = "tbeh7-5qaaa-aaaai-ayenq-cai";
const GROUP2_CLUB = "yfwyv-nyaaa-aaaal-qxpyq-cai";
const provisionFile = path.join(scriptDirectory, "../../deploy/groups/g2/provision.json");
const provision = JSON.parse(readFileSync(provisionFile, "utf8"));
const marketing = ["https://igniteclubhq.com", "https://www.igniteclubhq.com"];

function generatedManifest(environment, opts = {}) {
  // No canister call or deployment. Build the production generator in an
  // isolated temporary directory, then discard every generated file.
  const dir = mkdtempSync(path.join(os.tmpdir(), "ignite-ii-manifest-"));
  const frontend = path.join(dir, "frontend");
  const scripts = path.join(frontend, "scripts");
  const dist = path.join(frontend, "dist-live");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(dist);
  const g2Dir = path.join(dir, "deploy", "groups", "g2");
  mkdirSync(g2Dir, { recursive: true });
  writeFileSync(path.join(g2Dir, "provision.json"), JSON.stringify(opts.badProvision ?? provision));
  for (const filename of ["prepare-canister-dist.mjs", "iiOriginPolicy.mjs"]) {
    cpSync(path.join(scriptDirectory, filename), path.join(scripts, filename));
  }
  writeFileSync(path.join(frontend, "package.json"), '{"type":"module"}\n');
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><html><body>TEST ONLY</body></html>");
  const isProd = environment === "prod";
  const frontId = isProd ? PROD_FRONTEND : DEV_FRONTEND;
  const clubId = isProd ? PROD_CLUB : DEV_CLUB;
  try {
    const result = spawnSync(process.execPath, [path.join(scripts, "prepare-canister-dist.mjs")], {
      cwd: dir,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        IGNITE_FRONTEND_ENV: environment,
        IGNITE_MCP_DEV_GROUP2_DISCOVERY: opts.enableGroup2 ? "1" : "0",
        FRONTEND_CANISTER_ID: frontId,
        IGNITE_LIVE_ICP_CANISTER_IDS_JSON: JSON.stringify({ club_domain: clubId }),
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const wellKnown = path.join(frontend, "dist-canister", ".well-known");
    return {
      origins: JSON.parse(readFileSync(path.join(wellKnown, "ii-alternative-origins"), "utf8")).alternativeOrigins,
      derivation: readFileSync(path.join(wellKnown, "ii-derivation-origin"), "utf8").trim(),
      manifest: JSON.parse(readFileSync(path.join(wellKnown, "ic-architecture"), "utf8")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("generated DEV files never advertise the production website or backend", () => {
  const dev = generatedManifest("dev");
  assert.deepEqual(dev.origins.filter(origin => marketing.includes(origin)), []);
  assert.ok(!dev.origins.includes("https://igniteclubhq.app"));
  assert.ok(dev.origins.includes("https://ignite-club-launchpad.lovable.app"));
  assert.equal(dev.derivation, `https://${DEV_FRONTEND}.icp0.io`);
  assert.ok(dev.manifest.canisters.some(c => c.id === DEV_CLUB));
  assert.ok(dev.manifest.canisters.every(c => c.id !== PROD_CLUB && c.id !== PROD_FRONTEND));
});

test("generated PROD files preserve production website login continuity", () => {
  const prod = generatedManifest("prod");
  for (const origin of marketing) assert.ok(prod.origins.includes(origin));
  assert.ok(prod.origins.includes("https://igniteclubhq.app"));
  assert.ok(!prod.origins.includes("https://ignite-club-launchpad.lovable.app"));
  assert.equal(prod.derivation, "https://igniteclubhq.app");
  assert.ok(prod.manifest.canisters.some(c => c.id === PROD_CLUB));
  assert.ok(prod.manifest.canisters.every(c => c.id !== DEV_CLUB && c.id !== DEV_FRONTEND));
});


test("opt-in DEV discovery declares only the Group 2 club/team canister", () => {
  const dev = generatedManifest("dev", { enableGroup2: true });
  const expected = [provision.canisters.club_domain];
  const declared = dev.manifest.canisters.filter(c => c.name.startsWith("g2/"));
  assert.equal(declared.length, expected.length);
  assert.deepEqual(new Set(declared.map(c => c.id)), new Set(expected));
  assert.equal(new Set(dev.manifest.canisters.map(c => c.id)).size, dev.manifest.canisters.length);
  assert.ok(declared.every(c => c.role === "backend"));
  assert.equal(dev.derivation, `https://${DEV_FRONTEND}.icp0.io`);
  assert.ok(!dev.manifest.canisters.some(c => c.id === PROD_CLUB || c.id === PROD_FRONTEND));
});

test("Group 2 disclosure remains disabled by default and on PROD even with an opt-in", () => {
  const disabled = generatedManifest("dev");
  const prod = generatedManifest("prod", { enableGroup2: true });
  for (const manifest of [disabled.manifest, prod.manifest]) {
    assert.ok(manifest.canisters.every(c => !c.name.startsWith("g2/")));
    assert.ok(manifest.canisters.every(c => c.id !== GROUP2_CLUB));
  }
});

test("invalid Group 2 provisioning never silently exposes a partial manifest", () => {
  const bad = structuredClone(provision);
  bad.canisters.club_domain = "not-a-valid-canister";
  assert.throws(() => generatedManifest("dev", { enableGroup2: true, badProvision: bad }));
});

test("generated manifest refuses PROD builds without an explicit frontend canister", () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), "ignite-no-prod-id-"));
  try {
    const frontend = path.join(baseDir, "frontend");
    mkdirSync(path.join(frontend, "scripts"), { recursive: true });
    mkdirSync(path.join(frontend, "dist-live"));
    cpSync(path.join(scriptDirectory, "prepare-canister-dist.mjs"), path.join(frontend, "scripts", "prepare-canister-dist.mjs"));
    cpSync(path.join(scriptDirectory, "iiOriginPolicy.mjs"), path.join(frontend, "scripts", "iiOriginPolicy.mjs"));
    writeFileSync(path.join(frontend, "package.json"), '{"type":"module"}\n');
    writeFileSync(path.join(frontend, "dist-live", "index.html"), "TEST");
    const env = { ...process.env, IGNITE_FRONTEND_ENV: "prod", IGNITE_LIVE_ICP_CANISTER_IDS_JSON: "{}" };
    delete env.FRONTEND_CANISTER_ID;
    const run = spawnSync(process.execPath, [path.join(frontend, "scripts", "prepare-canister-dist.mjs")], { env, encoding: "utf8", timeout: 30000 });
    assert.notEqual(run.status, 0, "PROD must fail closed without an explicitly set frontend ID");
    assert.match(run.stderr, /FRONTEND_CANISTER_ID is required for PROD frontend builds/);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});
