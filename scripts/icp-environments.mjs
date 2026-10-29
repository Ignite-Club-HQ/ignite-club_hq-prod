// Ignite ICP environments: DEV (test canisters, built from `main`) and PROD
// (live canisters, promoted from `prod`). Mirrors the Supabase DEV/PROD split:
// every build and workflow resolves exactly one environment and refuses any
// canister ID, governor or database belonging to the other one (fail closed).
//
// CLI:
//   node scripts/icp-environments.mjs resolve            -> prints dev|prod
//   node scripts/icp-environments.mjs ids <env>          -> compact ID JSON ("{}" when unprovisioned)
//   node scripts/icp-environments.mjs guard <env> [supabaseUrl]
//   node scripts/icp-environments.mjs changed <env> <toSha>   -> canister names needing upgrade
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ENVIRONMENTS = Object.freeze({
  dev: Object.freeze({
    name: "dev",
    branch: "main",
    projectDir: "deploy/mainnet",
    frontendDir: "deploy/frontend",
    supabaseRef: "ecsdwrarzfexssxtrymj",
    governorPrincipal: "vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae",
  }),
  prod: Object.freeze({
    name: "prod",
    branch: "prod",
    projectDir: "deploy/prod",
    frontendDir: "deploy/frontend-prod",
    supabaseRef: "yabcfiuntwqjwvschnji",
    // Set by the operator (repository variable PROD_GOVERNOR_PRINCIPAL); never the DEV governor.
    governorPrincipal: null,
  }),
});

/** Upgrade order: shared core first, domains next, router last. */
export const UPGRADE_ORDER = Object.freeze([
  "identity_access", "placement_registry", "migration_coordinator", "secret_workload_identity",
  "pii_access_control", "timer_jobs", "club_domain", "events_domain", "competition_domain",
  "mini_league_domain", "messaging_domain", "notification_queue", "media_metadata", "media_blob_store",
  "vault_domain", "club_points_domain", "insights_domain", "shard_router",
]);

/** Paths that affect every canister when they change. */
const SHARED_PATHS = [/^backend\/shared\//, /^backend\/migrations\//, /^mops\.(toml|lock)$/, /^Cargo\.(toml|lock)$/, /^deploy\/prod\/icp\.yaml$/];

export function otherEnv(env) {
  return env === "prod" ? "dev" : "dev" === env ? "prod" : (() => { throw new Error(`Unknown ICP environment: ${env}`); })();
}

export function resolveEnv(e = process.env) {
  const explicit = (e.IGNITE_ICP_ENV || "").trim().toLowerCase();
  if (explicit) {
    if (!ENVIRONMENTS[explicit]) throw new Error(`Unknown IGNITE_ICP_ENV: ${explicit}`);
    return explicit;
  }
  // Netlify sets BRANCH; GitHub sets GITHUB_REF_NAME. Only the prod branch is live.
  const branch = e.BRANCH || e.GITHUB_REF_NAME || "";
  return branch === "prod" ? "prod" : "dev";
}

export function mappingPath(env, root = REPO_ROOT) {
  return path.join(root, ENVIRONMENTS[env].projectDir, ".icp", "data", "mappings", "ic.ids.json");
}

export function loadIds(env, root = REPO_ROOT) {
  if (!ENVIRONMENTS[env]) throw new Error(`Unknown ICP environment: ${env}`);
  const file = mappingPath(env, root);
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v : v?.ic ?? v?.id ?? Object.values(v ?? {})[0]]));
}

/** Throws if `env`'s IDs share any canister with the other environment. */
export function assertIsolated(env, ids = loadIds(env), otherIds = loadIds(otherEnv(env))) {
  const foreign = new Set(Object.values(otherIds));
  const leaked = Object.entries(ids).filter(([, id]) => foreign.has(id));
  if (leaked.length) {
    throw new Error(`${env.toUpperCase()} canister table contains ${otherEnv(env).toUpperCase()} canisters: ${leaked.map(([k]) => k).join(", ")}`);
  }
  return ids;
}

/** PROD must never use the DEV database; DEV builds must never use the PROD canisters (checked by assertIsolated). */
export function assertDatabase(env, supabaseUrl) {
  if (!supabaseUrl) return;
  if (env === "prod" && supabaseUrl.includes(ENVIRONMENTS.dev.supabaseRef)) throw new Error("Refusing PROD ICP build against the DEV database");
  if (env === "dev" && supabaseUrl.includes(ENVIRONMENTS.prod.supabaseRef) && process.env.IGNITE_ALLOW_DEV_ICP_WITH_PROD_DB !== "1") {
    // Netlify branch previews share the live database variables; DEV canisters stay test-only regardless.
    console.warn("warning: DEV ICP canisters with the PROD database URL; DEV canisters hold test clubs only");
  }
}

export function assertGovernor(env, principal, e = process.env) {
  if (!principal) throw new Error("Governor principal required");
  if (env === "prod") {
    const expected = (e.PROD_GOVERNOR_PRINCIPAL || "").trim();
    if (!expected) throw new Error("Repository variable PROD_GOVERNOR_PRINCIPAL is not set");
    if (expected === ENVIRONMENTS.dev.governorPrincipal || principal === ENVIRONMENTS.dev.governorPrincipal) throw new Error("PROD must not use the DEV governor key");
    const devDeployer = (e.DEV_DEPLOYER_PRINCIPAL || "").trim();
    if (devDeployer && principal === devDeployer) throw new Error("PROD must not use the DEV web-app publishing key");
    if (principal !== expected) throw new Error(`PROD governor mismatch: key is ${principal}, expected ${expected}`);
  } else if (principal !== ENVIRONMENTS.dev.governorPrincipal) {
    throw new Error("DEV governor mismatch");
  }
}

/** Canister names whose source changed between `fromSha` and `toSha`. `null` fromSha means never deployed: all. */
export function canistersForChangedFiles(files, all = UPGRADE_ORDER) {
  if (files === null) return [...all];
  const touched = new Set();
  for (const file of files) {
    if (SHARED_PATHS.some((re) => re.test(file))) return [...all];
    const m = /^backend\/([a-z_]+)\//.exec(file);
    if (m && all.includes(m[1])) touched.add(m[1]);
  }
  return all.filter((n) => touched.has(n));
}

export function readRelease(env, root = REPO_ROOT) {
  const file = path.join(root, ENVIRONMENTS[env].projectDir, "release.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { canisters: {} };
}

/** Per-canister plan: each canister compares against its own last deployed commit, so an interrupted run resumes. */
export function planUpgrade(env, toSha, { root = REPO_ROOT, diff = gitDiff } = {}) {
  const release = readRelease(env, root);
  const ids = loadIds(env, root);
  const deployed = UPGRADE_ORDER.filter((n) => ids[n]);
  return deployed.filter((name) => {
    const from = release.canisters?.[name] ?? null;
    if (from === toSha) return false;
    return canistersForChangedFiles(from ? diff(from, toSha, root) : null, [name]).length > 0;
  });
}

function gitDiff(from, to, root) {
  try {
    return execFileSync("git", ["diff", "--name-only", `${from}..${to}`], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return null; // unknown base (history rewritten / shallow) -> upgrade everything
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, envArg, extra] = process.argv.slice(2);
  const env = envArg || resolveEnv();
  if (cmd === "resolve") console.log(resolveEnv());
  else if (cmd === "ids") process.stdout.write(JSON.stringify(assertIsolated(env)));
  else if (cmd === "guard") {
    assertIsolated(env);
    assertDatabase(env, extra || process.env.IGNITE_LIVE_SUPABASE_URL);
    console.log(`${env.toUpperCase()} ICP environment isolated (${Object.keys(loadIds(env)).length} canisters)`);
  } else if (cmd === "changed") console.log(planUpgrade(env, extra).join(" "));
  else { console.error("usage: icp-environments.mjs resolve|ids|guard|changed <env> [arg]"); process.exit(2); }
}
