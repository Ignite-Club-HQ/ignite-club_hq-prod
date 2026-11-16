import test from 'node:test';
import assert from 'node:assert/strict';
import {secureNameEnvironment,secureNameChangedSettings,requireSecureNameGithubProtection,SAVE_RELEASE,DISPLAY_RELEASE} from './secure-name-release-policy.mjs';
const pins={identity:'identity-cai',originalPii:'original-pii-cai'};
test('secure saving pins original authority without enabling display, cleanup or conversion',()=>{
  const env=[{name:'VETKD_KEY_NAME',value:'key_1'},{name:'custom',value:'keep'}];
  const result=secureNameEnvironment(env,'pii_access_control','secure_name_save',pins);
  assert.equal(result.find(r=>r.name===SAVE_RELEASE)?.value,'1');
  assert.equal(result.find(r=>r.name==='IGNITE_SECURE_ADULT_NAME_IDENTITY')?.value,pins.identity);
  assert.equal(result.some(r=>r.name===DISPLAY_RELEASE||r.name.includes('CLEANUP')||r.name.includes('REHEARSAL')),false);
  for(const r of env)assert.deepEqual(result.find(x=>x.name===r.name),r);
  assert.equal(env.length,2);
});
test('identity save uses only the pinned original PII authority',()=>{
  const result=secureNameEnvironment([],'identity_access','secure_name_save',pins);
  assert.equal(result.find(r=>r.name==='IGNITE_SECURE_ADULT_NAME_PII')?.value,pins.originalPii);
  assert.throws(()=>secureNameEnvironment([{name:'IGNITE_SECURE_ADULT_NAME_PII',value:'foreign-cai'}],'identity_access','secure_name_save',pins));
});
test('display release requires secure saving and existing reciprocal identity, changes only display',()=>{
  const env=[{name:'VETKD_KEY_NAME',value:'key_1'},{name:SAVE_RELEASE,value:'1'},{name:'IGNITE_SECURE_ADULT_NAME_IDENTITY',value:pins.identity},{name:'IGNITE_PRIVATE_PROFILE_IDENTITY',value:pins.identity}];
  const result=secureNameEnvironment(env,'pii_access_control','private_club_name_display',pins);
  assert.equal(result.find(r=>r.name===DISPLAY_RELEASE)?.value,'1');
  for(const r of env)assert.deepEqual(result.find(x=>x.name===r.name),r);
  assert.throws(()=>secureNameEnvironment(env.filter(r=>r.name!==SAVE_RELEASE),'pii_access_control','private_club_name_display',pins));
  assert.throws(()=>secureNameEnvironment(env.map(r=>r.name==='IGNITE_PRIVATE_PROFILE_IDENTITY'?{...r,value:'foreign-cai'}:r),'pii_access_control','private_club_name_display',pins),/IGNITE_PRIVATE_PROFILE_IDENTITY/);
  assert.deepEqual(secureNameChangedSettings('private_club_name_display','club_domain'),[DISPLAY_RELEASE]);
});
test('display adds an absent verifier only to the identity already pinned by secure saving',()=>{
  const env=[{name:'VETKD_KEY_NAME',value:'key_1'},{name:SAVE_RELEASE,value:'1'},{name:'IGNITE_SECURE_ADULT_NAME_IDENTITY',value:pins.identity},{name:'custom',value:'keep'}];
  const result=secureNameEnvironment(env,'pii_access_control','private_club_name_display',pins);
  assert.equal(result.find(r=>r.name==='IGNITE_PRIVATE_PROFILE_IDENTITY')?.value,pins.identity);
  assert.equal(result.find(r=>r.name===DISPLAY_RELEASE)?.value,'1');
  for(const r of env)assert.deepEqual(result.find(x=>x.name===r.name),r);
  assert.equal(env.length,4);
  assert.deepEqual(secureNameChangedSettings('private_club_name_display','pii_access_control'),[DISPLAY_RELEASE,'IGNITE_PRIVATE_PROFILE_IDENTITY']);
  assert.throws(()=>secureNameEnvironment(env.filter(r=>r.name!=='IGNITE_SECURE_ADULT_NAME_IDENTITY'),'pii_access_control','private_club_name_display',pins));
  assert.throws(()=>secureNameEnvironment(env.map(r=>r.name==='IGNITE_SECURE_ADULT_NAME_IDENTITY'?{...r,value:'foreign-cai'}:r),'pii_access_control','private_club_name_display',pins));
  assert.equal(result.some(r=>r.name.includes('CLEANUP')||r.name.includes('REHEARSAL')),false);
});
test('live account admission release switch is preserved, not mistaken for a rehearsal',()=>{
  const env=[{name:'VETKD_KEY_NAME',value:'key_1'},{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}];
  const result=secureNameEnvironment(env,'pii_access_control','secure_name_save',pins);
  assert.equal(result.find(r=>r.name==='IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL')?.value,'1');
  assert.equal(result.find(r=>r.name===SAVE_RELEASE)?.value,'1');
  assert.throws(()=>secureNameEnvironment([{name:'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL',value:'1'}],'identity_access','secure_name_save',pins),/IGNITE_PRIVATE_PROFILE_READS_REHEARSAL/);
});
test('foreign keys, active rehearsals, duplicate settings and unrelated targets stop release',()=>{
  for(const env of [[{name:'VETKD_KEY_NAME',value:'test_key_1'}],[{name:'VETKD_KEY_NAME',value:'key_1'},{name:'ANY_REHEARSAL',value:'1'}],[{name:'VETKD_KEY_NAME',value:'key_1'},{name:'VETKD_KEY_NAME',value:'key_1'}]])assert.throws(()=>secureNameEnvironment(env,'pii_access_control','secure_name_save',pins));
  assert.throws(()=>secureNameChangedSettings('secure_name_save','club_domain'));
  assert.throws(()=>secureNameChangedSettings('private_name_cleanup','identity_access'));
  assert.throws(()=>requireSecureNameGithubProtection({can_admins_bypass:true,protection_rules:[],deployment_branch_policy:null},{}));
});

test('exact disposable DEV private display release prepares original G1 team-name authority, not a global profile grant',()=>{
  const dev={identity:'mq2sj-fiaaa-aaaal-qxlqa-cai',originalPii:'iui5p-aaaaa-aaaal-qxllq-cai'};
  const baseline=[
    {name:'IGNITE_SECURE_ADULT_NAME_PII',value:dev.originalPii},
    {name:SAVE_RELEASE,value:'1'},
    {name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'},
    {name:'custom_setting',value:'retain'},
  ];
  const rows=secureNameEnvironment(baseline,'identity_access','private_club_name_display',dev);
  assert.equal(rows.find(x=>x.name===DISPLAY_RELEASE)?.value,'1');
  assert.equal(rows.find(x=>x.name==='IGNITE_DEV_LEGACY_G1_TEAM_NAME_RELEASE')?.value,'1');
  assert.equal(rows.find(x=>x.name==='IGNITE_DEV_LEGACY_G1_OBSERVED_KEY_SHA256')?.value,
    'f80ed20bc0d8a244f40b31fdbd0024ff469d24254197dce9242dce669fa1f34d');
  assert.equal(rows.find(x=>x.name==='custom_setting')?.value,'retain');
  assert.equal(rows.find(x=>x.name==='IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL')?.value,'1');
  assert.equal(baseline.length,4,'original environment remains unmodified');
  const repeated=secureNameEnvironment(rows,'identity_access','private_club_name_display',dev);
  assert.deepEqual(repeated,rows,'replaying a vetted release plan does not change the release');
  assert.throws(()=>secureNameEnvironment([...baseline,{name:'IGNITE_DEV_LEGACY_G1_OBSERVED_KEY_SHA256',value:'0'.repeat(64)}],'identity_access','private_club_name_display',dev),/fingerprint differs/);
  assert.throws(()=>secureNameEnvironment([...baseline,{name:'IGNITE_DEV_LEGACY_G1_TEAM_NAME_RELEASE',value:'1'}],'pii_access_control','private_club_name_display',dev),/original DEV Identity only/);
});

test('foreign and PROD authority inventories never auto-release DEV original team names',()=>{
  const baseline=[{name:'IGNITE_SECURE_ADULT_NAME_PII',value:'foreign-pii-cai'},{name:SAVE_RELEASE,value:'1'}];
  const res=secureNameEnvironment(baseline,'identity_access','private_club_name_display',
    {identity:'foreign-identity-cai',originalPii:'foreign-pii-cai'});
  assert.equal(res.some(x=>x.name.startsWith('IGNITE_DEV_LEGACY_G1_')),false);
  assert.throws(()=>secureNameEnvironment([...baseline,{name:'IGNITE_DEV_LEGACY_G1_TEAM_NAME_RELEASE',value:'1'}],
    'identity_access','private_club_name_display',{identity:'foreign-identity-cai',originalPii:'foreign-pii-cai'}),/original DEV Identity only/);
});
