import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const LOCAL_WORKSPACE = resolve(process.cwd(), "local-supabase-workspace");
// Keep the local container images and legacy demo JWT contract reproducible.
// Newer floating CLI releases can provision asymmetric signing-key state that
// is incompatible with the fixed, local-only HS256 keys used by this harness.
const LOCAL_SUPABASE_CLI = "supabase@2.71.0";
const EXPECTED_LOCAL_PROJECT = 'project_id = "ignite-club-local-security-tests"';
const TEST_BRANCH = "codespaces-review";
const TEST_REMOTE = "origin";

// Never pass hosted Supabase configuration into any child test process.
const safeEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/SUPABASE|DATABASE_URL|PGPASSWORD/i.test(name)),
);
Object.assign(safeEnvironment, {
  CI: "true",
  TZ: "UTC",
  VITE_SUPABASE_URL: LOCAL_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON_KEY,
});

const results = [];

function git(args, options = {}) {
  return spawnSync("git", args, {
    cwd: process.cwd(),
    env: safeEnvironment,
    encoding: "utf8",
    shell: false,
    ...options,
  });
}

async function updateTestBranch() {
  console.log("\n========== Test branch update preflight ==========");

  const branch = git(["branch", "--show-current"]);
  const currentBranch = branch.stdout?.trim();
  if (branch.status !== 0 || currentBranch !== TEST_BRANCH) {
    console.error(`Refusing update: expected branch ${TEST_BRANCH}, found ${currentBranch || "unknown"}.`);
    console.error("No fetch, merge, pull, push, or test command was run.");
    return false;
  }

  const status = git(["status", "--porcelain"]);
  if (status.status !== 0 || status.stdout.trim()) {
    console.error("Refusing update: the worktree is not clean. Commit or stash changes first.");
    console.error("No fetch, merge, pull, push, or test command was run.");
    return false;
  }

  console.log(`Fetching only ${TEST_REMOTE}/${TEST_BRANCH}; this does not push or modify main.`);
  const fetch = git(["fetch", TEST_REMOTE, TEST_BRANCH], { stdio: "inherit" });
  if ((fetch.status ?? 1) !== 0) {
    console.error("Unable to fetch the test branch; no source files were changed.");
    return false;
  }

  const remoteRef = `refs/remotes/${TEST_REMOTE}/${TEST_BRANCH}`;
  const relation = git(["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`]);
  if (relation.status !== 0) {
    console.error(`Unable to compare HEAD with ${TEST_REMOTE}/${TEST_BRANCH}.`);
    return false;
  }
  const [ahead, behind] = relation.stdout.trim().split(/\s+/).map(Number);

  if (ahead > 0 && behind > 0) {
    console.error(`Refusing automatic update: branches have diverged (${ahead} local, ${behind} remote commits).`);
    console.error("Resolve the branch history manually; no merge was attempted.");
    return false;
  }
  if (behind === 0) {
    console.log(`Already up to date with ${TEST_REMOTE}/${TEST_BRANCH}.`);
    return true;
  }
  if (!stdin.isTTY) {
    console.error(`Branch is ${behind} commit(s) behind ${TEST_REMOTE}/${TEST_BRANCH}.`);
    console.error("Interactive approval is required before updating source files.");
    return false;
  }

  console.log(`Branch is ${behind} commit(s) behind ${TEST_REMOTE}/${TEST_BRANCH}.`);
  console.log(`Exact command: git merge --ff-only ${remoteRef}`);
  console.log(`Effect: fast-forward ${TEST_BRANCH} only. This cannot modify or push to main.`);
  const prompt = createInterface({ input: stdin, output: stdout });
  const approval = await prompt.question('Type "APPROVE TEST BRANCH UPDATE" to continue: ');
  prompt.close();
  if (approval !== "APPROVE TEST BRANCH UPDATE") {
    console.error("Test branch update was not approved; tests will not run against stale code.");
    return false;
  }

  const merge = git(["merge", "--ff-only", remoteRef], { stdio: "inherit" });
  if ((merge.status ?? 1) !== 0) {
    console.error("Fast-forward update failed; tests will not run.");
    return false;
  }
  console.log(`${TEST_BRANCH} is now up to date. No push was performed.`);
  return true;
}

function runStage(name, command, args, environment = safeEnvironment) {
  console.log(`\n========== ${name} ==========`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
    shell: false,
  });
  const status = result.status ?? 1;
  results.push({ name, status, skipped: false });
}

async function isLocalStackHealthy() {
  try {
    const response = await fetch(`${LOCAL_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

if (!(await updateTestBranch())) process.exit(1);

let localHealthy = await isLocalStackHealthy();
let localSessionApproved = false;
const configPath = resolve(LOCAL_WORKSPACE, "supabase/config.toml");
let config = "";
try { config = readFileSync(configPath, "utf8"); } catch { /* handled below */ }

if (!config.includes(EXPECTED_LOCAL_PROJECT)) {
  console.error(`Refusing local test session: expected isolated config was not found at ${configPath}.`);
} else if (!stdin.isTTY) {
  console.error("Local Supabase test-session approval requires an interactive terminal.");
} else {
  console.log("\n========== Local Supabase test-session approval ==========");
  if (!localHealthy) {
    console.log(`Exact command: cd ${LOCAL_WORKSPACE} && npx --yes ${LOCAL_SUPABASE_CLI} start`);
  } else {
    console.log(`Start not required: the isolated stack at ${LOCAL_URL} is already healthy.`);
  }
  console.log(`Exact cleanup command after tests: cd ${LOCAL_WORKSPACE} && npx --yes ${LOCAL_SUPABASE_CLI} stop`);
  console.log("Target: only the Docker-based Supabase instance configured in local-supabase-workspace.");
  console.log("Hosted safety: hosted Supabase variables are removed; neither command contains a remote URL,");
  console.log("project reference, hosted credential, or remote migration option. They cannot target hosted Supabase.");
  console.log("The cleanup command runs after the test stages even when a test stage fails.");
  const prompt = createInterface({ input: stdin, output: stdout });
  const approval = await prompt.question('Type "APPROVE LOCAL TEST SESSION" to continue: ');
  prompt.close();
  localSessionApproved = approval === "APPROVE LOCAL TEST SESSION";
  if (!localSessionApproved) {
    console.error("Local Supabase test session was not approved; backend tests will not run.");
  } else if (!localHealthy) {
      const start = spawnSync("npx", ["--yes", LOCAL_SUPABASE_CLI, "start"], {
        cwd: LOCAL_WORKSPACE,
        env: safeEnvironment,
        stdio: "inherit",
        shell: false,
      });
      if ((start.status ?? 1) !== 0) console.error("Local Supabase startup failed.");
      localHealthy = await isLocalStackHealthy();
  }
}

runStage("Frontend Vitest", "npm", ["run", "test:ci"]);
runStage("Isolated Playwright", "npm", ["run", "test:e2e-baseline"]);

if (localSessionApproved && localHealthy) {
  runStage("Local Supabase integration", "npm", ["run", "test:local-supabase"], {
    ...safeEnvironment,
    LOCAL_SUPABASE_URL: LOCAL_URL,
    LOCAL_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
    LOCAL_SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_KEY,
    LOCAL_SUPABASE_REALTIME_ENABLED: "true",
    LOCAL_SUPABASE_EDGE_ENABLED: "true",
  });
} else {
  console.error(`\n========== Local Supabase integration ==========`);
  console.error(`NOT RUN: no healthy local stack at ${LOCAL_URL}. Hosted fallback is forbidden.`);
  results.push({ name: "Local Supabase integration", status: 2, skipped: true });
}

if (localSessionApproved) {
  console.log("\n========== Local Supabase cleanup ==========");
  const stop = spawnSync("npx", ["--yes", LOCAL_SUPABASE_CLI, "stop"], {
    cwd: LOCAL_WORKSPACE,
    env: safeEnvironment,
    stdio: "inherit",
    shell: false,
  });
  const status = stop.status ?? 1;
  results.push({ name: "Local Supabase cleanup", status, skipped: false });
  if (status !== 0) console.error("Local Supabase cleanup failed; stop the isolated stack manually.");
}

console.log("\n========== Baseline summary ==========");
for (const result of results) {
  const label = result.skipped ? "NOT RUN" : result.status === 0 ? "PASS" : "FAIL";
  console.log(`${label.padEnd(7)} ${result.name}`);
}

process.exit(results.every((result) => result.status === 0) ? 0 : 1);
