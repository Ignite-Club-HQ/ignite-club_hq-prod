import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PREVIOUS_MODULE_HASH, PREVIOUS_RELEASE_SOURCE, CONFIRMATION, TARGET,
  validateRequest
} from './dev-g2-single-read-release-policy.mjs';
const source='809b06d8c760cb899b65af00999373ae880eda8e';
const candidate='f'.repeat(64);
const base={action:'upgrade',confirmation:CONFIRMATION,release:source,actualCommit:source,
  oldHash:PREVIOUS_MODULE_HASH,candidateHash:candidate,expectedCandidateHash:candidate};
test('single-read upgrade requires exact previous DEV G2 module, source, and candidate hashes',()=>{
  assert.equal(PREVIOUS_RELEASE_SOURCE,'51bb9578ec7888acf21dddcdfc488eb6580d1408');
  assert.equal(TARGET.canisterId,'yfwyv-nyaaa-aaaal-qxpyq-cai');
  validateRequest({action:'check'});
  validateRequest(base);
  assert.throws(()=>validateRequest({...base,confirmation:'UPGRADE ALL MAINNET GROUPS'}),/confirmation/);
  assert.throws(()=>validateRequest({...base,oldHash:'a'.repeat(64)}),/drift/);
  assert.throws(()=>validateRequest({...base,release:'a'.repeat(40)}),/source/);
  assert.throws(()=>validateRequest({...base,expectedCandidateHash:'b'.repeat(64)}),/candidate/);
  assert.throws(()=>validateRequest({...base,candidateHash:PREVIOUS_MODULE_HASH,expectedCandidateHash:PREVIOUS_MODULE_HASH}),/candidate/);
  for(const k of ['confirmation','release','oldHash','expectedCandidateHash'])
    assert.throws(()=>validateRequest({action:'check',[k]:'unexpected'}),/empty/);
});
test('release workflow remains single-target and cannot use a bridge or touch PROD',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/dev-g2-single-read-release.yml',import.meta.url),'utf8');
  const runner=readFileSync(new URL('../frontend/scripts/upgrade-dev-g2-single-read.ts',import.meta.url),'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/default: check/);
  assert.match(workflow,/group-2-admin-controls/);
  assert.match(workflow,/ref: 51bb9578ec7888acf21dddcdfc488eb6580d1408/);
  assert.match(workflow,/icp build club_domain/);
  assert.doesNotMatch(workflow,/icp build club_domain events_domain|upgrade-group2\.mjs|prod-enable-member-access\.yml/);
  assert.match(runner,/dev-g2-single-read-release-receipts/);
  assert.match(runner,/single-read-release\.json/);
  assert.match(runner,/wasmHash\(previousBytes\) !== PREVIOUS_MODULE_HASH/);
  assert.match(runner,/baseline\.moduleHash !== PREVIOUS_MODULE_HASH/);
  assert.match(runner,/process\.env\.EXPECTED_CANDIDATE_HASH\?\.trim\(\) !== target\.newHash/);
  assert.match(runner,/const mainnetProject=resolve\(import\.meta\.dirname,'\.\.\/\.\.\/deploy\/mainnet'\)/);
  assert.match(runner,/cwd:mainnetProject/);
  assert.match(runner,/executeUpgrade\(journal/);
  assert.match(runner,/TARGET\.canisterId/);
  assert.doesNotMatch(runner,/https:\/\/.*(?:supabase|netlify)|proxy_url|openai\.com\/api/);
});
