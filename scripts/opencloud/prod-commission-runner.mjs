import {memberReaders,admissionEnvironment,assertAdmissionEnvironment,planDigest,sanitizeAccountDiagnostics} from './prod-commission-policy.mjs';
export async function runProdCommission({config,rows,manifest,mode,sourceCommit,I,pid,status,verifyControllers,invoke,optional,query,management,saveReport=()=>{}}){
let failureContext={target:null,method:null},lastReport={},complete=false,inventoryVerified=false;
const sendReport=report=>{lastReport=report;saveReport(report);};
const rawInvoke=invoke,rawQuery=query,rawManagement=management,rawStatus=status,rawOptional=optional;
invoke=async(target,method,...args)=>{failureContext={target,method};return rawInvoke(target,method,...args);};
query=async(target,method,...args)=>{failureContext={target,method};return rawQuery(target,method,...args);};
optional=async(target,method,...args)=>{failureContext={target,method};return rawOptional(target,method,...args);};
status=async target=>{failureContext={target,method:'canister_status'};return rawStatus(target);};
management=async(method,type,args)=>{failureContext={target:args.canister_id.toText(),method};return rawManagement(method,type,args);};
const B=I.Vec(I.Nat8),P=I.Principal,T=I.Text,N=I.Nat64,V=I.Vec,R=I.Record,E=V(R({name:T,value:T}));
try{
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
const reviewedPlanHash=planDigest({sourceCommit:sourceCommit,registryRevision:page.revision,
  modules:modules.map(([principal,module])=>[principal.toText(),Buffer.from(module).toString('hex')]),targets:plannedTargets});
const report=()=>({status:complete?'commissioned':receipt?'receipt-only':'uncommissioned',mode,sourceCommit:sourceCommit,reviewedPlanHash,
  registryRevision:String(page.revision),groups:page.groups.map(group=>({id:group.id,accepting:group.accepting})),
  liveModulesVerified:31,controllersVerified:31,plannedReaders:readers.length,commissionedReaders:complete?readers.length:0,authenticatedInventoryVerified:inventoryVerified,accounts:beforeDiagnostics,
  removalRelease:false,recoveryRelease:false,routingApproval:false,groupOpening:false});
const Directory=R({binding:Binding,generation:N,inventory_digest:B,sources:V(I.Tuple(T,P)),enabled:I.Bool,app_enabled:I.Bool});
const verifyCommissionedReadback=async()=>{
  receipt=await invoke(id,'read_opencloud_prod_admission_commissioning',[],[],Receipt);
  const directoryConfig=await invoke(id,'read_membership_directory_configuration',[],[],Directory);
  if(!directoryConfig.enabled||directoryConfig.app_enabled||directoryConfig.generation!==1n||directoryConfig.sources.length!==2||
      !equal(Binding,directoryConfig.binding,binding)||directoryConfig.inventory_digest.length!==32||
      directoryConfig.sources.some(([name,principal])=>!['base','g2'].includes(name)||!same(principal,config.groups[name==='base'?0:1]?.canisterIds.club_domain))||
      new Set(directoryConfig.sources.map(([name])=>name)).size!==2)throw Error('Membership discovery readback mismatch');
  const opening=await invoke(id,'read_group_opening_configuration',[],[],V(I.Tuple(T,T)));
  const openingRows=new Map(opening);
  if(openingRows.get('account_admission_released')!=='true'||openingRows.get('ordinary_member_access')!=='true'||
      openingRows.get('global_account_operations_deferred')!=='true')throw Error('Ordinary admission readback mismatch');
  await reviewInventory();
  for(const row of rows.filter(r=>r.service!=='frontend')){
    const live=await status(row.id);verifyControllers(live);
    const artifact=manifest.canisters.find(r=>r.id===row.id);
    if(live.module_hash.length!==1||Buffer.from(live.module_hash[0]).toString('hex')!==artifact.moduleSha256)throw Error('Final live module mismatch '+row.id);
    if(readers.some(r=>r.id===row.id))assertAdmissionEnvironment(live.settings.environment_variables,id);
  }
  const afterDiagnostics=sanitizeAccountDiagnostics(await invoke(id,'read_opencloud_prod_name_diagnostics',[V(T)],[directory.items.map(row=>row.account_id)],V(Diagnostic)));
  if(JSON.stringify(afterDiagnostics)!==JSON.stringify(beforeDiagnostics))throw Error('Account/profile/PII diagnostics changed during commissioning');
  complete=true;
};
const Configuration=R({receiver:P,authority:I.Opt(P),protocol:I.Nat32,admission_required:I.Bool,removal_enabled:I.Bool,rehearsal:I.Bool});
const Lifecycle=R({canister:P,module_hash:B,changes:N});
const Draft=R({inventory:Inventory,eligibility_readers:V(P),account_readers:V(P),targets:V(P),lifecycle:V(Lifecycle),configurations:V(Configuration),release_authorized:I.Bool,recovery_accepted:I.Bool});
const equal=(type,a,b)=>Buffer.from(I.encode([type],[a])).equals(Buffer.from(I.encode([type],[b])));
const reviewInventory=async()=>{
  const currentHistory=await invoke(id,'read_production_account_history_revision',[],[],N);
  expected={...expected,inventory:{...expected.inventory,groups:{...expected.inventory.groups,history_revision:currentHistory}}};
  const review=await invoke(id,'review_production_account_inventory',[Expectation,N],[expected,currentHistory],Draft);
  const targets=[...new Set([...page.groups.flatMap(g=>g.domains.map(d=>d.canister.toText())),...supplemental.map(r=>r.canister.toText())])];
  const exact=(actual,wanted)=>JSON.stringify(actual.map(p=>p.toText()).sort())===JSON.stringify([...wanted].sort());
  if(targets.length!==28||!exact(review.targets,targets)||!exact(review.account_readers,readers.map(r=>r.id))||
      !exact(review.eligibility_readers,readers.map(r=>r.id))||review.configurations.length!==28||review.lifecycle.length||review.release_authorized||review.recovery_accepted||
      !equal(Inventory,review.inventory,expected.inventory))throw Error('Identity-authenticated inventory readback mismatch');
  if(new Set(review.configurations.map(c=>c.receiver.toText())).size!==28)throw Error('Duplicate receiver readback');
  for(const c of review.configurations){
    const receiver=c.receiver.toText();
    if(!targets.includes(receiver)||c.authority.length!==1||!same(c.authority[0],id)||c.protocol!==1||c.rehearsal||c.removal_enabled||
       c.admission_required!==readers.some(r=>r.id===receiver))throw Error('Receiver admission mode readback mismatch '+receiver);
  }
  inventoryVerified=true;
  return review;
};
const infrastructure=[router,...config.groups.map(g=>g.canisterIds.timer_jobs),config.shared.secret_workload_identity];
const authorities=new Map();
for(const target of infrastructure){
  const value=await query(target,'read_account_removal_authority',I.Opt(P));
  if(value.length>1||(value.length===1&&!same(value[0],id)))throw Error('Foreign immutable infrastructure authority '+target);
  authorities.set(target,value.length===1);
}
const routerConfig=new Map(await invoke(router,'read_group_opening_configuration',[],[],V(I.Tuple(T,T))));
const deletion=routerConfig.get('deletion_authority');
if(deletion===undefined||(deletion!==''&&deletion!==id))throw Error('Foreign or missing deletion authority readback');
const settingsReady=plannedTargets.every(target=>{
  try{assertAdmissionEnvironment(target.environment,id);return true;}catch{return false;}
});
if(mode==='check'){
  if(!settingsReady||[...authorities.values()].some(v=>!v)||deletion!==id){
    sendReport({...report(),status:'blocked-needs-configuration',authenticatedInventoryVerified:false});
    throw Error('Admission check blocked: settings or immutable authority configuration incomplete; no writes performed');
  }
  await reviewInventory();
  if(receipt)await verifyCommissionedReadback();
  sendReport({...report(),status:receipt?'commissioned':'ready-uncommissioned',authenticatedInventoryVerified:true});
  return report();
}

// Skip matching settings. Every uncertain write stops; a new invocation reads
// authoritative state independently before deciding whether anything remains.
for(const target of plannedTargets){
  const live=await status(target.id);verifyControllers(live);
  const next=admissionEnvironment(live.settings.environment_variables,id);
  const canonical=values=>JSON.stringify([...values].sort((a,b)=>a.name.localeCompare(b.name)));
  if(canonical(next)!==canonical(live.settings.environment_variables)){
    await management('update_settings',R({canister_id:P,settings:R({environment_variables:I.Opt(E)})}),
      {canister_id:pid(target.id),settings:{environment_variables:[next]}});
  }
  const after=await status(target.id);verifyControllers(after);assertAdmissionEnvironment(after.settings.environment_variables,id);
  if(Buffer.from(after.module_hash[0]??[]).toString('hex')!==Buffer.from(live.module_hash[0]).toString('hex'))throw Error('Module changed during reader configuration '+target.id);
}
if(deletion!==id){
  await invoke(router,'set_deletion_authority',[P],[pid(id)]);
  const after=new Map(await invoke(router,'read_group_opening_configuration',[],[],V(I.Tuple(T,T))));
  if(after.get('deletion_authority')!==id)throw Error('Deletion authority readback mismatch');
}
for(const target of infrastructure){
  if(!authorities.get(target))await invoke(target,'set_account_removal_authority',[P],[pid(id)]);
  const value=await query(target,'read_account_removal_authority',I.Opt(P));
  if(value.length!==1||!same(value[0],id))throw Error('Infrastructure authority readback mismatch '+target);
}
await reviewInventory();
if(!receipt)receipt=await invoke(id,'commission_opencloud_prod_admission',[Expectation],[expected],Receipt);
const opening=new Map(await invoke(id,'read_group_opening_configuration',[],[],V(I.Tuple(T,T))));
if(opening.get('ordinary_member_access')!=='true')await invoke(id,'authorize_production_member_access',[Binding],[receipt.expectation.inventory.groups.binding]);
let directoryConfig;
try{directoryConfig=await invoke(id,'read_membership_directory_configuration',[],[],Directory);}catch(error){
  if(!String(error.message).includes('Membership directory unconfigured'))throw error;
}
if(!directoryConfig)await invoke(id,'configure_membership_directory',[Binding,V(P),N],
  [receipt.expectation.inventory.groups.binding,config.groups.map(g=>pid(g.canisterIds.club_domain)),1n],I.Reserved);
await verifyCommissionedReadback();
sendReport({...report(),authenticatedInventoryVerified:true});
return report();

}catch(error){sendReport({...lastReport,status:lastReport.status==='blocked-needs-configuration'?lastReport.status:'failed',mode,sourceCommit,failedTarget:failureContext.target,failedMethod:failureContext.method,errorCode:'COMMISSIONING_STOPPED',removalRelease:false,recoveryRelease:false,routingApproval:false,groupOpening:false});throw error;}
}
