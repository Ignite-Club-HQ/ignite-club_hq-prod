import { digest } from './all-group-upgrade-policy.mjs';

// Immutable historical check #44478590675; refresh through a reviewed PR
// rather than silently treating new source or live settings as approved.
export const FIRST_CONTENT_DEV = Object.freeze({
  sourceBaseline: 'e7b74c79f7604e4383e957c826f5f34e2d4bf2d4',
  governor: 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae',
  subnet: 'e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe',
  originalPlan: 'ebde8a6546cdc2bea30abf99ff07c6c809c0f44aea2d07c5bc60f7c2621feb40',
  identity: Object.freeze({
    name:'identity_access',groupId:'shared',id:'mq2sj-fiaaa-aaaal-qxlqa-cai',
    old:'579d4d7983858cde6c6aa817c809159ccc1448a227a8947e58da7ef4fefa2b65',
    next:'6fa6b030be740ccdcd0293fb463333e6e7eb4770ad9c3828ef3b65fbf914eb4c',
    settings:'d6752c81f2b0a38107b196f696dfe8a61f1c363f05fade25aec5d740db643e98'
  }),
  club:Object.freeze({
    name:'club_domain',groupId:'g2',id:'yfwyv-nyaaa-aaaal-qxpyq-cai',
    old:'84ea7c5c55a0e4d3ed3948a8780bcafb1ca8b696e6e7ee234f5eeb31700941b0',
    next:'2a2361a11b76075d6cf9567e9667f72839ee5fe56ed0f23dd1d85860d171062f',
    settings:'80410bd8deeab72e2aedd1c28d0bd9d962ad742b43db30e5c84b9371e849deac'
  })
});
export const STAGE_CONFIRMATIONS = Object.freeze({
  identity:'UPGRADE EXACT DEV SHARED IDENTITY FIRST',
  g2_club:'UPGRADE EXACT DEV GROUP 2 CLUB SECOND'
});
const fail=message=>{throw Error(message)};
const hex64=s=>typeof s==='string' && /^[a-f0-9]{64}$/.test(s);
const expected=(stage,service)=>stage==='identity'?service.old:service.name==='identity_access'?service.next:service.old;

export function verifyFirstContentStage({action,stage,confirmation='',checkedPlan='',sourceRevision,candidateHashes,report}) {
  if(!['check','upgrade'].includes(action))fail('Only check or explicitly approved upgrade is supported; never recover/retry automatically');
  if(!Object.hasOwn(STAGE_CONFIRMATIONS,stage))fail('Choose exact Identity-first or Group 2 Club-second stage');
  if(!/^[a-f0-9]{40}$/.test(sourceRevision??''))fail('Pinned source SHA required');
  if(!report || report.liveAcceptance!==false || !report.binding)fail('Fresh read-only all-group preflight report required');
  const b=report.binding;
  if(b.repo!=='Ignite-Club-HQ/ignite-club_hq-prod'||b.release!==sourceRevision||
      b.scope!=='dev_first_content_admission_preflight'||b.governor!==FIRST_CONTENT_DEV.governor||
      b.router!=='jcdfe-vqaaa-aaaal-qxloq-cai'||b.host!=='https://icp-api.io'||
      !hex64(report.planHash)||digest(b)!==report.planHash)
    fail('Read-only preflight source, binding or plan does not match this release');
  if(!Array.isArray(report.targets)||report.targets.length!==2||!Array.isArray(b.targets)||b.targets.length!==2)
    fail('Exactly two live preflight targets required');
  const services=[FIRST_CONTENT_DEV.identity,FIRST_CONTENT_DEV.club];
  for(let i=0;i<2;i++){
    const s=services[i],current=report.targets[i],target=b.targets[i];
    if(!current||!target||!current.canisterId||!target.canisterId||
        current.canisterId!==s.id||target.canisterId!==s.id||
        current.name!==s.name||target.name!==s.name||
        current.groupId!==s.groupId||target.groupId!==s.groupId||
        current.subnetId!==FIRST_CONTENT_DEV.subnet||target.subnetId!==FIRST_CONTENT_DEV.subnet||
        current.newHash!==s.next||target.newHash!==s.next||
        candidateHashes?.[s.name]!==s.next||
        current.moduleHash!==expected(stage,s)||
        current.settingsHash!==s.settings||current.rawSettingsHash!==s.settings||
        !(BigInt(current.cycles??0)>1_000_000_000_000n))
      fail('DEV stage has wrong target, built module, original settings, lifecycle or 1T cycles floor: '+s.name);
  }
  if(!b.wiring || Object.keys(b.wiring).length!==1 ||
     b.wiring[FIRST_CONTENT_DEV.club.id]!=='49d56de478b4e4488b1753bbb552877997aff303aa3fc022ad7ea9e2dc0650cd')
     fail('G2 club-to-Identity and peer-service wiring drift');
  if(!b.pii || Object.keys(b.pii).length!==2||
      b.pii.g1!=='iui5p-aaaaa-aaaal-qxllq-cai'||
      b.pii.g2!=='zt5a6-yiaaa-aaaal-qxp5q-cai')
    fail('PII key-holder continuity inventory drift');
  const binding={
    sourceRevision,stage,scope:b.scope,preflightPlan:report.planHash,
    routerRevision:b.configurationRevision,
    targets:services.map(s=>({name:s.name,groupId:s.groupId,canisterId:s.id,
      installed:expected(stage,s),candidate:s.next,settings:s.settings})),
    wiring:b.wiring,pii:b.pii
  };
  const planHash=digest(binding);
  if(action==='check') {
    if(confirmation||checkedPlan)fail('Leave confirmation and checked-plan fields empty during check');
  }else{
    if(confirmation!==STAGE_CONFIRMATIONS[stage])fail('Exact stage-specific confirmation required');
    if(!hex64(checkedPlan)||checkedPlan!==planHash)fail('Fresh stage check plan hash required from same source, live module and settings');
  }
  return {binding,planHash,target:stage==='identity'?FIRST_CONTENT_DEV.identity:FIRST_CONTENT_DEV.club};
}
