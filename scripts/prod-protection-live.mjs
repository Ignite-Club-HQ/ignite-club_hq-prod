// Closed commissioning only. Private keys exist solely inside protected CI jobs.
// Settings/reloads, account signatures, recovery acceptance and delivery are
// separated by role. Every external mutation has a retained acknowledged intent.
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash,createPrivateKey,sign,verify,createPublicKey} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {identityFromPem} from './prod-connection-check.mjs';
import {assertCheckContext,evidenceText} from './prod-connection-check-policy.mjs';
import {githubJournal} from './prod-base-group.mjs';
import {RECEIPTS_BRANCH,RECEIPT_PATH,canonical} from './prod-base-group-policy.mjs';
import {G2_REGISTRATION_RECEIPT_PATH} from './prod-g2-register-policy.mjs';
import {groupContract} from './prod-group-contract.mjs';
import {protectionContract} from './prod-protection-contract.mjs';
import {SAFEGUARD_RECEIPT,assertWitnessState,identityPinEnv} from './prod-safeguard-live-policy.mjs';
import {openAccountSeed,accountPublicKey} from './prod-account-key-policy.mjs';
import {reconcileDecision,activationTargets,assertProtectionContext,protectionEnvironment,verifyActivatedDraft,assertNoPending,PROTECTION_RECEIPT,APPROVAL_LIFETIME_NS,digest,requireProtectionExecutionReady} from './prod-protection-policy.mjs';
import {attestDeployKey,verifyDeployKey} from '../frontend/scripts/media-key-deploy-rules.mjs';
import {configuredMainnetPhotoKey} from '../frontend/scripts/media-key-mainnet.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hex=b=>Buffer.from(b).toString('hex');
const hash=b=>createHash('sha256').update(b).digest('hex');
const plain=v=>JSON.parse(evidenceText(v));
let stage='startup';
const ok=r=>{if(!r||'Err'in r)throw Error('Canister refused the commissioning step');return r.Ok;};
function managementContract(IDL){const Env=IDL.Vec(IDL.Record({name:IDL.Text,value:IDL.Text}));return()=>IDL.Service({
  canister_status:IDL.Func([IDL.Record({canister_id:IDL.Principal})],[IDL.Record({module_hash:IDL.Opt(IDL.Vec(IDL.Nat8)),
    settings:IDL.Record({controllers:IDL.Vec(IDL.Principal),environment_variables:Env})})],[]),
  update_settings:IDL.Func([IDL.Record({canister_id:IDL.Principal,settings:IDL.Record({environment_variables:IDL.Opt(Env)})})],[],[]),
  clear_chunk_store:IDL.Func([IDL.Record({canister_id:IDL.Principal})],[],[]),
  upload_chunk:IDL.Func([IDL.Record({canister_id:IDL.Principal,chunk:IDL.Vec(IDL.Nat8)})],[IDL.Record({hash:IDL.Vec(IDL.Nat8)})],[]),
  install_chunked_code:IDL.Func([IDL.Record({mode:IDL.Variant({upgrade:IDL.Opt(IDL.Record({skip_pre_upgrade:IDL.Opt(IDL.Bool),
    wasm_memory_persistence:IDL.Opt(IDL.Variant({keep:IDL.Null,replace:IDL.Null}))}))}),target_canister:IDL.Principal,store_canister:IDL.Opt(IDL.Principal),
    chunk_hashes_list:IDL.Vec(IDL.Record({hash:IDL.Vec(IDL.Nat8)})),wasm_module_hash:IDL.Vec(IDL.Nat8),arg:IDL.Vec(IDL.Nat8),sender_canister_version:IDL.Opt(IDL.Nat64)})],[],[]),
});}

async function main(){
  requireProtectionExecutionReady();
  const env=process.env;assertProtectionContext(env);mkdirSync(env.CHECK_REPORT_DIR,{recursive:true});
  const job=env.PROTECTION_JOB;
  if(!['prepare','account-inventory','recovery-inventory','deliver-inventory','account-protection','recovery-protection','deliver-protection'].includes(job))throw Error('Unknown commissioning job');
  const require=createRequire(path.join(env.CHECK_DEPS_DIR,'package.json'));
  const {HttpAgent,Actor,CanisterStatus}=require('@icp-sdk/core/agent');
  const {IDL}=require('@icp-sdk/core/candid');const {Principal}=require('@icp-sdk/core/principal');
  const {Ed25519KeyIdentity}=require('@icp-sdk/core/identity');const {Secp256k1KeyIdentity}=require('@icp-sdk/core/identity/secp256k1');
  const ids=JSON.parse(readFileSync(path.join(ROOT,'deploy/prod/.icp/data/mappings/ic.ids.json'),'utf8'));
  stage='read safeguard and original inventories';
  const load=spec=>githubJournal(env,fetch,spec).load({readOnly:true});
  const safeguard=await load(SAFEGUARD_RECEIPT);
  if(safeguard?.phase!=='identity-pinned'||safeguard.pending||safeguard.identity!==ids.identity_access)throw Error('Completed identity pin receipt required');
  const base=await load({branch:RECEIPTS_BRANCH,path:RECEIPT_PATH});
  const g2=await load({branch:RECEIPTS_BRANCH,path:G2_REGISTRATION_RECEIPT_PATH});
  const journal=githubJournal(env,fetch,PROTECTION_RECEIPT);let receipt=await journal.load({readOnly:true});
  let identity,key;
  if(job.startsWith('account-')||job.startsWith('recovery-')){
    const role=job.split('-')[0];
    if(env.KEY_ENVIRONMENT!==`production-${role}-approval`)throw Error('Dedicated owner signing environment required');
    const seed=openAccountSeed((env.EXISTING_ENC??'').trim(),env.PASSPHRASE);
    if(accountPublicKey(seed)!==safeguard.pins[`${role}PublicKey`]||env.EXISTING_PUBLIC_KEY!==safeguard.pins[`${role}PublicKey`])throw Error('Signing public pin mismatch');
    identity=Ed25519KeyIdentity.fromSecretKey(Uint8Array.from(Buffer.from(seed,'hex')));
    if(identity.getPrincipal().toText()!==safeguard.pins[`${role}Principal`]||env.EXISTING_PRINCIPAL!==safeguard.pins[`${role}Principal`])throw Error('Signing principal mismatch');
    key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(seed,'hex')]),format:'der',type:'pkcs8'});
  }else{identity=identityFromPem(readFileSync(env.CHECK_KEY_PEM,'utf8'),{Ed25519KeyIdentity,Secp256k1KeyIdentity});assertCheckContext(ids,env,identity.getPrincipal().toText());}
  const agent=await HttpAgent.create({host:'https://icp-api.io',identity});
  const pid=t=>Principal.fromText(t);
  const actor=(factory,id)=>Actor.createActor(factory,{agent,canisterId:id});
  const contract=protectionContract(IDL);const router=actor(groupContract(IDL).reader,ids.shard_router);
  const readPage=async()=>plain(ok(await router.read_group_registry_page('mainnet',[],[],64)));
  // Registry reads are caller-authenticated. Signing jobs use the exact saved
  // governor review; recovery acceptance itself repeats live participant checks.
  const governorJob=job==='prepare'||job.startsWith('deliver-');
  const page=governorJob?await readPage():receipt?.page;
  const targets=activationTargets(ids,page,base,g2);
  const certified=async id=>{const s=await CanisterStatus.request({agent,canisterId:pid(id),paths:['controllers','module_hash','subnet']});const m=s.get('module_hash');
    return {controllers:(s.get('controllers')??[]).map(p=>p.toText()).sort(),moduleHash:typeof m==='string'?m.replace(/^0x/,''):m?hex(m):null,subnet:s.get('subnet')?.subnetId};};
  assertWitnessState(await certified(safeguard.witness),safeguard,{installed:true});
  const identityState=await certified(ids.identity_access);
  if(identityState.controllers.length!==1||identityState.controllers[0]!==safeguard.governor||identityState.subnet!==safeguard.subnet)throw Error('Exclusive identity controller and subnet required');
  const save=async r=>{receipt=r;await journal.save(r);writeFileSync(path.join(env.CHECK_REPORT_DIR,'activation-receipt.json'),evidenceText(r));};
  // Intent records the exact observable before/after state; completion and its
  // phase/progress fields commit in ONE acknowledged write. A retained intent is
  // resolved only by a read-only probe matching before or after exactly.
  const probes=new Map();
  const checkpoint=async(kind,{probe,before,after,retryable=false,commit=()=>({})},call)=>{probes.set(kind,probe);
    await save({...receipt,pending:{kind,before,after,retryable,at:new Date().toISOString()}});const value=await call();
    const seen=await probe();if(JSON.stringify(seen)!==JSON.stringify(after))throw Error('Acknowledged step readback mismatch');
    await save({...receipt,...commit(value),pending:null});return value;};
  const resolvePending=async()=>{const p=receipt?.pending;if(!p)return;const probe=probes.get(p.kind)??probeFor(p.kind);
    if(!probe)throw Error('Unresolved activation intent has no read-only probe; manual review required');
    const d=reconcileDecision(p,await probe());if(d==='unknown')throw Error('Unresolved activation intent: live state matches neither before nor after');
    await save({...receipt,...(d==='committed'?(p.commit??{}):{}),pending:null});report(`Retained intent ${p.kind} reconciled read-only as ${d}.`);};
  const report=text=>{console.log(text);if(env.GITHUB_STEP_SUMMARY)appendFileSync(env.GITHUB_STEP_SUMMARY,text+'\n');};
  const decode=(type,encoded)=>IDL.decode([type],Uint8Array.from(Buffer.from(encoded,'base64')))[0];
  const encode=(type,value)=>Buffer.from(IDL.encode([type],[value])).toString('base64');
  const mgmt=id=>Actor.createActor(managementContract(IDL),{agent,canisterId:'aaaaa-aa',effectiveCanisterId:pid(id)});
  const status=async id=>mgmt(id).canister_status({canister_id:pid(id)});
  const assertClosed=async()=>{const live=await readPage();activationTargets(ids,live,base,g2);if(canonical(live.groups.map(g=>({id:g.id,domains:g.domains,accepting:g.accepting})))!==canonical(page.groups.map(g=>({id:g.id,domains:g.domains,accepting:g.accepting})))||live.revision!==page.revision)throw Error('Registry changed during commissioning');};
  const id=actor(contract.identity,ids.identity_access);
  // Fresh-run probes for retained intents; each is read-only.
  const probeFor=kind=>{const [k,target]=kind.split(':');
    if(k==='settings')return async()=>canonical((await status(target)).settings.environment_variables);
    if(k==='upgrade')return async()=>{const c=await certified(target);return {moduleHash:c.moduleHash,controllers:c.controllers,subnet:c.subnet};};
    if(k==='authority')return async()=>(await actor(contract.infrastructure,target).read_account_removal_authority()).map(p=>p.toText());
    if(k==='witness')return async()=>ok(await actor(contract.witness,safeguard.witness).read_recovery_head()).accepted.map(a=>canonical(plain(a)));
    return null;};
  stage='reconcile retained intent';await resolvePending();
  async function build(name){execFileSync('icp',['build',name],{cwd:path.join(ROOT,'deploy/prod'),env:{...env,...identityPinEnv(safeguard,ids)},stdio:['ignore','ignore','pipe']});
    return readFileSync(path.join(ROOT,'deploy/prod/.icp/cache/artifacts',name));}
  async function upgrade(target,wasm,keep){
    await assertClosed();const before=await certified(target.id);
    if(before.controllers.length!==1||before.controllers[0]!==safeguard.governor||before.subnet!==target.subnet)throw Error('Exclusive target controller and subnet required');
    const modProbe=async()=>{const c=await certified(target.id);return {moduleHash:c.moduleHash,controllers:c.controllers,subnet:c.subnet};};
    // Same-program reloads keep the hash; re-running an upgrade-only reload is
    // idempotent, and identity's effective-configuration review is the final proof.
    await checkpoint(`upgrade:${target.id}`,{probe:modProbe,before:await modProbe(),after:{moduleHash:hash(wasm),controllers:before.controllers,subnet:before.subnet},retryable:true},async()=>{const m=mgmt(target.id);await m.clear_chunk_store({canister_id:pid(target.id)});const chunks=[];
      for(let i=0;i<wasm.length;i+=1_000_000)chunks.push({hash:(await m.upload_chunk({canister_id:pid(target.id),chunk:wasm.subarray(i,i+1_000_000)})).hash});
      await m.install_chunked_code({mode:{upgrade:[{skip_pre_upgrade:[],wasm_memory_persistence:keep?[{keep:null}]:[]}]},target_canister:pid(target.id),store_canister:[],
        chunk_hashes_list:chunks,wasm_module_hash:Buffer.from(hash(wasm),'hex'),arg:Uint8Array.from(IDL.encode([],[])),sender_canister_version:[]});
      const after=await certified(target.id);if(after.moduleHash!==hash(wasm)||canonical(after.controllers)!==canonical(before.controllers)||after.subnet!==before.subnet)throw Error('Upgrade readback mismatch');});
  }
  async function prepareUnsigned(purpose){
    const revision=ok(await id.read_production_account_history_revision());
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
    const review=ok(await id[purpose==='inventory'?'review_production_account_inventory':'review_production_account_protection'](expectation,revision));
    verifyActivatedDraft(plain(review),targets,ids.identity_access);
    const state=ok(await id.read_production_account_authorization());
    const body={kind:`ignite-production-account-${purpose==='inventory'?'inventory':'protection'}-v1`,identity:pid(ids.identity_access),operator:pid(safeguard.governor),generation:state.generation+1n,
      expires_at_ns:BigInt(Date.now())*1_000_000n+APPROVAL_LIFETIME_NS,expectation,review,
      original_inventory_evidence:Buffer.from(digest({base,g2,inventory:plain(inventory)}),'hex'),runtime_evidence:Buffer.from(digest(plain(review)),'hex'),
      fenced_recovery_evidence:Buffer.from(digest({safeguard,controllers:receipt.controllers,review:plain(review)}),'hex'),recovery_epoch:1n};
    // Fresh witness starts at epoch 1; recovery job checks exact live epoch/head,
    // refusing renewal/recovery rather than manufacturing an acceptance.
    const bytes=ok(await id.production_account_approval_signing_bytes(body));
    await save({...receipt,phase:`${purpose}-reviewed`,purpose,body:encode(contract.Body,body),signingBytes:Buffer.from(bytes).toString('base64'),historyRevision:revision.toString(),
      identityChanges:ok(await id.read_production_account_runtime_version()).toString(),removalGeneration:ok(await id.read_production_account_removal_generation()).toString(),approval:null,acceptance:null});
  }
  if(job==='prepare'){
    if(receipt){if(receipt.phase==='inventory-reviewed'){report('Preparation already verified; no reload repeated.');return;}throw Error('Existing commissioning receipt requires reviewed continuation');}
    if(identityState.moduleHash!==safeguard.identityModuleHash)throw Error('Identity differs from its recorded pinned program');
    const controllers=[];const builds=new Map();const photoKeys={};
    // Build/verify all 24 current programs before the first setting change.
    for(const t of targets){const s=await certified(t.id);if(s.controllers.length!==1||s.controllers[0]!==safeguard.governor||s.subnet!==t.subnet)throw Error('Exclusive receiver controller and subnet required');controllers.push({id:t.id,...s});
      if(t.human){if(!builds.has(t.name))builds.set(t.name,await build(t.name));if(hash(builds.get(t.name))!==s.moduleHash)throw Error('Receiver reload program differs from live program');
        protectionEnvironment((await status(t.id)).settings.environment_variables,ids.identity_access);}}
    for(const t of targets.filter(t=>t.name==='pii_access_control')){
      const binding={deploymentId:'prod',environment:'ic',host:'https://icp-api.io',canisterId:t.id,governor:safeguard.governor,keyName:'key_1'};
      const pii=actor(()=>IDL.Service({pii_vetkey_verification_key:IDL.Func([],[IDL.Vec(IDL.Nat8)],[])}),t.id);
      await attestDeployKey(binding,{status:()=>certified(t.id),originalKey:async()=>hex(await pii.pii_vetkey_verification_key()),configuredKey:()=>configuredMainnetPhotoKey(binding),save:async r=>{photoKeys[t.id]=r;}});
    }
    const identityWasm=await build('identity_access');
    if(!identityWasm.includes(Buffer.from(safeguard.witness))||!identityWasm.includes(Buffer.from(safeguard.pins.accountPublicKey)))throw Error('Identity build lacks immutable pins');
    await save({version:1,phase:'planned',pending:null,sourceCommit:env.GITHUB_SHA,safeguardDigest:digest(safeguard),page,targets,controllers,photoKeys,openingAuthorized:false,erasureAuthorized:false,reloaded:[],configured:[],identityModuleHash:hash(identityWasm)});
    await upgrade({id:ids.identity_access,name:'identity_access',subnet:safeguard.subnet},identityWasm,false);
    for(const t of targets){stage=`configure ${t.group}/${t.name}`;await assertClosed();
      if(t.human){const s=await status(t.id);const merged=protectionEnvironment(s.settings.environment_variables,ids.identity_access);
        const envProbe=async()=>canonical((await status(t.id)).settings.environment_variables);
        await checkpoint(`settings:${t.id}`,{probe:envProbe,before:canonical(s.settings.environment_variables),after:canonical(merged),retryable:true},async()=>{await mgmt(t.id).update_settings({canister_id:pid(t.id),settings:{environment_variables:[merged]}});
          if(canonical((await status(t.id)).settings.environment_variables)!==canonical(merged))throw Error('Protection setting readback mismatch');});
        await upgrade(t,builds.get(t.name),true);
        if(t.name==='pii_access_control'){
          const original=photoKeys[t.id];const binding={deploymentId:'prod',environment:'ic',host:'https://icp-api.io',canisterId:t.id,governor:safeguard.governor,keyName:'key_1'};
          const pii=actor(()=>IDL.Service({pii_vetkey_verification_key:IDL.Func([],[IDL.Vec(IDL.Nat8)],[])}),t.id);
          await verifyDeployKey(binding,original,{status:()=>certified(t.id),originalKey:async()=>hex(await pii.pii_vetkey_verification_key()),configuredKey:()=>configuredMainnetPhotoKey(binding)});
        }
        await save({...receipt,reloaded:[...new Set([...receipt.reloaded,t.id])]});
      }else{const a=actor(contract.infrastructure,t.id);const existing=await a.read_account_removal_authority();
        if(existing.length&&existing[0].toText()!==ids.identity_access)throw Error('Foreign infrastructure authority requires separate review');
        const authProbe=async()=>(await a.read_account_removal_authority()).map(p=>p.toText());
        if(!existing.length)await checkpoint(`authority:${t.id}`,{probe:authProbe,before:[],after:[ids.identity_access],retryable:true},async()=>{ok(await a.set_account_removal_authority(pid(ids.identity_access)));const r=await a.read_account_removal_authority();if(r.length!==1||r[0].toText()!==ids.identity_access)throw Error('Infrastructure authority readback mismatch');});}
      await save({...receipt,configured:[...new Set([...receipt.configured,t.id])]});}
    await assertClosed();await prepareUnsigned('inventory');report('All 28 effective modes verified by identity; first inventory approval awaits the account and recovery approvals. Groups closed.');return;
  }
  if(!receipt||receipt.sourceCommit!==env.GITHUB_SHA||receipt.safeguardDigest!==digest(safeguard)||identityState.moduleHash!==receipt.identityModuleHash)throw Error('Exact retained activation plan required');
  const purpose=job.endsWith('inventory')?'inventory':'protection';
  if(job.startsWith('account-')){
    if(receipt.phase!==`${purpose}-reviewed`)throw Error('Fresh effective review required before signing');
    const body=decode(contract.Body,receipt.body);if(body.expires_at_ns<=BigInt(Date.now())*1_000_000n)throw Error('Commissioning approval expired');
    verifyActivatedDraft(plain(body.review),targets,ids.identity_access);
    const bytes=Buffer.from(receipt.signingBytes,'base64');
    const canonicalBytes=Buffer.concat([Buffer.from('ignite:production-account-authorization:v1\0'),createHash('sha256').update(Buffer.from(IDL.encode([contract.Body],[body]))).digest()]);
    if(!bytes.equals(canonicalBytes))throw Error('Canonical approval bytes mismatch');
    const signature=sign(null,bytes,key);if(!verify(null,bytes,createPublicKey(key),signature))throw Error('Approval signature verification failed');
    await save({...receipt,phase:`${purpose}-signed`,approval:encode(contract.Approval,{body,signature})});report(`Exact ${purpose} approval signed; no private key exported.`);return;
  }
  if(job.startsWith('recovery-')){
    if(receipt.phase!==`${purpose}-signed`)throw Error('Exact account signature required before recovery acceptance');
    const approval=decode(contract.Approval,receipt.approval);const w=actor(contract.witness,safeguard.witness);
    const head=ok(await w.read_recovery_head());if(head.epoch!==approval.body.recovery_epoch||head.revision!==0n||head.digest.length!==32)throw Error('Fresh empty witness history required; recovery must be reviewed separately');
    const records=ok(await w.read_recovery_records(0n,200));if(records.length)throw Error('Existing witness history requires separate reconciliation');
    const acceptance={witness:pid(safeguard.witness),witness_version:ok(await w.read_recovery_runtime_version()),identity:pid(ids.identity_access),identity_version:BigInt(receipt.identityChanges),
      epoch:head.epoch,journal_revision:head.revision,journal_digest:head.digest,inventory_digest:approval.body.original_inventory_evidence,decoded_history_digest:Buffer.from(digest(plain(records)),'hex'),
      generation:approval.body.generation,signed_digest:createHash('sha256').update(Buffer.concat([Buffer.from(receipt.signingBytes,'base64'),Buffer.from(approval.signature)])).digest(),expires_at_ns:approval.body.expires_at_ns,
      history_revision:BigInt(receipt.historyRevision),removal_generation:BigInt(receipt.removalGeneration),participants:approval.body.review.lifecycle.map(l=>({canister:l.canister,module:l.module_hash,changes:l.changes}))};
    const signature=sign(null,Buffer.from(ok(await w.recovery_acceptance_signing_bytes(acceptance))),key);
    const signed=canonical(plain({body:acceptance,signature}));
    const accProbe=async()=>ok(await w.read_recovery_head()).accepted.map(a=>canonical(plain(a)));
    await checkpoint(`witness:${purpose}`,{probe:accProbe,before:[],after:[signed],retryable:true},async()=>{ok(await w.accept_recovery_fence({body:acceptance,signature}));const read=ok(await w.read_recovery_head());
      if(read.accepted.length!==1||canonical(plain(read.accepted[0]))!==canonical(plain({body:acceptance,signature})))throw Error('Independent witness acceptance readback mismatch');});
    // No read-only probe distinguishes this step's outcome: an interrupted
    // attempt stays unknown and stops for manual review rather than replaying.
    if(purpose==='protection')await checkpoint('subject progress policy',{probe:async()=>({unobservable:true}),before:null,after:{unobservable:true}},async()=>{const sig=sign(null,Buffer.from(ok(await w.subject_progress_approval_signing_bytes(acceptance))),key);ok(await w.authorize_subject_removal_progress({body:acceptance,signature:sig}));});
    await save({...receipt,phase:`${purpose}-witness-accepted`,acceptance:encode(contract.SignedAcceptance,{body:acceptance,signature})});report(`Independent ${purpose} acceptance stored and read back; groups not opened.`);return;
  }
  if(receipt.phase!==`${purpose}-witness-accepted`)throw Error('Independent witness acceptance required before delivery');
  await assertClosed();const approval=decode(contract.Approval,receipt.approval);
  stage=`deliver signed ${purpose} approval`;
  const delProbe=async()=>{const st=ok(await id.read_production_account_authorization());return st.approval.length===1&&canonical(plain(st.approval[0]))===canonical(plain(approval))?'delivered':`generation:${st.generation}`;};
  const result=await checkpoint(`deliver:${purpose}`,{probe:delProbe,before:await delProbe(),after:'delivered',retryable:true},async()=>ok(await id[purpose==='inventory'?'provision_production_account_inventory':'authorize_production_account_readers'](approval)));
  if(purpose==='inventory'){await save({...receipt,inventoryApproval:receipt.approval,inventoryAcceptance:receipt.acceptance,phase:'inventory-delivered',provisionedRevision:result.toString()});
    await prepareUnsigned('protection');report('Signed original inventory committed and read back; fresh full-protection approval awaits owner signing.');return;}
  const state=ok(await id.read_production_account_authorization());if(state.generation!==result||state.approval.length!==1||canonical(plain(state.approval[0]))!==canonical(plain(approval)))throw Error('Signed protection readback mismatch');
  stage='fresh effective readback of every service and witness';
  const effective=ok(await id.read_active_production_account_protection());verifyActivatedDraft(plain(effective),targets,ids.identity_access);await assertClosed();
  const rows=targets.map(t=>({...t,configuration:plain(effective.configurations.find(c=>c.receiver.toText()===t.id)),result:'EFFECTIVE_CONFIGURATION_AND_LIVE_WITNESS_VERIFIED'}));
  await save({...receipt,phase:'verified',generation:result.toString(),expiresAtNs:approval.body.expires_at_ns.toString(),rows,verifiedAt:new Date().toISOString(),openingAuthorized:false,erasureAuthorized:false,
    userAccountFlowVerified:false});
  report(['### Closed protection commissioning verified','', '| Group | Service | Result |','|---|---|---|',...rows.map(r=>`| ${r.group} | ${r.name} | Effective configuration and live signed witness verified |`),'',
    `All 28 modes verified; exactly 24 alias readers. Approval expires ${new Date(Number(approval.body.expires_at_ns/1_000_000n)).toISOString()}.`,
    'Both groups remain closed. No account, club, data movement, erasure, routing or delivery schedule was changed. Real member flows are not tested by this infrastructure readback.'].join('\n'));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{const text=`Protection commissioning stopped safely at: ${stage}. Inspect the retained receipt; do not replay an unresolved intent. No opening authorized.`;
  console.error(text);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,text+'\n');process.exitCode=1;});