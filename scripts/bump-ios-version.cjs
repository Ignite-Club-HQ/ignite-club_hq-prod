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
 *   node scripts/bump-ios-version.js 1.2.20 20260501001  # explicit version + build
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

// --- read current build from Info.plist ---
const plistRaw = read(PLIST);
const buildMatch = plistRaw.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/);
const currentBuild = buildMatch ? buildMatch[1] : '';
const newBuild = explicitBuild || nextBuildNumber(currentBuild);

console.log(`Bumping iOS version:`);
console.log(`  version: ${currentVersion}  ->  ${newVersion}`);
console.log(`  build:   ${currentBuild || '(none)'}  ->  ${newBuild}`);

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
let pbx = read(PBXPROJ);
pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${newVersion};`);
pbx = pbx.replace(
  /CURRENT_PROJECT_VERSION = [^;]+;/g,
  `CURRENT_PROJECT_VERSION = ${newBuild};`
);
write(PBXPROJ, pbx);

console.log(`\n✅ Done. Next: npx cap sync ios && open ios/App/App.xcworkspace`);
