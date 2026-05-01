#!/usr/bin/env node
/**
 * App Store Connect build-number precheck.
 *
 * Verifies the build number currently in ios/App/App/Info.plist (CFBundleVersion)
 * has NOT already been used by this app on App Store Connect. This intentionally
 * checks across all marketing versions because Apple/Transporter can reject reused
 * CFBundleVersion values with "already been used" during IPA upload.
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

/**
 * Normalise the App Store Connect .p8 private key into a PEM string Node's
 * crypto module can decode. Handles the common ways CI systems mangle it:
 *   - surrounded by single/double quotes
 *   - literal "\n" sequences instead of real newlines (Codemagic, GH Actions)
 *   - CRLF line endings
 *   - base64-encoded blob of the .p8 contents (no PEM headers at all)
 *   - raw base64 body without BEGIN/END headers
 */
function normalizePrivateKey(raw) {
  let key = String(raw).trim();
  // Strip wrapping quotes
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  // If the value looks like a filesystem path to a .p8 file (Codemagic "Secure file"
  // exposes the file path, not the contents), read the file.
  if (
    key.length < 1024 &&
    !key.includes('\n') &&
    !key.includes(' ') &&
    (key.startsWith('/') || key.startsWith('~') || /^[A-Za-z]:[\\/]/.test(key)) &&
    /\.p8$/i.test(key)
  ) {
    try {
      const expanded = key.startsWith('~')
        ? path.join(process.env.HOME || '', key.slice(1))
        : key;
      if (fs.existsSync(expanded)) {
        key = fs.readFileSync(expanded, 'utf8').trim();
      }
    } catch {
      // fall through
    }
  }
  // Convert literal \n (and \r\n) to real newlines
  if (!key.includes('\n') && key.includes('\\n')) {
    key = key.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  }
  // Normalise CRLF
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  const hasHeader = key.includes('-----BEGIN');

  // If it has no PEM header, it might be the raw base64 body OR a base64-encoded
  // copy of the entire .p8 file. Try decoding once to see if a PEM falls out.
  if (!hasHeader) {
    const base64ish = /^[A-Za-z0-9+/=\s]+$/.test(key);
    if (base64ish) {
      try {
        const decoded = Buffer.from(key.replace(/\s+/g, ''), 'base64').toString('utf8');
        if (decoded.includes('-----BEGIN')) {
          key = decoded.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
        } else {
          // Treat as raw base64 body of a PKCS#8 key — wrap with PEM headers.
          const body = key.replace(/\s+/g, '').match(/.{1,64}/g).join('\n');
          key = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
        }
      } catch {
        // fall through; crypto will throw a clearer error below
      }
    }
  }

  if (!key.endsWith('\n')) key += '\n';
  return key;
}

function makeJwt() {
  const keyId = requireEnv('ASC_KEY_ID');
  const issuerId = requireEnv('ASC_ISSUER_ID');
  const privateKey = normalizePrivateKey(requireEnv('ASC_PRIVATE_KEY'));

  // Validate the key parses before we try to sign — gives a clearer error.
  try {
    crypto.createPrivateKey(privateKey);
  } catch (err) {
    const head = (privateKey.split('\n')[0] || '').slice(0, 40);
    console.error('❌ Could not parse ASC_PRIVATE_KEY as a PEM private key.');
    console.error(`   Got ${privateKey.length} chars, first line: "${head}"`);
    console.error('   Paste the FULL contents of the .p8 file (including the');
    console.error('   "-----BEGIN PRIVATE KEY-----" / "-----END PRIVATE KEY-----" lines)');
    console.error('   directly into the secret VALUE — not a file path, not the filename.');
    console.error('   In Codemagic, add it as an Environment variable (Group: app_store_credentials),');
    console.error('   or base64-encode the .p8 contents — both are accepted by this script.');
    console.error(`   Underlying error: ${err.message}`);
    process.exit(2);
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
 * Returns true if the build number is already present on App Store Connect for this app.
 *
 * We intentionally check globally across all pre-release versions, not just the current
 * marketing version, because Transporter rejects duplicate CFBundleVersion values before
 * the post-upload TestFlight assignment step can recover.
 */
async function isBuildTaken(appId, version, build, jwt) {
  let url =
    `/v1/builds?filter[app]=${appId}` +
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
        if (buildVer === build) {
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
