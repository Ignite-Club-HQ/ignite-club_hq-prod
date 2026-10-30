import test from 'node:test';
import assert from 'node:assert/strict';
import { nextBuildNumber, readNextStoreBuild, assertArchivedVersion } from './native-release-version.mjs';

test('next Android build exceeds every released track', () => {
  const tracks = { internal: '12', alpha: '25', beta: '20', production: '40' };
  assert.equal(readNextStoreBuild('android', (_, args) => tracks[args.at(-1)]), 41);
});
test('iOS exceeds both App Store and TestFlight builds', () => {
  assert.equal(readNextStoreBuild('ios', (_, args) => args[0].includes('app-store') ? '99' : '80'), 100);
});
test('failed store query never falls back to zero', () => {
  assert.throws(() => readNextStoreBuild('android', () => { throw new Error('offline'); }), /offline/);
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