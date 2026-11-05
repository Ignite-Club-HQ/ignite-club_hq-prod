import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/upgrade-all-groups.yml', import.meta.url), 'utf8');
const start = workflow.indexOf('          if ! governor_identity=');
const end = workflow.indexOf('          unset governor_identity', start);
assert.ok(start >= 0 && end > start);
const check = workflow.slice(start, end) + 'unset governor_identity\necho accepted';
const pin = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';

function run(output, status = 0) {
  return spawnSync('bash', ['-c', `
    set -euo pipefail
    icp() {
      [ "$*" = 'identity principal --identity ignite-governor' ] || return 99
      printf '%s\\n' "$MOCK_IDENTITY"
      return "$MOCK_STATUS"
    }
    ${check}
  `], { encoding: 'utf8', env: { ...process.env, MOCK_IDENTITY: output, MOCK_STATUS: String(status) } });
}

test('governor check explicitly selects the imported identity and accepts only the existing TEST pin', () => {
  const result = run(pin);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'accepted');
});

test('different identity fails closed with safe guidance and never echoes identity output', () => {
  const result = run('unrelated-test-fixture');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /environment-level GOVERNOR_PEM/);
  assert.equal(result.stdout.includes('unrelated-test-fixture'), false);
  assert.equal(result.stdout.includes('accepted'), false);
});

test('failed identity command is distinguished from a mismatched identity without revealing output', () => {
  const result = run('unrelated-command-fixture', 1);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Could not read the imported governor identity/);
  assert.equal(result.stdout.includes('unrelated-command-fixture'), false);
  assert.equal(result.stdout.includes('accepted'), false);
});