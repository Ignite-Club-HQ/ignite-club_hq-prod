#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { trancheTestManifest } from "./tranche-test-manifest.mjs";

const repository = resolve(import.meta.dirname, "..");
const rawTranche = process.argv[2];
const tranche = rawTranche?.toLowerCase().replace(/^promotion\//, "").match(/^([0-9]{2}[ab]?)/)?.[1];
const listOnly = process.argv.includes("--list");
const includeLocal = process.argv.includes("--include-local");
const fullGate = process.argv.includes("--full-gate");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    env: { ...process.env, CI: "true", TZ: "UTC" },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
  return result.stdout?.trim() ?? "";
}

function discover(directory, suffixes, output = []) {
  const root = resolve(repository, directory);
  if (!existsSync(root)) return output;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = resolve(root, entry.name);
    if (entry.isDirectory()) discover(relative(repository, absolute), suffixes, output);
    else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) output.push(relative(repository, absolute));
  }
  return output;
}

function select(files, patterns = []) {
  const regexes = patterns.map((pattern) => new RegExp(pattern));
  return files.filter((file) => regexes.some((regex) => regex.test(file))).sort();
}

if (!tranche || !trancheTestManifest[tranche]) {
  console.error(`Usage: npm run baseline:tranche -- <${Object.keys(trancheTestManifest).join("|")}> [--list] [--include-local] [--full-gate]`);
  process.exit(2);
}

const manifest = trancheTestManifest[tranche];
const localFiles = discover("tests/local-supabase", [".test.ts", ".test.tsx"]);
const sourceUnitFiles = discover("src", [".test.ts", ".test.tsx", ".guard.test.ts", ".guard.test.tsx"]);
const harnessUnitFiles = localFiles.filter((file) => file.includes(".unit.test."));
const selectedSourceUnit = select(sourceUnitFiles, manifest.vitest);
const selectedHarnessUnit = select(harnessUnitFiles, manifest.vitest);
const selectedUnit = [...selectedSourceUnit, ...selectedHarnessUnit];
const selectedMatrixUnit = selectedSourceUnit.filter((file) => file.endsWith(".matrix.test.ts") || file.endsWith(".matrix.test.tsx"));
const selectedDefaultUnit = selectedSourceUnit.filter((file) => !selectedMatrixUnit.includes(file));
const selectedPlaywright = (manifest.playwright ?? []).filter((file) => existsSync(resolve(repository, file)));
const selectedLocal = select(localFiles, manifest.local);

if (selectedUnit.length === 0) {
  console.error(`No Vitest files matched tranche ${tranche} (${manifest.name}); update the manifest before trusting this gate.`);
  process.exit(2);
}

const mainCommit = run("git", ["rev-parse", "main^{commit}"], { capture: true });
const headCommit = run("git", ["rev-parse", "HEAD^{commit}"], { capture: true });
const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", mainCommit, headCommit], {
  cwd: repository,
  stdio: "ignore",
  shell: false,
});
const mergeHead = spawnSync("git", ["rev-parse", "--verify", "MERGE_HEAD^{commit}"], {
  cwd: repository,
  encoding: "utf8",
  stdio: "pipe",
  shell: false,
});
const updatedMainIncluded = ancestry.status === 0 ||
  (mergeHead.status === 0 && mergeHead.stdout.trim() === mainCommit);
if (!updatedMainIncluded) {
  console.error(`Candidate does not include updated main at ${mainCommit.slice(0, 10)}.`);
  console.error("Merge/reconcile updated main into this tranche candidate before running its gate.");
  process.exit(2);
}

console.log(`Tranche ${tranche}: ${manifest.name}`);
console.log(`Updated main: ${mainCommit.slice(0, 10)} (included)`);
console.log(`Candidate HEAD: ${headCommit.slice(0, 10)}`);
console.log(`Vitest files: ${selectedUnit.length}`);
console.log(`Playwright specs: ${selectedPlaywright.length}`);
console.log(`Local integration files represented: ${selectedLocal.length}`);

if (listOnly) {
  for (const file of [...selectedUnit, ...selectedPlaywright, ...selectedLocal]) console.log(file);
  process.exit(0);
}

try {
  run("npm", ["run", "typecheck:production"]);
  run("npm", ["run", "typecheck:strict-features"]);
  if (selectedDefaultUnit.length) run("npx", ["vitest", "run", ...selectedDefaultUnit]);
  if (selectedMatrixUnit.length) {
    run("npx", ["vitest", "run", "--config", "vitest.matrix.config.ts", ...selectedMatrixUnit]);
  }
  if (selectedHarnessUnit.length) {
    run("npx", ["vitest", "run", "--config", "vitest.local-supabase.config.ts", ...selectedHarnessUnit]);
  }
  if (selectedPlaywright.length) {
    run("npx", ["playwright", "test", "--config", "playwright.baseline.config.ts", ...selectedPlaywright]);
  }
  if (includeLocal || fullGate) {
    console.log("Running the complete baseline lifecycle so local startup, migrations and cleanup cannot be bypassed.");
    run("npm", ["run", "baseline"]);
  }
  console.log(`\nTRANCHE ${tranche} GREEN`);
} catch (error) {
  console.error(`\nTRANCHE ${tranche} RED: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
