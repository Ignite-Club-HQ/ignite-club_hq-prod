import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventory } from './deployment.mjs';
import { memberReaders, admissionEnvironment, assertAdmissionEnvironment, sanitizeAccountDiagnostics, planDigest,
  ADMISSION_CONFIRMATION } from './prod-commission-policy.mjs';

const config=JSON.parse(readFileSync('deploy/opencloud/prod.json','utf8'));
const identity=config.shared.identity_access;

test('OpenCloud PROD commissions exactly 24 readers: twelve in each closed group',()=>{
  const rows=memberReaders(inventory(config));
  assert.equal(rows.length,24);
  assert.equal(rows.filter(row=>row.scope==='g1').length,12);
  assert.equal(rows.filter(row=>row.scope==='g2').length,12);
  assert.equal(new Set(rows.map(row=>row.id)).size,24);
  assert.ok(rows.some(row=>row.id===config.groups[0].canisterIds.pii_access_control));
  assert.ok(rows.some(row=>row.id===config.groups[1].canisterIds.pii_access_control));
  assert.ok(!rows.some(row=>row.id===config.shared.shard_router));
  assert.ok(!rows.some(row=>row.id===config.shared.identity_access));
});

test('reader configuration adds only admission and preserves every unrelated setting',()=>{
  const before=[{name:'VETKD_KEY_NAME',value:'key_1'},{name:'IGNITE_CLOUD_ENGINE',value:'1'}];
  const after=admissionEnvironment(before,identity);
  assert.deepEqual(before,[{name:'VETKD_KEY_NAME',value:'key_1'},{name:'IGNITE_CLOUD_ENGINE',value:'1'}]);
  assert.equal(after.find(row=>row.name==='VETKD_KEY_NAME').value,'key_1');
  assert.equal(after.find(row=>row.name==='IGNITE_CLOUD_ENGINE').value,'1');
  assert.equal(after.find(row=>row.name==='IGNITE_ACCOUNT_SERVICE_IDENTITY').value,identity);
  assert.equal(after.find(row=>row.name==='IGNITE_ACCOUNT_ADMISSION_RELEASE').value,'1');
  assert.equal(after.some(row=>row.name==='IGNITE_ACCOUNT_REMOVAL_RELEASE'),false);
  assert.equal(after.some(row=>row.name==='IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL'),false);
  assertAdmissionEnvironment(after,identity);
});

test('foreign authority, removal and rehearsal all refuse admission configuration',()=>{
  assert.throws(()=>admissionEnvironment([{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:config.groups[0].canisterIds.club_domain}],identity),/Foreign/);
  assert.throws(()=>admissionEnvironment([{name:'IGNITE_ACCOUNT_REMOVAL_RELEASE',value:'1'}],identity),/remain off/);
  assert.throws(()=>admissionEnvironment([{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}],identity),/remain off/);
});

test('account diagnostics contain no profile name, ciphertext or invented display value',()=>{
  const subject=config.groups[0].canisterIds.pii_access_control;
  const authority=config.groups[0].canisterIds.pii_access_control;
  const principal={toText:()=>subject};
  const rows=sanitizeAccountDiagnostics([{account_id:'account-1',profile_present:false,opaque_name_reference:false,
    display_name:'must never be emitted',presence:[{subject:principal,authority:{toText:()=>authority},valid_owned_ciphertext:false,ciphertext:[1,2,3]}]}]);
  assert.deepEqual(rows,[{accountId:'account-1',profilePresent:false,opaqueNameReference:false,
    encryptedNamePresence:[{subject,authority,validOwnedCiphertext:false}]}]);
  assert.equal(JSON.stringify(rows).includes('must never be emitted'),false);
  assert.equal(JSON.stringify(rows).includes('ciphertext\":['),false);
});

test('check mode reaches its read-only exit before any setting, authority or commissioning write',()=>{
  const runner=readFileSync('scripts/opencloud/prod-commission.mjs','utf8');
  const beforeCheckExit=runner.split("if(mode==='check')")[0];
  for(const mutation of ['update_settings','set_deletion_authority','set_account_removal_authority',
    'commission_opencloud_prod_admission\',[Expectation]','authorize_production_member_access\',[Binding]','configure_membership_directory\',[Binding'])
    assert.equal(beforeCheckExit.includes(mutation),false,mutation);
  assert.match(runner,/allReceivers\.length!==28/);
  assert.match(runner,/config\.admission_required!==member\|\|config\.removal_enabled\|\|config\.rehearsal/);
});

test('reviewed plan binds source, registry revision, modules and exact reader settings',()=>{
  const targets=memberReaders(inventory(config)).map(row=>({...row,environment:[],identity}));
  const input={sourceCommit:'a'.repeat(40),registryRevision:4n,modules:[['id','b'.repeat(64)]],targets};
  assert.match(planDigest(input),/^[a-f0-9]{64}$/);
  assert.notEqual(planDigest(input),planDigest({...input,registryRevision:5n}));
  assert.equal(ADMISSION_CONFIRMATION,'COMMISSION OPENCLOUD PROD ADMISSION');
});
