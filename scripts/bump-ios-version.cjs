#!/usr/bin/env node
/**
 * Bump iOS version + build number across:
 *   - package.json              ("version")
 *   - ios/App/App/Info.plist    (CFBundleShortVersionString, CFBundleVersion)
 *   - ios/App/App.xcodeproj/project.pbxproj (MARKETING_VERSION, CURRENT_PROJECT_VERSION)
 *
 * Usage:
 *   node scripts/bump-ios-version.js                 # patch bump (1.2.18 -> 1.2.19)
 *   node scripts/bump-ios-version.js minor           # 1.2.18 -> 1.3.0
 *   node scripts/bump-ios-version.js major           # 1.2.18 -> 2.0.0
 *   node scripts/bump-ios-version.js 1.2.20          # explicit version
 *   node scripts/bump-ios-version.js 1.2.20 20260501120000  # explicit version + build
 *
 * Build number defaults to YYYYMMDD + 3-digit counter. If the existing build
 * already matches today's date, the counter is incremented; otherwise reset to 001.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const PLIST = path.join(ROOT, 'ios/App/App/Info.plist');
const PBXPROJ = path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}
function write(file, content) {
  fs.writeFileSync(file, content);
}

function bumpSemver(current, mode) {
  const [maj, min, pat] = current.split('.').map((n) => parseInt(n, 10) || 0);
  if (mode === 'major') return `${maj + 1}.0.0`;
  if (mode === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

function isExplicitVersion(s) {
  return /^\d+\.\d+\.\d+$/.test(s);
}

function nextBuildNumber(currentBuild) {
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(today.getUTCDate()).padStart(2, '0');
  const datePrefix = `${yyyy}${mm}${dd}`;
  if (currentBuild && currentBuild.startsWith(datePrefix)) {
    const counter = parseInt(currentBuild.slice(8), 10) || 0;
    return `${datePrefix}${String(counter + 1).padStart(3, '0')}`;
  }
  return `${datePrefix}001`;
}

// --- parse args ---
const args = process.argv.slice(2);
let versionArg = args[0];
let explicitBuild = args[1];

const pkg = JSON.parse(read(PKG));
const currentVersion = pkg.version;

let newVersion;
if (!versionArg || ['patch', 'minor', 'major'].includes(versionArg)) {
  newVersion = bumpSemver(currentVersion, versionArg || 'patch');
} else if (isExplicitVersion(versionArg)) {
  newVersion = versionArg;
} else {
  console.error(`Invalid version arg: "${versionArg}". Use patch|minor|major or X.Y.Z`);
  process.exit(1);
}

// --- read current values from each file BEFORE writing ---
const plistRaw = read(PLIST);
const pbxRaw = read(PBXPROJ);

const plistShortMatch = plistRaw.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
const plistBuildMatch = plistRaw.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/);
const pbxMarketingMatch = pbxRaw.match(/MARKETING_VERSION = ([^;]+);/);
const pbxCurrentMatch = pbxRaw.match(/CURRENT_PROJECT_VERSION = ([^;]+);/);

const before = {
  pkgVersion: currentVersion,
  plistShort: plistShortMatch ? plistShortMatch[1] : '(none)',
  plistBuild: plistBuildMatch ? plistBuildMatch[1] : '(none)',
  pbxMarketing: pbxMarketingMatch ? pbxMarketingMatch[1] : '(none)',
  pbxCurrent: pbxCurrentMatch ? pbxCurrentMatch[1] : '(none)',
};

const newBuild = explicitBuild || nextBuildNumber(before.plistBuild === '(none)' ? '' : before.plistBuild);

// --- helpers for pretty diff output ---
const COL = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', bold: '\x1b[1m' };
function diff(label, oldVal, newVal) {
  const changed = String(oldVal) !== String(newVal);
  const arrow = changed ? `${COL.yellow}->${COL.reset}` : `${COL.dim}==${COL.reset}`;
  const newCol = changed ? COL.green : COL.dim;
  const tag = changed ? '' : `${COL.dim} (unchanged)${COL.reset}`;
  console.log(`    ${label.padEnd(28)} ${COL.dim}${oldVal}${COL.reset} ${arrow} ${newCol}${newVal}${COL.reset}${tag}`);
}

console.log(`\n${COL.bold}${COL.cyan}🔧 Bumping iOS version${COL.reset}`);
console.log(`${COL.dim}─────────────────────────────────────────────────────────────${COL.reset}`);

console.log(`\n  ${COL.bold}package.json${COL.reset}`);
diff('version', before.pkgVersion, newVersion);

console.log(`\n  ${COL.bold}ios/App/App/Info.plist${COL.reset}`);
diff('CFBundleShortVersionString', before.plistShort, newVersion);
diff('CFBundleVersion', before.plistBuild, newBuild);

console.log(`\n  ${COL.bold}ios/App/App.xcodeproj/project.pbxproj${COL.reset}`);
diff('MARKETING_VERSION', before.pbxMarketing, newVersion);
diff('CURRENT_PROJECT_VERSION', before.pbxCurrent, newBuild);

console.log(`\n${COL.dim}─────────────────────────────────────────────────────────────${COL.reset}`);

// --- update package.json ---
pkg.version = newVersion;
write(PKG, JSON.stringify(pkg, null, 2) + '\n');

// --- update Info.plist ---
let plist = plistRaw.replace(
  /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
  `$1${newVersion}$2`
);
plist = plist.replace(
  /(<key>CFBundleVersion<\/key>\s*<string>)[^<]+(<\/string>)/,
  `$1${newBuild}$2`
);
write(PLIST, plist);

// --- update project.pbxproj (multiple occurrences) ---
let pbx = pbxRaw.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${newVersion};`);
pbx = pbx.replace(
  /CURRENT_PROJECT_VERSION = [^;]+;/g,
  `CURRENT_PROJECT_VERSION = ${newBuild};`
);
write(PBXPROJ, pbx);

console.log(`\n${COL.green}✅ Wrote 3 files${COL.reset}  ${COL.bold}version ${newVersion}${COL.reset}  ${COL.bold}build ${newBuild}${COL.reset}`);
console.log(`${COL.dim}   Next: npx cap sync ios && open ios/App/App.xcworkspace${COL.reset}`);
