import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEV_LEGAL, checkDevLegalContext, checkDevLegalInventory,
  planDevLegalRelease, assertDevLegalGovernor
} from './dev-legal-release-policy.mjs';

const context = () => ({
  GITHUB_REPOSITORY: DEV_LEGAL.repo,
  GITHUB_REF: DEV_LEGAL.ref,
  GITHUB_SHA: 'a'.repeat(40),
  IGNITE_ICP_ENV: 'dev',
  ACTION: 'check',
  CONFIRMATION: '',
});

test('main branch, DEV governor and explicit manual action are mandatory', () => {
  assert.equal(checkDevLegalContext(context()), 'check');
  const allowed = { ...context(), ACTION: 'publish', CONFIRMATION: DEV_LEGAL.confirmation };
  assert.equal(checkDevLegalContext(allowed), 'publish');
  for (const change of [
    { GITHUB_REF: 'refs/heads/prod' },
    { GITHUB_REPOSITORY: 'other/repo' },
    { IGNITE_ICP_ENV: 'prod' },
    { GITHUB_SHA: '' },
    { ACTION: 'upgrade' },
    { ACTION: 'publish', CONFIRMATION: '' },
    { ACTION: 'publish', CONFIRMATION: 'PUBLISH DEV G1 LEGAL 2026-11-13' },
    { ACTION: 'check', CONFIRMATION: DEV_LEGAL.confirmation },
  ]) assert.throws(() => checkDevLegalContext({ ...context(), ...change }));
  assertDevLegalGovernor(DEV_LEGAL.governor);
  assert.throws(() => assertDevLegalGovernor('2vxsx-fae'));
});

test('pinned group IDs cannot overlap PROD inventory', () => {
  assert.doesNotThrow(() => checkDevLegalInventory(DEV_LEGAL.group1, DEV_LEGAL.group2, {}));
  assert.throws(() => checkDevLegalInventory(DEV_LEGAL.group2, DEV_LEGAL.group1));
  assert.throws(() => checkDevLegalInventory(DEV_LEGAL.group1, DEV_LEGAL.group2, { club_domain: DEV_LEGAL.group2 }));
});

test('only a plain owner-approved G1 release and blank/matching G2 can proceed', () => {
  assert.equal(planDevLegalRelease(DEV_LEGAL.release, null), 'write-group2-once');
  assert.equal(planDevLegalRelease(DEV_LEGAL.release, DEV_LEGAL.release), 'already-matching');
  for (const malformed of [
    '{"version":"2026-11-13"}',
    '"2026-11-13"',
    '2026-11-14',
    '',
    null,
  ]) assert.throws(() => planDevLegalRelease(malformed, null));
  for (const invalid of ['{"version":"2026-11-13"}', '2026-11-14', '1', '']) {
    assert.throws(() => planDevLegalRelease(DEV_LEGAL.release, invalid));
  }
});

test('GitHub publication is manual and reviewer-protected, without PROD writer', () => {
  const w = readFileSync(new URL('../.github/workflows/publish-dev-g2-legal-release.yml', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../frontend/scripts/publish-dev-g2-legal-release.ts', import.meta.url), 'utf8');
  assert.match(w, /workflow_dispatch:/);
  assert.doesNotMatch(w, /^\s*(?:push|pull_request|schedule):/m);
  assert.match(w, /environment: group-2-admin-controls/);
  assert.match(w, /group: ignite-mainnet-governor-deployment/);
  assert.match(w, /IGNITE_ICP_ENV: dev/);
  assert.match(w, /default: check/);
  assert.match(w, /contents: read/);
  assert.match(w, /node --test scripts\/dev-legal-release-policy\.test\.mjs/);
  assert.match(w, /secrets\.GOVERNOR_PEM/);
  assert.match(script, /operator\.verifyGovernor\(DEV_LEGAL\.group2, DEV_LEGAL\.governor\)/);
  assert.match(script, /group2\.set_app_config\(DEV_LEGAL\.key, DEV_LEGAL\.release\)/);
  assert.doesNotMatch(script, /group1\.set_app_config\(/);
  assert.doesNotMatch(script, /'prod'\s*,\s*.*set_app_config/);
  assert.match(script, /const plan = planDevLegalRelease\(before1, before2\)/);
});
