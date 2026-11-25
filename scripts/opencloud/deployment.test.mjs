import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { template, inventory, validateMappings, validate, manifest, prepare, collect, frontendEnv, ROOT } from './deployment.mjs';
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const { Principal } = require('@icp-sdk/core/principal');
const source = name => JSON.parse(readFileSync(path.join(ROOT, `deploy/opencloud/${name}.json`), 'utf8'));
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 2])).toText();
function ready() {
  const c = source('dev'); c.engineId = 'offline-test-engine'; c.consoleProxyId = p(101);
  c.controllers = { owner: p(102), governor: p(103), frontendPublisher: p(104) };
  c.supabase.publishableKey = 'sb_publishable_OFFLINE_TEST_ONLY';
  c.engineSettings.devWasmMemoryLimit = '1073741824';
  c.groups.forEach(g => { g.maxClubs = 10; g.heapBudgetBytes = '1073741824'; });
  return c;
}
test('owner export has 32 parts per application and 64 distinct IDs', () => {
  const dev = source('dev'), prod = source('prod');
  assert.equal(inventory(dev).length, 32); assert.equal(inventory(prod).length, 32);
  assert.equal(new Set([...inventory(dev), ...inventory(prod)].map(r => r.id)).size, 64);
  assert.equal(validateMappings(dev, prod).length, 32);
  assert.equal(dev.applicationKey, 'ignite_dev_v2'); assert.equal(prod.applicationKey, 'ignite_prod_v2');
});
test('OpenCloud IDs never overlap either peer or existing mainnet mappings', () => {
  const dev = source('dev'), prod = source('prod');
  const collision = structuredClone(prod); collision.shared.frontend = dev.shared.frontend;
  assert.throws(() => validateMappings(dev, collision), /overlap/);
  assert.throws(() => validateMappings(dev, prod, new Set([dev.shared.frontend])), /mainnet/);
});
test('missing or duplicated group parts fail closed', () => {
  const c = source('dev'); delete c.groups[1].canisterIds.vault_domain;
  assert.throws(() => validateMappings(c), /Complete/);
  const d = source('dev'); d.groups[1].canisterIds.vault_domain = d.groups[0].canisterIds.vault_domain;
  assert.throws(() => validateMappings(d), /Unique/);
});
test('operator cannot be substituted for the chain-key proxy', () => {
  const c = ready(); c.consoleProxyId = c.operatorId;
  assert.throws(() => validate(c), /distinct/);
  assert.equal(validate(ready()).length, 32);
});
test('DEV and PROD governors and publisher identities cannot cross', () => {
  const c = ready(), peer = source('prod'); peer.controllers.governor = c.controllers.governor;
  assert.throws(() => validate(c, peer), /signing identities/);
});
test('mainnet API defaults and private database credentials are refused', () => {
  const c = ready(); c.apiHost = 'https://icp-api.io'; assert.throws(() => validate(c), /mainnet endpoint/);
  const d = ready(); d.supabase.publishableKey = 'sb_secret_test'; assert.throws(() => validate(d), /Private/);
});
test('engine push remains uncommissioned and controller changes never authorized', () => {
  const c = ready(), m = manifest(c);
  assert.equal(m.restrictions.changeControllers, false); assert.equal(m.restrictions.changeMainnet, false);
  assert.equal(m.restrictions.changeSupabase, false); assert.equal(m.restrictions.createCanisters, false);
  c.push.enabled = true; assert.throws(() => validate(c), /Push commissioning/);
});
test('every group wires to its own services plus the one shared identity', () => {
  const c = ready(), m = manifest(c);
  for (const g of c.groups) {
    const call = m.postInstallCalls.find(r => r.service === `${g.id}_pii_access_control` && r.method === 'set_club_domain_canister');
    assert.equal(call.candidArgs, `(principal "${g.canisterIds.club_domain}")`);
    const identity = m.postInstallCalls.find(r => r.service === `${g.id}_notification_queue` && r.method === 'set_identity_access_canister');
    assert.equal(identity.candidArgs, `(principal "${c.shared.identity_access}")`);
  }
  assert.equal(m.groups[0].domains.length, 13); assert.equal(m.groups[1].domains.length, 13);
  assert.equal(m.groups[0].accepting, false);
  assert.deepEqual(m.groups.map(g => g.groupId), ['base', 'g2']);
  assert.match(m.groups[0].registerGroupCall.candidArgs, /min_cycles = 0 : nat64; cycles = 0 : nat64/);
  assert.match(m.groups[0].registerGroupCall.candidArgs, /accepting = false/);
});
test('legacy recovery commissioning stays held until independent witness pins exist', () => {
  const c = ready(); delete c.commissioningMode; c.accountProtection = {};
  assert.equal(manifest(c).accountProtectionBuild.ready, false);
  c.accountProtection = { approverPublicKey: 'k', witness: c.shared.frontend, witnessModuleHash: 'h', witnessController: 'c' };
  assert.throws(() => manifest(c), /independent/);
});
test('fresh DEV uses 32 targets without witness/key, with erasure and recovery unavailable',()=>{
  const c=ready();c.accountProtection={};const m=manifest(c);
  assert.equal(m.canisters.length,32);assert.equal(m.accountProtectionBuild.ready,true);
  assert.equal(m.accountProtectionBuild.witnessRequired,false);assert.equal(m.accountProtectionBuild.approverKeyRequired,false);
  assert.equal(m.accountProtectionBuild.globalErasureEnabled,false);assert.equal(m.accountProtectionBuild.recoveryEnabled,false);
  assert.equal(Object.keys(m.accountProtectionBuild.compileTimeEnv).some(k=>/WITNESS|APPROVER/.test(k)),false);
  assert.equal(m.sharedCommissioning.some(c=>c.method==='commission_fresh_opencloud_dev'),true);
  assert.equal(m.sharedCommissioning.some(c=>c.method==='provision_production_account_inventory'),false);
  const pii=m.canisters.find(r=>r.name==='g1_pii_access_control').settings.environmentVariables;
  assert.equal(pii.PROXY_CANISTER_ID,c.consoleProxyId);assert.equal(pii.IGNITE_ACCOUNT_ADMISSION_RELEASE,'1');
  assert.equal(pii.IGNITE_PRIVATE_PROFILE_IDENTITY,c.shared.identity_access);
  assert.equal(pii.IGNITE_SHARED_CLUB_NAME_ENFORCEMENT_RELEASE,'1');
  assert.equal(m.canisters.find(r=>r.name==='identity_access').settings.environmentVariables.IGNITE_SECURE_ADULT_NAME_PII,c.groups[0].canisterIds.pii_access_control);
  assert.equal(m.canisters.find(r=>r.name==='g2_club_domain').settings.environmentVariables.IGNITE_NEW_CLUB_PLACEMENT_GROUP,'g2');
  assert.equal(m.canisters.find(r=>r.name==='g1_club_domain').settings.environmentVariables.IGNITE_NEW_CLUB_PLACEMENT_GROUP,'base');
  assert.equal(m.postInstallCalls.filter(r=>r.method==='link_display_identity_authority').length,2);
});
test('first-install mode never enables PROD or extra canisters',()=>{
  const c=source('prod');c.commissioningMode='fresh-install-admission-only';assert.throws(()=>manifest(c,undefined,undefined,true),/DEV-only/);
  const d=ready();d.groups.push({...d.groups[1],id:'g3',canisterIds:Object.fromEntries(Object.keys(d.groups[1].canisterIds).map((s,i)=>[s,p(120+i)]))});
  assert.throws(()=>manifest(d),/exact 32/);
});
test('unverified infrastructure produces only a held manifest, never install arguments guessed as null principals', () => {
  const c = source('dev'); c.controllers.governor = null; const m = manifest(c, source('prod'), undefined, true);
  assert.equal(m.executable, false); assert.equal(m.canisters.find(r => r.name === 'identity_access').initArgs, null);
  assert.throws(() => validate(c, source('prod')), /populated principal/);
});
test('future group reuses thirteen services without exceeding console app limit', () => {
  const c = ready(); const g3 = structuredClone(c.groups[1]); g3.id = 'g3';
  let i = 120; Object.keys(g3.canisterIds).forEach(s => { g3.canisterIds[s] = p(i++); });
  c.groups.push(g3); delete c.commissioningMode; assert.equal(validateMappings(c).length, 45);
  const g4 = structuredClone(g3); g4.id = 'g4'; c.groups.push(g4);
  assert.throws(() => validateMappings(c), /50-canister/);
});
test('isolated staging changes only the encryption route sentinel, never original source', () => {
  const c = ready(), before = readFileSync(path.join(ROOT, 'backend/pii_access_control/src/main.mo'), 'utf8');
  const out = path.join(ROOT, 'deploy/opencloud/work', `offline-test-${process.pid}`);
  rmSync(out, { recursive: true, force: true });
  try {
    const m = prepare(c, source('prod'), out);
    assert.equal(m.canisters.length, 32);
    assert.equal(readFileSync(path.join(ROOT, 'backend/pii_access_control/src/main.mo'), 'utf8'), before);
    assert.match(readFileSync(path.join(out, 'build/backend/pii_access_control/src/main.mo'), 'utf8'), /freshEngineBuild = true/);
    assert.match(readFileSync(path.join(out, 'build/backend/pii_access_control/src/main.mo'), 'utf8'), /accountProtectionMode : AccountProtection.Mode = #ProductionAdmission/);
    assert.match(readFileSync(path.join(out, 'build/backend/pii_access_control/src/main.mo'), 'utf8'), /sharedClubNameEnforcement = true/);
    assert.match(readFileSync(path.join(out, 'build/backend/secret_workload_identity/src/main.mo'), 'utf8'), /removal_enabled = false/);
    assert.equal(existsSync(path.join(out, 'build/.icp/data')), false);
    const env = frontendEnv(c);
    assert.equal(env.IGNITE_LIVE_OPENCLOUD_ENV, 'opencloud-dev');
    assert.equal(env.IGNITE_LIVE_II_DERIVATION_ORIGIN, 'https://h2knm-vaaaa-aaac5-aadqa-cai.icp.net');
    // Invalid final artifact prevents publishing even earlier valid modules.
    const cache = path.join(out, 'build/.icp/cache/artifacts'); mkdirSync(cache, { recursive: true });
    for (const service of new Set(m.canisters.filter(r => r.service !== 'frontend').map(r => r.service))) writeFileSync(path.join(cache, service), Buffer.from([0,97,115,109,1,0,0,0]));
    writeFileSync(path.join(cache, 'vault_domain'), Buffer.from('invalid'));
    assert.throws(() => collect(out), /Invalid module vault_domain/);
    assert.equal(existsSync(path.join(out, 'artifacts')), false);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
test('PROD artifacts cannot be staged or deployed by the DEV preparer', () => {
  assert.throws(() => prepare(source('prod'), source('dev'), '/tmp/prod'), /PROD is template-only/);
  assert.equal(template('opencloud-prod').push.enabled, false);
});