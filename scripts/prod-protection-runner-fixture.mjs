// Offline adapters only. Synthetic certificates use an ephemeral test root;
// no production credentials, network, or release authority are available here.
import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {PROD_CHECK_IDS,evidenceText} from './prod-connection-check-policy.mjs';
import {sealAccountSeed,accountPublicKey} from './prod-account-key-policy.mjs';
import {protectionContract} from './prod-protection-contract.mjs';
import {activationTargets,PROTECTION_CONFIRMATION,PROTECTION_RECEIPT,digest} from './prod-protection-policy.mjs';
import {SAFEGUARD_RECEIPT} from './prod-safeguard-live-policy.mjs';
import {RECEIPTS_BRANCH,RECEIPT_PATH} from './prod-base-group-policy.mjs';
import {G2_REGISTRATION_RECEIPT_PATH} from './prod-g2-register-policy.mjs';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const core={...require('@icp-sdk/core/agent'),...require('@icp-sdk/core/candid'),...require('@icp-sdk/core/principal')};
const identities={...require('@icp-sdk/core/identity'),...require('@icp-sdk/core/identity/secp256k1')};
const {bls12_381:bls}=require('@noble/curves/bls12-381');
const {IDL,Principal,Cbor,requestIdOf,lebEncode,reconstruct,domain_sep}=core;
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=v=>JSON.parse(evidenceText(v));
export const JOBS=['prepare','account-inventory','recovery-inventory','deliver-inventory','account-protection','recovery-protection','deliver-protection'];
export function commissioningFixture({alreadyInstalled=true}={}){
  const governor=generateKeyPairSync('ed25519');
  const pem=governor.privateKey.export({format:'pem',type:'pkcs8'}).toString();
  const govSeed=governor.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32);
  const gov=identities.Ed25519KeyIdentity.fromSecretKey(govSeed).getPrincipal().toText();
  const accountSeed=createHash('sha256').update('ephemeral-account-'+pem).digest('hex');
  const recoverySeed=createHash('sha256').update('ephemeral-recovery-'+pem).digest('hex');
  const principal=seed=>identities.Ed25519KeyIdentity.fromSecretKey(Buffer.from(seed,'hex')).getPrincipal().toText();
  const passphrase='fixture-only-random-passphrase-'+hash(govSeed);
  const encrypted={account:sealAccountSeed(accountSeed,passphrase),recovery:sealAccountSeed(recoverySeed,passphrase)};
  const pins={accountPublicKey:accountPublicKey(accountSeed),accountPrincipal:principal(accountSeed),recoveryPublicKey:accountPublicKey(recoverySeed),recoveryPrincipal:principal(recoverySeed)};
  const p=n=>Principal.fromUint8Array(Uint8Array.of(200,n,1)).toText();
  const subnet=p(250),witness=p(249),ids={...PROD_CHECK_IDS};
  const domains=['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'];
  let n=1;const groups=['base','g2'].map(id=>({id,target_alias:'mainnet',accepting:false,domains:domains.map(domain=>({domain,canister:id==='base'||domain==='secret_workload_identity'?ids[domain]:p(n++)})),photo_store:[id==='base'?ids.media_blob_store:p(n++)]}));
  const placements=groups.map(g=>({group_id:g.id,deployment_id:'prod',deployment_revision:'1',host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:g.domains.map(d=>({...d,subnet}))}));
  const page={revision:'2',groups,placements,next_cursor:[]};
  const base={phase:'registered-closed',pending:null,plan:{group:groups[0],placement:placements[0]}},g2={phase:'registered-closed',pending:null,plan:{group:groups[1],placement:placements[1]}};
  const targets=activationTargets(ids,page,base,g2);
  const wasm=name=>Buffer.from('offline-reviewed-artifact:'+name);
  const safeguard={phase:'identity-pinned',pending:null,identity:ids.identity_access,governor:gov,subnet,witness,witnessModuleHash:hash(wasm('witness')),identityModuleHash:hash(wasm('identity-original')),pins,sourceCommit:'a'.repeat(40)};
  const store=new Map([[SAFEGUARD_RECEIPT.path,json(safeguard)],[RECEIPT_PATH,json(base)],[G2_REGISTRATION_RECEIPT_PATH,json(g2)]]);
  const history={revision:0n,principal_denials:0n,erased_accounts:0n,pending_intents:0n,club_authorities:[],service_readers:[],removal_generation:0n,removal_barriers:0n,removal_subjects:0n,removal_receipts:0n,removal_completions:0n};
  const state={generation:0n,approval:[]};let inventory=[];
  const head={epoch:1n,revision:0n,digest:new Uint8Array(32),accepted:[]};
  let subjectArmed=false,finalFailures=0;const versions=new Map();const modules=new Map();const settings=new Map();const authorities=new Map();
  const counters={authorization:0,inventory:0,finalReadback:0,identityUpgrade:0,settings:0};
  const sentinel='fixture-private-setting-must-not-be-persisted';
  for(const t of targets){modules.set(t.id,hash(wasm(t.name)));versions.set(t.id,1n);settings.set(t.id,[{name:'PRIVATE_TEST_SETTING',value:sentinel}]);authorities.set(t.id,[]);}
  modules.set(ids.identity_access,hash(wasm(alreadyInstalled?'identity_access':'identity-original')));versions.set(ids.identity_access,1n);
  modules.set(witness,safeguard.witnessModuleHash);versions.set(witness,1n);
  const contract=protectionContract(IDL),identityTypes=new Map(contract.identity()._fields),witnessTypes=new Map(contract.witness()._fields);
  const lifecycle=()=>[...targets.map(t=>({canister:Principal.fromText(t.id),module_hash:Buffer.from(modules.get(t.id),'hex'),changes:versions.get(t.id)})),{canister:Principal.fromText(ids.identity_access),module_hash:Buffer.from(modules.get(ids.identity_access),'hex'),changes:versions.get(ids.identity_access)}];
  const draft=expectation=>({inventory:expectation.inventory,targets:targets.map(t=>Principal.fromText(t.id)),account_readers:targets.filter(t=>t.human).map(t=>Principal.fromText(t.id)),eligibility_readers:targets.filter(t=>t.human).map(t=>Principal.fromText(t.id)),lifecycle:lifecycle(),configurations:targets.map(t=>({receiver:Principal.fromText(t.id),authority:[Principal.fromText(ids.identity_access)],protocol:1,admission_required:t.human,removal_enabled:true,rehearsal:false})),release_authorized:false,recovery_accepted:false});
  const call=async(canister,method,args)=>{
    if(method==='read_group_registry_page')return {Ok:page};
    if(method==='read_media_quota_store_registry'){const g=groups.find(g=>g.domains.some(d=>d.domain==='club_domain'&&d.canister===canister));return {Ok:{active:true,stores:g.photo_store.map(p=>Principal.fromText(p))}};}
    if(method==='pii_vetkey_verification_key')return new Uint8Array(96).fill(7);
    if(method==='read_production_receiver_lifecycle')return {Ok:{canister:args[0],module_hash:Buffer.from(modules.get(args[0].toText()),'hex'),changes:versions.get(args[0].toText())}};
    if(method==='read_production_account_history_revision')return {Ok:history.revision};
    if(method==='read_production_account_runtime_version')return {Ok:versions.get(ids.identity_access)};
    if(method==='read_production_account_removal_generation')return {Ok:0n};
    if(method==='read_production_account_authorization')return {Ok:state};
    if(method==='read_production_commissioning_evidence')return {Ok:{history,inventory_approval:inventory}};
    if(method==='review_production_account_inventory'||method==='review_production_account_protection')return {Ok:draft(args[0])};
    if(method==='read_recovery_head')return {Ok:head};
    if(method==='read_recovery_records')return {Ok:[]};
    if(method==='read_recovery_runtime_version')return {Ok:1n};
    if(method==='accept_recovery_fence'){head.accepted=[args[0]];subjectArmed=false;return {Ok:head.epoch};}
    if(method==='authorize_subject_removal_progress'){subjectArmed=true;return {Ok:null};}
    if(method==='provision_production_account_inventory'){counters.inventory++;inventory=[args[0]];history.revision++;return {Ok:history.revision};}
    if(method==='authorize_production_account_readers'){counters.authorization++;state.generation=args[0].body.generation;state.approval=[args[0]];return {Ok:state.generation};}
    if(method==='read_active_production_account_protection'){counters.finalReadback++;if(finalFailures>0){finalFailures--;throw Error('offline interrupted final readback');}if(!subjectArmed)return {Err:'Current global and subject protection baseline required'};return {Ok:draft(state.approval[0].body.expectation)};}
    if(method==='read_account_removal_authority')return authorities.get(canister);
    if(method==='set_account_removal_authority'){authorities.set(canister,[args[0]]);return {Ok:null};}
    if(method==='canister_status')return {settings:{controllers:[Principal.fromText(gov)],environment_variables:settings.get(args[0].canister_id.toText())}};
    if(method==='update_settings'){counters.settings++;settings.set(args[0].canister_id.toText(),args[0].settings.environment_variables[0]);return;}
    if(method==='clear_chunk_store')return;
    if(method==='upload_chunk')return {hash:Buffer.from(hash(args[0].chunk),'hex')};
    if(method==='install_chunked_code'){const target=args[0].target_canister.toText();modules.set(target,Buffer.from(args[0].wasm_module_hash).toString('hex'));versions.set(target,versions.get(target)+1n);if(target===ids.identity_access)counters.identityUpgrade++;return;}
    throw Error('Unhandled offline method '+method);
  };
  const blsKey=new Uint8Array(32);blsKey[31]=9;
  const root=Buffer.concat([Buffer.from('308182301d060d2b0601040182dc7c0503010201060c2b0601040182dc7c05030201036100','hex'),Buffer.from(bls.getPublicKeyForShortSignatures(blsKey))]);
  const acknowledgements=new Map();
  const certificate=async(requestId,reply)=>{
    const leaf=b=>[3,b],label=(s,t)=>[2,typeof s==='string'?Buffer.from(s):s,t];
    const tree=[1,label('time',leaf(lebEncode(BigInt(Date.now())*1_000_000n))),label('request_status',label(requestId,[1,label('status',leaf(Buffer.from('replied'))),label('reply',leaf(reply))]))];
    return Cbor.encode({tree,signature:bls.signShortSignature(Buffer.concat([domain_sep('ic-state-root'),await reconstruct(tree)]),blsKey)});
  };
  const reports=[],written=[];let crashAfterPhase=null,crashPendingCommit=null;
  const sdk={...core,HttpAgent:{createSync:()=>({rootKey:root}),create:async({identity})=>({rootKey:root,identity,
    update:async(canister,{methodName,arg,nonce})=>{
      const request={body:{request_type:'call',canister_id:canister,sender:identity.getPrincipal(),method_name:methodName,arg,nonce,ingress_expiry:BigInt(Date.now()+300000)*1_000_000n},request:{}};
      const transformed=await identity.transformRequest(request);const content=transformed.body.content;
      const type=(canister.toText()===ids.identity_access?identityTypes:witnessTypes).get(methodName);
      const args=IDL.decode(type.argTypes,arg),value=await call(canister.toText(),methodName,args),reply=IDL.encode(type.retTypes,[value]);
      const rid=requestIdOf(content),cert=await certificate(rid,reply);acknowledgements.set(Buffer.from(rid).toString('hex'),cert);return {reply,rawCertificate:cert};
    },readState:async(_,{paths})=>({certificate:acknowledgements.get(Buffer.from(paths[0][1]).toString('hex'))})})},
    CanisterStatus:{request:async({canisterId})=>new Map([['controllers',[Principal.fromText(canisterId.toText()===witness?pins.recoveryPrincipal:gov)]],['module_hash',modules.get(canisterId.toText())],['subnet',{subnetId:subnet}]])},
    Actor:{createActor:(_,{canisterId,effectiveCanisterId})=>new Proxy({}, {get:(_,method)=>async(...args)=>call(effectiveCanisterId?.toText()??canisterId,method,args)})},
  };
  const journalFor=spec=>({load:async()=>store.has(spec.path)?json(store.get(spec.path)):null,save:async r=>{
    if(crashPendingCommit&&store.get(spec.path)?.pending?.kind===crashPendingCommit&&!r.pending){crashPendingCommit=null;throw Error('offline completion acknowledgement lost');}
    store.set(spec.path,json(r));
    if(crashAfterPhase===r.phase&&!r.pending){crashAfterPhase=null;throw Error('offline process lost after committed phase');}
  }});
  const baseEnv={GITHUB_REPOSITORY:'Ignite-Club-HQ/ignite-club_hq-prod',GITHUB_REF:'refs/heads/prod',IGNITE_ICP_ENV:'prod',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'offline-1',CONFIRMATION:PROTECTION_CONFIRMATION,PROD_GOVERNOR_PRINCIPAL:gov,DEV_DEPLOYER_PRINCIPAL:p(245)};
  return {targets,page,counters,sentinel,store,written,reports,settings,modules,safeguard,
    receipt:()=>store.get(PROTECTION_RECEIPT.path),
    failFinalOnce:()=>{finalFailures=1;},disarmSubjects:()=>{subjectArmed=false;},
    crashAfter:phase=>{crashAfterPhase=phase;},crashCommit:kind=>{crashPendingCommit=kind;},
    runtime:job=>{const role=job.split('-')[0];const env={...baseEnv,PROTECTION_JOB:job,REVIEWED_PLAN_HASH:store.has('prod-group-setup/protection-plan.json')?digest(store.get('prod-group-setup/protection-plan.json')):''};
      if(role==='account'||role==='recovery')Object.assign(env,{KEY_ENVIRONMENT:`production-${role}-approval`,PASSPHRASE:passphrase,EXISTING_ENC:encrypted[role],EXISTING_PUBLIC_KEY:pins[`${role}PublicKey`],EXISTING_PRINCIPAL:pins[`${role}Principal`]});
      return {env,sdk,ids,identities,journalFor,readPem:()=>pem,build:async name=>wasm(name),photoKey:async()=>Buffer.alloc(96,7).toString('hex'),writeReceipt:r=>written.push(evidenceText(r)),report:t=>reports.push(t)};
    },
  };
}