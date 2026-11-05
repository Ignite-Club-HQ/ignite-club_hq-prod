import test from 'node:test';
import assert from 'node:assert/strict';
import { restoredSettings } from './prod-preserve-settings-policy.mjs';

test('a switch wiped by an upgrade is put back', () => {
  const before = [{ name: 'IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE', value: '1' }, { name: 'VETKD_KEY_NAME', value: 'key_1' }];
  const after = [{ name: 'VETKD_KEY_NAME', value: 'key_1' }];
  const r = restoredSettings(before, after);
  assert.equal(r.changed, true);
  assert.deepEqual(r.next, before);
});

test('untouched settings need no write; new ones are kept', () => {
  const before = [{ name: 'A', value: '1' }];
  assert.equal(restoredSettings(before, [{ name: 'A', value: '1' }]).changed, false);
  const r = restoredSettings(before, [{ name: 'A', value: '1' }, { name: 'B', value: '2' }]);
  assert.equal(r.changed, false);
  assert.deepEqual(r.next.map(x => x.name), ['A', 'B']);
});

test('a changed value goes back to the live value', () => {
  assert.deepEqual(restoredSettings([{ name: 'A', value: '1' }], [{ name: 'A', value: '0' }]).next, [{ name: 'A', value: '1' }]);
});

test('unreadable settings stop', () => {
  assert.throws(() => restoredSettings(undefined, []));
});
