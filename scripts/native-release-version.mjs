import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PLAY_MAX_VERSION_CODE = 2100000000;

/**
 * Preserve the existing Play numbering range while continuing to advance
 * with elapsed minutes. A fixed floor would repeat until the clock caught up.
 */
export const ANDROID_MIN_VERSION_CODE = 88498315;
export const ANDROID_VERSION_EPOCH_MS = Date.parse('2026-11-09T00:00:00Z');

/**
 * Android build numbers never touch Play Console. Each elapsed UTC minute
 * advances the version from the reviewed baseline above the used 88498314.
 * Builds within the same minute have the same number; rebuilds for a new
 * upload must start in a later minute. Invalid/backdated clocks fail closed.
 */
export function timeBasedBuildNumber(nowMs = Date.now()) {
  const minutes = Math.floor(nowMs / 60000);
  if (!Number.isSafeInteger(minutes) || minutes <= 0) throw new Error('Clock time is not usable for a build number');
  const elapsed = minutes - Math.floor(ANDROID_VERSION_EPOCH_MS / 60000);
  if (elapsed < 0) throw new Error('Clock precedes the Android version baseline');
  const build = ANDROID_MIN_VERSION_CODE + elapsed;
  if (build > PLAY_MAX_VERSION_CODE) throw new Error('Time-based build number exceeds the Google Play limit');
  return build;
}

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

/**
 * iOS still asks Apple for the highest released build: the App Store Connect
 * integration is already configured, and Apple has no reusable-number scheme.
 * Android deliberately has no branch here — see timeBasedBuildNumber.
 */
export function readNextStoreBuild(platform, query) {
  if (platform === 'android') throw new Error('Android build numbers are time-based; the store is never queried');
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
    } else if (platform === 'android') {
      console.log(timeBasedBuildNumber());
    } else {
      const next = readNextStoreBuild(platform, (command, params) => {
        try { return execFileSync(command, params, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch { throw new Error('Store build lookup failed; refusing a zero fallback'); }
      });
      console.log(next);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
