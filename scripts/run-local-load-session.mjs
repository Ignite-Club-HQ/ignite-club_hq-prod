import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertOnlyAllowedLocalNames,
  hasExplicitLocalSessionApproval,
  LOCAL_CONTAINERS,
  LOCAL_PROJECT,
  LOCAL_URL,
  LOCAL_VOLUMES,
  parseLocalGatewayKeys,
} from "./local-baseline-safety.mjs";
import { resolveLocalLoadProfile } from "./local-load-safety.mjs";

const workspace = resolve(process.cwd(), "local-supabase-workspace");
const cli = "supabase@2.71.0";
const dbContainer = `supabase_db_${LOCAL_PROJECT}`;
const kongContainer = `supabase_kong_${LOCAL_PROJECT}`;
const approved = hasExplicitLocalSessionApproval(process.argv.slice(2));
const profileArg = process.argv.find((arg) => arg.startsWith("--profile=")) ?? "--profile=smoke";
const { name: profileName } = resolveLocalLoadProfile([profileArg]); // Reject arbitrary profiles before lifecycle work.

const safeEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/SUPABASE|DATABASE_URL|PGPASSWORD/i.test(name)),
);
Object.assign(safeEnvironment, { CI: "true", TZ: "UTC" });

function command(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: process.cwd(),
    env: safeEnvironment,
    encoding: "utf8",
    shell: false,
    timeout: 240_000,
    ...options,
  });
}

function docker(args, options = {}) {
  return command("docker", args, options);
}

function exists(kind, name) {
  return docker([kind, "inspect", name]).status === 0;
}

function cleanup() {
  console.log("\n========== Verified local load cleanup ==========");
  assertOnlyAllowedLocalNames(LOCAL_CONTAINERS, LOCAL_CONTAINERS);
  assertOnlyAllowedLocalNames(LOCAL_VOLUMES, LOCAL_VOLUMES);
  const containers = LOCAL_CONTAINERS.filter((name) => exists("container", name));
  if (containers.length && docker(["rm", "-f", ...containers], { stdio: "inherit" }).status !== 0) return false;
  const volumes = LOCAL_VOLUMES.filter((name) => exists("volume", name));
  if (volumes.length && docker(["volume", "rm", ...volumes], { stdio: "inherit" }).status !== 0) return false;
  const leftovers = [
    ...LOCAL_CONTAINERS.filter((name) => exists("container", name)),
    ...LOCAL_VOLUMES.filter((name) => exists("volume", name)),
  ];
  if (leftovers.length) {
    console.error(`Cleanup verification failed: ${leftovers.join(", ")}`);
    return false;
  }
  console.log("PASS: no isolated load-test containers or data volumes remain.");
  return true;
}

function onSignal(signal) {
  console.error(`Received ${signal}; cleaning isolated local load stack.`);
  process.exit(cleanup() ? 130 : 1);
}

function captureFailureLogs(profile) {
  const reportDirectory = resolve(process.cwd(), "test-results", "local-load");
  mkdirSync(reportDirectory, { recursive: true });
  for (const name of [
    `supabase_realtime_${LOCAL_PROJECT}`,
    `supabase_db_${LOCAL_PROJECT}`,
    `supabase_rest_${LOCAL_PROJECT}`,
    `supabase_kong_${LOCAL_PROJECT}`,
  ]) {
    if (!exists("container", name)) continue;
    const result = docker(["logs", "--tail", "1000", name]);
    writeFileSync(
      resolve(reportDirectory, `${profile}-${name.replace(`_${LOCAL_PROJECT}`, "")}-failure.log`),
      `${result.stdout ?? ""}${result.stderr ?? ""}`,
      "utf8",
    );
  }
  console.log(`Failure logs: ${reportDirectory}`);
}
process.once("SIGINT", () => onSignal("SIGINT"));
process.once("SIGTERM", () => onSignal("SIGTERM"));

const config = readFileSync(resolve(workspace, "supabase/config.toml"), "utf8");
if (!config.includes(`project_id = "${LOCAL_PROJECT}"`)) {
  throw new Error("Refusing local load session: isolated project configuration is missing");
}
if (!approved) {
  console.error("Refusing local load session: exact --approved-local-session flag is required");
  process.exit(2);
}

let exitCode = 1;
let resourceSampler;
try {
  if (!cleanup()) throw new Error("Could not establish an empty isolated stack");
  console.log(`Exact startup command: cd ${workspace} && npx --yes ${cli} start`);
  console.log("Target: fresh Docker-based local Supabase only; hosted variables are stripped.");
  const started = command("npx", ["--yes", cli, "start"], {
    cwd: workspace,
    stdio: "inherit",
  });
  if (started.status !== 0) throw new Error("Local Supabase startup failed");

  const health = command("curl", ["--fail", "--silent", `${LOCAL_URL}/auth/v1/health`]);
  if (health.status !== 0) throw new Error("Local Supabase health check failed");

  const gateway = docker(["exec", kongContainer, "grep", "-E", "apikey ==", "/home/kong/kong.yml"]);
  if (gateway.status !== 0) throw new Error("Could not discover generated local gateway keys");
  const keys = parseLocalGatewayKeys(gateway.stdout);

  const marker = docker([
    "exec", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-Atc",
    "select public.is_local_security_test_environment();",
  ]);
  if (marker.status !== 0 || marker.stdout.trim() !== "t") {
    throw new Error("Synthetic local database marker was not confirmed");
  }

  if (profileName === "realtime500") {
    const realtimeLimitSql = [
      "with updated as (",
      "update _realtime.tenants",
      "set max_concurrent_users = 600",
      "returning max_concurrent_users",
      ") select count(*), min(max_concurrent_users) from updated;",
    ].join(" ");
    console.log(
      `Exact local tenant command: docker exec ${dbContainer} `
      + `env PGPASSWORD=postgres psql -U supabase_admin -d postgres `
      + `-v ON_ERROR_STOP=1 -Atc "${realtimeLimitSql}"`,
    );
    console.log(
      "Target: verified synthetic local _realtime tenant only; the ephemeral database is removed after this run.",
    );
    const realtimeLimit = docker([
      "exec", dbContainer, "env", "PGPASSWORD=postgres",
      "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
      "-Atc", realtimeLimitSql,
    ]);
    if (realtimeLimit.status !== 0 || realtimeLimit.stdout.trim() !== "1|600") {
      console.error(`Local tenant update stdout: ${realtimeLimit.stdout.trim() || "(empty)"}`);
      console.error(`Local tenant update stderr: ${realtimeLimit.stderr.trim() || "(empty)"}`);
      throw new Error("Could not verify the isolated local Realtime connection ceiling");
    }
  }

  const loadEnvironment = {
    ...safeEnvironment,
    LOCAL_SUPABASE_URL: LOCAL_URL,
    LOCAL_SUPABASE_ANON_KEY: keys.publishableKey,
    LOCAL_SUPABASE_SERVICE_ROLE_KEY: keys.secretKey,
  };
  const resourceReport = resolve(
    process.cwd(),
    "test-results",
    "local-load",
    `${profileArg.split("=")[1]}-resources.jsonl`,
  );
  mkdirSync(resolve(process.cwd(), "test-results", "local-load"), { recursive: true });
  try { unlinkSync(resourceReport); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  resourceSampler = spawn("node", [
    "scripts/local-load-resource-sampler.mjs",
    resourceReport,
  ], {
    cwd: process.cwd(),
    env: safeEnvironment,
    stdio: "inherit",
    shell: false,
  });
  console.log(`Resource samples: ${resourceReport}`);
  const load = spawnSync("node", ["scripts/local-load-test.mjs", profileArg], {
    cwd: process.cwd(),
    env: loadEnvironment,
    stdio: "inherit",
    shell: false,
    timeout: 600_000,
  });
  exitCode = load.status ?? 1;
  if (exitCode !== 0) captureFailureLogs(profileName);
} catch (error) {
  console.error(`Local load infrastructure failure: ${error instanceof Error ? error.message : error}`);
  exitCode = 2;
} finally {
  if (resourceSampler && !resourceSampler.killed) resourceSampler.kill("SIGTERM");
  if (!cleanup()) exitCode = 1;
}
process.exit(exitCode);
