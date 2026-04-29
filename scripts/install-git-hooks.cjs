#!/usr/bin/env node
/**
 * Installs project git hooks from scripts/git-hooks/ into .git/hooks/.
 *
 * Run with:  npm run install:hooks
 *
 * Safe to re-run. Existing hooks are backed up to <hook>.backup once.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'scripts/git-hooks');

let gitDir;
try {
  gitDir = execSync('git rev-parse --git-dir', { cwd: ROOT }).toString().trim();
} catch (e) {
  console.error('❌ Not a git repository (or git not installed). Skipping hook install.');
  process.exit(0);
}
const HOOKS_DIR = path.isAbsolute(gitDir)
  ? path.join(gitDir, 'hooks')
  : path.join(ROOT, gitDir, 'hooks');

if (!fs.existsSync(SRC_DIR)) {
  console.error(`❌ Hook source dir not found: ${SRC_DIR}`);
  process.exit(1);
}
if (!fs.existsSync(HOOKS_DIR)) {
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
}

const hooks = fs.readdirSync(SRC_DIR).filter((f) => !f.startsWith('.'));
let installed = 0;
for (const hook of hooks) {
  const src = path.join(SRC_DIR, hook);
  const dest = path.join(HOOKS_DIR, hook);
  if (fs.existsSync(dest)) {
    const existing = fs.readFileSync(dest, 'utf8');
    const incoming = fs.readFileSync(src, 'utf8');
    if (existing === incoming) {
      console.log(`✓ ${hook} already up to date`);
      continue;
    }
    const backup = `${dest}.backup`;
    if (!fs.existsSync(backup)) {
      fs.copyFileSync(dest, backup);
      console.log(`  backed up existing ${hook} → ${path.basename(backup)}`);
    }
  }
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`✅ installed ${hook} → ${path.relative(ROOT, dest)}`);
  installed++;
}

console.log(`\nDone. ${installed} hook(s) installed/updated.`);
console.log('Skip a single push with:  git push --no-verify');
console.log('Skip via env var:         SKIP_IOS_BUILD_CHECK=1 git push');
