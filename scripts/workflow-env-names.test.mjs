// Every GitHub workflow display name must carry exactly one environment tag, so
// the Actions tab alone tells the operator what a run can touch:
//   [TEST]  the DEV/test canister set (deploy/mainnet, deploy/groups, DEV frontend)
//   [PROD]  the live canister set (deploy/prod, deploy/frontend-prod)
//   [DB]    the club database the repo is wired to; no canisters
//   [REPO]  GitHub repository housekeeping; no canisters and no club data
// Why: the same repository drives both environments, and a misread workflow name
// is the cheapest way to spend money on or mutate the wrong canister set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, '.github/workflows');
const TAGS = ['[TEST]', '[PROD]', '[DB]', '[REPO]'];

const workflows = readdirSync(DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .sort()
  .map((file) => {
    const text = readFileSync(path.join(DIR, file), 'utf8');
    const line = text.split('\n').find((l) => /^name:\s/.test(l)) ?? '';
    return { file, line, text, name: line.replace(/^name:\s*/, '').trim().replace(/^"([\s\S]*)"$/, '$1') };
  });

test('every workflow display name carries exactly one environment tag', () => {
  assert.ok(workflows.length > 40, `expected the full workflow set, found ${workflows.length}`);
  for (const { file, name } of workflows) {
    const hits = TAGS.filter((tag) => name.startsWith(tag + ' '));
    assert.equal(hits.length, 1, `${file}: "${name}" must start with exactly one of ${TAGS.join(' ')}`);
    assert.ok(name.length > hits[0].length + 1, `${file}: "${name}" has no description after the tag`);
  }
});

test('a bracketed tag is quoted so the file still parses as YAML', () => {
  // An unquoted value starting with `[` is a YAML flow sequence, which makes the
  // whole workflow unreadable, so a tagged name must always be a quoted string.
  for (const { file, line, name } of workflows) {
    if (!name.startsWith('[')) continue;
    assert.match(line, /^name: "[^"]*"$/, `${file}: "${name}" must be written as name: "..."`);
  }
});

test('only promotion and isolated push delivery may claim PROD', () => {
  const prod = workflows.filter(({ name }) => name.startsWith('[PROD] '));
  assert.deepEqual(prod.map(({ file }) => file), ['icp-push-deliver-prod.yml', 'promote-icp-prod.yml']);
  for (const workflow of prod) {
    assert.match(workflow.text, /IGNITE_ICP_ENV:\s*prod/);
    assert.match(workflow.text, /refs\/heads\/prod/);
  }
});

test('a [TEST] workflow can never reach the live canister set', () => {
  for (const { file, name, text } of workflows) {
    if (!name.startsWith('[TEST] ')) continue;
    assert.doesNotMatch(text, /deploy\/prod\/|deploy\/frontend-prod/, `${file}: [TEST] must not touch PROD paths`);
    assert.doesNotMatch(text, /IGNITE_ICP_ENV:\s*prod|resolveEnv\(\)\s*===?\s*['"]prod/, `${file}: [TEST] must not resolve the PROD environment`);
  }
});

test('[DB] and [REPO] workflows cannot reach a canister at all', () => {
  for (const { file, name, text } of workflows) {
    if (!name.startsWith('[DB] ') && !name.startsWith('[REPO] ')) continue;
    assert.doesNotMatch(text, /ic\.ids\.json|deploy\/mainnet|deploy\/groups|deploy\/prod|deploy\/frontend/,
      `${file}: ${name.split(' ')[0]} must not reference a canister table`);
    // The governor key may only be *transported* between repos (migrate-repo-setup);
    // these workflows must never install it as a signing identity or call the ICP CLI.
    assert.doesNotMatch(text, /icp identity|identity import|--pem-file/,
      `${file}: ${name.split(' ')[0]} must not sign with the ICP governor key`);
  }
});

test('tags match what the workflow actually deploys', () => {
  const byFile = Object.fromEntries(workflows.map((w) => [w.file, w]));
  assert.ok(byFile['deploy-frontend-canister.yml'].name.startsWith('[TEST] '));
  assert.match(byFile['deploy-frontend-canister.yml'].text, /IGNITE_ICP_ENV=dev/);
  for (const file of ['upgrade-all-groups.yml', 'topup-canister-cycles.yml', 'canister-health.yml']) {
    assert.ok(byFile[file].name.startsWith('[TEST] '), `${file} targets the test canister set`);
    assert.match(byFile[file].text, /deploy\/mainnet|deploy\/groups/);
  }
});
