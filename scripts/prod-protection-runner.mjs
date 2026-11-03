// Closed commissioning only. Private keys exist solely inside protected CI jobs.
// Settings/reloads, account signatures, recovery acceptance and delivery are
// separated by role. Every external mutation has a retained acknowledged intent.
import {createHash,createPrivateKey,sign,verify,createPublicKey} from 'node:crypto';
import {identityFromPem} from './prod-connection-check.mjs';
import {assertCheckContext,evidenceText} from './prod-connection-check-policy.mjs';
import {RECEIPTS_BRANCH,RECEIPT_PATH,canonical} from './prod-base-group-policy.mjs';
import {G2_REGISTRATION_RECEIPT_PATH} from './prod-g2-register-policy.mjs';
import {groupContract} from './prod-group-contract.mjs';
import {protectionContract} from './prod-protection-contract.mjs';
import {SAFEGUARD_RECEIPT,assertWitnessState,identityPinEnv} from './prod-safeguard-live-policy.mjs';
import {openAccountSeed,accountPublicKey} from './prod-account-key-policy.mjs';
import {settingsCommitment,activationTargets,assertProtectionContext,protectionEnvironment,verifyActivatedDraft,assertNoPending,PROTECTION_RECEIPT,APPROVAL_LIFETIME_NS,digest} from './prod-protection-policy.mjs';
import {attestDeployKey,verifyDeployKey} from '../frontend/scripts/media-key-deploy-rules.mjs';
import {createProtectionJournal} from './prod-protection-journal.mjs';
import {captureUpdate,verifyUpdate,readUpdateAcknowledgement} from './prod-protection-evidence.mjs';
import {approvalBytes,recoveryBytes,verifySignature,validateReview,assertArtifactPlan,assertReviewedReceivers,jobTransition,identityPreparationDecision,protectionReviewContext} from './prod-protection-review.mjs';

const hex=b=>Buffer.from(b).toString('hex');
const hash=b=>createHash('sha256').update(b).digest('hex');
const plain=v=>JSON.parse(evidenceText(v));
const ok=r=>{if(!r||'Err'in r)throw Error('Canister refused the commissioning step');return r.Ok;};
function managementContract(IDL){const Env=IDL.Vec(IDL.Record({name:IDL.Text,value:IDL.Text}));return()=>IDL.Service({
  canister_status:IDL.Func([IDL.Record({canister_id:IDL.Principal})],[IDL.Record({module_hash:IDL.Opt(IDL.Vec(IDL.Nat8)),
    canister_version:IDL.Nat64,settings:IDL.Record({controllers:IDL.Vec(IDL.Principal),environment_variables:Env})})],[]),
  update_settings:IDL.Func([IDL.Record({canister_id:IDL.Principal,settings:IDL.Record({environment_variables:IDL.Opt(Env)})})],[],[]),
  clear_chunk_store:IDL.Func([IDL.Record({canister_id:IDL.Principal})],[],[]),
  upload_chunk:IDL.Func([IDL.Record({canister_id:IDL.Principal,chunk:IDL.Vec(IDL.Nat8)})],[IDL.Record({hash:IDL.Vec(IDL.Nat8)})],[]),
  install_chunked_code:IDL.Func([IDL.Record({mode:IDL.Variant({upgrade:IDL.Opt(IDL.Record({skip_pre_upgrade:IDL.Opt(IDL.Bool),
    wasm_memory_persistence:IDL.Opt(IDL.Variant({keep:IDL.Null,replace:IDL.Null}))}))}),target_canister:IDL.Principal,store_canister:IDL.Opt(IDL.Principal),
    chunk_hashes_list:IDL.Vec(IDL.Record({hash:IDL.Vec(IDL.Nat8)})),wasm_module_hash:IDL.Vec(IDL.Nat8),arg:IDL.Vec(IDL.Nat8),sender_canister_version:IDL.Opt(IDL.Nat64)})],[],[]),
});}

export async function runProtectionCommissioning(runtime){
  if(!runtime?.sdk||!runtime?.journalFor||!runtime?.build||!runtime?.writeReceipt||!runtime?.readPem)
    throw Error('Explicit commissioning runtime required; no default live transport');
  const {env,sdk,ids}=runtime;assertProtectionContext(env);
  let stage='startup';
  const job=env.PROTECTION_JOB;
  if(!['plan','prepare','account-inventory','recovery-inventory','deliver-inventory','account-protection','recovery-protection','deliver-protection'].includes(job))throw Error('Unknown commissioning job');
  const {HttpAgent,Actor,CanisterStatus,IDL,Principal}=sdk;
  const {Ed25519KeyIdentity,Secp256k1KeyIdentity}=runtime.identities;
  stage='read safeguard and original inventories';
  const load=spec=>runtime.journalFor(spec).load({readOnly:true});
  const safeguard=await load(SAFEGUARD_RECEIPT);
  if(safeguard?.phase!=='identity-pinned'||safeguard.pending||safeguard.identity!==ids.identity_access)throw Error('Completed identity pin receipt required');
  const base=await load({branch:RECEIPTS_BRANCH,path:RECEIPT_PATH});
  const g2=await load({branch:RECEIPTS_BRANCH,path:G2_REGISTRATION_RECEIPT_PATH});
  const journal=runtime.journalFor(PROTECTION_RECEIPT);let receipt=await journal.load({readOnly:true});
  let identity,key;
  if(job.startsWith('account-')||job.startsWith('recovery-')){
    const role=job.split('-')[0];
    if(env.KEY_ENVIRONMENT!==`production-${role}-approval`)throw Error('Dedicated owner signing environment required');
    const seed=openAccountSeed((env.EXISTING_ENC??'').trim(),env.PASSPHRASE);
    if(accountPublicKey(seed)!==safeguard.pins[`${role}PublicKey`]||env.EXISTING_PUBLIC_KEY!==safeguard.pins[`${role}PublicKey`])throw Error('Signing public pin mismatch');
    identity=Ed25519KeyIdentity.fromSecretKey(Uint8Array.from(Buffer.from(seed,'hex')));
    if(identity.getPrincipal().toText()!==safeguard.pins[`${role}Principal`]||env.EXISTING_PRINCIPAL!==safeguard.pins[`${role}Principal`])throw Error('Signing principal mismatch');
    key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(seed,'hex')]),format:'der',type:'pkcs8'});
  }else{identity=identityFromPem(runtime.readPem(),{Ed25519KeyIdentity,Secp256k1KeyIdentity});assertCheckContext(ids,env,identity.getPrincipal().toText());}
  const agent=await HttpAgent.create({host:'https://icp-api.io',identity});
  const pid=t=>Principal.fromText(t);
  const actor=(factory,id)=>Actor.createActor(factory,{agent,canisterId:id});
  const contract=protectionContract(IDL);const router=actor(groupContract(IDL).reader,ids.shard_router);
  const readPage=async()=>plain(ok(await router.read_group_registry_page('mainnet',[],[],64)));
  // Registry reads are caller-authenticated. Signing jobs use the exact saved
  // governor review; recovery acceptance itself repeats live participant checks.
  const governorJob=job==='plan'||job==='prepare'||job.startsWith('deliver-');
  const page=governorJob?await readPage():receipt?.page;
  const targets=activationTargets(ids,page,base,g2);
  const certified=async id=>{const s=await CanisterStatus.request({agent,canisterId:pid(id),paths:['controllers','module_hash','subnet']});const m=s.get('module_hash');
    return {controllers:(s.get('controllers')??[]).map(p=>p.toText()).sort(),moduleHash:typeof m==='string'?m.replace(/^0x/,''):m?hex(m):null,subnet:s.get('subnet')?.subnetId};};
  assertWitnessState(await certified(safeguard.witness),safeguard,{installed:true});
  const identityState=await certified(ids.identity_access);
  if(identityState.controllers.length!==1||identityState.controllers[0]!==safeguard.governor||identityState.subnet!==safeguard.subnet)throw Error('Exclusive identity controller and subnet required');
  const save=async r=>{await journal.save(r);receipt=r;runtime.writeReceipt(r);};
  const report=runtime.report;
  const decode=(type,encoded)=>IDL.decode([type],Uint8Array.from(Buffer.from(encoded,'base64')))[0];
  const encode=(type,value)=>Buffer.from(IDL.encode([type],[value])).toString('base64');
  const mgmt=id=>Actor.createActor(managementContract(IDL),{agent,canisterId:'aaaaa-aa',effectiveCanisterId:pid(id)});
  const status=async id=>mgmt(id).canister_status({canister_id:pid(id)});
  const assertClosed=async()=>{const live=await readPage();activationTargets(ids,live,base,g2);if(canonical(live.groups.map(g=>({id:g.id,domains:g.domains,accepting:g.accepting})))!==canonical(page.groups.map(g=>({id:g.id,domains:g.domains,accepting:g.accepting})))||live.revision!==page.revision)throw Error('Registry changed during commissioning');};
  const id=actor(contract.identity,ids.identity_access);
  const types=factory=>new Map(factory()._fields);
  const identityTypes=types(contract.identity),witnessTypes=types(contract.witness);
  const certifiedCall=async(canister,method,args=[],context=receipt)=>captureUpdate({identity,sdk,canister,method,
    type:(canister===ids.identity_access?identityTypes:witnessTypes).get(method),args,runId:context.runId,purpose:context.purpose});
  const readInventoryState=async()=>{const c=ok(await id.read_production_commissioning_evidence());
    return {revision:c.history.revision.toString(),approval:c.inventory_approval.length?encode(contract.Approval,c.inventory_approval[0]):null};};
  const probePending=async p=>{
    const [kind,target]=p.kind.split(':');
    if(kind==='settings')return settingsCommitment((await status(target)).settings.environment_variables);
    if(kind==='upgrade'){
      const c=await certified(target),l=ok(await id.read_production_receiver_lifecycle(pid(target)));
      return {moduleHash:c.moduleHash,controllers:c.controllers,subnet:c.subnet,changes:l.changes.toString()};
    }
    if(kind==='identity-upgrade'){
      const c=await certified(target);
      return {moduleHash:c.moduleHash,controllers:c.controllers,subnet:c.subnet};
    }
    if(kind==='authority')return (await actor(contract.infrastructure,target).read_account_removal_authority()).map(p=>p.toText());
    if(kind==='inventory')return readInventoryState();
    if(kind==='authorization'){const s=ok(await id.read_production_account_authorization());return {generation:s.generation.toString(),approval:s.approval.length?encode(contract.Approval,s.approval[0]):null};}
    if(kind==='witness')return ok(await actor(contract.witness,safeguard.witness).read_recovery_head()).accepted.map(a=>encode(contract.SignedAcceptance,a));
    if(kind==='subject'){
      const ack=await readUpdateAcknowledgement({agent,sdk,request:p.metadata.request,type:witnessTypes.get('authorize_subject_removal_progress')});
      return ack?{replied:true}:null;
    }
    throw Error('Retained intent lacks a bounded read-only probe');
  };
  const durable=createProtectionJournal({load:async()=>receipt,save,probe:probePending});
  if(governorJob&&receipt?.pending)await durable.reconcile();else assertNoPending(receipt);
  const transition=jobTransition(job,receipt);
  if(transition==='reject')throw Error('Commissioning job and retained stage differ');
  if(transition==='done'){
    // Inventory delivery must continue into the fresh protection review after
    // reconciling its committed inventory write, not silently skip that review.
    if(!(job==='deliver-inventory'&&receipt.phase==='inventory-delivered')){
      report('This stage already completed; retained signatures and progress preserved.');return;
    }
  }
  const checkpoint=async(kind,{before,after,commit={},retryable=false,metadata={}},call)=>durable.checkpoint({kind,before,after,commit,retryable,metadata},call);
  const build=name=>runtime.build(name,safeguard,ids);
  async function upgrade(target,wasm,keep){
    await assertClosed();const before=await certified(target.id);
    if(before.controllers.length!==1||before.controllers[0]!==safeguard.governor||before.subnet!==target.subnet)throw Error('Exclusive target controller and subnet required');
    const identityUpgrade=target.id===ids.identity_access;
    const beforeState={moduleHash:before.moduleHash,controllers:before.controllers,subnet:before.subnet};
    if(!identityUpgrade){const prior=ok(await id.read_production_receiver_lifecycle(pid(target.id)));beforeState.changes=prior.changes.toString();}
    const afterState={...beforeState,moduleHash:hash(wasm)};
    if(!identityUpgrade)afterState.changes=(BigInt(beforeState.changes)+1n).toString();
    const progress=target.id===ids.identity_access?{identityUpgraded:true}:{reloaded:[...new Set([...receipt.reloaded,target.id])]};
    await checkpoint(`${identityUpgrade?'identity-upgrade':'upgrade'}:${target.id}`,{before:beforeState,after:afterState,commit:progress},async()=>{
      const m=mgmt(target.id);await m.clear_chunk_store({canister_id:pid(target.id)});const chunks=[];
      for(let i=0;i<wasm.length;i+=1_000_000)chunks.push({hash:(await m.upload_chunk({canister_id:pid(target.id),chunk:wasm.subarray(i,i+1_000_000)})).hash});
      await m.install_chunked_code({mode:{upgrade:[{skip_pre_upgrade:[],wasm_memory_persistence:keep?[{keep:null}]:[]}]},target_canister:pid(target.id),store_canister:[],
        chunk_hashes_list:chunks,wasm_module_hash:Buffer.from(hash(wasm),'hex'),arg:Uint8Array.from(IDL.encode([],[])),sender_canister_version:[]});
    });
  }
  async function prepareUnsigned(purpose,context={purpose,runId:receipt.runId}){
    const proofs={};
    const collect=async(method,args=[])=>{const r=await certifiedCall(ids.identity_access,method,args,context);proofs[method]=r.proof;return ok(r.value);};
    const revision=await collect('read_production_account_history_revision');
    const latest=await readPage();const supplemental=latest.groups.flatMap(g=>g.photo_store.map(canister=>({group_id:g.id,domain:'media_blob_store',canister:pid(canister),subnet:pid(latest.placements.find(p=>p.group_id===g.id).primary_subnet)})));
    supplemental.push({group_id:'base',domain:'shard_router',canister:pid(ids.shard_router),subnet:pid(safeguard.subnet)});
    const media=[];for(const g of latest.groups){const club=g.domains.find(d=>d.domain==='club_domain').canister;
      const m=actor(()=>IDL.Service({read_media_quota_store_registry:IDL.Func([],[IDL.Variant({Ok:IDL.Record({active:IDL.Bool,stores:IDL.Vec(IDL.Principal)}),Err:IDL.Text})],[])}),club);
      media.push({club_authority:pid(club),registry:ok(await m.read_media_quota_store_registry())});}
    const inventory={groups:{binding:{registry:pid(ids.shard_router),registry_revision:BigInt(latest.revision),target_alias:'mainnet',deployment_id:'prod',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'},history_revision:revision,
      snapshot:{revision:BigInt(latest.revision),groups:latest.groups.map(g=>({id:g.id,target_alias:g.target_alias,domains:g.domains.map(d=>({...d,canister:pid(d.canister)}))})),
        placements:latest.placements.map(p=>({...p,deployment_revision:BigInt(p.deployment_revision),primary_subnet:pid(p.primary_subnet),approved_subnets:p.approved_subnets.map(pid),domains:p.domains.map(d=>({...d,canister:pid(d.canister),subnet:pid(d.subnet)}))}))}},supplemental,media};
    const modules=[];for(const t of [...targets,{id:ids.identity_access,name:'identity_access',subnet:safeguard.subnet}]){const s=await certified(t.id);
      if(s.controllers.length!==1||s.controllers[0]!==safeguard.governor||s.subnet!==t.subnet||!s.moduleHash)throw Error('Live program binding mismatch');modules.push([pid(t.id),Buffer.from(s.moduleHash,'hex')]);}
    const expectation={identity:pid(ids.identity_access),inventory,modules};
    const reviewMethod=purpose==='inventory'?'review_production_account_inventory':'review_production_account_protection';
    const review=await collect(reviewMethod,[expectation,revision]);
    verifyActivatedDraft(plain(review),targets,ids.identity_access);
    const state=await collect('read_production_account_authorization');
    const commissioning=await collect('read_production_commissioning_evidence');
    // Real gathered fence evidence, never synthesized: certified sole-controller,
    // program and subnet for every target, identity and witness; an empty decoded
    // identity removal history and an empty witness record ledger. Any non-empty
    // history requires a separately reviewed recovery and stops here.
    const witnessCollect=async(method,args=[])=>{const r=await certifiedCall(safeguard.witness,method,args,context);proofs[method]=r.proof;return ok(r.value);};
    const records=await witnessCollect('read_recovery_records',[0n,200]);const head=await witnessCollect('read_recovery_head');
    const fencedState=[];for(const t of [...targets.map(t=>t.id),ids.identity_access]){const c=await certified(t);
      if(c.controllers.length!==1||c.controllers[0]!==safeguard.governor)throw Error('External controller fence not exclusive');fencedState.push({id:t,...c});}
    const ws=await certified(safeguard.witness);assertWitnessState(ws,safeguard,{installed:true});
    const fence={kind:'ignite-prod-fence-evidence-v1',governor:safeguard.governor,fencedState,witness:{id:safeguard.witness,...ws},
      planHash:receipt.planHash,identityHistoryRevision:revision.toString(),identityHistory:plain(commissioning.history),witnessRecords:records.length,witnessEpoch:head.epoch.toString(),review:digest(plain(review))};
    const body={kind:`ignite-production-account-${purpose==='inventory'?'inventory':'protection'}-v1`,identity:pid(ids.identity_access),operator:pid(safeguard.governor),generation:state.generation+1n,
      expires_at_ns:BigInt(Date.now())*1_000_000n+APPROVAL_LIFETIME_NS,expectation,review,
      original_inventory_evidence:Buffer.from(digest({base,g2,inventory:plain(inventory)}),'hex'),runtime_evidence:Buffer.from(digest(plain(review)),'hex'),
      fenced_recovery_evidence:Buffer.from(digest(fence),'hex'),recovery_epoch:head.epoch};
    validateReview({body,review,commissioning,head,records,state,fence,base,g2,targets,identity:ids.identity_access,governor:safeguard.governor,purpose,plain});
    const identityChanges=await collect('read_production_account_runtime_version');
    const removalGeneration=await collect('read_production_account_removal_generation');
    const witnessChanges=await witnessCollect('read_recovery_runtime_version');
    await save({...receipt,...context,phase:`${purpose}-reviewed`,purpose,fenceEvidence:fence,proofs,
      body:encode(contract.Body,body),signingBytes:approvalBytes(IDL,contract.Body,body).toString('base64'),historyRevision:revision.toString(),
      identityChanges:identityChanges.toString(),removalGeneration:removalGeneration.toString(),witnessChanges:witnessChanges.toString(),
      approval:null,acceptance:null,subjectApproval:null});
  }
  if(job==='plan'||job==='prepare'){
    const planSpec={...PROTECTION_RECEIPT,path:'prod-group-setup/protection-plan.json'};
    const pins=identityPinEnv(safeguard,ids);
    const builds=new Map(),controllers=[],photoKeys={};
    for(const t of targets){const st=await certified(t.id);
      if(st.controllers.length!==1||st.controllers[0]!==safeguard.governor||st.subnet!==t.subnet)throw Error('Exclusive receiver controller and subnet required');
      controllers.push({id:t.id,...st});
      if(t.human){if(!builds.has(t.name))builds.set(t.name,await build(t.name));if(hash(builds.get(t.name))!==st.moduleHash)throw Error('Receiver reload program differs from live program');}}
    const identityWasm=await build('identity_access');
    const plan={version:1,sourceCommit:env.GITHUB_SHA,identityModuleHash:hash(identityWasm),previousIdentityModuleHash:safeguard.identityModuleHash,pins,
      receivers:controllers,openingAuthorized:false,safeguardDigest:digest(safeguard)};
    const planJournal=runtime.journalFor(planSpec);
    if(job==='plan'){
      if(receipt)throw Error('Activation already started; use retained reviewed continuation');
      await assertClosed();await planJournal.save(plan);
      report(`Read-only artifact plan prepared: ${digest(plan)}. Review before starting preparation; no live setting or program changed.`);return;
    }
    const approvedPlan=await planJournal.load({readOnly:true});
    assertArtifactPlan(approvedPlan,{sourceCommit:env.GITHUB_SHA,identityHash:hash(identityWasm),pins,receivers:controllers});
    if(env.REVIEWED_PLAN_HASH!==digest(approvedPlan)||approvedPlan.safeguardDigest!==digest(safeguard))throw Error('Exact owner-reviewed artifact plan hash required');
    if(receipt&&(receipt.sourceCommit!==env.GITHUB_SHA||receipt.safeguardDigest!==digest(safeguard)||receipt.planHash!==digest(approvedPlan)))throw Error('Retained activation plan changed');
    if(receipt?.phase==='inventory-reviewed'){report('Preparation already verified; no reload repeated.');return;}
    for(const t of targets.filter(t=>t.name==='pii_access_control')){
      const binding={deploymentId:'prod',environment:'ic',host:'https://icp-api.io',canisterId:t.id,governor:safeguard.governor,keyName:'key_1'};
      const pii=actor(()=>IDL.Service({pii_vetkey_verification_key:IDL.Func([],[IDL.Vec(IDL.Nat8)],[])}),t.id);
      if(receipt?.photoKeys?.[t.id])photoKeys[t.id]=receipt.photoKeys[t.id];
      else await attestDeployKey(binding,{status:()=>certified(t.id),originalKey:async()=>hex(await pii.pii_vetkey_verification_key()),configuredKey:()=>runtime.photoKey(binding),save:async r=>{photoKeys[t.id]=r;}});
    }
    if(!receipt){identityPreparationDecision(identityState.moduleHash,hash(identityWasm),safeguard.identityModuleHash);
      await save({version:2,phase:'planned',pending:null,sourceCommit:env.GITHUB_SHA,planHash:digest(approvedPlan),runId:env.GITHUB_RUN_ID,purpose:'inventory',
        safeguardDigest:digest(safeguard),page,targets,controllers,photoKeys,openingAuthorized:false,erasureAuthorized:false,reloaded:[],configured:[],identityModuleHash:hash(identityWasm),identityUpgraded:false});}
    if(!receipt.identityUpgraded){
      const live=await certified(ids.identity_access);
      if(live.controllers.length!==1||live.controllers[0]!==safeguard.governor||live.subnet!==safeguard.subnet)throw Error('Exclusive identity controller and subnet required');
      if(identityPreparationDecision(live.moduleHash,hash(identityWasm),safeguard.identityModuleHash)==='already-installed')
        await save({...receipt,identityUpgraded:true,identityUpgradeSkipped:true});
      else await upgrade({id:ids.identity_access,name:'identity_access',subnet:safeguard.subnet},identityWasm,false);
    }
    for(const t of targets){
      if(receipt.configured.includes(t.id))continue;
      stage=`configure ${t.group}/${t.name}`;await assertClosed();
      if(t.human){const st=await status(t.id),merged=protectionEnvironment(st.settings.environment_variables,ids.identity_access);
        if(canonical(st.settings.environment_variables)!==canonical(merged))await checkpoint(`settings:${t.id}`,{before:settingsCommitment(st.settings.environment_variables),after:settingsCommitment(merged),retryable:true},async()=>mgmt(t.id).update_settings({canister_id:pid(t.id),settings:{environment_variables:[merged]}}));
        if(!receipt.reloaded.includes(t.id))await upgrade(t,builds.get(t.name),true);
        if(t.name==='pii_access_control'){
          const binding={deploymentId:'prod',environment:'ic',host:'https://icp-api.io',canisterId:t.id,governor:safeguard.governor,keyName:'key_1'};
          const pii=actor(()=>IDL.Service({pii_vetkey_verification_key:IDL.Func([],[IDL.Vec(IDL.Nat8)],[])}),t.id);
          await verifyDeployKey(binding,photoKeys[t.id],{status:()=>certified(t.id),originalKey:async()=>hex(await pii.pii_vetkey_verification_key()),configuredKey:()=>runtime.photoKey(binding)});
        }
      }else{const a=actor(contract.infrastructure,t.id),existing=await a.read_account_removal_authority();
        if(existing.length&&existing[0].toText()!==ids.identity_access)throw Error('Foreign infrastructure authority requires separate review');
        if(!existing.length)await checkpoint(`authority:${t.id}`,{before:[],after:[ids.identity_access],retryable:true,commit:{configured:[...new Set([...receipt.configured,t.id])]}},async()=>ok(await a.set_account_removal_authority(pid(ids.identity_access))));}
      await save({...receipt,configured:[...new Set([...receipt.configured,t.id])]});
    }
    await assertClosed();await prepareUnsigned('inventory');report('All 28 effective modes reviewed; separate account and recovery signatures await owner approvals. Both groups remain closed.');return;
  }
  if(!receipt||receipt.sourceCommit!==env.GITHUB_SHA||receipt.safeguardDigest!==digest(safeguard)||identityState.moduleHash!==receipt.identityModuleHash)throw Error('Exact retained activation plan required');
  const approvedPlan=await load({...PROTECTION_RECEIPT,path:'prod-group-setup/protection-plan.json'});
  if(!approvedPlan||digest(approvedPlan)!==env.REVIEWED_PLAN_HASH||receipt.planHash!==digest(approvedPlan)||
     approvedPlan.sourceCommit!==env.GITHUB_SHA||approvedPlan.safeguardDigest!==digest(safeguard)||
     canonical(approvedPlan.pins)!==canonical(identityPinEnv(safeguard,ids))||approvedPlan.identityModuleHash!==identityState.moduleHash||
     approvedPlan.previousIdentityModuleHash!==safeguard.identityModuleHash)throw Error('Independent signer artifact plan mismatch');
  if(job==='deliver-inventory'&&receipt.phase==='inventory-delivered'){
    await assertClosed();
    await prepareUnsigned('protection',protectionReviewContext(receipt,env.GITHUB_RUN_ID));
    report('Signed inventory preserved; complete fresh protection review committed.');return;
  }
  const purpose=job.endsWith('inventory')?'inventory':'protection';
  const body=decode(contract.Body,receipt.body);
  async function verifyEvidence(){
    const checked=async(canister,method,args=[])=>verifyUpdate(receipt.proofs[method],{sdk,canister,method,
      type:(canister===ids.identity_access?identityTypes:witnessTypes).get(method),args,runId:receipt.runId,purpose,governor:safeguard.governor});
    const reviewMethod=purpose==='inventory'?'review_production_account_inventory':'review_production_account_protection';
    const review=await checked(ids.identity_access,reviewMethod,[body.expectation,body.expectation.inventory.groups.history_revision]);
    const commissioning=await checked(ids.identity_access,'read_production_commissioning_evidence');
    const state=await checked(ids.identity_access,'read_production_account_authorization');
    const records=await checked(safeguard.witness,'read_recovery_records',[0n,200]);
    const head=await checked(safeguard.witness,'read_recovery_head');
    const identityChanges=await checked(ids.identity_access,'read_production_account_runtime_version');
    const removalGeneration=await checked(ids.identity_access,'read_production_account_removal_generation');
    const witnessChanges=await checked(safeguard.witness,'read_recovery_runtime_version');
    if(identityChanges.toString()!==receipt.identityChanges||removalGeneration.toString()!==receipt.removalGeneration||witnessChanges.toString()!==receipt.witnessChanges)throw Error('Certified lifecycle/history counters mismatch');
    // Independent signer gathers certified controllers/modules/subnets again.
    const fencedState=[];for(const t of [...targets.map(t=>t.id),ids.identity_access])fencedState.push({id:t,...await certified(t)});
    assertReviewedReceivers(approvedPlan,targets,fencedState);
    const ws=await certified(safeguard.witness);assertWitnessState(ws,safeguard,{installed:true});
    const fence={kind:'ignite-prod-fence-evidence-v1',governor:safeguard.governor,fencedState,witness:{id:safeguard.witness,...ws},
      planHash:receipt.planHash,identityHistoryRevision:commissioning.history.revision.toString(),identityHistory:plain(commissioning.history),witnessRecords:records.length,witnessEpoch:head.epoch.toString(),review:digest(plain(review))};
    if(canonical(fence)!==canonical(receipt.fenceEvidence))throw Error('Independent decoded fence evidence differs from retained review');
    validateReview({body,review,commissioning,head,records,state,fence,base,g2,targets,identity:ids.identity_access,governor:safeguard.governor,purpose,plain});
    if(purpose==='protection'){
      const inventory=commissioning.inventory_approval[0];
      verifySignature(approvalBytes(IDL,contract.Body,inventory.body),inventory.signature,safeguard.pins.accountPublicKey);
      if(encode(contract.Approval,inventory)!==receipt.inventoryApproval)throw Error('Certified original inventory receipt mismatch');
    }
    return {head,records,identityChanges,removalGeneration,witnessChanges};
  }
  if(job.startsWith('account-')){
    if(receipt.phase!==`${purpose}-reviewed`)throw Error('Fresh effective review required before signing');
    await verifyEvidence();const bytes=approvalBytes(IDL,contract.Body,body);
    const signature=sign(null,bytes,key);verifySignature(bytes,signature,safeguard.pins.accountPublicKey);
    await save({...receipt,phase:`${purpose}-signed`,approval:encode(contract.Approval,{body,signature})});report(`Exact independently verified ${purpose} review signed. No live writes.`);return;
  }
  const approval=decode(contract.Approval,receipt.approval);
  verifySignature(approvalBytes(IDL,contract.Body,approval.body),approval.signature,safeguard.pins.accountPublicKey);
  if(encode(contract.Body,approval.body)!==encode(contract.Body,body))throw Error('Account approval differs from independently verified body');
  if(job.startsWith('recovery-')){
    if(receipt.phase!==`${purpose}-signed`)throw Error('Exact account signature required');
    const e=await verifyEvidence();
    const acceptance={witness:pid(safeguard.witness),witness_version:e.witnessChanges,identity:pid(ids.identity_access),identity_version:e.identityChanges,
      epoch:e.head.epoch,journal_revision:e.head.revision,journal_digest:e.head.digest,inventory_digest:approval.body.original_inventory_evidence,
      decoded_history_digest:Buffer.from(digest({identityHistory:receipt.fenceEvidence.identityHistory,witnessRecords:plain(e.records)}),'hex'),
      generation:approval.body.generation,signed_digest:createHash('sha256').update(Buffer.concat([approvalBytes(IDL,contract.Body,approval.body),Buffer.from(approval.signature)])).digest(),
      expires_at_ns:approval.body.expires_at_ns,history_revision:BigInt(receipt.historyRevision),removal_generation:e.removalGeneration,
      participants:approval.body.review.lifecycle.map(l=>({canister:l.canister,module:l.module_hash,changes:l.changes}))};
    const signature=sign(null,recoveryBytes(IDL,contract.Acceptance,acceptance),key);
    const subjectSignature=purpose==='protection'?sign(null,recoveryBytes(IDL,contract.Acceptance,acceptance,true),key):null;
    await save({...receipt,phase:`${purpose}-recovery-signed`,acceptance:encode(contract.SignedAcceptance,{body:acceptance,signature}),
      subjectApproval:subjectSignature?encode(contract.SignedAcceptance,{body:acceptance,signature:subjectSignature}):null});
    report(`Independent ${purpose} acceptance signed offline; governor delivery awaits its own owner approval.`);return;
  }
  const completed=purpose==='inventory'?'inventory-delivered':'protection-delivered';
  const w=actor(contract.witness,safeguard.witness),acceptance=decode(contract.SignedAcceptance,receipt.acceptance);
  verifySignature(recoveryBytes(IDL,contract.Acceptance,acceptance.body),acceptance.signature,safeguard.pins.recoveryPublicKey);
  const accepted=acceptance.body;
  if(accepted.identity.toText()!==ids.identity_access||accepted.witness.toText()!==safeguard.witness||accepted.generation!==body.generation||
     accepted.expires_at_ns!==body.expires_at_ns||accepted.epoch!==body.recovery_epoch||accepted.history_revision!==BigInt(receipt.historyRevision)||
     accepted.removal_generation!==BigInt(receipt.removalGeneration)||accepted.identity_version!==BigInt(receipt.identityChanges)||
     accepted.witness_version!==BigInt(receipt.witnessChanges)||hex(accepted.inventory_digest)!==hex(body.original_inventory_evidence)||
     canonical(plain(accepted.participants))!==canonical(plain(body.review.lifecycle.map(l=>({canister:l.canister,module:l.module_hash,changes:l.changes}))))||
     hex(accepted.signed_digest)!==hash(Buffer.concat([approvalBytes(IDL,contract.Body,body),Buffer.from(approval.signature)])))throw Error('Recovery acceptance differs from independently verified scope');
  if(accepted.journal_revision!==0n||hex(accepted.journal_digest)!=='0'.repeat(64)||
    hex(accepted.decoded_history_digest)!==digest({identityHistory:receipt.fenceEvidence.identityHistory,witnessRecords:[]}))throw Error('Recovery decoded history differs from certified empty commissioning history');
  if(receipt.phase!==completed&&receipt.phase!=='verified'){
    if(![`${purpose}-recovery-signed`,`${purpose}-witness-accepted`,`${purpose}-subject-accepted`].includes(receipt.phase))throw Error('Independent recovery signature required');
    await assertClosed();await verifyEvidence();
    if(receipt.phase===`${purpose}-recovery-signed`){
      const before=(ok(await w.read_recovery_head())).accepted.map(a=>encode(contract.SignedAcceptance,a));
      const after=[receipt.acceptance];
      if(canonical(before)!==canonical(after))await checkpoint(`witness:${purpose}`,{before,after,commit:{phase:`${purpose}-witness-accepted`},retryable:true},async()=>ok(await w.accept_recovery_fence(acceptance)));
      else await save({...receipt,phase:`${purpose}-witness-accepted`});
    }
    if(purpose==='protection'&&receipt.phase==='protection-witness-accepted'){
      const subject=decode(contract.SignedAcceptance,receipt.subjectApproval);
      verifySignature(recoveryBytes(IDL,contract.Acceptance,subject.body,true),subject.signature,safeguard.pins.recoveryPublicKey);
      if(canonical(plain(subject.body))!==canonical(plain(acceptance.body)))throw Error('Subject policy differs from recovery acceptance');
      await checkpoint('subject:protection',{before:null,after:{replied:true},commit:{phase:'protection-subject-accepted'},metadata:{}},async()=>{
        const result=await certifiedCallWithIntent(safeguard.witness,'authorize_subject_removal_progress',[subject]);ok(result.value);
      });
    }
    if(purpose==='inventory'){
      const before=await readInventoryState(),revision=(BigInt(receipt.historyRevision)+1n).toString();
      await checkpoint('inventory:inventory',{before,after:{revision,approval:receipt.approval},commit:{inventoryApproval:receipt.approval,inventoryAcceptance:receipt.acceptance,provisionedRevision:revision,phase:completed},retryable:true},async()=>ok(await id.provision_production_account_inventory(approval)));
    }else{
      const current=ok(await id.read_production_account_authorization());
      const before={generation:current.generation.toString(),approval:current.approval.length?encode(contract.Approval,current.approval[0]):null};
      await checkpoint('authorization:protection',{before,after:{generation:approval.body.generation.toString(),approval:receipt.approval},commit:{phase:completed,generation:approval.body.generation.toString()},retryable:true},async()=>ok(await id.authorize_production_account_readers(approval)));
    }
  }
  if(purpose==='inventory'){
    await prepareUnsigned('protection',protectionReviewContext(receipt,env.GITHUB_RUN_ID));report('Exact signed inventory read back; new history revision used for full protection approval.');return;
  }
  const result=BigInt(receipt.generation);
  if(approval.body.expires_at_ns<=BigInt(Date.now())*1_000_000n)throw Error('Protection approval expired; fresh owner approval required');
  assertReviewedReceivers(approvedPlan,targets,await Promise.all(targets.map(async t=>({id:t.id,...await certified(t.id)}))));
  const current=ok(await id.read_production_account_authorization());
  if(current.generation!==result||current.approval.length!==1||encode(contract.Approval,current.approval[0])!==receipt.approval)throw Error('Current live authorization differs from retained approval');
  async function certifiedCallWithIntent(canister,method,args){return captureUpdate({identity,sdk,canister,method,args,type:witnessTypes.get(method),runId:receipt.runId,purpose,
    onRequest:async request=>save({...receipt,pending:{...receipt.pending,metadata:{request}}})});}
  stage='fresh effective readback of every service and witness';
  const effective=ok(await id.read_active_production_account_protection());verifyActivatedDraft(plain(effective),targets,ids.identity_access);await assertClosed();
  const rows=targets.map(t=>({...t,configuration:plain(effective.configurations.find(c=>c.receiver.toText()===t.id)),result:'EFFECTIVE_CONFIGURATION_GLOBAL_AND_SUBJECT_WITNESS_VERIFIED'}));
  await save({...receipt,phase:'verified',generation:result.toString(),expiresAtNs:approval.body.expires_at_ns.toString(),rows,verifiedAt:new Date().toISOString(),openingAuthorized:false,erasureAuthorized:false,
    subjectBaselineVerified:true,userAccountFlowVerified:false});
  report(['### Closed protection commissioning verified','', '| Group | Service | Result |','|---|---|---|',...rows.map(r=>`| ${r.group} | ${r.name} | Effective configuration, global and subject safeguards verified |`),'',
    `All 28 modes verified; exactly 24 alias readers. Approval expires ${new Date(Number(approval.body.expires_at_ns/1_000_000n)).toISOString()}.`,
    'Both groups remain closed. No account, club, data movement, erasure, routing or delivery schedule was changed. Real member flows are not tested by this infrastructure readback.'].join('\n'));
}
