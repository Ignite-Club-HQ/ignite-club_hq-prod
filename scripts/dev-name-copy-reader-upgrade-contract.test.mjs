import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCOPES,validateRequest} from './all-group-upgrade-policy.mjs';
import {isSecureNameScope,secureNameChangedSettings} from './secure-name-release-policy.mjs';
const workflow=readFileSync(new URL('../.github/workflows/upgrade-all-groups.yml',import.meta.url),'utf8');
const runner=readFileSync(new URL('../frontend/scripts/upgrade-all-groups.ts',import.meta.url),'utf8');
const source=readFileSync(new URL('../scripts/all-group-upgrade-policy.mjs',import.meta.url),'utf8');
const scope='dev_club_name_coverage_reader';
const hash='a'.repeat(64);

test('PII metadata reader scope never enters name release activation or unrelated services',()=>{
  assert.deepEqual(SCOPES[scope],['pii_access_control']);
  assert.equal(isSecureNameScope(scope),false);
  assert.throws(()=>secureNameChangedSettings(scope,'pii_access_control'),/Exact secure-name target/);
  assert.match(runner,/const settingsRelease = cleanupRelease \|\| secureRelease;/);
  assert.match(runner,/if\(settingsRelease\) \{/);
  assert.match(runner,/if\(!recovery\)await executeUpgrades\(/);
  assert.match(source,/DEV club-name coverage reader requires exactly pinned G1\/G2 PII/);
});

test('separate exact manual approval and checked plan are required to upgrade',()=>{
  validateRequest('check',scope);
  validateRequest('upgrade',scope,'UPGRADE DEV NAME COVERAGE READER ONLY',hash);
  assert.throws(()=>validateRequest('upgrade',scope,'UPGRADE DEV NAME COVERAGE READER ONLY',''),/Checked plan/);
  assert.throws(()=>validateRequest('upgrade',scope,'UPGRADE DEV SHARED CLUB NAMES ONLY',hash),/COVERAGE READER/);
  assert.match(workflow,/dev_club_name_coverage_reader/);
  assert.match(workflow,/UPGRADE DEV NAME COVERAGE READER ONLY/);
  assert.match(workflow,/if: inputs.scope == 'dev_club_name_coverage_reader'/);
  assert.match(workflow,/test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow,/group: ignite-mainnet-governor-deployment/);
  assert.match(workflow,/environment: group-2-admin-controls/);
  // Automatic no-hash check-and-upgrade must NOT include this sensitive scope.
  const automatic=workflow.slice(workflow.indexOf("Automatically check the complete release on this exact source revision"));
  assert.doesNotMatch(automatic.slice(0,900),/dev_club_name_coverage_reader/);
});

test('reader-only source contains no implicit settings update or other activation',()=>{
  const scopeComment=source.slice(source.indexOf("dev_club_name_coverage_reader:"));
  assert.match(scopeComment,/\['pii_access_control'\]/);
  assert.doesNotMatch(scopeComment.split('\n')[0],/identity_access|club_domain|notification_queue|messaging_domain/);
  assert.doesNotMatch(workflow,/\n  push:|\n  schedule:/);
  assert.match(workflow,/node --test scripts\/dev-club-name-coverage-policy\.test\.mjs scripts\/dev-club-name-coverage-contract\.test\.mjs/);
});
