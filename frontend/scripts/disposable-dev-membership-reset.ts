/**
 * DEV-only, explicit owner-approved DISPOSABLE membership DIRECTORY reset.
 * This intentionally neither upgrades wasm nor touches account/PII/child/club
 * records. It resets only an old, unreleased directory at revision 7 and
 * restores exact original G1 + registered G2 sources at router revision 11.
 *
 * IMPORTANT: the new backend method must be deployed to the *exact* DEV
 * shared Identity canister via separately owner-approved upgrade first.
 * Both DEV source Club canisters must accept newer directory generations.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Principal } from '@icp-sdk/core/principal';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE as RouterService } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import type { _SERVICE as IdentityService } from '../src/lab/bindings/identity_access/declarations/identity_access.did';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import type { _SERVICE as ClubService } from '../src/lab/bindings/club_domain/declarations/club_domain.did';
import { GROUP2_GOVERNOR } from '../../scripts/group2-upgrade-rules.mjs';

const [pem, reportDir] = process.argv.slice(2);
const action = process.env.DEV_DIRECTORY_ACTION;
const confirmation = process.env.DEV_DIRECTORY_CONFIRMATION;
const phrase = 'RESET IGNITE DEV DIRECTORY 7 TO 11';
const repo = process.env.GITHUB_REPOSITORY?.toLowerCase();
if (!pem || !reportDir || repo !== 'ignite-club-hq/ignite-club_hq-prod' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    !['check','reset'].includes(action ?? '')) {
  throw new Error('Exact original repo, main branch, signed governor, report path and check/reset action required');
}
if (action === 'reset' && confirmation !== phrase) {
  throw new Error('Exact user-approved disposable DEV directory reset confirmation required');
}
const root = new URL('../../', import.meta.url);
const shared = JSON.parse(readFileSync(new URL('deploy/mainnet/.icp/data/mappings/ic.ids.json',root),'utf8'));
const group2 = JSON.parse(readFileSync(new URL('deploy/groups/g2/provision.json',root),'utf8'));
const PIN = Object.freeze({
  router:'jcdfe-vqaaa-aaaal-qxloq-cai',
  identity:'mq2sj-fiaaa-aaaal-qxlqa-cai',
  g1:'mzzzv-taaaa-aaaal-qxlrq-cai',
  g2:'yfwyv-nyaaa-aaaal-qxpyq-cai',
  g1Pii:'iui5p-aaaaa-aaaal-qxllq-cai',
  g2Pii:'zt5a6-yiaaa-aaaal-qxp5q-cai',
  target:'mainnet',
});
if (shared.shard_router!==PIN.router||shared.identity_access!==PIN.identity||
    shared.club_domain!==PIN.g1||group2.canisters.club_domain!==PIN.g2||
    shared.pii_access_control!==PIN.g1Pii||group2.canisters.pii_access_control!==PIN.g2Pii) {
  throw new Error('Checked-in exact DEV inventory changed; no reset');
}
const operator = loadOperatorIdentity(pem);
if (operator.getPrincipal().toText()!==GROUP2_GOVERNOR) throw new Error('Existing exact DEV governor required');
const agent = await HttpAgent.create({host:'https://icp-api.io', identity:operator});
const router = Actor.createActor<RouterService>(routerIdl,{agent,canisterId:PIN.router});
const identity = Actor.createActor<IdentityService>(identityIdl,{agent,canisterId:PIN.identity});
const clubs = [
  {group:'g1',cid:PIN.g1},
  {group:'g2',cid:PIN.g2},
].map(s=>({...s,actor:Actor.createActor<ClubService>(clubIdl,{agent,canisterId:s.cid})}));
const unwrap=<T>(reply:{Ok:T}|{Err:string},label:string):T=>{
  if ('Err' in reply) throw new Error(label+' refused: '+reply.Err);
  return reply.Ok;
};
const fingerprint=(obj:unknown)=>JSON.stringify(obj,(_,value)=>
  typeof value==='bigint'?String(value):value instanceof Uint8Array?Array.from(value):value);
const readRegistry = () => readPinnedGroupRegistry((r,c,l)=>
  router.read_group_registry_page(PIN.target,r,c,l));
const assertRegistry = async ()=>{
  const snapshot=await readRegistry();
  if(snapshot.revision!==11n||snapshot.groups.length!==1||snapshot.groups[0].id!=='g2'||
    snapshot.placements.length!==1||snapshot.placements[0].group_id!=='g2'||
    snapshot.groups[0].domains.find(x=>x.domain==='club_domain')?.canister.toText()!==PIN.g2||
    snapshot.groups[0].domains.find(x=>x.domain==='pii_access_control')?.canister.toText()!==PIN.g2Pii||
    snapshot.placements[0].host!=='https://icp-api.io'||
    snapshot.placements[0].network_kind!=='public_mainnet'||
    snapshot.placements[0].deployment_id!=='mainnet'||
    snapshot.placements[0].deployment_revision!==1n) {
    throw new Error('Expected exact current DEV G2 router revision and placement missing');
  }
  return snapshot;
};
const before=await assertRegistry();
const directory = unwrap(await identity.read_membership_directory_configuration(),'old DEV directory');
const expectedSources=[['g1',PIN.g1],['g2',PIN.g2]];
const matchesSources=(sources:typeof directory.sources)=>
  fingerprint(sources.map(([g,p])=>[g,p.toText()]))===fingerprint(expectedSources);
if(directory.binding.registry.toText()!==PIN.router||
   directory.binding.registry_revision!==7n||
   directory.binding.target_alias!=='mainnet'||
   directory.binding.deployment_id!=='mainnet'||
   directory.binding.deployment_revision!==1n||
   directory.binding.host!=='https://icp-api.io'||
   directory.binding.network_kind!=='public_mainnet'||
   directory.generation!==1n||
   directory.app_enabled||
   !matchesSources(directory.sources)) {
  throw new Error('Existing directory is not the exact unreleased DEV revision-7 fixture; no changes');
}
const sourceBefore = [];
for (const s of clubs) {
  const observed=unwrap(await s.actor.read_membership_directory_source_binding(),'old '+s.group+' source');
  if (observed.binding.length!==1 ||
      observed.binding[0].identity.toText()!==PIN.identity ||
      observed.binding[0].router.toText()!==PIN.router ||
      observed.binding[0].group!==s.group ||
      observed.binding[0].generation!==1n) {
    throw new Error('Unexpected source configuration for '+s.group+'; stop before reset');
  }
  sourceBefore.push(observed);
}
const reread=unwrap(await identity.read_membership_directory_configuration(),'rechecked old directory');
const routerAgain=await assertRegistry();
if(fingerprint(before)!==fingerprint(routerAgain) || fingerprint(directory)!==fingerprint(reread)) {
  throw new Error('DEV routing or membership directory changed during preflight; no changes');
}
mkdirSync(resolve(reportDir),{recursive:true});
const report=(details:Record<string,unknown>)=>
  writeFileSync(resolve(reportDir,'check.json'),JSON.stringify({
    action, target:'DEV-only-original-shared-identity',
    originalDirectoryRevision:'7',routerRevision:'11',groups:['g1','g2'],
    accountRecordsChanged:false,piiRecordsChanged:false,childRecordsChanged:false,
    nameReadAuthorised:false,...details,
  },null,2));
if(action==='check'){
  report({status:'ready-for-separately-approved-reset',readOnly:true,sourceBindingsVerified:true,
          membershipLookupReleased:false});
  console.log('Read-only DEV reset preflight PASSED; no settings or records modified.');
  process.exit(0);
}
const reset=await identity.reset_disposable_dev_membership_directory(7n,11n,phrase);
unwrap(reset,'exact disposable DEV directory reset');
const cleared=await identity.read_membership_directory_configuration();
if (!('Err' in cleared)) throw new Error('Identity directory reset did not result in unconfigured state');
const binding={
  registry:Principal.fromText(PIN.router),registry_revision:11n,
  target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:1n,
  host:'https://icp-api.io',network_kind:'public_mainnet',
};
// The existing verification path checks two full consensus router reads,
// independent source lifecycle history, and original G1 source pin.
const grants=unwrap(await identity.configure_membership_directory(binding,
  clubs.map(s=>Principal.fromText(s.cid)),2n),'fresh DEV directory configuration');
if(grants.length!==2||grants.some(g=>g.generation!==2n||g.router.toText()!==PIN.router||
    g.identity.toText()!==PIN.identity||g.inventory_digest.length!==32)){
  throw new Error('Fresh DEV directory source grants are incomplete');
}
for (const s of clubs) {
  const grant=grants.find(g=>g.group===s.group);
  if(!grant) throw new Error('Missing fresh '+s.group+' source grant');
  const current=unwrap(await s.actor.read_membership_directory_source_binding(),
    'source pre-rebind '+s.group);
  if (current.binding.length===1 && current.binding[0].generation===2n &&
      fingerprint(current.binding[0])===fingerprint(grant) && current.enabled) continue;
  if (current.binding.length!==1 || current.binding[0].generation!==1n) {
    throw new Error('Source binding changed after reset; stop without overwriting '+s.group);
  }
  unwrap(await s.actor.configure_membership_directory_source(grant),
    'fresh '+s.group+' source rebind');
}
for (const s of clubs) {
  const fresh=unwrap(await s.actor.read_membership_directory_source_binding(),
    'fresh '+s.group+' source');
  const grant=grants.find(g=>g.group===s.group);
  if(!grant || !fresh.enabled||fresh.binding.length!==1||
     fingerprint(fresh.binding[0])!==fingerprint(grant)) {
     throw new Error('Fresh directory source binding verification failed for '+s.group);
  }
}
const configured=unwrap(await identity.read_membership_directory_configuration(),
  'fresh DEV directory readback');
if(configured.binding.registry_revision!==11n||configured.generation!==2n||
   !configured.enabled||configured.app_enabled||!matchesSources(configured.sources)) {
  throw new Error('Fresh DEV directory not correctly pinned (reader remains closed)');
}
const after=await assertRegistry();
if(fingerprint(before)!==fingerprint(after)) throw new Error('Router changed during reset/reinit');
report({status:'reinitialised-closed',readOnly:false,sourceBindingsVerified:true,
        directoryGeneration:'2',membershipLookupReleased:false,readyToReleaseName:false});
console.log('DEV-only membership directory reset and reinitialised at router revision 11, generation 2. No private reader released; no account/PII/club records deleted.');
