import { createHash } from 'node:crypto';
export const ADMISSION_CONFIRMATION = 'COMMISSION OPENCLOUD PROD ADMISSION';
const MEMBER_SERVICES = ['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','media_blob_store'];
const AUTHORITY='IGNITE_ACCOUNT_SERVICE_IDENTITY',ADMISSION='IGNITE_ACCOUNT_ADMISSION_RELEASE',REMOVAL='IGNITE_ACCOUNT_REMOVAL_RELEASE',REHEARSAL='IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL';
export function memberReaders(rows) {
  const readers=rows.filter(row=>row.scope!=='shared'&&MEMBER_SERVICES.includes(row.service));
  if(rows.length!==32||readers.length!==24||new Set(readers.map(r=>r.id)).size!==24||!['g1','g2'].every(g=>readers.filter(r=>r.scope===g).length===12))throw Error('Exactly 24 distinct member readers across base and g2 required');
  return readers.sort((a,b)=>a.id.localeCompare(b.id));
}
export function admissionEnvironment(current,identity) {
  if(!Array.isArray(current))throw Error('Current reader environment required');
  const vars=new Map(current.map(r=>[r.name,r.value]));
  if(vars.size!==current.length)throw Error('Duplicate reader environment names');
  if(vars.get(REMOVAL)==='1'||vars.get(REHEARSAL)==='1')throw Error('Removal and rehearsal must remain off');
  if(vars.has(AUTHORITY)&&vars.get(AUTHORITY)!==identity)throw Error('Foreign account authority');
  vars.set(AUTHORITY,identity);vars.set(ADMISSION,'1');
  return [...vars].map(([name,value])=>({name,value})).sort((a,b)=>a.name.localeCompare(b.name));
}
export function assertAdmissionEnvironment(current,identity) {
  const expected=admissionEnvironment(current,identity);
  const canonical=items=>JSON.stringify(items.map(({name,value})=>[name,value]).sort((a,b)=>a[0].localeCompare(b[0])));
  if(canonical(current)!==canonical(expected))throw Error('Reader admission readback mismatch');
}
export function planDigest({sourceCommit,registryRevision,modules,targets}) {
  return createHash('sha256').update(JSON.stringify({purpose:'OpenCloud PROD existing-account admission-only commissioning',sourceCommit,registryRevision:String(registryRevision),modules:modules.map(([id,hash])=>[id,String(hash)]).sort(),targets:targets.map(r=>({name:r.name,id:r.id,environment:admissionEnvironment(r.environment,r.identity)})),removalRelease:false,recoveryRelease:false,routingApproval:false,groupOpening:false})).digest('hex');
}
export function sanitizeAccountDiagnostics(rows) {
  if(!Array.isArray(rows))throw Error('Account diagnostics required');
  return rows.map(r=>({accountId:r.account_id,profilePresent:r.profile_present,opaqueNameReference:r.opaque_name_reference,encryptedNamePresence:r.presence.map(p=>({subject:p.subject.toText(),authority:p.authority.toText(),validOwnedCiphertext:p.valid_owned_ciphertext}))}));
}
