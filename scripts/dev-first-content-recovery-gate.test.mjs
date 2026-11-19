import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyExactPreviousWasms, assertRecoveryRunMetadata } from './dev-first-content-recovery-gate.mjs';

test('fail closed when either previous module binary is missing or not byte-identical', () => {
  assert.throws(() => verifyExactPreviousWasms({}), /Missing actual archived old Wasm bytes/);
  assert.throws(() => verifyExactPreviousWasms({ identity_access: new Uint8Array([0,97,115,109]) }), /Invalid Wasm|differs from live installed module/);
  assert.throws(() => verifyExactPreviousWasms({ identity_access: Buffer.from('invalid'), club_domain: Buffer.from('invalid') }), /Invalid Wasm|differs from live installed module/);
  assert.throws(() => verifyExactPreviousWasms({ identity_access: new Uint8Array(), club_domain: new Uint8Array([1]) }), /Missing actual archived old Wasm bytes/);
});

test('receipt metadata cannot be forged from an unrelated repository, branch or event', () => {
  const valid={repository:{full_name:'Ignite-Club-HQ/ignite-club_hq-prod'},
    path:'.github/workflows/dev-first-content-recovery-artifacts.yml',
    event:'workflow_dispatch',conclusion:'success',status:'completed',
    head_branch:'main',head_sha:'a'.repeat(40),id:123};
  assert.deepEqual(assertRecoveryRunMetadata(valid),{runId:123,headSha:'a'.repeat(40)});
  for(const patch of [
    {repository:{full_name:'attacker/repo'}},
    {path:'.github/workflows/broad-upgrade.yml'},
    {event:'pull_request'},
    {head_branch:'release/foreign'},
    {status:'queued'},
    {conclusion:'failure'},
    {head_sha:'not-a-commit'}
  ]) assert.throws(() => assertRecoveryRunMetadata({...valid,...patch}), /Recovery bundle/);
});

test('rebuild workflow uses immutable historical refs, no release identity and only permits artifact upload after hash verification', () => {
  const workflow=readFileSync(new URL('../.github/workflows/dev-first-content-recovery-artifacts.yml',import.meta.url),'utf8');
  assert.match(workflow,/permissions:\n  contents: read/);
  assert.doesNotMatch(workflow,/GOVERNOR_PEM|DEPLOYER_PEM|\bicp canister install\b|\bicp deploy\b|update_settings/);
  assert.match(workflow,/ref: 4aeae3a09103b067ac289e602a1efa0b5ac757ca/);
  assert.match(workflow,/ref: 4b9650f219c2ee0985fd6deda5cb6670c14252f4/);
  assert.match(workflow,/verifyExactPreviousWasms/);
  assert.match(workflow,/if-no-files-found: error/);
  assert.match(workflow,/GITHUB_REF=refs\/heads\/main node scripts\/prefetch-test-icp-tools\.mjs/);
  assert.match(workflow,/ICP_HOME: \$\{\{ runner\.temp \}\}\/dev-recovery-icp-home/);
  assert.match(workflow,/GH_TOKEN: \$\{\{ github\.token \}\}/);
});
