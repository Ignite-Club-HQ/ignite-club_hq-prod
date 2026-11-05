import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nextBuildNumber, readNextStoreBuild, assertArchivedVersion, timeBasedBuildNumber, PLAY_MAX_VERSION_CODE } from './native-release-version.mjs';

const SCRIPT = fileURLToPath(new URL('./native-release-version.mjs', import.meta.url));

test('android build number is time-based and never queries a store', () => {
  assert.equal(timeBasedBuildNumber(29_900_000 * 60_000), 29_900_000);
  assert.throws(() => readNextStoreBuild('android', () => { throw new Error('store must not be queried'); }), /time-based/);
});

test('android build number grows with the clock and stays inside the Play limit', () => {
  const early = timeBasedBuildNumber(1_794_000_000_000);
  const later = timeBasedBuildNumber(1_794_000_060_000);
  assert.ok(later > early, 'a later clock must produce a higher build number');
  assert.ok(early < PLAY_MAX_VERSION_CODE, 'the current clock must stay under the Play limit');
  assert.throws(() => timeBasedBuildNumber((PLAY_MAX_VERSION_CODE + 1) * 60_000));
  assert.throws(() => timeBasedBuildNumber(-1));
  assert.throws(() => timeBasedBuildNumber(Number.NaN));
});

test('the android CLI path prints a number without any store tool installed', () => {
  const out = execFileSync(process.execPath, [SCRIPT, 'android'], { encoding: 'utf8' }).trim();
  assert.match(out, /^\d+$/, 'the build step feeds this straight into versionCode');
  const value = Number(out);
  assert.ok(value > 29_000_000 && value < PLAY_MAX_VERSION_CODE, `unexpected build number ${out}`);
});

test('iOS exceeds both App Store and TestFlight builds', () => {
  assert.equal(readNextStoreBuild('ios', (_, args) => args[0].includes('app-store') ? '99' : '80'), 100);
});

test('failed store query never falls back to zero', () => {
  assert.throws(() => readNextStoreBuild('ios', () => { throw new Error('offline'); }), /offline/);
});

test('empty malformed and unsafe build responses fail closed', () => {
  for (const value of ['', 'error 404', '-1', '1.5', 'NaN', '9007199254740992']) assert.throws(() => nextBuildNumber([value]));
});

test('numeric zero and surrounding whitespace are valid evidence', () => {
  assert.equal(nextBuildNumber(['0', ' 42\n']), 43);
});

test('Play maximum is enforced', () => {
  assert.equal(nextBuildNumber(['2099999999'], 2100000000), 2100000000);
  assert.throws(() => nextBuildNumber(['2100000000'], 2100000000));
});

test('IPA must preserve existing app identity and exact expected version/build', () => {
  const expected = { version: '1.2.3', build: '101' };
  const actual = { appId: 'app.lovable.igniteteamhub', ...expected };
  assert.doesNotThrow(() => assertArchivedVersion(expected, actual));
  for (const change of [{ appId: 'new.app' }, { version: '1.2.2' }, { build: '100' }]) assert.throws(() => assertArchivedVersion(expected, { ...actual, ...change }));
});
