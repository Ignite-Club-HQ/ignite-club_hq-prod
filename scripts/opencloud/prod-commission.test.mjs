import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {inventory,manifest} from './deployment.mjs';
import {runProdCommission} from './prod-commission-runner.mjs';
import {memberReaders,admissionEnvironment,assertAdmissionEnvironment,planDigest,sanitizeAccountDiagnostics,ADMISSION_CONFIRMATION} from './prod-commission-policy.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {IDL:I}=require('@icp-sdk/core/candid'),{Principal}=require('@icp-sdk/core/principal');
const pid=s=>Principal.fromText(s),load=s=>JSON.parse(readFileSync(new URL(`../../deploy/opencloud/${s}.json`,import.meta.url)));
const config=load('prod');
function fixture({settings=true,authorities=true,receipt=false,members=false,directory=false}={}){
  const rows=inventory(config),readers=memberReaders(rows),m=manifest(config,load('dev'),undefined,true);
  const state={history:0n,receipt:null,members,directory:null,mutations:[],calls:[],reviews:0,deniedReceiver:null,configFault:null,unknown:null,reports:[]};
  const id=config.shared.identity_access,router=config.shared.shard_router;
  const controls=[config.operatorId,config.controllers.owner,config.controllers.connectedIdentity,config.controllers.governor].map(pid);
  const statuses=new Map(rows.filter(r=>r.service!=='frontend').map(r=>[r.id,{module_hash:[new Uint8Array(32).fill(7)],settings:{controllers:controls,wasm_memory_limit:0n,environment_variables:readers.some(x=>x.id===r.id)&&settings?admissionEnvironment([{name:'VETKD_KEY_NAME',value:'key_1'}],id):[{name:'VETKD_KEY_NAME',value:'key_1'}]}}]));
  m.canisters.forEach(r=>r.moduleSha256='07'.repeat(32));
  const infrastructure=[router,...config.groups.map(g=>g.canisterIds.timer_jobs),config.shared.secret_workload_identity];
  state.authorities=new Map(infrastructure.map(p=>[p,authorities?[pid(id)]:[]]));state.deletion=authorities?id:'';
  const groups=config.groups.map((g,n)=>({id:n?'g2':'base',target_alias:config.environment,domains:Object.entries(g.canisterIds).filter(([key])=>key!=='media_blob_store').concat([['secret_workload_identity',config.shared.secret_workload_identity]]).map(([domain,p])=>({domain,canister:pid(p)})),accepting:false,photo_store:[pid(g.canisterIds.media_blob_store)],assigned_clubs:0,max_clubs:g.maxClubs}));
  const placements=groups.map(g=>({group_id:g.id,deployment_id:config.environment,deployment_revision:1n,host:config.apiHost,network_kind:'cloud_engine',primary_subnet:pid(config.subnetId),approved_subnets:[pid(config.subnetId)],additional_subnets_enabled:false,domains:g.domains.map(d=>({...d,subnet:pid(config.subnetId)}))}));
  const page={groups,placements,revision:4n,next_cursor:[],configuration_revision:[]};
  const binding={registry_revision:4n,host:config.apiHost,network_kind:'cloud_engine',deployment_revision:1n,target_alias:config.environment,registry:pid(router),deployment_id:config.environment};
  const sources=config.groups.map((g,n)=>[n?'g2':'base',pid(g.canisterIds.club_domain)]);
  const makeDirectory=()=>({binding,generation:1n,inventory_digest:new Uint8Array(32).fill(8),sources,enabled:true,app_enabled:false});
  const data=[{account_id:'encrypted',profile_present:true,opaque_name_reference:true,presence:[{subject:pid(id),authority:pid(config.groups[0].canisterIds.pii_access_control),valid_owned_ciphertext:true}]},{account_id:'missing-one',profile_present:false,opaque_name_reference:false,presence:[]},{account_id:'missing-two',profile_present:false,opaque_name_reference:false,presence:[]}];
  state.data=JSON.stringify(sanitizeAccountDiagnostics(data));
  const faultAfter=method=>{if(state.unknown===method){state.unknown=null;throw Error('Unknown callback '+method);}};
  const invoke=async(target,method,types,args)=>{
    state.calls.push([target,method]);
    switch(method){
      case 'read_group_registry_page':return page;
      case 'read_media_quota_store_registry':return {active:false,stores:[pid(config.groups.find(g=>g.canisterIds.club_domain===target).canisterIds.media_blob_store)]};
      case 'read_production_account_history_revision':return state.history;
      case 'read_opencloud_prod_admission_commissioning':if(!state.receipt)throw Error('OpenCloud PROD admission commissioning required');return state.receipt;
      case 'list_admin_accounts':return {items:data.map(r=>({account_id:r.account_id})),next:[]};
      case 'read_opencloud_prod_name_diagnostics':return data;
      case 'read_group_opening_configuration':return target===router?[['deletion_authority',state.deletion]]:[['account_admission_released',String(state.members)],['ordinary_member_access',String(state.members)],['global_account_operations_deferred','true']];
      case 'read_membership_directory_configuration':if(!state.directory)throw Error('Membership directory unconfigured');return state.directory;
      case 'review_production_account_inventory':{
        state.reviews++;
        if(target!==id)throw Error('Governor must call identity');
        const expected=args[0];state.expected=expected;
        const targets=[...new Set(groups.flatMap(g=>g.domains.map(d=>d.canister.toText())).concat(expected.inventory.supplemental.map(s=>s.canister.toText())))];
        // Model the actual identity->receiver contract, not governor authority.
        const configurations=targets.map(p=>{
          if(state.deniedReceiver===p)throw Error('Configured identity authority required '+p);
          const member=readers.some(r=>r.id===p);
          if(!member&&state.authorities.get(p)?.[0]?.toText()!==id)throw Error('Unconfigured infrastructure');
          const c={receiver:pid(p),authority:[pid(id)],protocol:1,admission_required:member,removal_enabled:false,rehearsal:false};
          if(state.configFault)state.configFault(c,p);
          return c;
        });
        const result={inventory:expected.inventory,account_readers:readers.map(r=>pid(r.id)),eligibility_readers:readers.map(r=>pid(r.id)),targets:targets.map(pid),lifecycle:[],configurations,release_authorized:false,recovery_accepted:false};
        if(state.reviewFault)state.reviewFault(result);
        return result;
      }
      case 'set_deletion_authority':state.mutations.push(method);state.deletion=args[0].toText();faultAfter(method);return null;
      case 'set_account_removal_authority':state.mutations.push(method+':'+target);state.authorities.set(target,[args[0]]);faultAfter(method);return null;
      case 'commission_opencloud_prod_admission':state.mutations.push(method);state.receipt={expectation:args[0],lifecycle:[]};state.history++;faultAfter(method);return state.receipt;
      case 'authorize_production_member_access':state.mutations.push(method);state.members=true;state.history++;faultAfter(method);return null;
      case 'configure_membership_directory':state.mutations.push(method);state.directory=makeDirectory();faultAfter(method);return [];
      default:throw Error('Unexpected operation '+target+' '+method);
    }
  };
  const management=async(method,type,args)=>{
    assert.equal(method,'update_settings');state.mutations.push(method+':'+args.canister_id.toText());
    statuses.get(args.canister_id.toText()).settings.environment_variables=args.settings.environment_variables[0];faultAfter(method);
  };
  const run=mode=>runProdCommission({config,rows,manifest:m,mode,sourceCommit:'a'.repeat(40),I,pid,status:async p=>statuses.get(p),verifyControllers:s=>assert.deepEqual(s.settings.controllers.map(p=>p.toText()).sort(),controls.map(p=>p.toText()).sort()),invoke,optional:async(...args)=>{try{return await invoke(...args);}catch(e){if(e.message.includes('commissioning required'))return null;throw e;}},query:async(p,method)=>{assert.equal(method,'read_account_removal_authority');return state.authorities.get(p);},management,saveReport:r=>state.reports.push(r)});
  return {state,run,readers,statuses,page,makeDirectory,initialize:async()=>{await run('commission');state.mutations=[];state.calls=[];state.reviews=0;}};
}

test('exact 24 member readers, twelve per group; infrastructure cannot inherit alias access',()=>{
  const readers=memberReaders(inventory(config));assert.equal(readers.length,24);assert.equal(readers.filter(r=>r.scope==='g1').length,12);assert.equal(readers.filter(r=>r.scope==='g2').length,12);assert.ok(!readers.some(r=>r.id===config.shared.shard_router));
  assert.throws(()=>memberReaders(inventory(config).slice(1)),/Exactly 24/);
});
test('admission settings preserve encryption; foreign authority/removal/rehearsal refuse',()=>{
  const before=[{name:'VETKD_KEY_NAME',value:'key_1'}],after=admissionEnvironment(before,config.shared.identity_access);
  assert.equal(after.find(r=>r.name==='VETKD_KEY_NAME').value,'key_1');assert.equal(before.length,1);assertAdmissionEnvironment(after,config.shared.identity_access);
  for(const name of ['IGNITE_ACCOUNT_REMOVAL_RELEASE','IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL'])assert.throws(()=>admissionEnvironment([{name,value:'1'}],config.shared.identity_access),/remain off/);
  assert.throws(()=>admissionEnvironment([{name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:load('dev').shared.identity_access}],config.shared.identity_access),/Foreign/);
});
test('unconfigured check is blocked, not green, and performs zero writes',async()=>{
  const f=fixture({settings:false,authorities:false});await assert.rejects(f.run('check'),/blocked/);assert.deepEqual(f.state.mutations,[]);assert.equal(f.state.reviews,0);
});
test('pre-receipt check calls the actual identity-authenticated 28 receiver inventory without writes',async()=>{
  const f=fixture();await f.run('check');assert.equal(f.state.reviews,1);assert.deepEqual(f.state.mutations,[]);assert.equal(f.state.reports.at(-1).authenticatedInventoryVerified,true);assert.equal(f.state.receipt,null);
});
test('complete commissioning and repeat check/retry preserve encrypted and missing profiles with no second mutation',async()=>{
  const f=fixture({settings:false,authorities:false});const before=f.state.data;await f.initialize();
  assert.ok(f.state.receipt);assert.equal(f.state.members,true);assert.equal(f.state.directory.app_enabled,false);assert.equal(f.state.directory.sources.length,2);
  await f.run('check');await f.run('commission');assert.deepEqual(f.state.mutations,[]);assert.equal(f.state.data,before);assert.equal(f.state.reviews,4);
  assert.equal(f.state.calls.some(([p,m])=>m==='read_account_protection_configuration'),false);
});
for(const method of ['update_settings','set_account_removal_authority','commission_opencloud_prod_admission','authorize_production_member_access','configure_membership_directory'])test('unknown '+method+' stops; a new run independently reads back and never replays settled work',async()=>{
  const f=fixture({settings:false,authorities:false});f.state.unknown=method;await assert.rejects(f.run('commission'),/Unknown callback/);
  const previous=f.state.mutations.slice();await f.run('commission');
  const settled=previous.at(-1);assert.equal(f.state.mutations.filter(m=>m===settled).length,1);assert.equal(f.state.members,true);assert.ok(f.state.directory);
});
test('each of the 28 receiver identity refusals blocks before commissioning',async()=>{
  const f=fixture();await f.run('check');const targets=f.state.expected.modules.map(([p])=>p.toText()).filter(p=>p!==config.shared.identity_access);assert.equal(targets.length,28);
  for(const p of targets){const g=fixture();g.state.deniedReceiver=p;await assert.rejects(g.run('check'),/Configured identity/);assert.deepEqual(g.state.mutations,[]);}
});
for(const field of ['authority','admission_required','removal_enabled','rehearsal'])test('all 28 wrong '+field+' receiver states are refused',async()=>{
  const f=fixture();await f.run('check');const targets=f.state.expected.modules.map(([p])=>p.toText()).filter(p=>p!==config.shared.identity_access);
  for(const p of targets){const g=fixture();g.state.configFault=(c,target)=>{if(target===p)c[field]=field==='authority'?[pid(load('dev').shared.identity_access)]:!c[field];};await assert.rejects(g.run('check'),/Receiver admission mode/);assert.deepEqual(g.state.mutations,[]);}
});
test('missing reader and stale inventory cannot pass authenticated review',async()=>{
  for(const fault of [r=>r.account_readers.pop(),r=>r.inventory={...r.inventory,groups:{...r.inventory.groups,history_revision:99n}},r=>r.configurations.pop()]){const f=fixture();f.state.reviewFault=fault;await assert.rejects(f.run('check'),/inventory readback/);assert.deepEqual(f.state.mutations,[]);}
});
test('foreign immutable infrastructure and wrong group/store refuse without writes',async()=>{
  const f=fixture();f.state.authorities.set(config.shared.shard_router,[pid(load('dev').shared.identity_access)]);await assert.rejects(f.run('commission'),/Foreign immutable/);assert.deepEqual(f.state.mutations,[]);
  for(const fault of [f=>f.page.groups[0].photo_store=[pid(config.groups[1].canisterIds.media_blob_store)],f=>f.page.placements[0].host='https://icp-api.io',f=>f.page.revision=3n]){const g=fixture();fault(g);await assert.rejects(g.run('check'),/mismatch|Unexpected registry/);assert.deepEqual(g.state.mutations,[]);}
});
test('final readback rejects foreign directory source/binding and public release',async()=>{
  for(const fault of [d=>d.sources[0][1]=pid(config.groups[1].canisterIds.club_domain),d=>d.binding={...d.binding,registry_revision:5n},d=>d.app_enabled=true,d=>d.sources[0][0]='foreign']){const f=fixture();await f.initialize();fault(f.state.directory);await assert.rejects(f.run('check'),/Membership discovery/);assert.deepEqual(f.state.mutations,[]);}
});
test('stale receipt and live module drift are rejected without mutation',async()=>{
  const f=fixture();await f.initialize();f.state.receipt.expectation={...f.state.receipt.expectation,modules:f.state.receipt.expectation.modules.slice(1)};await assert.rejects(f.run('check'),/receipt differs/);assert.deepEqual(f.state.mutations,[]);
  const g=fixture();g.statuses.get(config.shared.identity_access).module_hash=[new Uint8Array(32).fill(9)];await assert.rejects(g.run('check'),/Live module mismatch/);assert.deepEqual(g.state.mutations,[]);
});
test('reviewed plan binds source/revision/modules and exact admission confirmation',()=>{
  const targets=memberReaders(inventory(config)).map(r=>({...r,environment:[],identity:config.shared.identity_access})),input={sourceCommit:'a'.repeat(40),registryRevision:4n,modules:[['id','b'.repeat(64)]],targets};
  assert.match(planDigest(input),/^[a-f0-9]{64}$/);assert.notEqual(planDigest(input),planDigest({...input,registryRevision:5n}));assert.equal(ADMISSION_CONFIRMATION,'COMMISSION OPENCLOUD PROD ADMISSION');
});
