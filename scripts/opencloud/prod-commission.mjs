import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { identityFromPem } from '../prod-connection-check.mjs';
import { MANAGEMENT_PROXY } from './dev-auto.mjs';
import { validate } from './deployment.mjs';
import { ADMISSION_CONFIRMATION, memberReaders, admissionEnvironment, assertAdmissionEnvironment,
  planDigest, sanitizeAccountDiagnostics } from './prod-commission-policy.mjs';

const [work, mode] = process.argv.slice(2);
if (!['check','commission'].includes(mode)) throw Error('Explicit check or commission mode required');
if (mode === 'commission' && process.env.CONFIRMATION !== ADMISSION_CONFIRMATION) throw Error(`Exact confirmation required: ${ADMISSION_CONFIRMATION}`);
const config = JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const peer = JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
if (process.env.GITHUB_REF_NAME!=='prod' || config.environment !== 'opencloud-prod' ||
    config.applicationKey!=='ignite_prod_v2' || config.commissioningMode !== 'existing-accounts-admission-only' ||
    config.apiHost !== 'https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net' || config.operatorId !== MANAGEMENT_PROXY) throw Error('Wrong PROD admission target');
const rows = validate({...config,supabase:{...config.supabase,publishableKey:config.supabase.publishableKey||'sb_publishable_OFFLINE_INSTALL_VALIDATION'}},peer);
const manifest = JSON.parse(fs.readFileSync(path.join(work,'manifest.json')));
if (manifest.environment !== config.environment || manifest.applicationKey !== config.applicationKey ||
    manifest.accountProtectionBuild?.mode !== 'existing-accounts-admission-only' || manifest.canisters.length !== 32 ||
    manifest.engine.operatorId !== MANAGEMENT_PROXY) throw Error('Wrong reviewed PROD artifact manifest');
const require = createRequire(path.resolve('frontend/package.json'));
const {HttpAgent,Actor} = require('@icp-sdk/core/agent');
const {IDL:I} = require('@icp-sdk/core/candid');
const {Principal} = require('@icp-sdk/core/principal');
const {Ed25519KeyIdentity} = require('@icp-sdk/core/identity');
const {Secp256k1KeyIdentity} = require('@icp-sdk/core/identity/secp256k1');
const identity = identityFromPem(fs.readFileSync(process.env.GOVERNOR_PEM_FILE,'utf8'),{Ed25519KeyIdentity,Secp256k1KeyIdentity});
if (identity.getPrincipal().toText() !== config.controllers.governor) throw Error('Wrong governor');
const agent = await HttpAgent.create({host:config.apiHost,identity,shouldFetchRootKey:false});
const B=I.Vec(I.Nat8), P=I.Principal, T=I.Text, N=I.Nat64, V=I.Vec, R=I.Record;
const E=V(R({name:T,value:T}));
const proxy=Actor.createActor(()=>I.Service({proxy:I.Func([R({method:T,args:B,canister_id:P,cycles:I.Nat})],
  [I.Variant({Ok:R({result:B}),Err:I.Variant({CallFailed:R({reason:T}),InsufficientCycles:R({available:I.Nat,required:I.Nat}),UnauthorizedUser:I.Null})})],[])}),
  {agent,canisterId:MANAGEMENT_PROXY});
const pid = text => Principal.fromText(text);
const management=async(method,type,arg,returns=[])=>{
  const reply=await proxy.proxy({method,args:new Uint8Array(I.encode([type],[arg])),canister_id:pid('aaaaa-aa'),cycles:0n});
  if(!('Ok' in reply))throw Error('Management relay refused '+method);
  return I.decode(returns,Uint8Array.from(reply.Ok.result));
};
const Target=R({canister_id:P});
const Status=R({module_hash:I.Opt(B),settings:R({controllers:V(P),environment_variables:E,wasm_memory_limit:I.Nat})});
const status=async id=>(await management('canister_status',Target,{canister_id:pid(id)},[Status]))[0];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const expectedControllers=[MANAGEMENT_PROXY,config.controllers.owner,config.controllers.connectedIdentity,config.controllers.governor].sort();
const verifyControllers=s=>{
  if(JSON.stringify(s.settings.controllers.map(p=>p.toText()).sort())!==JSON.stringify(expectedControllers))throw Error('Controller mismatch');
};
const invoke=async(id,method,types,args,ret=I.Null)=>{
  const actor=Actor.createActor(()=>I.Service({[method]:I.Func(types,[I.Variant({Ok:ret,Err:T})],[])}),{agent,canisterId:id});
  const out=await actor[method](...args);
  if(!('Ok' in out))throw Error(method+': '+out.Err);
  console.log(method+' OK');return out.Ok;
};
const optional=async(id,method,types,args,ret)=>{
  try{return await invoke(id,method,types,args,ret);}catch(error){
    if(String(error.message).includes('commissioning required'))return null;
    throw error;
  }
};

// The reviewed artifact is compared with every live backend before any write.
const modules=[], statuses=new Map();
for(const row of rows.filter(row=>row.service!=='frontend')){
  const artifact=manifest.canisters.find(item=>item.name===row.name&&item.id===row.id&&item.service===row.service);
  if(!artifact||!/^[a-f0-9]{64}$/.test(artifact.moduleSha256))throw Error('Artifact mismatch '+row.name);
  const live=await status(row.id);verifyControllers(live);statuses.set(row.id,live);
  if(live.module_hash.length!==1||Buffer.from(live.module_hash[0]).toString('hex')!==artifact.moduleSha256)throw Error('Live module mismatch '+row.name);
  if(!['placement_registry','migration_coordinator'].includes(row.service))modules.push([pid(row.id),Array.from(live.module_hash[0])]);
}
if(modules.length!==29)throw Error('Exact 29 authority modules required');

const Domain=R({domain:T,canister:P}), DP=R({domain:T,canister:P,subnet:P});
const Group=R({id:T,target_alias:T,domains:V(Domain),accepting:I.Bool,photo_store:I.Opt(P),assigned_clubs:I.Nat32,max_clubs:I.Nat32});
const Placement=R({group_id:T,deployment_id:T,deployment_revision:N,host:T,network_kind:T,primary_subnet:P,approved_subnets:V(P),additional_subnets_enabled:I.Bool,domains:V(DP)});
const Page=R({groups:V(Group),placements:V(Placement),revision:N,next_cursor:I.Opt(T),configuration_revision:I.Opt(N)});
const Binding=R({registry_revision:N,host:T,network_kind:T,deployment_revision:N,target_alias:T,registry:P,deployment_id:T});
const Snapshot=R({groups:V(R({id:T,target_alias:T,domains:V(Domain)})),placements:V(Placement),revision:N});
const Media=R({stores:V(P),active:I.Bool});
const Inventory=R({groups:R({binding:Binding,history_revision:N,snapshot:Snapshot}),supplemental:V(R({domain:T,group_id:T,subnet:P,canister:P})),media:V(R({club_authority:P,registry:Media}))});
const Expectation=R({identity:P,modules:V(I.Tuple(P,B)),inventory:Inventory});
const Receipt=R({expectation:Expectation,lifecycle:V(R({canister:P,module_hash:B,changes:N}))});
const router=config.shared.shard_router,id=config.shared.identity_access;
const page=await invoke(router,'read_group_registry_page',[T,I.Opt(N),I.Opt(T),I.Nat32],['opencloud-prod',[],[],64],Page);
if(page.next_cursor.length||page.groups.length!==2||page.placements.length!==2||page.revision!==4n)throw Error('Unexpected registry revision or inventory');
const same=(a,b)=>a.toText()===b;
for(const [index,group] of config.groups.entries()){
  const name=index===0?'base':'g2',live=page.groups.find(item=>item.id===name),placement=page.placements.find(item=>item.group_id===name);
  const domains=Object.entries(group.canisterIds).filter(([key])=>key!=='media_blob_store').concat([['secret_workload_identity',config.shared.secret_workload_identity]]);
  if(!live||!placement||live.accepting||live.assigned_clubs!==0||live.max_clubs!==group.maxClubs||live.target_alias!==config.environment||
      live.photo_store.length!==1||!same(live.photo_store[0],group.canisterIds.media_blob_store)||placement.deployment_revision!==1n||
      placement.host!==config.apiHost||placement.network_kind!=='cloud_engine'||placement.deployment_id!==config.environment||
      placement.additional_subnets_enabled||!same(placement.primary_subnet,config.subnetId)||placement.approved_subnets.length!==1||
      !same(placement.approved_subnets[0],config.subnetId)||live.domains.length!==domains.length||placement.domains.length!==domains.length||
      domains.some(([key,value])=>!live.domains.some(d=>d.domain===key&&same(d.canister,value))||
        !placement.domains.some(d=>d.domain===key&&same(d.canister,value)&&same(d.subnet,config.subnetId))))throw Error('Closed group mismatch '+name);
}
const binding={registry_revision:page.revision,host:config.apiHost,network_kind:'cloud_engine',deployment_revision:1n,
  target_alias:config.environment,registry:pid(router),deployment_id:config.environment};
const media=[];
for(const group of config.groups){
  const registry=await invoke(group.canisterIds.club_domain,'read_media_quota_store_registry',[],[],Media);
  if(registry.stores.length!==1||!same(registry.stores[0],group.canisterIds.media_blob_store))throw Error('Media registry mismatch');
  media.push({club_authority:pid(group.canisterIds.club_domain),registry});
}
const supplemental=[{domain:'shard_router',group_id:'base',subnet:pid(config.subnetId),canister:pid(router)},
  ...config.groups.map((group,index)=>({domain:'media_blob_store',group_id:index===0?'base':'g2',subnet:pid(config.subnetId),canister:pid(group.canisterIds.media_blob_store)}))];
const history=await invoke(id,'read_production_account_history_revision',[],[],N);
let expected={identity:pid(id),modules,inventory:{groups:{binding,history_revision:history,snapshot:{groups:page.groups,placements:page.placements,revision:page.revision}},supplemental,media}};
let receipt=await optional(id,'read_opencloud_prod_admission_commissioning',[],[],Receipt);
if(receipt){
  const normalized={...receipt.expectation,inventory:{...receipt.expectation.inventory,groups:{...receipt.expectation.inventory.groups,history_revision:history}}};
  if(!Buffer.from(I.encode([Expectation],[normalized])).equals(Buffer.from(I.encode([Expectation],[expected]))))throw Error('Commissioned receipt differs from live inventory');
  expected=normalized;
}

// Bounded account/profile and encrypted-name-presence evidence. Plaintext names
// are decoded only as part of the existing admin DTO and immediately discarded.
const Role=R({account_id:T,role:T,site_id:I.Opt(T),club:I.Opt(T),team:I.Opt(T)});
const Profile=R({account_id:T,display_name:T,avatar_ref:I.Opt(T),updated_at_ns:N,theme_preference:I.Opt(T),club_switcher_hint_seen_at:I.Opt(N)});
const AccountRow=R({account_id:T,status:I.Variant({Active:I.Null,Suspended:I.Null}),principals:V(P),roles:V(Role),profile:I.Opt(Profile)});
const AccountPage=R({items:V(AccountRow),next:I.Opt(T)});
const directory=await invoke(id,'list_admin_accounts',[T,I.Opt(T),I.Nat16],['',[],100],AccountPage);
if(directory.next.length||directory.items.length>100)throw Error('Bounded account diagnostic requires a complete single page');
const Presence=R({subject:P,authority:P,valid_owned_ciphertext:I.Bool});
const Diagnostic=R({account_id:T,profile_present:I.Bool,opaque_name_reference:I.Bool,presence:V(Presence)});
const rawDiagnostics=await invoke(id,'read_opencloud_prod_name_diagnostics',[V(T)],[directory.items.map(row=>row.account_id)],V(Diagnostic));
const beforeDiagnostics=sanitizeAccountDiagnostics(rawDiagnostics);
const readers=memberReaders(rows);
const plannedTargets=readers.map(row=>({...row,environment:statuses.get(row.id).settings.environment_variables,identity:id}));
const reviewedPlanHash=planDigest({sourceCommit:process.env.GITHUB_SHA,registryRevision:page.revision,
  modules:modules.map(([principal,module])=>[principal.toText(),Buffer.from(module).toString('hex')]),targets:plannedTargets});
const report=()=>({status:receipt?'commissioned':'checked',mode,sourceCommit:process.env.GITHUB_SHA,reviewedPlanHash,
  registryRevision:String(page.revision),groups:page.groups.map(group=>({id:group.id,accepting:group.accepting})),
  liveModulesVerified:31,controllersVerified:31,plannedReaders:readers.length,commissionedReaders:receipt?readers.length:0,accounts:beforeDiagnostics,
  removalRelease:false,recoveryRelease:false,routingApproval:false,groupOpening:false});
const save=()=>{if(process.env.CHECK_REPORT_DIR){fs.mkdirSync(process.env.CHECK_REPORT_DIR,{recursive:true});
  fs.writeFileSync(path.join(process.env.CHECK_REPORT_DIR,'opencloud-prod-admission-report.json'),JSON.stringify(report(),null,2)+'\n');}};
const Receiver=R({receiver:P,authority:I.Opt(P),protocol:I.Nat32,admission_required:I.Bool,removal_enabled:I.Bool,rehearsal:I.Bool});
const Directory=R({binding:Binding,generation:N,inventory_digest:B,sources:V(I.Tuple(T,P)),enabled:I.Bool,app_enabled:I.Bool});
const verifyCommissionedReadback=async()=>{
  receipt=await invoke(id,'read_opencloud_prod_admission_commissioning',[],[],Receipt);
  const directoryConfig=await invoke(id,'read_membership_directory_configuration',[],[],Directory);
  if(!directoryConfig.enabled||directoryConfig.app_enabled||directoryConfig.generation!==1n||directoryConfig.sources.length!==2||
      directoryConfig.sources.some(([name])=>!['base','g2'].includes(name)))throw Error('Membership discovery readback mismatch');
  const opening=await invoke(id,'read_group_opening_configuration',[],[],V(I.Tuple(T,T)));
  const openingRows=new Map(opening);
  if(openingRows.get('account_admission_released')!=='true'||openingRows.get('ordinary_member_access')!=='true'||
      openingRows.get('global_account_operations_deferred')!=='true')throw Error('Ordinary admission readback mismatch');
  const allReceivers=[...new Set([...page.groups.flatMap(group=>group.domains.map(domain=>domain.canister.toText())),
    ...supplemental.map(row=>row.canister.toText())])];
  if(allReceivers.length!==28)throw Error('Exact 28 authenticated receivers required');
  for(const receiver of allReceivers){
    const config=await invoke(receiver,'read_account_protection_configuration',[],[],Receiver);
    const member=readers.some(row=>row.id===receiver);
    if(config.receiver.toText()!==receiver||config.authority.length!==1||config.authority[0].toText()!==id||config.protocol!==1||
        config.admission_required!==member||config.removal_enabled||config.rehearsal)throw Error('Receiver admission mode readback mismatch '+receiver);
  }
  for(const target of readers)assertAdmissionEnvironment((await status(target.id)).settings.environment_variables,id);
  const afterDiagnostics=sanitizeAccountDiagnostics(await invoke(id,'read_opencloud_prod_name_diagnostics',[V(T)],[directory.items.map(row=>row.account_id)],V(Diagnostic)));
  if(JSON.stringify(afterDiagnostics)!==JSON.stringify(beforeDiagnostics))throw Error('Account/profile/PII diagnostics changed during commissioning');
};
if(mode==='check'){
  if(receipt)await verifyCommissionedReadback();
  save();console.log(`Read-only PROD admission check passed: 31 modules/controllers, ${readers.length} planned readers, ${beforeDiagnostics.length} accounts; plan ${reviewedPlanHash}`);
  process.exit(0);
}

// Apply only the two admission settings. No unrelated environment value is
// replaced and neither removal nor rehearsal is ever written on.
for(const target of plannedTargets){
  const live=await status(target.id);verifyControllers(live);
  const next=admissionEnvironment(live.settings.environment_variables,id);
  await management('update_settings',R({canister_id:P,settings:R({environment_variables:I.Opt(E)})}),
    {canister_id:pid(target.id),settings:{environment_variables:[next]}});
  const after=await status(target.id);verifyControllers(after);assertAdmissionEnvironment(after.settings.environment_variables,id);
  if(Buffer.from(after.module_hash[0]??[]).toString('hex')!==Buffer.from(live.module_hash[0]).toString('hex'))throw Error('Module changed during reader configuration');
}

await invoke(router,'set_deletion_authority',[P],[pid(id)]);
for(const target of [router,...config.groups.map(group=>group.canisterIds.timer_jobs),config.shared.secret_workload_identity]){
  await invoke(target,'set_account_removal_authority',[P],[pid(id)]);
}
if(!receipt){
  await invoke(id,'review_production_account_inventory',[Expectation,N],[expected,history],I.Reserved);
  receipt=await invoke(id,'commission_opencloud_prod_admission',[Expectation],[expected],Receipt);
}
await invoke(id,'authorize_production_member_access',[Binding],[receipt.expectation.inventory.groups.binding]);
await invoke(id,'configure_membership_directory',[Binding,V(P),N],
  [receipt.expectation.inventory.groups.binding,config.groups.map(group=>pid(group.canisterIds.club_domain)),1n],I.Reserved);
await verifyCommissionedReadback();
save();console.log(`OpenCloud PROD admission commissioned and read back: ${readers.length} readers, two closed groups, two directory sources; plan ${reviewedPlanHash}`);
