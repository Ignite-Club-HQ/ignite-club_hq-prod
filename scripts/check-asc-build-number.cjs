#!/usr/bin/env node
/**
 * App Store Connect build-number precheck.
 *
 * Verifies the build number currently in ios/App/App/Info.plist (CFBundleVersion)
 * has NOT already been used for the app's MARKETING_VERSION on App Store Connect.
 *
 * If the build is already used, the script auto-bumps to the next unused build
 * number by repeatedly invoking scripts/bump-ios-version.cjs (which advances the
 * date-suffixed counter). It will retry up to MAX_ATTEMPTS times.
 *
 * Required env vars (set as Lovable Cloud secrets / Codemagic env):
 *   ASC_KEY_ID         - App Store Connect API Key ID  (e.g. "ABC123DEFG")
 *                        Alias: APP_STORE_CONNECT_KEY_IDENTIFIER
 *   ASC_ISSUER_ID      - Issuer ID (UUID from App Store Connect → Users and Access → Keys)
 *                        Alias: APP_STORE_CONNECT_ISSUER_ID
 *   ASC_PRIVATE_KEY    - Contents of the .p8 file (full PEM, including BEGIN/END lines)
 *                        Alias: APP_STORE_CONNECT_PRIVATE_KEY
 *   ASC_APP_ID         - Numeric App Store Connect "Apple ID" of the app (e.g. "1234567890")
 *   ASC_BUNDLE_ID      - (optional) Used only if ASC_APP_ID is not provided; will look up the app.
 *
 * Usage:
 *   node scripts/check-asc-build-number.cjs              # check + auto-bump if taken
 *   node scripts/check-asc-build-number.cjs --check-only # exit 1 if taken, no bump
 *
 * Exits 0 when the local build number is confirmed unused.
 * Exits non-zero on auth failure, network error, or after exhausting bump retries.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLIST = path.join(ROOT, 'ios/App/App/Info.plist');
const BUMP_SCRIPT = path.join(ROOT, 'scripts/bump-ios-version.cjs');
const MAX_ATTEMPTS = 10;

const CHECK_ONLY = process.argv.includes('--check-only');

function readPlist() {
  const raw = fs.readFileSync(PLIST, 'utf8');
  const v = raw.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
  const b = raw.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/);
  if (!v || !b) throw new Error('Could not parse Info.plist version/build');
  return { version: v[1], build: b[1] };
}

const ENV_ALIASES = {
  ASC_KEY_ID: ['APP_STORE_CONNECT_KEY_IDENTIFIER'],
  ASC_ISSUER_ID: ['APP_STORE_CONNECT_ISSUER_ID'],
  ASC_PRIVATE_KEY: ['APP_STORE_CONNECT_PRIVATE_KEY'],
};

function getEnv(name) {
  const names = [name, ...(ENV_ALIASES[name] || [])];
  for (const envName of names) {
    const value = process.env[envName];
    if (value && value.trim()) return value;
  }
  return '';
}

function requireEnv(name) {
  const v = getEnv(name);
  if (!v || !v.trim()) {
    console.error(`❌ Missing required env var: ${name}`);
    console.error('   Set ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY, and ASC_APP_ID (or ASC_BUNDLE_ID).');
    console.error('   Codemagic aliases are also supported: APP_STORE_CONNECT_KEY_IDENTIFIER, APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_PRIVATE_KEY.');
    process.exit(2);
  }
  return v;
}

// --- JWT (ES256) for App Store Connect ---
function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function makeJwt() {
  const keyId = requireEnv('ASC_KEY_ID');
  const issuerId = requireEnv('ASC_ISSUER_ID');
  let privateKey = requireEnv('ASC_PRIVATE_KEY');
  // Allow secret stored with literal "\n"
  if (!privateKey.includes('\n') && privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 60 * 15, // 20-min max; use 15
    aud: 'appstoreconnect-v1',
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  const derSig = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${base64url(derSig)}`;
}

async function ascFetch(pathAndQuery, jwt) {
  const url = `https://api.appstoreconnect.apple.com${pathAndQuery}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ASC API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

async function resolveAppId(jwt) {
  if (process.env.ASC_APP_ID) return process.env.ASC_APP_ID.trim();
  const bundleId = requireEnv('ASC_BUNDLE_ID');
  const data = await ascFetch(
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
    jwt
  );
  if (!data.data || data.data.length === 0) {
    throw new Error(`No App Store Connect app found for bundleId ${bundleId}`);
  }
  return data.data[0].id;
}

/**
 * Returns true if the (version, build) pair is already present on App Store Connect.
 *
 * We page through all builds for the app and match preReleaseVersion.version === version
 * and build.version === build. (App Store Connect requires uniqueness of build number
 * within a given marketing version.)
 */
async function isBuildTaken(appId, version, build, jwt) {
  let url =
    `/v1/builds?filter[app]=${appId}` +
    `&filter[preReleaseVersion.version]=${encodeURIComponent(version)}` +
    `&filter[version]=${encodeURIComponent(build)}` +
    `&include=preReleaseVersion&limit=200`;
  // Loop pagination just in case
  while (url) {
    const data = await ascFetch(url, jwt);
    if (Array.isArray(data.data) && data.data.length > 0) {
      // Confirm the marketing version matches via included preReleaseVersion
      const prvById = new Map(
        (data.included || [])
          .filter((i) => i.type === 'preReleaseVersions')
          .map((i) => [i.id, i.attributes && i.attributes.version])
      );
      for (const b of data.data) {
        const buildVer = b.attributes && b.attributes.version;
        const prvId =
          b.relationships &&
          b.relationships.preReleaseVersion &&
          b.relationships.preReleaseVersion.data &&
          b.relationships.preReleaseVersion.data.id;
        const marketingVer = prvId ? prvById.get(prvId) : null;
        if (buildVer === build && (!marketingVer || marketingVer === version)) {
          return true;
        }
      }
    }
    const next = data.links && data.links.next;
    url = next ? next.replace('https://api.appstoreconnect.apple.com', '') : null;
  }
  return false;
}

function bumpBuildOnly() {
  // Re-run bump script with the SAME marketing version to only advance the build counter.
  const { version } = readPlist();
  execSync(`node "${BUMP_SCRIPT}" ${version}`, { stdio: 'inherit', cwd: ROOT });
}

(async () => {
  const jwt = makeJwt();
  const appId = await resolveAppId(jwt);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { version, build } = readPlist();
    process.stdout.write(
      `🔎 Checking App Store Connect for build ${version} (${build}) ... `
    );
    const taken = await isBuildTaken(appId, version, build, jwt);
    if (!taken) {
      console.log('✅ unused');
      console.log(`\nReady to archive: version ${version}, build ${build}`);
      process.exit(0);
    }
    console.log('⚠️  already used');
    if (CHECK_ONLY) {
      console.error(
        `❌ Build ${build} for version ${version} is already on App Store Connect.`
      );
      process.exit(1);
    }
    console.log(`   Bumping build number (attempt ${attempt}/${MAX_ATTEMPTS})...`);
    bumpBuildOnly();
  }

  console.error(
    `❌ Could not find an unused build number after ${MAX_ATTEMPTS} attempts. Aborting.`
  );
  process.exit(1);
})().catch((err) => {
  console.error('❌ Precheck failed:', err.message || err);
  process.exit(2);
});
