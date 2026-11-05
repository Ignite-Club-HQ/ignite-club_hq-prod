// PROD-only settings compatibility. No data copies, activation or rewiring.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { readRoutingGate } from './prod-routing-gate.mjs';
import { githubJournal } from './prod-base-group.mjs';
import { settingsCommitment } from './prod-protection-policy.mjs';
import { wasmHash } from './group2-upgrade-rules.mjs';
import { matchingProdSettings, settingsTargets, applySettingsPlan } from './prod-settings-promotion-policy.mjs';

async function main() {
  const env = process.env;
  const action = process.argv[2];
  if (!['check','apply'].includes(action)) throw Error('Check or apply required');
  const handles = await readRoutingGate(env, { log: false });
  const { ids, page, agent, Actor, IDL, Principal } = handles;
  const receipt = await githubJournal(env, fetch, { branch: 'prod-group-setup', path: 'prod-group-setup/g2-registration.json' }).load({readOnly:true});
  const targets = settingsTargets(ids, page, receipt);
  const pid = id => Principal.fromText(id);
  const Env = IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text }));
  const mgmt = id => Actor.createActor(() => IDL.Service({
    canister_status: IDL.Func([IDL.Record({canister_id:IDL.Principal})],[IDL.Record({module_hash:IDL.Opt(IDL.Vec(IDL.Nat8)),settings:IDL.Record({controllers:IDL.Vec(IDL.Principal),environment_variables:Env})})],[]),
    update_settings: IDL.Func([IDL.Record({canister_id:IDL.Principal,settings:IDL.Record({environment_variables:IDL.Opt(Env)})})],[],[]),
    upload_chunk: IDL.Func([IDL.Record({canister_id:IDL.Principal,chunk:IDL.Vec(IDL.Nat8)})],[IDL.Record({hash:IDL.Vec(IDL.Nat8)})],[]),
    install_chunked_code: IDL.Func([IDL.Record({mode:IDL.Variant({upgrade:IDL.Opt(IDL.Record({skip_pre_upgrade:IDL.Opt(IDL.Bool),wasm_memory_persistence:IDL.Opt(IDL.Variant({keep:IDL.Null,replace:IDL.Null}))}))}),target_canister:IDL.Principal,store_canister:IDL.Opt(IDL.Principal),chunk_hashes_list:IDL.Vec(IDL.Record({hash:IDL.Vec(IDL.Nat8)})),wasm_module_hash:IDL.Vec(IDL.Nat8),arg:IDL.Vec(IDL.Nat8),sender_canister_version:IDL.Opt(IDL.Nat64)})],[],[]),
  }), {agent,canisterId:'aaaaa-aa',effectiveCanisterId:pid(id)});
  const read = async p => {
    const s = await mgmt(p.id).canister_status({canister_id:pid(p.id)});
    if (s.settings.controllers.length !== 1 || s.settings.controllers[0].toText() !== env.PROD_GOVERNOR_PRINCIPAL) throw Error('Unexpected PROD controller');
    return {moduleHash:Buffer.from(s.module_hash[0] ?? []).toString('hex'),environment:s.settings.environment_variables};
  };
  const plans = [];
  for (const t of targets) {
    const live = await read(t), proposed = matchingProdSettings(live.environment,ids.identity_access);
    plans.push({...t,before:live.environment,moduleHash:live.moduleHash,...proposed});
  }
  const report = plans.map(p=>({group:p.groupId,name:p.name,id:p.id,changes:p.next.filter(r=>!p.before.some(b=>b.name===r.name&&b.value===r.value)).map(r=>r.name)}));
  mkdirSync(env.CHECK_REPORT_DIR,{recursive:true});
  writeFileSync(path.join(env.CHECK_REPORT_DIR,'prod-settings-check.json'),JSON.stringify({source:env.GITHUB_SHA,configurationRevision:page.configuration_revision[0],services:report,dataChanged:false},null,2));
  console.log(JSON.stringify(report));
  if (action === 'check') return;
  const journal = githubJournal(env,fetch,{branch:'prod-group-setup',path:'prod-group-setup/settings-promotion.json'});
  let state = await journal.load({readOnly:true});
  if (state?.pending) throw Error('Interrupted settings promotion requires read-only review; no replay');
  state = {source:env.GITHUB_SHA,configurationRevision:page.configuration_revision[0],pending:null,completed:[]};
  const artifacts = new Map();
  const router = Actor.createActor(() => IDL.Service({read_group_registry_page:IDL.Func([IDL.Text,IDL.Opt(IDL.Nat64),IDL.Opt(IDL.Text),IDL.Nat32],[IDL.Variant({Ok:IDL.Record({configuration_revision:IDL.Opt(IDL.Nat64)}),Err:IDL.Text})],[])}),{agent,canisterId:ids.shard_router});
  const assertRevision = async () => {
    const r = await router.read_group_registry_page('mainnet',[],[],64);
    if (!('Ok' in r) || String(r.Ok.configuration_revision[0]) !== String(page.configuration_revision[0])) throw Error('PROD registry changed; stop');
  };
  const governorArg = Uint8Array.from(IDL.encode([IDL.Principal],[pid(env.PROD_GOVERNOR_PRINCIPAL)]));
  await applySettingsPlan(plans,{
    prepare:async p=>{
      await assertRevision();
      let bytes = readFileSync(path.join(env.PROD_SETTINGS_WASM_DIR,p.name));
      if (wasmHash(bytes) !== p.moduleHash) throw Error('Exact running PROD code unavailable; no settings changed');
      if(bytes[0]===0x1f&&bytes[1]===0x8b) bytes=gunzipSync(bytes);
      artifacts.set(p.id,bytes);
    },read,
    intent:async p=>{
      await assertRevision();
      state.pending={kind:'settings-and-exact-code-restart',id:p.id,name:p.name,moduleHash:p.moduleHash,before:settingsCommitment(p.before),after:settingsCommitment(p.next)};
      await journal.save(state);
    },
    write:p=>mgmt(p.id).update_settings({canister_id:pid(p.id),settings:{environment_variables:[p.next]}}),
    restart:async p=>{
      await assertRevision();
      const bytes=artifacts.get(p.id);
      if(!bytes) throw Error('Prepared artifact missing');
      const actor=mgmt(p.id),chunks=[];
      for(let offset=0;offset<bytes.length;offset+=1_000_000) chunks.push(await actor.upload_chunk({canister_id:pid(p.id),chunk:bytes.subarray(offset,offset+1_000_000)}));
      await actor.install_chunked_code({mode:{upgrade:[{skip_pre_upgrade:[false],wasm_memory_persistence:[{keep:null}]}]},target_canister:pid(p.id),store_canister:[],chunk_hashes_list:chunks,wasm_module_hash:Buffer.from(p.moduleHash,'hex'),arg:governorArg,sender_canister_version:[]});
    },
    ack:async p=>{state.completed.push(p.id);state.pending=null;await journal.save(state);},
  });
  // Repeat all settings checks, including unchanged group services.
  for(const p of plans) if(matchingProdSettings((await read(p)).environment,ids.identity_access).changed) throw Error('Final PROD settings mismatch');
  console.log('PROD settings compatibility checked across both groups; data and separate feature switches retained.');
}
main().catch(()=>{console.error('PROD settings promotion stopped. Check the filtered report and any pending receipt before retrying; no automatic replay.');process.exitCode=1;});