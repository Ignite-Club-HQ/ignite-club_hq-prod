import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ENVIRONMENTS, assertDatabase, assertGovernor, assertIsolated, canistersForChangedFiles,
  loadIds, planUpgrade, resolveEnv, UPGRADE_ORDER, REPO_ROOT,
} from "./icp-environments.mjs";
import { recordRelease } from "./record-prod-release.mjs";

const DEV_IDS = loadIds("dev");

function fakeRepo({ dev = { club_domain: "aaaaa-dev" }, prod } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "icp-env-"));
  for (const [env, ids] of [["dev", dev], ["prod", prod]]) {
    if (!ids) continue;
    const dir = path.join(root, ENVIRONMENTS[env].projectDir, ".icp", "data", "mappings");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "ic.ids.json"), JSON.stringify(ids));
  }
  return root;
}

test("DEV is today's test canister set, including the shared router", () => {
  assert.equal(DEV_IDS.shard_router, "jcdfe-vqaaa-aaaal-qxloq-cai");
  assert.equal(DEV_IDS.club_domain, "mzzzv-taaaa-aaaal-qxlrq-cai");
});

test("an unprovisioned PROD table is empty, never the DEV canisters", () => {
  const root = fakeRepo();
  assert.deepEqual(loadIds("prod", root), {});
});

test("PROD refuses any DEV canister ID", () => {
  assert.throws(() => assertIsolated("prod", { club_domain: DEV_IDS.club_domain }, DEV_IDS), /contains DEV canisters: club_domain/);
});

test("DEV refuses any PROD canister ID", () => {
  assert.throws(() => assertIsolated("dev", { ...DEV_IDS, vault_domain: "ppppp-prod" }, { vault_domain: "ppppp-prod" }), /contains PROD canisters/);
});

test("PROD build refuses the DEV database", () => {
  assert.throws(() => assertDatabase("prod", "https://ecsdwrarzfexssxtrymj.supabase.co"), /DEV database/);
  assert.doesNotThrow(() => assertDatabase("prod", "https://yabcfiuntwqjwvschnji.supabase.co"));
});

test("only the prod branch resolves to PROD", () => {
  assert.equal(resolveEnv({ BRANCH: "prod" }), "prod");
  assert.equal(resolveEnv({ GITHUB_REF_NAME: "main" }), "dev");
  assert.equal(resolveEnv({}), "dev");
  assert.equal(resolveEnv({ IGNITE_ICP_ENV: "prod", BRANCH: "main" }), "prod");
  assert.throws(() => resolveEnv({ IGNITE_ICP_ENV: "staging" }));
});

test("PROD rejects the DEV governor and requires its own configured principal", () => {
  const dev = ENVIRONMENTS.dev.governorPrincipal;
  assert.throws(() => assertGovernor("prod", dev, { PROD_GOVERNOR_PRINCIPAL: dev }), /DEV governor/);
  assert.throws(() => assertGovernor("prod", "abc", {}), /PROD_GOVERNOR_PRINCIPAL/);
  assert.throws(() => assertGovernor("prod", "abc", { PROD_GOVERNOR_PRINCIPAL: "xyz" }), /mismatch/);
  assert.throws(() => assertGovernor("prod", "web", { PROD_GOVERNOR_PRINCIPAL: "web", DEV_DEPLOYER_PRINCIPAL: "web" }), /web-app publishing key/);
  assert.doesNotThrow(() => assertGovernor("prod", "xyz", { PROD_GOVERNOR_PRINCIPAL: "xyz" }));
});

test("changed files map to the canisters that need upgrading", () => {
  assert.deepEqual(canistersForChangedFiles(["backend/club_domain/src/main.mo", "frontend/src/a.ts"]), ["club_domain"]);
  assert.deepEqual(canistersForChangedFiles(["backend/shared/Oql.mo"]), UPGRADE_ORDER);
  assert.deepEqual(canistersForChangedFiles(["backend/migrations/x.mo"]), UPGRADE_ORDER);
  assert.deepEqual(canistersForChangedFiles(["docs/a.md"]), []);
  assert.deepEqual(canistersForChangedFiles(null), UPGRADE_ORDER);
});

test("upgrades follow core -> domains -> router order", () => {
  assert.equal(UPGRADE_ORDER[0], "identity_access");
  assert.equal(UPGRADE_ORDER.at(-1), "shard_router");
  assert.ok(UPGRADE_ORDER.indexOf("pii_access_control") < UPGRADE_ORDER.indexOf("club_domain"));
});

test("an interrupted promotion resumes with only the canisters still behind", () => {
  const root = fakeRepo({ prod: { identity_access: "p1", club_domain: "p2", shard_router: "p3" } });
  const diff = () => ["backend/club_domain/src/main.mo", "backend/shard_router/src/main.mo"];
  recordRelease(["identity_access", "club_domain", "shard_router"], "aaaaaaa", root);
  assert.deepEqual(planUpgrade("prod", "bbbbbbb", { root, diff }), ["club_domain", "shard_router"]);
  recordRelease(["club_domain"], "bbbbbbb", root); // router upgrade failed
  assert.deepEqual(planUpgrade("prod", "bbbbbbb", { root, diff }), ["shard_router"]);
});

test("never-deployed PROD canisters upgrade fully", () => {
  const root = fakeRepo({ prod: { club_domain: "p2" } });
  assert.deepEqual(planUpgrade("prod", "ccccccc", { root, diff: () => [] }), ["club_domain"]);
});

const wf = (name) => readFileSync(path.join(REPO_ROOT, ".github/workflows", name), "utf8");

test("merging into prod promotes PROD canisters automatically, with PROD keys only", () => {
  const y = wf("promote-icp-prod.yml");
  assert.match(y, /push:\n\s+branches: \[prod\]/);
  assert.match(y, /secrets\.PROD_GOVERNOR_PEM/);
  assert.doesNotMatch(y, /secrets\.(DEPLOYER_PEM|GOVERNOR_PEM)\b/);
  assert.match(y, /--mode upgrade --no-create/);
  assert.doesNotMatch(y, /--mode reinstall|wasm-memory-persistence[= ]replace/);
  assert.match(y, /deploy\/frontend-prod/);
});

test("DEV workflows never use PROD keys or the PROD canister set", () => {
  for (const name of ["deploy-frontend-canister.yml", "upgrade-all-groups.yml", "deploy-icp-mainnet.yml"]) {
    const y = wf(name);
    assert.doesNotMatch(y, /PROD_GOVERNOR_PEM|deploy\/prod\b|frontend-prod/, name);
  }
  assert.match(wf("deploy-frontend-canister.yml"), /branches: \[main\]/);
  assert.match(wf("deploy-frontend-canister.yml"), /icp-environments\.mjs ids dev/);
});

test("store app builds bake the PROD canister table, not DEV", () => {
  const cm = readFileSync(path.join(REPO_ROOT, "codemagic.yaml"), "utf8");
  assert.doesNotMatch(cm, /deploy\/mainnet\/\.icp/);
  assert.match(cm, /icp-environments\.mjs ids prod/);
});
