#!/usr/bin/env node
/**
 * Minimal patch applier that replaces `patch-package` at postinstall time.
 *
 * Why: patch-package's bundled applier is stricter than GNU `patch` and was
 * rejecting a valid unified diff for @capgo/native-purchases on Codemagic /
 * npm installs. GNU `patch -p1` applies the same file cleanly, so we shell
 * out to it directly. Skips silently if the target file is already patched
 * (so re-running install is idempotent).
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const patchesDir = path.join(__dirname, "..", "patches");
if (!fs.existsSync(patchesDir)) process.exit(0);

const patches = fs
  .readdirSync(patchesDir)
  .filter((f) => f.endsWith(".patch"))
  .sort();

if (patches.length === 0) process.exit(0);

let failed = 0;
for (const file of patches) {
  const full = path.join(patchesDir, file);
  try {
    // --forward makes already-applied patches a no-op instead of an error.
    execSync(`patch -p1 --forward --silent < "${full}"`, {
      stdio: ["ignore", "inherit", "inherit"],
      shell: "/bin/bash",
    });
    console.log(`[apply-patches] applied ${file}`);
  } catch (err) {
    // Reverse-check: if patch is already applied, treat as success.
    try {
      execSync(`patch -p1 -R --dry-run --silent < "${full}"`, {
        stdio: ["ignore", "ignore", "ignore"],
        shell: "/bin/bash",
      });
      console.log(`[apply-patches] already applied: ${file}`);
    } catch {
      console.error(`[apply-patches] FAILED: ${file}`);
      failed += 1;
    }
  }
}

process.exit(failed === 0 ? 0 : 1);
