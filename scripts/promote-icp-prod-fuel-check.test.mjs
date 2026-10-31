import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const wf = readFileSync(new URL('../.github/workflows/promote-icp-prod.yml', import.meta.url), 'utf8');
const line = wf.split('\n').find((l) => l.includes('HAVE="$(icp cycles balance'));
const script = line.match(/node -e '([^']+)'/)[1];

const parse = (json) => execFileSync('node', ['-e', script], { input: json }).toString().trim();

test('fuel check prints plain digits for a funded account (no BigInt "n" suffix)', () => {
  assert.equal(parse(JSON.stringify({ balance: '28_363_061_691_799 cycles' })), '28363061691799');
});

test('fuel check prints 0 for unreadable output', () => {
  assert.equal(parse('not json'), '0');
});

test('28.36T passes the 19.8T bash comparison', () => {
  const have = parse(JSON.stringify({ balance: '28_363_061_691_799 cycles' }));
  execFileSync('bash', ['-c', `[ "${have}" -ge 19800000000000 ]`]);
});
