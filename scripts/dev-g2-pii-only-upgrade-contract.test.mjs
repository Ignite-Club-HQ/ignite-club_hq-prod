// Offline source-only release guard. The actual GitHub workflow additionally
// requires the original pinned governor, complete live registry, old PII key,
// exact plan digest, serialised release journal and signed status readbacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const policy=file('scripts/all-group-upgrade-policy.mjs');
const workflow=file('.github/workflows/upgrade-all-groups.yml');
const runner=file('frontend/scripts/upgrade-all-groups.ts');

test('manual release scope requires MAIN, exact words/hash and the protected serialised governor runner',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/dev_g2_pii_owner_fastpath/);
  assert.match(workflow,/environment: group-2-admin-controls/);
  assert.match(workflow,/group: ignite-mainnet-governor-deployment/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/refs\/heads\/main/);
  assert.match(workflow,/UPGRADE DEV GROUP 2 PII ONLY/);
  assert.match(workflow,/CHECKED_PLAN:/);
  assert.match(workflow,/Test inventory and interrupted-release safeguards/);
  assert.match(workflow,/Check or upgrade the complete existing mainnet inventory/);
  assert.match(policy,/scope === 'dev_g2_pii_owner_fastpath' \? 'UPGRADE DEV GROUP 2 PII ONLY'/);
  assert.match(policy,/\^\[a-f0-9\]\{64\}\$/);
});

test('target selector is one exact Group 2 PII with no implicit G1 or future-group expansion',()=>{
  assert.match(policy,/dev_g2_pii_owner_fastpath: \['pii_access_control'\]/);
  assert.match(policy,/scope === 'dev_g2_pii_owner_fastpath'[\s\S]*?groupId: 'g2'[\s\S]*?hashes\.pii_access_control/);
  assert.match(policy,/if \(scope === 'dev_g2_pii_owner_fastpath'\)/);
  assert.match(policy,/targets\.length !== 1/);
  assert.match(policy,/t\.groupId !== 'g2'/);
  assert.match(policy,/t\.name !== 'pii_access_control'/);
  assert.match(policy,/t\.canisterId !== 'zt5a6-yiaaa-aaaal-qxp5q-cai'/);
  assert.match(policy,/Complete mainnet domain placement required/);
  assert.match(policy,/Saved and live group inventory differ/);
});

test('runner retains journal/readback/crypto continuity, never updates PII settings in this scope',()=>{
  assert.match(runner,/const inventory=planInventory\(shared,provisions,initial,scope,hashes\)/);
  assert.match(runner,/const targets:Target\[\]=inventory\.targets/);
  assert.match(runner,/requireSettledNarrowRelease\(b,old\)/);
  assert.match(runner,/read_group_opening_configuration/);
  assert.match(runner,/media-key-deploy-preflight\.mjs/);
  assert.match(runner,/const keys=journal\?\.keys\?\?Object\.keys\(inventory\.pii\)/);
  assert.match(runner,/assertCheckedPlan\(CHECKED_PLAN,planHash\)/);
  assert.match(runner,/persistGroup2Journal\(api,path,branch,stored,journal,'all-groups'\)/);
  assert.match(runner,/await executeUpgrades\(/);
  assert.match(runner,/await gate\(\)/);
  assert.match(runner,/if\(action==='check'\)\{await gate\(\);process\.exit\(0\);\}/);
  assert.match(runner,/const settingsRelease=cleanupRelease\|\|secureRelease/);
  assert.ok(!policy.includes("dev_g2_pii_owner_fastpath: ['identity_access'"));
  assert.doesNotMatch(workflow,/\n  push:/);
});
