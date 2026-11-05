import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertNativePublicationApproval } from './native-publication-approval.mjs';
const sha = 'a'.repeat(40);
const env = { CM_BRANCH: 'prod', CM_COMMIT: sha, NATIVE_APPROVED_COMMIT: sha };
test('native release requires approval for its exact prod commit', () => {
  assert.doesNotThrow(() => assertNativePublicationApproval(env));
  for (const change of [{ NATIVE_APPROVED_COMMIT: '' }, { NATIVE_APPROVED_COMMIT: 'b'.repeat(40) },
    { CM_BRANCH: 'main' }, { CM_COMMIT: 'aaaaaaa' }]) assert.throws(() => assertNativePublicationApproval({ ...env, ...change }));
});
test('both store workflows require separate approval before promotion evidence or building', () => {
  const text = readFileSync(new URL('../codemagic.yaml', import.meta.url), 'utf8');
  for (const name of ['android-workflow', 'ios-workflow']) {
    const section = text.split(`  ${name}:`)[1].split(/\n  [a-z][a-z-]+:/)[0];
    assert.ok(section.indexOf('node scripts/native-publication-approval.mjs') < section.indexOf('node scripts/prod-publication-gate.mjs'));
    assert.match(section, /node scripts\/native-publication-approval\.mjs/);
  }
});