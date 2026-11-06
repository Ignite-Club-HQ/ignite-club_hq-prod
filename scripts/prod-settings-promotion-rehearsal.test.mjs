import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { HUMAN_DOMAINS } from './prod-protection-policy.mjs';
import { hashPlan } from './prod-base-group-policy.mjs';
import { wasmHash } from './group2-upgrade-rules.mjs';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const { Principal } = require('@icp-sdk/core/principal');
const governor = Principal.selfAuthenticating(new Uint8Array(32).fill(99)).toText();
const wasm = Buffer.from([0,97,115,109,1,0,0,0]);

// The actual CLI entry point runs in a child with only its two network entry
// dependencies replaced. Real settings policy, journals' caller lifecycle,
// Wasm hashing, SDK Candid encoding, artifacts and reports run unchanged.
const stub = `
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.REHEARSAL_SDK);
const { IDL } = require('@icp-sdk/core/candid');
const { Principal } = require('@icp-sdk/core/principal');
const f = JSON.parse(readFileSync(process.env.REHEARSAL_FIXTURE));
const calls = [], states = new Map(f.targets.map(t => [t.id, { environment: t.environment, moduleHash: f.moduleHash, records: {score: 0, ciphertext: 'retained', roster: ['member']} }]));
let pending = f.pending ? {id:f.targets[0].id} : null;
const snapshot = () => writeFileSync(process.env.REHEARSAL_TRACE, JSON.stringify({calls, pending, states: [...states]}));
process.on('exit', snapshot);
globalThis.fetch = () => { throw Error('Network forbidden in offline rehearsal'); };
export async function readRoutingGate() {
  calls.push('routing-read');
  return {ids:f.ids,page:f.page,agent:{},IDL,Principal,Actor:{createActor(factory,options) {
    factory(IDL); // Validate that the runner constructs real Candid definitions.
    if(options.canisterId === f.ids.shard_router) return {read_group_registry_page:async()=>{
      calls.push('revision-read');
      return {Ok:{configuration_revision:[BigInt(f.scenario === 'revision-drift' ? 8 : 7)]}};
    }};
    const id = options.effectiveCanisterId.toText();
    const state = states.get(id);
    if(!state) throw Error('Unknown target');
    return {
      canister_status: async()=>{
        calls.push('read:'+id);
        return {module_hash:[Buffer.from(state.moduleHash,'hex')], settings:{controllers:[Principal.fromText(process.env.PROD_GOVERNOR_PRINCIPAL)],environment_variables:state.environment}};
      },
      update_settings: async args=>{
        calls.push('write:'+id);
        state.environment = args.settings.environment_variables[0];
        if(f.scenario === 'readback-failure') state.environment = [];
      },
      upload_chunk: async args=>{
        calls.push('upload:'+id);
        if(!Buffer.from(args.chunk).equals(Buffer.from(f.wasm))) throw Error('Wrong artifact');
        return {hash:Buffer.from(f.moduleHash,'hex')};
      },
      install_chunked_code: async args=>{
        calls.push('restart:'+id);
        const name = f.targets.find(t=>t.id === id).name;
        const decoded = IDL.decode(name === 'media_blob_store' ? [] : [IDL.Principal], args.arg);
        if(name === 'media_blob_store' && decoded.length) throw Error('Unexpected blob store argument');
        if(name !== 'media_blob_store' && decoded[0].toText() !== process.env.PROD_GOVERNOR_PRINCIPAL) throw Error('Wrong governor argument');
        if(args.mode.upgrade[0].wasm_memory_persistence[0].keep !== null || args.mode.upgrade[0].skip_pre_upgrade[0] !== false) throw Error('Memory preservation missing');
        if(!Buffer.from(args.wasm_module_hash).equals(Buffer.from(f.moduleHash,'hex'))) throw Error('Code changed');
        if(f.scenario === 'lost-restart') throw Error('Unknown restart result');
        if(f.scenario === 'final-drift') states.get(f.targets.at(-1).id).environment = [{name:'UNRELATED',value:'drift'}];
      }
    };
  }}};
}
export function githubJournal(env, fetcher, options) {
  return {load:async()=>{
    calls.push('journal-read:'+options.path);
    return options.path.endsWith('g2-registration.json') ? f.receipt : (pending ? {pending} : null);
  },save:async value=>{
    calls.push(value.pending ? 'intent-save' : 'ack-save');
    if(f.scenario === 'journal-failure') throw Error('Journal readback failed');
    pending = value.pending;
  }};
}
`;

function rehearse(scenario, action = 'apply') {
  const dir = mkdtempSync(path.join(tmpdir(), 'settings-rehearsal-'));
  try {
    const ids = {...PROD_CHECK_IDS};
    const second = Object.fromEntries(GROUP_DOMAINS.map((n,i)=>[n,Principal.selfAuthenticating(new Uint8Array(32).fill(i+1)).toText()]));
    second.secret_workload_identity = ids.secret_workload_identity;
    const photo = Principal.selfAuthenticating(new Uint8Array(32).fill(88)).toText();
    const groups = ['base','g2'].map(id=>({id,accepting:true,target_alias:'mainnet',domains:[...GROUP_DOMAINS,'secret_workload_identity'].map(domain=>({domain,canister:id==='base'?ids[domain]:second[domain]})),photo_store:[id==='base'?ids.media_blob_store:photo]}));
    const placements = groups.map(g=>({group_id:g.id,deployment_id:'prod',host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:governor,approved_subnets:[governor],additional_subnets_enabled:false,domains:g.domains.map(d=>({...d,subnet:governor}))}));
    const plan = {groupId:'g2',group:{...groups[1],accepting:false},openingAuthorized:false,admissionAuthorized:false};
    const targets = groups.flatMap(g=>HUMAN_DOMAINS.map(name=>({id:name==='media_blob_store'?g.photo_store[0]:g.domains.find(d=>d.domain===name).canister,name,environment:[]})));
    const changed = scenario === 'blob-argument' ? targets.find(t=>t.name==='media_blob_store') : targets[0];
    changed.environment = [{name:'IGNITE_ACCOUNT_ADMISSION_RELEASE',value:'1'},{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'},{name:'VETKD_KEY_NAME',value:'key_1'},{name:'IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE',value:'1'}];
    const f = {ids,page:{groups,placements,next_cursor:[],configuration_revision:['7']},receipt:{phase:'registered-closed',pending:null,plan,planHash:hashPlan(plan)},targets,moduleHash:wasmHash(wasm),wasm:[...wasm],scenario,pending:scenario==='pending'};
    mkdirSync(path.join(dir,'artifacts'));
    mkdirSync(path.join(dir,'reports'));
    for(const name of HUMAN_DOMAINS) if(scenario!=='missing-artifact') writeFileSync(path.join(dir,'artifacts',name),scenario==='gzip'?gzipSync(wasm):wasm);
    writeFileSync(path.join(dir,'fixture.json'),JSON.stringify(f));
    writeFileSync(path.join(dir,'stub.mjs'),stub);
    writeFileSync(path.join(dir,'loader.mjs'),`export async function resolve(s,c,n) {if(c.parentURL?.endsWith('/prod-settings-promotion.mjs') && ['prod-routing-gate.mjs','prod-base-group.mjs'].some(x=>s.endsWith(x))) return {url:${JSON.stringify(pathToFileURL(path.join(dir,'stub.mjs')).href)},shortCircuit:true};return n(s,c);}`);
    const result = spawnSync(process.execPath,['--no-warnings','--experimental-loader',path.join(dir,'loader.mjs'),path.join(root,'scripts/prod-settings-promotion.mjs'),action],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH,PROD_GOVERNOR_PRINCIPAL:governor,GITHUB_SHA:'a'.repeat(40),CHECK_REPORT_DIR:path.join(dir,'reports'),PROD_SETTINGS_WASM_DIR:path.join(dir,'artifacts'),REHEARSAL_SDK:path.join(root,'frontend/package.json'),REHEARSAL_FIXTURE:path.join(dir,'fixture.json'),REHEARSAL_TRACE:path.join(dir,'trace.json')}});
    return {status:result.status,trace:JSON.parse(readFileSync(path.join(dir,'trace.json'))),report:JSON.parse(readFileSync(path.join(dir,'reports/prod-settings-check.json'))),targets};
  } finally {rmSync(dir,{recursive:true,force:true});}
}

test('actual check command reads 24 receivers with no writes or restarts',()=>{
  const r=rehearse('success','check');assert.equal(r.status,0);assert.equal(r.report.services.length,24);
  assert.equal(r.trace.calls.some(c=>/^(write:|restart:|intent-save|ack-save)/.test(c)),false);
});
test('actual apply repairs admission and preserves code, records, keys and unrelated switches',()=>{
  const r=rehearse('success');assert.equal(r.status,0);assert.equal(r.trace.pending,null);
  assert.equal(r.trace.calls.filter(c=>c.startsWith('write:')).length,1);
  const state=r.trace.states.find(([id])=>id===r.targets[0].id)[1];
  assert.equal(state.moduleHash,wasmHash(wasm));assert.deepEqual(state.records,{score:0,ciphertext:'retained',roster:['member']});
  const env=new Map(state.environment.map(e=>[e.name,e.value]));
  assert.equal(env.get('IGNITE_ACCOUNT_SERVICE_IDENTITY'),PROD_CHECK_IDS.identity_access);
  assert.equal(env.get('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL'),'0');
  assert.equal(env.get('VETKD_KEY_NAME'),'key_1');assert.equal(env.get('IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE'),'1');
  assert.equal(env.has('IGNITE_ACCOUNT_REMOVAL_RELEASE'),false);
  assert.ok(r.trace.calls.indexOf('intent-save')<r.trace.calls.findIndex(c=>c.startsWith('write:')));
  assert.ok(r.trace.calls.indexOf('ack-save')>r.trace.calls.findIndex(c=>c.startsWith('restart:')));
});
test('plain persistent blob store restarts with no Candid arguments',()=>assert.equal(rehearse('blob-argument').status,0));
test('compressed exact-code artifacts upload the same decoded module',()=>assert.equal(rehearse('gzip').status,0));
for(const scenario of ['missing-artifact','revision-drift','journal-failure','pending']) test(`${scenario} stops before settings writes`,()=>{
  const r=rehearse(scenario);assert.equal(r.status,1);assert.equal(r.trace.calls.some(c=>c.startsWith('write:')),false);
});
for(const scenario of ['readback-failure','lost-restart']) test(`${scenario} retains pending intent and never acknowledges or proceeds`,()=>{
  const r=rehearse(scenario);assert.equal(r.status,1);assert.ok(r.trace.pending);assert.equal(r.trace.calls.includes('ack-save'),false);
  assert.equal(r.trace.calls.filter(c=>c.startsWith('write:')).length,1);
});
test('final verification rejects unrelated drift on an unchanged receiver',()=>assert.equal(rehearse('final-drift').status,1));