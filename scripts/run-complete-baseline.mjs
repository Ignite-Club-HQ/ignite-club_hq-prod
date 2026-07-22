import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  LOCAL_CONTAINERS,
  LOCAL_PROJECT,
  LOCAL_URL,
  LOCAL_VOLUMES,
  assertOnlyAllowedLocalNames,
  expectedMigrationVersions,
  migrationLedgersMatch,
  parseLocalGatewayKeys,
} from "./local-baseline-safety.mjs";

const LOCAL_WORKSPACE = resolve(process.cwd(), "local-supabase-workspace");
const LOCAL_MIGRATIONS = resolve(LOCAL_WORKSPACE, "supabase/migrations");
const LOCAL_SUPABASE_CLI = "supabase@2.71.0";
const EXPECTED_LOCAL_PROJECT = `project_id = "${LOCAL_PROJECT}"`;
const TEST_BRANCH = "codespaces-review";
const TEST_REMOTE = "origin";
const DB_CONTAINER = `supabase_db_${LOCAL_PROJECT}`;
const KONG_CONTAINER = `supabase_kong_${LOCAL_PROJECT}`;

// Hosted Supabase configuration is never inherited by lifecycle or test children.
const safeEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/SUPABASE|DATABASE_URL|PGPASSWORD/i.test(name)),
);
Object.assign(safeEnvironment, { CI: "true", TZ: "UTC" });

const results = [];
let localSessionApproved = false;
let cleanupStarted = false;

function command(commandName, args, options = {}) {
  return spawnSync(commandName, args, {
    cwd: process.cwd(),
    env: safeEnvironment,
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
    ...options,
  });
}

function git(args, options = {}) {
  return command("git", args, options);
}

function docker(args, options = {}) {
  return command("docker", args, options);
}

function targetExists(kind, name) {
  const inspected = docker([kind, "inspect", name]);
  return inspected.status === 0;
}

function cleanupLocalStack() {
  if (cleanupStarted) return true;
  cleanupStarted = true;
  console.log("\n========== Verified local Supabase cleanup ==========");
  assertOnlyAllowedLocalNames(LOCAL_CONTAINERS, LOCAL_CONTAINERS);
  assertOnlyAllowedLocalNames(LOCAL_VOLUMES, LOCAL_VOLUMES);

  const existingContainers = LOCAL_CONTAINERS.filter((name) => targetExists("container", name));
  if (existingContainers.length) {
    const removed = docker(["rm", "-f", ...existingContainers], { stdio: "inherit" });
    if (removed.status !== 0) return false;
  }

  const existingVolumes = LOCAL_VOLUMES.filter((name) => targetExists("volume", name));
  if (existingVolumes.length) {
    const removed = docker(["volume", "rm", ...existingVolumes], { stdio: "inherit" });
    if (removed.status !== 0) return false;
  }

  const stillRunning = docker([
    "ps", "--filter", `name=${LOCAL_PROJECT}`, "--format", "{{.Names}}",
  ]).stdout?.trim();
  const leftovers = [
    ...LOCAL_CONTAINERS.filter((name) => targetExists("container", name)),
    ...LOCAL_VOLUMES.filter((name) => targetExists("volume", name)),
  ];
  if (stillRunning || leftovers.length) {
    console.error(`Cleanup verification failed: ${stillRunning || leftovers.join(", ")}`);
    return false;
  }
  console.log("PASS: no isolated test containers or data volumes remain.");
  return true;
}

function cleanupAfterSignal(signal) {
  console.error(`\nReceived ${signal}; cleaning the isolated local test stack before exit.`);
  const cleaned = localSessionApproved ? cleanupLocalStack() : true;
  process.exit(cleaned ? 130 : 1);
}

process.once("SIGINT", () => cleanupAfterSignal("SIGINT"));
process.once("SIGTERM", () => cleanupAfterSignal("SIGTERM"));

async function updateTestBranch() {
  console.log("\n========== Test branch update preflight ==========");
  const branch = git(["branch", "--show-current"]);
  const currentBranch = branch.stdout?.trim();
  if (branch.status !== 0 || currentBranch !== TEST_BRANCH) {
    console.error(`Refusing update: expected branch ${TEST_BRANCH}, found ${currentBranch || "unknown"}.`);
    return false;
  }
  const status = git(["status", "--porcelain"]);
  if (status.status !== 0 || status.stdout.trim()) {
    console.error("Refusing update: the worktree is not clean. Commit or stash changes first.");
    return false;
  }
  const fetch = git(["fetch", TEST_REMOTE, TEST_BRANCH], { stdio: "inherit" });
  if (fetch.status !== 0) return false;
  const remoteRef = `refs/remotes/${TEST_REMOTE}/${TEST_BRANCH}`;
  const relation = git(["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`]);
  if (relation.status !== 0) return false;
  const [ahead, behind] = relation.stdout.trim().split(/\s+/).map(Number);
  if (ahead > 0 && behind > 0) {
    console.error(`Refusing automatic update: branches diverged (${ahead} local, ${behind} remote).`);
    return false;
  }
  if (behind === 0) return true;
  if (!stdin.isTTY) return false;
  console.log(`Exact command: git merge --ff-only ${remoteRef}`);
  const prompt = createInterface({ input: stdin, output: stdout });
  const approval = await prompt.question('Type "APPROVE TEST BRANCH UPDATE" to continue: ');
  prompt.close();
  return approval === "APPROVE TEST BRANCH UPDATE"
    && git(["merge", "--ff-only", remoteRef], { stdio: "inherit" }).status === 0;
}

async function isLocalStackHealthy() {
  try {
    const response = await fetch(`${LOCAL_URL}/auth/v1/health`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function discoverLocalKeys() {
  const gateway = docker(["exec", KONG_CONTAINER, "grep", "-E", "apikey ==", "/home/kong/kong.yml"]);
  if (gateway.status !== 0) throw new Error("Unable to read generated keys from the isolated local gateway");
  return parseLocalGatewayKeys(gateway.stdout);
}

function verifyMigrationLedger() {
  const expected = expectedMigrationVersions(readdirSync(LOCAL_MIGRATIONS));
  const ledger = docker([
    "exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atc",
    "select version from supabase_migrations.schema_migrations order by version;",
  ]);
  if (ledger.status !== 0) throw new Error("Unable to read the isolated local migration ledger");
  const applied = ledger.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!migrationLedgersMatch(expected, applied)) {
    throw new Error(`Local migration mismatch. Expected [${expected.join(", ")}], applied [${applied.join(", ")}]`);
  }
  console.log(`PASS: all ${expected.length} synthetic local migrations are applied.`);
}

function runStage(name, executable, args, environment = safeEnvironment) {
  console.log(`\n========== ${name} ==========`);
  const result = spawnSync(executable, args, {
    cwd: process.cwd(), env: environment, stdio: "inherit", shell: false,
  });
  results.push({ name, status: result.status ?? 1, skipped: false });
}

async function approveLocalSession() {
  if (!stdin.isTTY) return false;
  console.log("\n========== Local Supabase test-session approval ==========");
  console.log(`Exact startup command: cd ${LOCAL_WORKSPACE} && npx --yes ${LOCAL_SUPABASE_CLI} start`);
  console.log(`Exact cleanup targets: only the ${LOCAL_PROJECT} container and volume allowlists.`);
  console.log("The cleanup removes synthetic local data so every run replays all migrations from scratch.");
  console.log("Hosted Supabase variables are stripped; no hosted URL, credential, or project reference is used.");
  const prompt = createInterface({ input: stdin, output: stdout });
  const approval = await prompt.question('Type "APPROVE LOCAL TEST SESSION" to continue: ');
  prompt.close();
  return approval === "APPROVE LOCAL TEST SESSION";
}

const configPath = resolve(LOCAL_WORKSPACE, "supabase/config.toml");
let config = "";
try { config = readFileSync(configPath, "utf8"); } catch { /* checked below */ }

if (!(await updateTestBranch())) process.exit(1);
if (!config.includes(EXPECTED_LOCAL_PROJECT)) {
  console.error(`Refusing local test session: isolated config missing at ${configPath}.`);
  process.exit(1);
}

localSessionApproved = await approveLocalSession();
if (!localSessionApproved) {
  console.error("Local test session was not approved; no lifecycle or test command was run.");
  process.exit(1);
}

let localReady = false;
let localKeys;
try {
  // Always begin without retained synthetic state, then verify actual effects.
  if (!cleanupLocalStack()) throw new Error("Unable to establish an empty isolated local stack");
  cleanupStarted = false;
  const started = command("npx", ["--yes", LOCAL_SUPABASE_CLI, "start"], {
    cwd: LOCAL_WORKSPACE, stdio: "inherit", timeout: 180_000,
  });
  if (started.status !== 0 || !(await isLocalStackHealthy())) {
    throw new Error("Isolated local Supabase startup or health verification failed");
  }
  localKeys = discoverLocalKeys();
  verifyMigrationLedger();
  localReady = true;

  const frontendEnvironment = {
    ...safeEnvironment,
    VITE_SUPABASE_URL: LOCAL_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: localKeys.publishableKey,
  };
  runStage("Frontend Vitest", "npm", ["run", "test:ci"], frontendEnvironment);
  runStage("Isolated Playwright", "npm", ["run", "test:e2e-baseline"], frontendEnvironment);
  runStage("Local Supabase integration", "npm", ["run", "test:local-supabase"], {
    ...safeEnvironment,
    LOCAL_SUPABASE_URL: LOCAL_URL,
    LOCAL_SUPABASE_ANON_KEY: localKeys.publishableKey,
    LOCAL_SUPABASE_SERVICE_ROLE_KEY: localKeys.secretKey,
    LOCAL_SUPABASE_REALTIME_ENABLED: "true",
    LOCAL_SUPABASE_EDGE_ENABLED: "true",
  });
} catch (error) {
  console.error(`Local baseline infrastructure failure: ${error instanceof Error ? error.message : error}`);
  results.push({ name: "Local Supabase readiness", status: 2, skipped: !localReady });
} finally {
  const cleaned = cleanupLocalStack();
  results.push({ name: "Local Supabase cleanup", status: cleaned ? 0 : 1, skipped: false });
}

console.log("\n========== Baseline summary ==========");
for (const result of results) {
  const label = result.skipped ? "NOT RUN" : result.status === 0 ? "PASS" : "FAIL";
  console.log(`${label.padEnd(7)} ${result.name}`);
}
process.exit(results.length > 0 && results.every((result) => result.status === 0) ? 0 : 1);
