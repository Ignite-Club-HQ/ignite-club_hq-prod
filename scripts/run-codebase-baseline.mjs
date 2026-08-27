#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const mode = args[0] ?? "full";
const includeLocal = args.includes("--include-local");
const keepWorkspace = args.includes("--keep-workspace");
const prepareOnly = args.includes("--prepare-only");
const aggregateRef = process.env.BASELINE_AGGREGATE_REF ?? "promotion/09b-telemetry-recipient-reconciliation";
const baseRef = process.env.BASELINE_BASE_REF ?? "main";

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repository,
    env: options.env ?? process.env,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    shell: false,
  });
  if (options.capture) return result;
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed`);
  return result;
}

function git(args, options = {}) {
  return run("git", args, options);
}

function hasRef(ref) {
  return git(["rev-parse", "--verify", `${ref}^{commit}`], { capture: true }).status === 0;
}

function resolveTranche(value) {
  if (!value) throw new Error("Missing tranche. Example: npm run baseline:tranche -- 03");
  if (value.includes("/")) return value;
  const normalized = value.padStart(2, "0");
  const branches = git([
    "for-each-ref", "--format=%(refname:short)",
    "refs/heads/promotion", "refs/remotes/origin/promotion",
  ], { capture: true }).stdout.split(/\r?\n/).filter(Boolean);
  const matches = branches.filter((branch) => basename(branch).startsWith(`${normalized}-`));
  const local = matches.find((branch) => branch.startsWith("promotion/"));
  const selected = local ?? matches[0];
  if (!selected) throw new Error(`No promotion tranche branch found for ${value}`);
  return selected;
}

function findFiles(root, predicate, output = []) {
  if (!existsSync(root)) return output;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) findFiles(path, predicate, output);
    else if (predicate(path)) output.push(path);
  }
  return output;
}

function fileHash(path) {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function stage(name, command, commandArgs, cwd, env = process.env) {
  console.log(`\n========== ${name} ==========`);
  run(command, commandArgs, { cwd, env });
}

if (!["full", "tranche"].includes(mode)) {
  console.error("Usage: node scripts/run-codebase-baseline.mjs full [--include-local] [--keep-workspace]");
  console.error("   or: node scripts/run-codebase-baseline.mjs tranche <number-or-ref> [--include-local] [--keep-workspace]");
  process.exit(2);
}

let requestedRef;
try {
  requestedRef = mode === "full" ? aggregateRef : resolveTranche(args[1]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}
if (!hasRef(requestedRef)) {
  console.error(`Baseline ref does not exist: ${requestedRef}`);
  process.exit(2);
}
if (mode === "tranche" && !hasRef(baseRef)) {
  console.error(`Baseline base ref does not exist: ${baseRef}`);
  process.exit(2);
}
const requestedCommit = git(["rev-parse", `${requestedRef}^{commit}`], { capture: true }).stdout.trim();
const baseCommit = mode === "tranche"
  ? git(["rev-parse", `${baseRef}^{commit}`], { capture: true }).stdout.trim()
  : null;

const workspace = mkdtempSync(join(tmpdir(), `ignite-${mode}-baseline-`));
let failed = false;

try {
  console.log(`Mode: ${mode}`);
  console.log(`Source: ${requestedRef}`);
  if (mode === "tranche") console.log(`Base: ${baseRef}`);
  console.log(`Disposable workspace: ${workspace}`);

  git(["clone", "--shared", "--no-checkout", repository, workspace]);
  if (mode === "full") {
    git(["checkout", "--detach", requestedCommit], { cwd: workspace });
  } else {
    git(["checkout", "-B", "baseline-tranche-candidate", baseCommit], { cwd: workspace });
    stage("Merge tranche into disposable candidate", "git", ["merge", "--no-edit", "--no-ff", requestedCommit], workspace);
  }

  const sourceModules = join(repository, "node_modules");
  const candidateModules = join(workspace, "node_modules");
  const locksMatch = fileHash(join(repository, "package-lock.json")) === fileHash(join(workspace, "package-lock.json"));
  const forceReuse = process.env.BASELINE_REUSE_NODE_MODULES === "true";
  if (existsSync(sourceModules) && lstatSync(sourceModules).isDirectory() && (locksMatch || forceReuse)) {
    symlinkSync(sourceModules, candidateModules, "dir");
    console.log(locksMatch
      ? "Reusing repository node_modules (package locks match)."
      : "Reusing repository node_modules by explicit BASELINE_REUSE_NODE_MODULES=true override.");
  } else {
    console.log("Installing the candidate's exact locked dependencies.");
    stage("Install dependencies", "npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], workspace);
  }

  if (prepareOnly) {
    console.log("\nPREPARE CHECK GREEN");
    process.exitCode = 0;
  } else {

  const packageJson = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8"));
  const scripts = packageJson.scripts ?? {};
  const ciEnv = { ...process.env, CI: "true", TZ: "UTC" };

  if (scripts["typecheck:production"]) stage("Production TypeScript", "npm", ["run", "typecheck:production"], workspace, ciEnv);
  if (scripts["typecheck:strict-features"]) stage("Strict feature/workflow TypeScript", "npm", ["run", "typecheck:strict-features"], workspace, ciEnv);
  stage("Whole-codebase Vitest", "npx", ["vitest", "run"], workspace, ciEnv);
  if (existsSync(join(workspace, "vitest.matrix.config.ts"))) stage("Matrix", "npx", ["vitest", "run", "--config", "vitest.matrix.config.ts"], workspace, ciEnv);

  const playwrightSpecs = findFiles(join(workspace, "e2e-baseline"), (path) => path.endsWith(".spec.ts"));
  if (playwrightSpecs.length && existsSync(join(workspace, "playwright.baseline.config.ts"))) {
    console.log(`Playwright journeys discovered: ${playwrightSpecs.length} specification files.`);
    stage("Playwright journeys", "npx", ["playwright", "test", "--config", "playwright.baseline.config.ts"], workspace, ciEnv);
  } else {
    console.log("\nSKIP: no Playwright journey specifications exist in this candidate.");
  }

  if (scripts.build) stage("Production build", "npm", ["run", "build"], workspace, ciEnv);
  if (scripts["test:android-os:build"]) stage("Android isolated harness", "npm", ["run", "test:android-os:build"], workspace, ciEnv);
  if (scripts["test:ios-os:build"]) stage("iOS isolated harness", "npm", ["run", "test:ios-os:build"], workspace, ciEnv);

  const denoTests = findFiles(join(workspace, "supabase", "functions"), (path) => path.endsWith("_test.ts"));
  if (denoTests.length && spawnSync("deno", ["--version"], { stdio: "ignore" }).status === 0) {
    stage("Edge-function Deno tests", "deno", ["test", "--allow-read", "--allow-env", "--allow-net", "--no-check", ...denoTests], workspace, ciEnv);
  } else if (denoTests.length) {
    console.log(`\nSKIP: ${denoTests.length} Deno test files found, but Deno is not installed.`);
  }

  if (includeLocal) {
    if (!scripts["test:local-supabase"]) throw new Error("This candidate has no test:local-supabase command");
    stage("Local Supabase integration", "npm", ["run", "test:local-supabase"], workspace, ciEnv);
  } else {
    console.log("\nLocal Supabase integration not requested. Add --include-local when an isolated local stack is running.");
  }

  console.log("\nBASELINE GREEN");
  }
} catch (error) {
  failed = true;
  console.error(`\nBASELINE RED: ${error instanceof Error ? error.message : error}`);
} finally {
  if (keepWorkspace) console.log(`Retained disposable workspace: ${workspace}`);
  else rmSync(workspace, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
