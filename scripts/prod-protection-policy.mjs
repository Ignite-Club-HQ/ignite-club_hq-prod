import {createHash} from 'node:crypto';
import {canonical} from './prod-base-group-policy.mjs';
import {assertGroupsClosed} from './prod-safeguard-live-policy.mjs';
export const PROTECTION_CONFIRMATION='ACTIVATE PROD PROTECTIONS CLOSED';
export const PROTECTION_RECEIPT={branch:'prod-group-setup',path:'prod-group-setup/protection-activation.json',label:'protection activation'};
export const HUMAN_DOMAINS=['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain',
  'mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','media_blob_store'];
export const APPROVAL_LIFETIME_NS=24n*60n*60n*1_000_000_000n;
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
// This candidate is deliberately not executable until independent live history,
// witness implementation pins and atomic acknowledgement recovery are proved.
// No environment/form flag can bypass this release hold.
export function requireProtectionExecutionReady() {
  throw Error('Protection activation implementation review incomplete; no live execution');
}
export function assertProtectionContext(env) {
  if(env.GITHUB_REPOSITORY!=='Ignite-Club-HQ/ignite-club_hq-prod'||env.GITHUB_REF!=='refs/heads/prod'||env.IGNITE_ICP_ENV!=='prod'||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')||env.CONFIRMATION?.trim()!==PROTECTION_CONFIRMATION)throw Error('Exact closed production activation context required');
}
export function activationTargets(ids,page,base,g2) {
  assertGroupsClosed(page);
  if(base?.phase!=='registered-closed'||base.pending!==null||g2?.phase!=='registered-closed'||g2.pending!==null)
    throw Error('Acknowledged original group registration receipts required');
  const expected={base:base.plan,g2:g2.plan};
  const targets=new Map();
  for(const group of page.groups){
    const plan=expected[group.id];
    const placement=page.placements.find(p=>p.group_id===group.id);
    if(!plan||canonical(group.domains)!==canonical(plan.group.domains)||canonical(group.photo_store)!==canonical(plan.group.photo_store)||
      canonical(placement)!==canonical(plan.placement)||placement.deployment_id!=='prod'||placement.host!=='https://icp-api.io'||
      placement.network_kind!=='public_mainnet'||placement.additional_subnets_enabled||placement.approved_subnets.length!==1)
      throw Error('Live groups differ from independently recorded original inventory');
    for(const d of [...group.domains,...group.photo_store.map(canister=>({domain:'media_blob_store',canister}))]){
      const old=targets.get(d.canister);
      if(old&&(d.domain!=='secret_workload_identity'||old.name!==d.domain))throw Error('Unexpected shared receiver');
      targets.set(d.canister,{name:d.domain,id:d.canister,group:old?'shared':group.id,subnet:placement.primary_subnet,human:HUMAN_DOMAINS.includes(d.domain)});
    }
  }
  targets.set(ids.shard_router,{name:'shard_router',id:ids.shard_router,group:'shared',subnet:expected.base.placement.primary_subnet,human:false});
  const rows=[...targets.values()].sort((a,b)=>a.id.localeCompare(b.id));
  if(rows.length!==28||rows.filter(t=>t.human).length!==24||rows.some(t=>t.id===ids.identity_access))throw Error('Exact twenty eight receivers and twenty four readers required');
  for(const t of rows.filter(t=>t.group==='base'||t.name==='secret_workload_identity'||t.name==='shard_router'))
    if(ids[t.name]!==t.id)throw Error('Original base mapping mismatch');
  return rows;
}
// Preserve every unrelated setting; never export environment values.
export function protectionEnvironment(rows,identity) {
  const entries=new Map(rows.map(r=>[r.name,r.value]));
  if(entries.get('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL')==='1')throw Error('Rehearsal forbidden on production');
  const old=entries.get('IGNITE_ACCOUNT_SERVICE_IDENTITY');
  if(old&&old!==identity)throw Error('Foreign account authority requires separate review');
  entries.set('IGNITE_ACCOUNT_SERVICE_IDENTITY',identity);
  entries.set('IGNITE_ACCOUNT_ADMISSION_RELEASE','1');entries.set('IGNITE_ACCOUNT_REMOVAL_RELEASE','1');
  return [...entries].map(([name,value])=>({name,value}));
}
export function verifyActivatedDraft(draft,targets,identity) {
  const ids=targets.map(t=>t.id).sort();
  const readers=targets.filter(t=>t.human).map(t=>t.id).sort();
  if(draft.release_authorized!==false||draft.recovery_accepted!==false||canonical(draft.targets.slice().sort())!==canonical(ids)||
    canonical(draft.account_readers.slice().sort())!==canonical(readers)||canonical(draft.eligibility_readers.slice().sort())!==canonical(readers)||
    draft.configurations.length!==28||new Set(draft.configurations.map(c=>c.receiver)).size!==28||draft.lifecycle.length!==29||
    new Set(draft.lifecycle.map(l=>l.canister)).size!==29||!draft.lifecycle.some(l=>l.canister===identity))throw Error('Incomplete effective production review');
  for(const t of targets){const c=draft.configurations.find(c=>c.receiver===t.id);
    if(!c||c.authority?.length!==1||c.authority[0]!==identity||c.protocol!==1||c.rehearsal!==false||c.removal_enabled!==true||c.admission_required!==t.human)
      throw Error('Effective receiver configuration mismatch');}
  return true;
}
export function assertNoPending(receipt) {if(receipt?.pending)throw Error('Unresolved activation intent requires read only reconciliation');}