// Pure evaluator for the governor-only DEV replica audit. No network, keys,
// ciphertext, plaintext or account identifiers ever appear in its report.
export const PII = Object.freeze({
  g1:'iui5p-aaaaa-aaaal-qxllq-cai',
  g2:'zt5a6-yiaaa-aaaal-qxp5q-cai',
});
const statuses=['copy_verified','copy_missing','copy_invalid','original_missing','original_invalid','ambiguous'];
const pinnedSources=new Set(Object.values(PII));
const refRE=/^pii-display-name:v1:([a-z0-9-]+):([a-z0-9-]+)$/;
const text=v=>typeof v==='string'&&v.length>0&&v.length<=256;
const p=v=>typeof v==='string'?v:v?.toText?.();

export function planDevClubNameCoverage({g1,g2,accounts}) {
  if(!Array.isArray(g1)||!Array.isArray(g2)||!Array.isArray(accounts))
    throw Error('Complete signed DEV source and account inventories required');
  const aliases=new Map(),clubs=new Map(),edges=[['g1',g1],['g2',g2]];
  for(const row of accounts){
    if(!row||!text(row.account_id)||!Array.isArray(row.principals)||row.principals.length===0)
      throw Error('Invalid governed account inventory');
    for(const principal of row.principals){
      const id=p(principal);
      if(!text(id)||aliases.has(id))throw Error('Ambiguous account alias inventory');
      aliases.set(id,row);
    }
  }
  const exclusions=new Set();
  for(const [group,rows] of edges){
    if(rows.length>100000)throw Error('DEV membership source exceeds audit bound');
    for(const edge of rows){
      if(edge.Club){
        const {id,deleted}=edge.Club;
        if(!text(id)||typeof deleted!=='boolean'||clubs.has(id))
          throw Error('Ambiguous DEV club ownership');
        clubs.set(id,{group,active:!deleted});
      }
      if(edge.Excluded){
        const {club,subject}=edge.Excluded;
        if(!text(club)||!text(p(subject)))throw Error('Invalid exclusion');
        exclusions.add(JSON.stringify([club,p(subject)]));
      }
    }
  }
  if(clubs.size===0)throw Error('No verified DEV club inventory');
  const candidates=new Map(),issues={missing_account:0,missing_profile:0,legacy_plaintext:0,invalid_reference:0,inactive_account:0,ambiguous_membership:0};
  for(const [group,rows] of edges)for(const edge of rows){
    if(!edge.Role)continue;
    const club=edge.Role.club?.[0]??(typeof edge.Role.club==='string'?edge.Role.club:null);
    const subject=p(edge.Role.subject);
    if(!club)continue; // Global app-admin grant is not a club membership.
    if(!text(subject)||!text(club))throw Error('Invalid club role principal');
    const owner=clubs.get(club);
    if(!owner||!owner.active||owner.group!==group) {
      issues.ambiguous_membership++;continue;
    }
    if(exclusions.has(JSON.stringify([club,subject])))continue;
    const account=aliases.get(subject);
    if(!account){issues.missing_account++;continue}
    const status=account.status;
    if(!status || (!Object.hasOwn(status,'Active') && status!=='Active')){
      issues.inactive_account++;continue;
    }
    const profile=account.profile?.[0]??(Array.isArray(account.profile)?null:account.profile);
    if(!profile){issues.missing_profile++;continue}
    const display=profile.display_name;
    if(!text(display)){issues.missing_profile++;continue}
    if(!display.startsWith('pii-display-name:')){issues.legacy_plaintext++;continue}
    const match=refRE.exec(display);
    if(!match||!pinnedSources.has(match[1])||!account.principals.some(x=>p(x)===match[2])){
      issues.invalid_reference++;continue;
    }
    const key=JSON.stringify([match[1],match[2],club]);
    candidates.set(key,{source:match[1],subject:match[2],club});
    if(candidates.size>100000)throw Error('DEV audit candidate budget exceeded');
  }
  return {targets:[...candidates.values()].sort((a,b)=>
    JSON.stringify([a.source,a.subject,a.club]).localeCompare(JSON.stringify([b.source,b.subject,b.club]))),
    clubCount:[...clubs.values()].filter(c=>c.active).length,
    issues};
}

export function summarizeDevClubNameCoverage(plan,observations,{snapshotStable=false,backendReaderInstalled=false}={}){
  if(!plan||!Array.isArray(plan.targets)||!Array.isArray(observations))throw Error('Complete audit plan required');
  const expected=new Set(plan.targets.map(x=>JSON.stringify([x.source,x.subject,x.club])));
  const seen=new Set(),copyCounts=Object.fromEntries(statuses.map(x=>[x,0]));
  copyCounts.unverified=0;
  for(const r of observations){
    const key=JSON.stringify([r.source,r.subject,r.club]);
    if(!expected.has(key)||seen.has(key))throw Error('Foreign or duplicate coverage observation');
    if(!statuses.includes(r.state)&&r.state!=='unverified')throw Error('Unsupported private-name coverage state');
    copyCounts[r.state]++;seen.add(key);
  }
  copyCounts.unverified+=expected.size-seen.size;
  const blockers=Object.fromEntries(Object.entries(plan.issues).filter(([,n])=>n>0));
  // Security release requires independent authorised-read, outsider denial,
  // owner-copy coverage and immutable key provenance. This metadata-only audit
  // is intentionally NOT capable of granting it.
  const completeMetadata=Boolean(snapshotStable&&backendReaderInstalled&&
    plan.clubCount>0&&expected.size>0&&copyCounts.copy_verified===expected.size&&
    Object.values(plan.issues).every(n=>n===0));
  return {
    audit:'dev-g1-g2-club-name-copy-coverage',status:completeMetadata?'metadata-coverage-complete-release-blocked':'incomplete-release-blocked',
    clubCount:plan.clubCount,distinctClubSourceCopies:expected.size,
    copyCounts,blockers,snapshotStable:Boolean(snapshotStable),
    backendReaderInstalled:Boolean(backendReaderInstalled),
    noNamesOrKeysExported:true,readyToReleaseName:false,nameReadAuthorised:false,
    missingOwnerAuthorisedReadAndDenialAcceptance:true,
  };
}

// Return strictly allowlisted technical codes: the original rejection and
// transport error strings never leave the governor-only runner. In particular,
// unknown exception text can include a request URL, principal or account ID.
const backendRejections=Object.freeze({
  'Governor required':'governor_denied',
  'Only pinned DEV name authorities permitted':'dev_authority_mismatch',
  'Bounded exact DEV club-name coverage required':'invalid_batch_or_club',
  'Distinct nonanonymous subjects required':'invalid_batch_subject',
});
export function classifyDevNameCoverageFailure(error,{backend=false}={}) {
  const reason=typeof error==='string'?error:error instanceof Error?error.message:'';
  if(backend)return Object.hasOwn(backendRejections,reason)
    ? backendRejections[reason]:'backend_refused_other';
  if(/not found|unknown method|has no (?:update )?method|no such method|does not have a method/i.test(reason))
    return 'reader_method_unavailable';
  if(/deadline|timed? ?out|timeout|aborted/i.test(reason))
    return 'transport_deadline';
  if(/out of instructions|instruction limit|exceeded.*instruction|out of cycles|resource exhausted/i.test(reason))
    return 'canister_resource_limit';
  if(/candid|idl|decode|encode|unexpected (?:variant|reply|response)/i.test(reason))
    return 'candid_response_failure';
  if(/network|fetch|gateway|unavailable|503|502|reject|replica/i.test(reason))
    return 'transport_rejected';
  return 'transport_unclassified';
}
