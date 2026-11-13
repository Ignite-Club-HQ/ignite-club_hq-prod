import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateDevRoutingEvidence } from './dev-routing-approval-policy.mjs';

const route = readFileSync(new URL('../frontend/scripts/produce-routing-gates.ts',import.meta.url),'utf8');
const workflow = readFileSync(new URL('../.github/workflows/approve-dev-public-routing.yml',import.meta.url),'utf8');
const serviceNames = ['club_domain','events_domain','messaging_domain','vault_domain','competition_domain',
  'club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue',
  'pii_access_control','timer_jobs','secret_workload_identity'];
const domains = serviceNames.map((domain,i)=>({domain,canisterId:'test-service-'+i}));
const placementDomains = serviceNames.map((domain,i)=>({domain,canisterId:'test-service-'+i,subnetId:'test-subnet'}));
const config = JSON.stringify([{id:'g2',targetAlias:'mainnet',accepting:true,domains,
  placement:{domains:placementDomains}}]);
const fixture = () => ({
  approved:true, targetAlias:'mainnet', host:'https://icp-api.io',
  routerCanisterId:'jcdfe-vqaaa-aaaal-qxloq-cai', configurationRevision:'0',
  registryRevision:'10', approvedConfiguration:config, evidenceSha256:'b'.repeat(64),
  groups:[{id:'g2',domains,photoStore:'test-photo-store',
    moduleHashes:Object.fromEntries(serviceNames.filter(s=>s!=='secret_workload_identity')
      .concat('media_blob_store').map(s=>[s,'a'.repeat(64)]))}],
  removalWiring:{revision:'0',groupIds:['g2'],checkedAtMs:1794560000000}
});

test('accepts only complete signed DEV group evidence and computes stable bound digest',()=>{
  const checked=validateDevRoutingEvidence(fixture(),'0');
  assert.equal(checked.configurationRevision,'0');
  assert.equal(checked.routerCanisterId,'jcdfe-vqaaa-aaaal-qxloq-cai');
  assert.match(checked.approvedConfigurationSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(checked.groupIds,['g2']);
});

test('rejects mismatched DEV group, stale revision, invalid hashes or missing removal wiring',()=>{
  const v=fixture();v.routerCanisterId='tgfbl-qiaaa-aaaai-ayena-cai';
  assert.throws(()=>validateDevRoutingEvidence(v,'0'),/pinned DEV router/);
  assert.throws(()=>validateDevRoutingEvidence(fixture(),'1'),/operator-approved revision/);
  const bad=fixture();bad.groups.push({...bad.groups[0],id:'g3'});
  assert.throws(()=>validateDevRoutingEvidence(bad,'0'),/inventory/);
  const noHash=fixture();delete noHash.groups[0].moduleHashes.club_domain;
  assert.throws(()=>validateDevRoutingEvidence(noHash,'0'),/inventory/);
  const missing=fixture();missing.removalWiring={};
  assert.throws(()=>validateDevRoutingEvidence(missing,'0'),/removal wiring/);
});

test('DEV routing publisher validates operator pins before writing approval',()=>{
  assert.match(route,/EXPECTED_DEV_ROUTING_CONFIGURATION_REVISION/);
  assert.match(route,/EXPECTED_DEV_ROUTING_CONFIGURATION_SHA256/);
  assert.match(route,/DEV routing configuration digest changed since approval preflight/);
  const revisionCheck=route.indexOf('requiredDevRevision');
  const digestCheck=route.indexOf('requiredDevConfigSha');
  const approval=route.indexOf('recordLiveApproval(evidence.approvedConfiguration, evidenceSha256)');
  assert(revisionCheck>0 && digestCheck>revisionCheck && approval>digestCheck);
});

test('approval workflow requires separate manual DEV confirmation, never uses PROD or direct arbitrary router setters',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/pull_request:|push:|schedule:/);
  assert.match(workflow,/environment: group-2-admin-controls/);
  assert.match(workflow,/test "\$GITHUB_REF" = 'refs\/heads\/main'/);
  assert.match(workflow,/test "\$CONFIRMATION" = 'APPROVE DEV PUBLIC ROUTING'/);
  assert.match(workflow,/IGNITE_ICP_ENV: dev/);
  assert.match(workflow,/SNAPSHOT_CHECK_ONLY: "1"/);
  assert.match(workflow,/RECORD_ROUTING_APPROVAL: "0"/);
  assert.match(workflow,/RECORD_ROUTING_APPROVAL: "1"/);
  assert.match(workflow,/EXPECTED_DEV_ROUTING_CONFIGURATION_SHA256/);
  assert.match(workflow,/validateDevRoutingEvidence/);
  assert.match(workflow,/gh workflow run deploy-frontend-canister.yml --ref main/);
  assert.doesNotMatch(workflow,/deploy\/prod|refs\/heads\/prod|PROD_GOVERNOR|icp deploy|icp canister install|update_settings|set_app_config|register_group\(/);
});
