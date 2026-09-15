import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  LOCAL_CONTAINERS,
  LOCAL_PROJECT,
  LOCAL_URL,
  LOCAL_VOLUMES,
  assertOnlyAllowedLocalNames,
  baselineBranchMode,
  expectedMigrationVersions,
  findUnreviewedMirroredMigrations,
  hasExplicitLocalSessionApproval,
  migrationLedgersMatch,
  parseLocalGatewayKeys,
  validateCurrentLocalParity,
  worktreeUpdateMode,
} from "./local-baseline-safety.mjs";

const LOCAL_WORKSPACE = resolve(process.cwd(), "local-supabase-workspace");
const LOCAL_MIGRATIONS = resolve(LOCAL_WORKSPACE, "supabase/migrations");
const PRODUCTION_MIGRATIONS = resolve(process.cwd(), "supabase/migrations");
const LOCAL_SUPABASE_CLI = "supabase@2.71.0";
const EXPECTED_LOCAL_PROJECT = `project_id = "${LOCAL_PROJECT}"`;
const TEST_BRANCH = "codespaces-review";
const TEST_REMOTE = "origin";
const DB_CONTAINER = `supabase_db_${LOCAL_PROJECT}`;
const KONG_CONTAINER = `supabase_kong_${LOCAL_PROJECT}`;
const commandLineSessionApproved = hasExplicitLocalSessionApproval(process.argv.slice(2));
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
const includeLoad = process.argv.includes("--include-load");
const loadProfile = process.argv
  .find((arg) => arg.startsWith("--load-profile="))
  ?.slice("--load-profile=".length) ?? "smoke";

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

  // A timed-out `supabase start` can leave its compose process creating the
  // remaining services for a few seconds after the first cleanup snapshot.
  // Re-scan the explicit allowlist so those late local-only containers cannot
  // escape cleanup or poison the next one-click run.
  let consecutiveEmptyPasses = 0;
  for (let pass = 0; pass < 5; pass += 1) {
    const existingContainers = LOCAL_CONTAINERS.filter((name) => targetExists("container", name));
    if (existingContainers.length) {
      consecutiveEmptyPasses = 0;
      const removed = docker(["rm", "-f", ...existingContainers], { stdio: "inherit" });
      if (removed.status !== 0) return false;
    } else {
      consecutiveEmptyPasses += 1;
    }
    if (consecutiveEmptyPasses >= 2) break;
    if (pass < 4) command("sleep", ["1"]);
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
  if (isGitHubActions) {
    const refName = process.env.GITHUB_REF_NAME;
    if (refName !== TEST_BRANCH) {
      console.error(`Refusing GitHub Actions run: expected ref ${TEST_BRANCH}, found ${refName || "unknown"}.`);
      return false;
    }
    console.log(`PASS: GitHub Actions checked out the immutable ${TEST_BRANCH} workflow commit.`);
    return true;
  }
  const branch = git(["branch", "--show-current"]);
  const currentBranch = branch.stdout?.trim();
  const branchMode = branch.status === 0
    ? baselineBranchMode(currentBranch, TEST_BRANCH)
    : "error";
  if (branchMode === "error") {
    console.error("Refusing baseline: unable to identify the checked-out branch.");
    return false;
  }
  if (branchMode === "protected") {
    console.error(`Refusing baseline on protected branch ${currentBranch}. Use a Codespaces review or tranche branch.`);
    return false;
  }
  if (branchMode === "test-current") {
    console.warn(`NOTICE: testing current refactor branch ${currentBranch} without fetch or merge.`);
    console.warn("No files will be staged, committed, stashed, restored or deleted by this workflow.");
    return true;
  }
  const status = git(["status", "--porcelain"]);
  const updateMode = worktreeUpdateMode(status.status, status.stdout ?? "");
  if (updateMode === "error") {
    console.error("Refusing test startup: unable to inspect the worktree.");
    return false;
  }
  if (updateMode === "test-current") {
    console.warn("NOTICE: worktree changes are present.");
    console.warn("Automatic fetch/merge is skipped; the current checked-out files will be tested unchanged.");
    console.warn("No files will be staged, committed, stashed, restored or deleted by this workflow.");
    return true;
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
  console.log(`Exact command: git merge --ff-only ${remoteRef}`);
  if (commandLineSessionApproved) {
    return git(["merge", "--ff-only", remoteRef], { stdio: "inherit" }).status === 0;
  }
  if (!stdin.isTTY) return false;
  const prompt = createInterface({ input: stdin, output: stdout });
  const approval = await prompt.question('Type "APPROVE TEST BRANCH UPDATE" to continue: ');
  prompt.close();
  return approval === "APPROVE TEST BRANCH UPDATE"
    && git(["merge", "--ff-only", remoteRef], { stdio: "inherit" }).status === 0;
}

function verifyMirroredContractParity() {
  console.log("\n========== Synthetic contract parity preflight ==========");
  const productionMigrations = readdirSync(PRODUCTION_MIGRATIONS)
    .filter((name) => /^\d{14}_[a-zA-Z0-9_-]+\.sql$/.test(name))
    .map((name) => ({ name, sql: readFileSync(resolve(PRODUCTION_MIGRATIONS, name), "utf8") }));
  const unreviewed = findUnreviewedMirroredMigrations(productionMigrations);
  if (unreviewed.length) {
    console.error("Refusing local test startup: merged backend migrations touch mirrored security contracts:");
    for (const name of unreviewed) console.error(`  - supabase/migrations/${name}`);
    console.error("Review those files, update the synthetic local contract if required, then advance LOCAL_PARITY_REVIEWED_THROUGH.");
    return false;
  }
  const localSql = readdirSync(LOCAL_MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(resolve(LOCAL_MIGRATIONS, name), "utf8"))
    .join("\n");
  const missing = validateCurrentLocalParity(localSql);
  if (missing.length) {
    console.error(`Refusing local test startup: synthetic baseline is missing ${missing.join(", ")}.`);
    return false;
  }
  console.log("PASS: mirrored security contracts are reviewed and represented locally.");
  return true;
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

function reserveAvailableLoopbackPort(preferredPort = 4173) {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", (error) => {
      if (error?.code !== "EADDRINUSE") {
        reject(error);
        return;
      }
      const fallback = createServer();
      fallback.unref();
      fallback.once("error", reject);
      fallback.listen(0, "127.0.0.1", () => {
        const address = fallback.address();
        const port = typeof address === "object" && address ? address.port : null;
        fallback.close((closeError) => closeError ? reject(closeError) : resolvePort(port));
      });
    });
    probe.listen(preferredPort, "127.0.0.1", () => {
      probe.close((closeError) => closeError ? reject(closeError) : resolvePort(preferredPort));
    });
  });
}

async function approveLocalSession() {
  console.log("\n========== Local Supabase test-session approval ==========");
  console.log(`Exact startup command: cd ${LOCAL_WORKSPACE} && npx --yes ${LOCAL_SUPABASE_CLI} start`);
  console.log(`Exact cleanup targets: only the ${LOCAL_PROJECT} container and volume allowlists.`);
  console.log("The cleanup removes synthetic local data so every run replays all migrations from scratch.");
  console.log("Hosted Supabase variables are stripped; no hosted URL, credential, or project reference is used.");
  if (commandLineSessionApproved) {
    console.log("PASS: this lifecycle was explicitly approved with the one-command approval flag.");
    return true;
  }
  if (!stdin.isTTY) return false;
  const prompt = createInterface({ input: stdin, output: stdout });
  const approval = await prompt.question('Type "APPROVE LOCAL TEST SESSION" to continue: ');
  prompt.close();
  return approval === "APPROVE LOCAL TEST SESSION";
}

const configPath = resolve(LOCAL_WORKSPACE, "supabase/config.toml");
let config = "";
try { config = readFileSync(configPath, "utf8"); } catch { /* checked below */ }

if (!(await updateTestBranch())) process.exit(1);
if (!verifyMirroredContractParity()) process.exit(1);
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
    // A fresh Codespace may need several minutes to initialise Postgres and
    // start every optional local service even when all images are cached.
    // Keep this bounded, but do not kill compose halfway through startup and
    // create a late-container cleanup race.
    cwd: LOCAL_WORKSPACE, stdio: "inherit", timeout: 360_000,
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
  runStage("Production TypeScript", "npm", ["run", "typecheck:production"], frontendEnvironment);
  runStage("Strict feature boundary", "npm", ["run", "typecheck:strict-features"], frontendEnvironment);
  runStage("Frontend Vitest", "npm", ["run", "test:ci"], frontendEnvironment);
  runStage(
    "AutoSub matrix",
    "npx",
    ["vitest", "run", "--config", "vitest.matrix.config.ts"],
    frontendEnvironment,
  );
  const playwrightPort = await reserveAvailableLoopbackPort();
  console.log(`Playwright will use isolated loopback port ${playwrightPort}.`);
  runStage("Isolated Playwright", "npm", ["run", "test:e2e-baseline"], {
    ...frontendEnvironment,
    PLAYWRIGHT_BASELINE_PORT: String(playwrightPort),
  });
  runStage("Local Supabase integration", "npm", ["run", "test:local-supabase"], {
    ...safeEnvironment,
    LOCAL_SUPABASE_URL: LOCAL_URL,
    LOCAL_SUPABASE_ANON_KEY: localKeys.publishableKey,
    LOCAL_SUPABASE_SERVICE_ROLE_KEY: localKeys.secretKey,
    LOCAL_SUPABASE_REALTIME_ENABLED: "true",
    LOCAL_SUPABASE_EDGE_ENABLED: "true",
  });
  if (includeLoad) {
    runStage(
      `Local synthetic load (${loadProfile})`,
      "node",
      ["scripts/local-load-test.mjs", `--profile=${loadProfile}`],
      {
        ...safeEnvironment,
        LOCAL_SUPABASE_URL: LOCAL_URL,
        LOCAL_SUPABASE_ANON_KEY: localKeys.publishableKey,
        LOCAL_SUPABASE_SERVICE_ROLE_KEY: localKeys.secretKey,
      },
    );
  }
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
