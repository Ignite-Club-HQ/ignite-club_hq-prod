import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const LOCAL_WORKSPACE = resolve(process.cwd(), "local-supabase-workspace");
const EXPECTED_LOCAL_PROJECT = 'project_id = "ignite-club-local-security-tests"';

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

let localHealthy = await isLocalStackHealthy();
if (!localHealthy) {
  const configPath = resolve(LOCAL_WORKSPACE, "supabase/config.toml");
  let config = "";
  try { config = readFileSync(configPath, "utf8"); } catch { /* handled below */ }
  if (!config.includes(EXPECTED_LOCAL_PROJECT)) {
    console.error(`Refusing local startup: expected isolated config was not found at ${configPath}.`);
  } else if (!stdin.isTTY) {
    console.error("Local Supabase is stopped and startup approval requires an interactive terminal.");
  } else {
    console.log("\n========== Local Supabase startup approval ==========");
    console.log(`Exact command: cd ${LOCAL_WORKSPACE} && npx --yes supabase@latest start`);
    console.log("Target: the fresh Docker-based Supabase instance configured in local-supabase-workspace only.");
    console.log("Hosted safety: hosted Supabase variables are removed; this command contains no remote URL,");
    console.log("project reference, hosted credential, or remote migration option. It cannot target hosted Supabase.");
    const prompt = createInterface({ input: stdin, output: stdout });
    const approval = await prompt.question('Type "APPROVE LOCAL START" to continue: ');
    prompt.close();
    if (approval === "APPROVE LOCAL START") {
      const start = spawnSync("npx", ["--yes", "supabase@latest", "start"], {
        cwd: LOCAL_WORKSPACE,
        env: safeEnvironment,
        stdio: "inherit",
        shell: false,
      });
      if ((start.status ?? 1) !== 0) console.error("Local Supabase startup failed.");
      localHealthy = await isLocalStackHealthy();
    } else {
      console.error("Local Supabase startup was not approved; backend tests will not run.");
    }
  }
}

runStage("Frontend Vitest", "npm", ["run", "test:ci"]);
runStage("Isolated Playwright", "npm", ["run", "test:e2e-baseline"]);

if (localHealthy) {
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

console.log("\n========== Baseline summary ==========");
for (const result of results) {
  const label = result.skipped ? "NOT RUN" : result.status === 0 ? "PASS" : "FAIL";
  console.log(`${label.padEnd(7)} ${result.name}`);
}

process.exit(results.every((result) => result.status === 0) ? 0 : 1);
