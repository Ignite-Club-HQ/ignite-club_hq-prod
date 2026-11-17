/**
 * Exact DEV G1/G2 governor-only metadata audit.
 * No ciphertext, plaintext, transport keys or vetKeys. The backend method
 * must be separately installed under an approved DEV upgrade; until then
 * this report is explicitly NOT READY and no fallback decrypt is attempted.
 */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Actor,HttpAgent} from '@icp-sdk/core/agent';
import {Principal} from '@icp-sdk/core/principal';
import {IDL} from '@icp-sdk/core/candid';
import {loadOperatorIdentity} from '../src/live/operatorTransport';
import {idlFactory as clubIdl} from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import type {_SERVICE as ClubService} from '../src/lab/bindings/club_domain/declarations/club_domain.did';
import {idlFactory as identityIdl} from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import type {_SERVICE as IdentityService} from '../src/lab/bindings/identity_access/declarations/identity_access.did';
import {GROUP2_GOVERNOR} from '../../scripts/group2-upgrade-rules.mjs';
import {PII,planDevClubNameCoverage,summarizeDevClubNameCoverage,classifyDevNameCoverageFailure,assessDevG2TestParentNameCopies} from '../../scripts/dev-club-name-coverage-policy.mjs';

const [pemPath,reportDir]=process.argv.slice(2);
if(!pemPath||!reportDir||
   process.env.GITHUB_REPOSITORY?.toLowerCase()!=='ignite-club-hq/ignite-club_hq-prod'||
   process.env.GITHUB_REF!=='refs/heads/main'||
   process.env.DEV_CLUB_NAME_COVERAGE_ACTION!=='check'||
   process.env.DEV_CLUB_NAME_COVERAGE_CONFIRMATION!=='AUDIT DEV CLUB NAME COPIES READ ONLY')
  throw Error('Only protected original DEV main-branch owner-approved read-only coverage audit allowed');

const root=new URL('../../',import.meta.url);
const original=JSON.parse(readFileSync(new URL('deploy/mainnet/.icp/data/mappings/ic.ids.json',root),'utf8'));
const g2=JSON.parse(readFileSync(new URL('deploy/groups/g2/provision.json',root),'utf8'));
const ids={g1Club:'mzzzv-taaaa-aaaal-qxlrq-cai',g2Club:'yfwyv-nyaaa-aaaal-qxpyq-cai',
  identity:'mq2sj-fiaaa-aaaal-qxlqa-cai',g1Pii:PII.g1,g2Pii:PII.g2};
if(original.club_domain!==ids.g1Club || original.pii_access_control!==ids.g1Pii||
   original.identity_access!==ids.identity||g2.canisters.club_domain!==ids.g2Club||
   g2.canisters.pii_access_control!==ids.g2Pii)throw Error('DEV G1/G2 source mapping changed; stop');

const operator=loadOperatorIdentity(pemPath);
if(operator.getPrincipal().toText()!==GROUP2_GOVERNOR)throw Error('Pinned DEV governor required');
const agent=await HttpAgent.create({host:'https://icp-api.io',identity:operator});
const clubs={
 g1:Actor.createActor<ClubService>(clubIdl,{agent,canisterId:ids.g1Club}),
 g2:Actor.createActor<ClubService>(clubIdl,{agent,canisterId:ids.g2Club}),
};
const identity=Actor.createActor<IdentityService>(identityIdl,{agent,canisterId:ids.identity});

const readClubSource=async(actor:ClubService)=>{
  const edges:unknown[]=[];
  let next:unknown=[];let priorRevision:bigint|null=null;
  const visited=new Set<string>();
  for(let n=0;n<1500;n++){
    const page=await actor.read_membership_source_page(next as Parameters<ClubService['read_membership_source_page']>[0]);
    if('Err' in page)throw Error('Protected DEV membership source refused');
    if(!Array.isArray(page.Ok.edges)||page.Ok.edges.length>500||
       (priorRevision!==null&&page.Ok.revision!==priorRevision))
      throw Error('DEV membership source changed or exceeded bounds');
    priorRevision=page.Ok.revision;
    edges.push(...page.Ok.edges);
    if(edges.length>100000)throw Error('DEV membership source edge budget exceeded');
    next=page.Ok.next;
    if(!next.length)return edges;
    const fingerprint=JSON.stringify(next,(_,v)=>typeof v==='bigint'?v.toString():v);
    if(visited.has(fingerprint))throw Error('DEV source cursor did not advance');
    visited.add(fingerprint);
  }
  throw Error('DEV membership source pagination incomplete');
};
const readAccounts=async()=>{
  const rows:unknown[]=[];let after:string[]=[];const seen=new Set<string>();
  for(let n=0;n<1500;n++){
    const page=await identity.list_admin_accounts('',after,100);
    if('Err' in page)throw Error('Protected identity account inventory refused');
    if(!Array.isArray(page.Ok.items)||page.Ok.items.length>100)throw Error('Invalid account inventory page');
    for(const row of page.Ok.items){
      if(seen.has(row.account_id))throw Error('Duplicate account across pages');
      seen.add(row.account_id);
    }
    rows.push(...page.Ok.items);
    if(rows.length>100000)throw Error('DEV account inventory over limit');
    const next=page.Ok.next;
    if(!next.length)return rows;
    if(!next[0]||after.length&&next[0]<=after[0])throw Error('Invalid account inventory cursor');
    after=next;
  }
  throw Error('DEV account inventory incomplete');
};
const getSnapshot=async()=>{
  const g1=await readClubSource(clubs.g1);
  const g2Rows=await readClubSource(clubs.g2);
  const accounts=await readAccounts();
  const fingerprint=createHash('sha256').update(JSON.stringify({g1,g2:g2Rows,accounts},(_,v)=>
    typeof v==='bigint'?v.toString():v && typeof v.toText==='function'?v.toText():v)).digest('hex');
  return {g1,g2:g2Rows,accounts,fingerprint};
};

const first=await getSnapshot();
const plan=planDevClubNameCoverage(first);
const readerIdl=({IDL}: {IDL:typeof import('@icp-sdk/core/candid').IDL})=>IDL.Service({
  read_dev_private_club_name_replica_coverage:IDL.Func(
    [IDL.Vec(IDL.Principal),IDL.Text],
    [IDL.Variant({Ok:IDL.Vec(IDL.Record({subject:IDL.Principal,state:IDL.Text})),Err:IDL.Text})],[]),
});
type Reader={read_dev_private_club_name_replica_coverage:(subjects:Principal[],club:string)=>
  Promise<{Ok:{subject:Principal;state:string}[]}|{Err:string}>};
const readers=new Map(Object.values(PII).map(id=>[id,
  Actor.createActor<Reader>(readerIdl,{agent,canisterId:id})]));
const observed:{source:string;subject:string;club:string;state:string}[]=[];
type ReadFailure={sourceGroup:'g1'|'g2';reason:string;batchSize:number};
let readFailure:ReadFailure|null=null;
const groups=new Map<string,{source:string;club:string;subjects:string[]}>();
for(const t of plan.targets){
  const key=JSON.stringify([t.source,t.club]);
  if(!groups.has(key))groups.set(key,{source:t.source,club:t.club,subjects:[]});
  groups.get(key)!.subjects.push(t.subject);
}
// A failed update-shaped but READ-ONLY call is never replayed automatically.
// Store only a pinned G1/G2 label, bounded batch size and allowlisted error
// class. Do not log the original error, rejected principal, club or ciphertext.
groupLoop:
for(const group of groups.values()){
  const sourceGroup=group.source===PII.g1?'g1':'g2';
  for(let start=0;start<group.subjects.length;start+=25){
    const batch=group.subjects.slice(start,start+25);
    let subjects:Principal[];
    try {
      subjects=batch.map(subject=>Principal.fromText(subject));
    } catch {
      readFailure={sourceGroup,reason:'invalid_candidate_principal',batchSize:batch.length};
      break groupLoop;
    }
    try {
      const reply=await readers.get(group.source)!.read_dev_private_club_name_replica_coverage(
        subjects,group.club);
      if('Err' in reply){
        readFailure={sourceGroup,
          reason:classifyDevNameCoverageFailure(reply.Err,{backend:true}),batchSize:batch.length};
        break groupLoop;
      }
      if(!Array.isArray(reply.Ok)||reply.Ok.length!==batch.length||
         reply.Ok.some((row,i)=>!row||!row.subject||typeof row.state!=='string'||
           row.subject.toText()!==batch[i])){
        readFailure={sourceGroup,reason:'metadata_reply_mismatch',batchSize:batch.length};
        break groupLoop;
      }
      for(const row of reply.Ok)observed.push({
        source:group.source,club:group.club,subject:row.subject.toText(),state:row.state});
    } catch(error) {
      readFailure={sourceGroup,
        reason:classifyDevNameCoverageFailure(error),batchSize:batch.length};
      break groupLoop;
    }
  }
}
// A failed first-batch read previously threw before writing any artifact.
// Always record a privacy-safe blocked report, even for a transport error.
// A second full source snapshot still tests whether the membership set moved.
let stable=false,sourceReadbackFailed=false;
try {
  const second=await getSnapshot();
  stable=first.fingerprint===second.fingerprint;
} catch {
  sourceReadbackFailed=true;
}
// Hard-pinned to the currently verified Group 2 DEV U10 parent roster.
// The original encrypted-name references belong to G1. The artifact emits
// ONLY the two disposable test labels and status codes, never subject IDs.
const parentFocus=stable
  ? assessDevG2TestParentNameCopies(first,plan,observed,{
      club:'177f8c01-3617-402a-aedd-5c5c17ccfde1',
      test2:'pfslb-rpozk-543m5-zll3a-a3ay4-rdg3b-elojg-ukmfs-e624l-6rjyp-jae',
      otherParent:'mfmwy-tuspw-6ikuj-mfaqb-le2p3-ndi4w-a5caq-cwcit-xhnob-lidne-fae',
    })
  : {
      focus:'dev-g2-test-u10-other-parents',state:'snapshot_unverified',
      noNamesOrKeysExported:true,readyToReleaseName:false,
      nameReadAuthorised:false,
    };
const report={
  ...summarizeDevClubNameCoverage(plan,observed,
    {snapshotStable:stable,backendReaderInstalled:readFailure===null}),
  parentFocus,
  ...(readFailure?{readFailure}:{ }),
  sourceReadbackFailed,
};
mkdirSync(resolve(reportDir),{recursive:true});
writeFileSync(resolve(reportDir,'check.json'),JSON.stringify(report,null,2)+'\n');
console.log('DEV club-name copy coverage: '+report.status+
  '; club/source copies='+report.distinctClubSourceCopies+
  '; verified='+report.copyCounts.copy_verified+
  '; unknown='+report.copyCounts.unverified+
  '; READY_TO_RELEASE=false. No names, ciphertext or keys were exported.');
if(readFailure){
  console.error('Protected DEV copy metadata read blocked: '+readFailure.sourceGroup+
    ' / '+readFailure.reason+'; sanitized count-only report saved');
  throw Error('Protected DEV replica metadata read failed: '+readFailure.reason+
    ' in '+readFailure.sourceGroup+'; no coverage was inferred for missing results');
}
if(!stable)throw Error('DEV membership/account snapshots changed or could not be read; no coverage attested');
// Do NOT enable keys, upgrades or frontend releases. The protected audit
// can complete with an explicit blocked report while old reader modules run.
