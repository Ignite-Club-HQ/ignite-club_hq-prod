import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function nextBuildNumber(values, max = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(values) || !values.length) throw new Error('Store build evidence is required');
  const numbers = values.map(value => {
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) throw new Error('Store lookup did not return a decimal build number');
    const number = Number(text);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error('Store build number is invalid');
    return number;
  });
  const next = Math.max(...numbers) + 1;
  if (!Number.isSafeInteger(next) || next > max) throw new Error('Next build exceeds platform limit');
  return next;
}

export function readNextStoreBuild(platform, query) {
  if (platform === 'android') {
    const values = ['internal', 'alpha', 'beta', 'production'].map(track =>
      query('google-play', ['get-latest-build-number', '--package-name', 'app.lovable.igniteteamhub', '--tracks', track]));
    return nextBuildNumber(values, 2100000000);
  }
  if (platform === 'ios') {
    return nextBuildNumber(['get-latest-app-store-build-number', 'get-latest-testflight-build-number'].map(command =>
      query('app-store-connect', [command, '--platform', 'IOS', '6758928691'])));
  }
  throw new Error('Unknown native platform');
}

export function assertArchivedVersion(expected, actual) {
  if (actual.appId !== 'app.lovable.igniteteamhub' || actual.version !== expected.version || String(actual.build) !== String(expected.build)) {
    throw new Error('IPA identity/version/build does not match the approved native build');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [platform, ...args] = process.argv.slice(2);
    if (platform === 'verify-ipa') {
      const [expectedFile, plist] = args;
      const expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
      const read = field => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${field}`, plist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      assertArchivedVersion(expected, { appId: read('CFBundleIdentifier'), version: read('CFBundleShortVersionString'), build: read('CFBundleVersion') });
      console.log('IPA identity and version verified');
    } else {
      const next = readNextStoreBuild(platform, (command, params) => {
        try { return execFileSync(command, params, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch { throw new Error('Store build lookup failed; refusing a zero fallback'); }
      });
      console.log(next);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}