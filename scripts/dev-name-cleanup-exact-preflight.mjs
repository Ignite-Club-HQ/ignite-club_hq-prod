/**
 * Privacy-safe exact-edge review preflight for the existing protected DEV name audit.
 * Reuses its same governor snapshot; NEVER calls canisters or authorises deletion.
 * Item labels are relative to the pinned source fingerprint (not stable user IDs).
 */
import {createHash} from 'node:crypto';
import {triageDevNameBlockers} from './dev-name-cleanup-triage.mjs';

const text = x => typeof x==='string' ? x : x?.toText?.();
const roleClub = r => r?.club?.[0] ?? (typeof r?.club==='string' ? r.club : null);
const active = s => s==='Active'||!!s&&Object.hasOwn(s,'Active');
const display = a => (Array.isArray(a?.profile)?a.profile[0]:a?.profile)?.display_name;
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export function buildDevNameCleanupPreflight(snapshot,expectedIssues) {
  if (!snapshot || !/^[a-f0-9]{64}$/.test(snapshot.fingerprint??''))
    throw Error('Stable DEV source fingerprint required');
  // Shares the existing count-only classifier as a consistency gate.
  const triage = triageDevNameBlockers(snapshot,expectedIssues);
  const edges=[['g1',snapshot.g1],['g2',snapshot.g2]];
  const clubs=new Map(), aliases=new Map(), family=new Set(), exclusions=new Set();
  const roleCounts=new Map(), globalRoles=new Set();
  for (const a of snapshot.accounts) for (const p of a.principals) {
    const id=text(p);
    if(!id || aliases.has(id))throw Error('Duplicate or invalid account alias');
    aliases.set(id,a);
  }
  for(const [source,rows] of edges)for(const edge of rows){
    if(edge.Club){
      if(clubs.has(edge.Club.id))throw Error('Ambiguous club source');
      clubs.set(edge.Club.id,{source,deleted:edge.Club.deleted});
    }
    if(edge.Parent||edge.Guardian){
      const subject=text((edge.Parent||edge.Guardian).subject);
      if(subject)family.add(subject);
    }
    if(edge.Excluded)
      exclusions.add(JSON.stringify([edge.Excluded.club,text(edge.Excluded.subject)]));
    if(edge.Role){
      const p=text(edge.Role.subject),club=roleClub(edge.Role);
      if(!p)throw Error('Invalid role subject');
      if(!club)globalRoles.add(p);
      roleCounts.set(p,(roleCounts.get(p)??0)+1);
    }
  }
  const rows=[];
  for(const [source,items] of edges)for(const edge of items){
    if(!edge.Role)continue;
    const subject=text(edge.Role.subject),club=roleClub(edge.Role);
    if(!club)continue;
    const owner=clubs.get(club);
    let kind;
    if(!owner)kind='unknown_club';
    else if(owner.deleted)kind='deleted_club';
    else if(owner.source!==source)kind='wrong_group';
    else {
      if(exclusions.has(JSON.stringify([club,subject])))continue;
      const account=aliases.get(subject);
      if(!account)kind='missing_account';
      else if(active(account.status)){
        const name=display(account);
        if(typeof name==='string'&&name.length>0&&name.length<=256&&!name.startsWith('pii-display-name:'))
          kind='legacy_name';
      }
    }
    if(!kind)continue;
    const account=aliases.get(subject);
    const dependency=family.has(subject)?'family_link_present':
      globalRoles.has(subject)?'global_role_present':
      (roleCounts.get(subject)??0)>1?'other_role_edges_present':
      account?'account_present':'none_observed_not_proven_absent';
    rows.push({source,kind,club,subject,dependency});
  }
  rows.sort((a,b)=>JSON.stringify([a.source,a.kind,a.club,a.subject])
    .localeCompare(JSON.stringify([b.source,b.kind,b.club,b.subject])));
  const counts={missing_account:0,legacy_plaintext:0,ambiguous_membership:0};
  for(const row of rows){
    if(row.kind==='missing_account')counts.missing_account++;
    else if(row.kind==='legacy_name')counts.legacy_plaintext++;
    else counts.ambiguous_membership++;
  }
  for(const [kind,count] of Object.entries(counts))
    if(expectedIssues[kind]!==count)throw Error('Exact candidate set differs from protected audit: '+kind);
  const exactPlanHash=digest({version:'dev-name-exact-review-v1',source:snapshot.fingerprint,
    items:rows.map(({source,kind,club,subject,dependency})=>[source,kind,club,subject,dependency])});
  const ordinals=new Map();
  const reviewItems=rows.map(row=>{
    const marker=row.source+'-'+row.kind;
    const n=(ordinals.get(marker)??0)+1;ordinals.set(marker,n);
    return {
      handle:row.source.toUpperCase()+'-'+row.kind.toUpperCase().replaceAll('_','-')+'-'+String(n).padStart(2,'0'),
      sourceGroup:row.source,
      finding:row.kind,
      dependency:row.dependency,
      disposition:row.kind==='legacy_name'?'PRESERVE_ACCOUNT_REVIEW_NAME':'EXACT_GRANT_REVIEW_REQUIRED',
      exactRoleGrantReadbackRequired:true,
      approvedForDeletion:false,
    };
  });
  // Never return raw rows, club ids, subjects, account ids, names or ciphertext.
  return {
    version:'dev-name-exact-review-v1',sourceFingerprint:snapshot.fingerprint,
    exactPlanHash,reviewItems,counts,triageSummary:triage.observedIssues,
    readOnly:true,approvedForDeletion:false,
    requiresFreshAuthorisedGrantReadback:true,
    mustPreserveActiveLegacyAccounts:true,
    noPersonalIdentifiersExported:true,
  };
}
